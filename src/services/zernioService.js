/**
 * zernioService.js — LinkedIn + Pinterest via the Zernio unified API.
 *
 * v4.1 rewrite. What was broken and what changed (details in /context.md):
 *
 *  1. `overview` came back as `{}` for Pinterest even though posts existed,
 *     because buildOverview() only emitted metrics whose value was > 0.
 *     → A per-platform metric CATALOGUE is now always emitted (zeros included)
 *       plus any extra non-zero keys Zernio sends, so nothing is hidden.
 *  2. `meta.account` was `null` because `/v1/accounts?limit=50` failed and the
 *     error was swallowed by a catch-all that returned `{accounts: []}`.
 *     → getAccounts() now retries with different param shapes, records the
 *       failure in `meta.diagnostics.accountError` and surfaces it as a notice.
 *  3. Pinterest account stats (pins, boards, monthly views) were fetched but
 *     never rendered, and boards were never fetched at all.
 *     → accountStats are exposed as gauge metrics + `meta.account`, and
 *       `/v1/accounts/{id}/pinterest-boards` is read for real board data.
 *  4. Every trend was hard-coded to 0.
 *     → Trends now compare the 2nd half of the range with the 1st half.
 *  5. Timeseries only contained days that had activity, so charts had holes.
 *     → The range is filled densely (one row per day) with `hasData` flags.
 *  6. External (non-Zernio-published) pins/posts never got analytics because
 *     the sync call used a stale endpoint.
 *     → We now POST /v1/posts/sync-external per external post URL (capped,
 *       cached 10 min) and report what happened in `meta.sync`.
 */
const axios = require('axios');
const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { summarize, pctChange, round, sum, labelOf } = require('../utils/metrics');

const ZB = config.ZERNIO_BASE_URL;
const TIMEOUT = 30000;
const SYNC_TTL_MS = 10 * 60 * 1000;
const syncCache = {};

const headers = () => ({
  Authorization: 'Bearer ' + config.ZERNIO_API_KEY,
  'Content-Type': 'application/json',
});

async function zGet(path, params = {}) {
  const { data } = await axios.get(ZB + path, { headers: headers(), params, timeout: TIMEOUT });
  return data;
}
async function zPost(path, body = {}) {
  const { data } = await axios.post(ZB + path, body, { headers: headers(), timeout: TIMEOUT });
  return data;
}

/** Human-readable message for any axios/other error. */
function describeError(e) {
  const status = e.response?.status;
  const body = e.response?.data;
  const msg =
    (typeof body === 'string' && body) ||
    body?.error?.message ||
    body?.error ||
    body?.message ||
    e.message ||
    'Unknown error';
  return status ? `HTTP ${status} — ${msg}` : String(msg);
}
function isAuthError(e) {
  return [401, 402, 403].includes(e.response?.status);
}

// ────────────────────────────────────────────────────────────────
// Accounts
// ────────────────────────────────────────────────────────────────
async function getAccounts(platform) {
  if (!config.ZERNIO_API_KEY) {
    return { accounts: [], all: [], hasAnalyticsAccess: false, error: 'ZERNIO_API_KEY is not set' };
  }
  // Different Zernio deployments/plans tolerate different query shapes.
  const attempts = [{ limit: 50 }, {}, { platform, limit: 50 }];
  let lastError = null;
  for (const params of attempts) {
    try {
      const d = await zGet('/v1/accounts', params);
      const all = Array.isArray(d) ? d : d.accounts || d.data || [];
      const accounts = platform
        ? all.filter((a) => String(a.platform || '').toLowerCase() === platform)
        : all;
      if (accounts.length || all.length) {
        return {
          accounts,
          all,
          hasAnalyticsAccess: d.hasAnalyticsAccess !== false,
          hasAnalyticsAccessRaw: d.hasAnalyticsAccess ?? null,
          error: null,
          attempt: JSON.stringify(params),
        };
      }
      lastError = lastError || `Zernio returned 0 accounts for platform "${platform}"`;
    } catch (e) {
      lastError = describeError(e);
      if (isAuthError(e)) break; // retrying won't help for auth/billing errors
    }
  }
  return { accounts: [], all: [], hasAnalyticsAccess: false, error: lastError };
}

function pick(...cands) {
  for (const c of cands) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim() !== '' && !Number.isNaN(Number(c))) return Number(c);
  }
  return null;
}

function buildAccount(a) {
  if (!a) return null;
  const stats = a.accountStats || a.stats || {};
  return {
    zernioAccountId: a._id || a.id || null,
    platform: a.platform || '',
    username: a.username || a.handle || '',
    displayName: a.displayName || a.name || a.username || '',
    profilePicture: a.profilePicture || a.avatar || a.profileImage || null,
    profileUrl: a.profileUrl || a.accountUrl || null,
    followers: pick(a.currentFollowers, a.followersCount, stats.followers, a.followers) || 0,
    following: pick(a.followingCount, stats.following, a.following),
    pinCount: pick(stats.pinCount, a.pinCount, stats.pins),
    boardCount: pick(stats.boardCount, a.boardCount, stats.boards),
    monthlyViews: pick(stats.monthlyViews, a.monthlyViews, stats.views),
    externalPostCount: pick(a.externalPostCount, stats.externalPostCount) || 0,
    lastSyncedAt: a.analyticsLastSyncedAt || a.lastSyncedAt || a.lastUpdated || null,
    connectedAt: a.connectedAt || a.createdAt || null,
    tokenExpiresAt: a.tokenExpiresAt || null,
    isActive: a.isActive !== false,
    accountType: a.accountType || a.metadata?.accountType || null,
    rawStats: stats && Object.keys(stats).length ? stats : undefined,
  };
}

// ────────────────────────────────────────────────────────────────
// Follower history
// ────────────────────────────────────────────────────────────────
async function getFollowerStats(platform, accountId) {
  try {
    const d = await zGet('/v1/accounts/follower-stats', {
      platform,
      ...(accountId ? { accountId } : {}),
      limit: 100,
    });
    const stats = d.stats || d.data || {};
    let rows = [];
    if (Array.isArray(stats)) rows = stats;
    else if (accountId && Array.isArray(stats[accountId])) rows = stats[accountId];
    else {
      // Unknown shape: take the first (or the matching) account bucket.
      const buckets = Object.entries(stats).filter(([, v]) => Array.isArray(v));
      const match = buckets.find(([k]) => k === accountId) || buckets[0];
      rows = match ? match[1] : [];
    }
    return {
      ok: true,
      rows: rows
        .filter((r) => r && r.date)
        .map((r) => ({
          date: String(r.date).slice(0, 10),
          followers: pick(r.followers, r.followerCount, r.count) || 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  } catch (e) {
    return { ok: false, rows: [], error: describeError(e) };
  }
}

// ────────────────────────────────────────────────────────────────
// Pinterest boards
// ────────────────────────────────────────────────────────────────
async function getPinterestBoards(accountId) {
  if (!accountId) return { ok: false, boards: [], error: 'no accountId' };
  const paths = [`/v1/accounts/${accountId}/pinterest-boards`, `/v1/accounts/${accountId}/boards`];
  let lastError = null;
  for (const p of paths) {
    try {
      const d = await zGet(p, { limit: 100 });
      const list = Array.isArray(d) ? d : d.boards || d.data || [];
      if (!Array.isArray(list)) {
        lastError = 'unexpected response shape';
        continue;
      }
      return {
        ok: true,
        boards: list.map((b) => ({
          id: b.id || b.boardId || b._id || null,
          name: b.name || b.title || 'Untitled board',
          pinCount: pick(b.pinCount, b.pin_count, b.pins),
          privacy: b.privacy || b.visibility || null,
          url: b.url || null,
        })),
      };
    } catch (e) {
      lastError = describeError(e);
      if (isAuthError(e)) break;
    }
  }
  return { ok: false, boards: [], error: lastError };
}

// ────────────────────────────────────────────────────────────────
// Post analytics
// ────────────────────────────────────────────────────────────────
async function getPostAnalytics(platform, query, diagnostics) {
  const { since, until } = parseDateRange(query, true);
  const fromDate = toDateStr(since);
  const toDate = toDateStr(until);
  const all = [];
  let page = 1;
  let totalPages = 1;
  let apiOverview = null;

  while (page <= totalPages && page <= 15) {
    try {
      const data = await zGet('/v1/analytics', {
        platform,
        fromDate,
        toDate,
        limit: 100,
        page,
        source: 'all',
        sortBy: 'date',
        order: 'desc',
      });
      const posts = data.posts || data.data || [];
      posts.forEach((p) => all.push(p));
      apiOverview = apiOverview || data.overview || data.stats || data.summary || null;
      totalPages = data.pagination?.pages || data.totalPages || 1;
      page += 1;
      if (!posts.length) break;
      await new Promise((r) => setTimeout(r, 250)); // be polite to the API
    } catch (e) {
      diagnostics.warnings.push(`analytics page ${page}: ${describeError(e)}`);
      if (e.response?.status === 402) {
        diagnostics.billing = true;
        throw Object.assign(new Error('Zernio analytics requires a paid plan (HTTP 402)'), {
          code: 'ZERNIO_PAYMENT_REQUIRED',
          httpStatus: 402,
        });
      }
      if (e.response?.status === 401) {
        throw Object.assign(new Error('Zernio API key rejected (HTTP 401)'), {
          code: 'ZERNIO_UNAUTHORIZED',
          httpStatus: 401,
        });
      }
      break;
    }
  }

  const seen = new Set();
  const posts = all.filter((p) => {
    const id = p.postId || p.latePostId || p.platformPostUrl || p.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { posts, apiOverview, pagesFetched: page - 1 };
}

/**
 * Zernio only returns post-level metrics for posts it knows about. External
 * posts (published natively on the platform) need an explicit sync first.
 */
async function syncExternalPosts(platform, accountId, posts) {
  const now = Date.now();
  const key = `${platform}:${accountId}`;
  if (syncCache[key] && now - syncCache[key].at < SYNC_TTL_MS) {
    return { skipped: true, reason: 'synced within the last 10 minutes', at: new Date(syncCache[key].at).toISOString() };
  }
  const candidates = posts
    .filter((p) => p.platformPostUrl && (p.isExternal || p.syncStatus !== 'synced'))
    .slice(0, 5);
  if (!accountId || !candidates.length) {
    syncCache[key] = { at: now };
    return { skipped: true, reason: candidates.length ? 'no accountId' : 'no external posts to sync', attempted: 0 };
  }
  syncCache[key] = { at: now };
  const results = await Promise.allSettled(
    candidates.map((p) =>
      zPost('/v1/posts/sync-external', { accountId, url: p.platformPostUrl }).catch(async (e) => {
        // Older deployments expose the legacy path.
        if (e.response?.status === 404) {
          return zPost('/v1/analytics/sync-external-posts', { accountId });
        }
        throw e;
      })
    )
  );
  return {
    skipped: false,
    attempted: candidates.length,
    synced: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
    errors: results
      .filter((r) => r.status === 'rejected')
      .slice(0, 3)
      .map((r) => describeError(r.reason)),
    note: 'Analytics for freshly synced posts can still lag 24–48h on Pinterest.',
  };
}

// ────────────────────────────────────────────────────────────────
// Metric catalogue — what each platform's overview ALWAYS shows
// ────────────────────────────────────────────────────────────────
const CATALOG = {
  pinterest: [
    { key: 'impressions', label: 'Impressions', kind: 'sum', group: 'Performance' },
    { key: 'clicks', label: 'Pin clicks', kind: 'sum', group: 'Performance' },
    { key: 'outboundClicks', label: 'Outbound clicks', kind: 'sum', group: 'Performance' },
    { key: 'saves', label: 'Saves', kind: 'sum', group: 'Engagement' },
    { key: 'closeups', label: 'Closeups', kind: 'sum', group: 'Engagement' },
    { key: 'views', label: 'Video views', kind: 'sum', group: 'Engagement' },
    { key: 'engagement', label: 'Total engagement', kind: 'sum', group: 'Engagement' },
    { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement' },
    { key: 'posts', label: 'Pins published', kind: 'count', group: 'Activity' },
    { key: 'followers', label: 'Followers', kind: 'gauge', group: 'Audience' },
    { key: 'pins', label: 'Total pins', kind: 'gauge', group: 'Audience' },
    { key: 'boards', label: 'Boards', kind: 'gauge', group: 'Audience' },
    { key: 'monthlyViews', label: 'Monthly views', kind: 'gauge', group: 'Audience' },
  ],
  linkedin: [
    { key: 'impressions', label: 'Impressions', kind: 'sum', group: 'Performance' },
    { key: 'reach', label: 'Reach', kind: 'sum', group: 'Performance' },
    { key: 'clicks', label: 'Clicks', kind: 'sum', group: 'Performance' },
    { key: 'likes', label: 'Reactions', kind: 'sum', group: 'Engagement' },
    { key: 'comments', label: 'Comments', kind: 'sum', group: 'Engagement' },
    { key: 'shares', label: 'Reposts', kind: 'sum', group: 'Engagement' },
    { key: 'saves', label: 'Saves', kind: 'sum', group: 'Engagement' },
    { key: 'sends', label: 'Sends', kind: 'sum', group: 'Engagement' },
    { key: 'follows', label: 'Follows from posts', kind: 'sum', group: 'Engagement' },
    { key: 'engagement', label: 'Total engagement', kind: 'sum', group: 'Engagement' },
    { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement' },
    { key: 'posts', label: 'Posts published', kind: 'count', group: 'Activity' },
    { key: 'followers', label: 'Followers', kind: 'gauge', group: 'Audience' },
  ],
};

const EMPTY_TOTALS = () => ({
  impressions: 0,
  reach: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  sends: 0,
  clicks: 0,
  outboundClicks: 0,
  closeups: 0,
  views: 0,
  follows: 0,
  reposts: 0,
  profileViews: 0,
  websiteClicks: 0,
  engagement: 0,
});

// ────────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────────
function enumerateDates(fromTs, toTs) {
  const out = [];
  const cur = new Date(toDateStr(fromTs) + 'T00:00:00Z');
  const end = new Date(toDateStr(toTs) + 'T00:00:00Z');
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}
function dateOf(post) {
  return String(post.publishedAt || post.scheduledFor || post.createdAt || '').slice(0, 10);
}
function splitDates(dates) {
  const mid = Math.floor(dates.length / 2);
  return { prev: new Set(dates.slice(0, mid)), cur: new Set(dates.slice(mid)) };
}

// ────────────────────────────────────────────────────────────────
// Post aggregation
// ────────────────────────────────────────────────────────────────
function readAnalytics(p) {
  const a = p.analytics || {};
  const t = EMPTY_TOTALS();
  t.impressions = pick(a.impressions, a.impression) || 0;
  t.reach = pick(a.reach) || 0;
  t.likes = pick(a.likes, a.reactions, a.reactionCount) || 0;
  t.comments = pick(a.comments, a.commentCount) || 0;
  t.shares = pick(a.shares, a.reposts, a.shareCount) || 0;
  t.saves = pick(a.saves, a.saveCount) || 0;
  t.sends = pick(a.sends) || 0;
  t.clicks = pick(a.clicks, a.pinClicks, a.linkClicks, a.clickCount) || 0;
  t.outboundClicks = pick(a.outboundClicks, a.outbound_clicks, a.websiteClicks) || 0;
  t.closeups = pick(a.closeups, a.closeUp) || 0;
  t.views = pick(a.views, a.videoViews) || 0;
  t.follows = pick(a.follows) || 0;
  t.reposts = pick(a.reposts) || 0;
  t.profileViews = pick(a.profileViews, a.profile_views) || 0;
  t.websiteClicks = pick(a.websiteClicks, a.website_clicks) || 0;
  t.engagement =
    t.likes + t.comments + t.shares + t.saves + t.sends + t.reposts + t.clicks;
  const er = pick(a.engagementRate, a.engagement_rate);
  t.engagementRate = er !== null ? er : null;
  t.lastUpdated = a.lastUpdated || null;
  return t;
}

function buildPostList(posts) {
  return posts.map((p) => {
    const a = readAnalytics(p);
    const denom = a.impressions || a.reach || 0;
    const er =
      a.engagementRate !== null
        ? round(a.engagementRate, 2)
        : denom > 0
        ? round((a.engagement / denom) * 100, 2)
        : 0;
    return {
      postId: p.postId || p.latePostId || p.id || '',
      content: (p.content || p.title || '').slice(0, 400),
      title: p.title || null,
      publishedAt: p.publishedAt || p.scheduledFor || null,
      date: dateOf(p) || null,
      platformUrl: p.platformPostUrl || p.permalink || '',
      mediaType: p.mediaType || p.type || 'text',
      mediaItems: p.mediaItems || [],
      thumbnailUrl: p.thumbnailUrl || p.mediaItems?.[0]?.thumbnail || p.mediaItems?.[0]?.url || '',
      status: p.status || 'unknown',
      platform: p.platform || 'unknown',
      boardName: p.boardName || p.board?.name || null,
      isExternal: Boolean(p.isExternal),
      syncStatus: p.syncStatus || (p.isExternal ? 'external' : 'late'),
      analytics: {
        impressions: a.impressions,
        reach: a.reach,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        saves: a.saves,
        sends: a.sends,
        clicks: a.clicks,
        outboundClicks: a.outboundClicks,
        views: a.views,
        follows: a.follows,
        engagement: a.engagement,
        engagementRate: er,
      },
    };
  });
}

function aggregate(posts, dates, dailyFollowers) {
  const totals = EMPTY_TOTALS();
  const byDate = {};
  const platformBreakdown = {};
  const ers = [];

  for (const date of dates) {
    byDate[date] = {
      date,
      posts: 0,
      impressions: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      sends: 0,
      clicks: 0,
      outboundClicks: 0,
      views: 0,
      follows: 0,
      engagement: 0,
      followers: dailyFollowers[date] ?? null,
    };
  }

  for (const p of posts) {
    const a = readAnalytics(p);
    for (const k of Object.keys(totals)) if (k in a) totals[k] += a[k];
    if (a.engagementRate !== null) ers.push(a.engagementRate);

    const pf = p.platform || 'unknown';
    if (!platformBreakdown[pf]) {
      platformBreakdown[pf] = {
        posts: 0, impressions: 0, reach: 0, clicks: 0, likes: 0,
        comments: 0, shares: 0, saves: 0, views: 0, engagement: 0,
      };
    }
    const b = platformBreakdown[pf];
    b.posts += 1;
    b.impressions += a.impressions;
    b.reach += a.reach;
    b.clicks += a.clicks;
    b.likes += a.likes;
    b.comments += a.comments;
    b.shares += a.shares;
    b.saves += a.saves;
    b.views += a.views;
    b.engagement += a.engagement;

    const d = dateOf(p);
    if (d && byDate[d]) {
      const row = byDate[d];
      row.posts += 1;
      row.impressions += a.impressions;
      row.reach += a.reach;
      row.likes += a.likes;
      row.comments += a.comments;
      row.shares += a.shares;
      row.saves += a.saves;
      row.sends += a.sends;
      row.clicks += a.clicks;
      row.outboundClicks += a.outboundClicks;
      row.views += a.views;
      row.follows += a.follows;
      row.engagement += a.engagement;
    }
  }

  const rows = dates.map((d) => {
    const row = byDate[d];
    const denom = row.impressions || row.reach || 0;
    row.engagementRate = denom > 0 ? round((row.engagement / denom) * 100, 2) : 0;
    row.hasData =
      row.posts > 0 || row.impressions > 0 || row.engagement > 0 || row.followers !== null;
    return row;
  });

  const avgER = ers.length ? round(sum(ers) / ers.length, 2) : 0;
  return { totals, rows, platformBreakdown, avgEngagementRate: avgER };
}

// ────────────────────────────────────────────────────────────────
// Overview
// ────────────────────────────────────────────────────────────────
function buildOverview({ platform, totals, rows, account, boards, avgEngagementRate, postCount, dates }) {
  const { prev, cur } = splitDates(dates);
  const halfTotals = (set) => {
    const t = EMPTY_TOTALS();
    t.posts = 0;
    for (const r of rows) {
      if (!set.has(r.date)) continue;
      for (const k of Object.keys(t)) t[k] += r[k] || 0;
    }
    return t;
  };
  const prevT = halfTotals(prev);
  const curT = halfTotals(cur);

  const entry = (key, label, kind, value, previous, extra = {}) => ({
    key,
    label: label || labelOf(key),
    kind,
    unit: extra.unit || (kind === 'rate' ? '%' : ''),
    group: extra.group || 'Performance',
    total: kind === 'rate' || kind === 'avg' ? round(value, 2) : Math.round(value),
    previous: previous === null || previous === undefined ? null : kind === 'rate' || kind === 'avg' ? round(previous, 2) : Math.round(previous),
    trend: previous === null || previous === undefined ? 0 : pctChange(value, previous),
    hasData: Boolean(value),
    ...extra,
  });

  const o = {};
  const catalogue = CATALOG[platform] || [];

  for (const c of catalogue) {
    const k = c.key;
    if (k === 'engagementRate') {
      const denomPrev = prevT.impressions || prevT.reach || 0;
      const denomCur = curT.impressions || curT.reach || 0;
      const prevRate = denomPrev > 0 ? (prevT.engagement / denomPrev) * 100 : null;
      const curRate = denomCur > 0 ? (curT.engagement / denomCur) * 100 : null;
      o[k] = entry(k, c.label, 'rate', avgEngagementRate, prevRate !== null && curRate !== null ? prevRate : null, {
        group: c.group,
        description: 'Total engagement ÷ impressions',
        currentHalfRate: curRate === null ? null : round(curRate, 2),
      });
      continue;
    }
    if (k === 'posts') {
      o[k] = entry(k, c.label, 'count', postCount, prevT.posts, { group: c.group });
      continue;
    }
    if (k === 'followers') {
      const followerRows = rows.filter((r) => r.followers !== null && r.followers !== undefined);
      const last = followerRows.length ? followerRows[followerRows.length - 1].followers : account?.followers || 0;
      const first = followerRows.length ? followerRows[0].followers : null;
      o[k] = entry(k, c.label, 'gauge', last, first, {
        group: c.group,
        change: first === null ? null : last - first,
        source: followerRows.length ? 'follower-stats' : 'account',
      });
      continue;
    }
    if (k === 'pins') {
      const v = account?.pinCount ?? boards.reduce((s, b) => s + (b.pinCount || 0), 0) ?? 0;
      o[k] = entry(k, c.label, 'gauge', v, null, { group: c.group });
      continue;
    }
    if (k === 'boards') {
      const v = boards.length || account?.boardCount || 0;
      o[k] = entry(k, c.label, 'gauge', v, null, { group: c.group, trend: 0 });
      continue;
    }
    if (k === 'monthlyViews') {
      o[k] = entry(k, c.label, 'gauge', account?.monthlyViews || 0, null, { group: c.group });
      continue;
    }
    // plain flow metrics
    o[k] = entry(k, c.label, c.kind || 'sum', totals[k] || 0, prevT[k] ?? null, { group: c.group });
  }

  // Anything Zernio sent that is not in the catalogue but has a value → show it.
  for (const [k, v] of Object.entries(totals)) {
    if (o[k] || !v) continue;
    o[k] = entry(k, labelOf(k), 'sum', v, prevT[k] ?? null, { group: 'Other', extra: true });
  }
  if (account?.externalPostCount && !o.externalPosts) {
    o.externalPosts = entry('externalPosts', 'External posts tracked', 'gauge', account.externalPostCount, null, {
      group: 'Activity',
    });
  }

  return o;
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────
function emptyPayload(platform, since, until, notice, diagnostics) {
  return {
    platform,
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'Zernio',
      hasAnalyticsAccess: false,
      postCount: 0,
      totalDataPoints: 0,
      account: null,
      diagnostics,
    },
    overview: {},
    timeseries: [],
    topPosts: [],
    posts: [],
    totals: EMPTY_TOTALS(),
    avgEngagementRate: 0,
    platformBreakdown: {},
    followerTimeseries: [],
    notice,
  };
}

async function fetchPlatform(platform, query) {
  const { since, until } = parseDateRange(query, true);
  const diagnostics = { warnings: [], steps: {} };
  const dates = enumerateDates(since, until);

  if (!config.ZERNIO_API_KEY) {
    return emptyPayload(platform, since, until, `${platform}: ZERNIO_API_KEY is not configured on the server.`, diagnostics);
  }

  // 1 ── accounts ────────────────────────────────────────────────
  const acct = await getAccounts(platform);
  diagnostics.steps.accounts = {
    ok: !acct.error && acct.accounts.length > 0,
    matched: acct.accounts.length,
    total: acct.all.length,
    attempt: acct.attempt || null,
    error: acct.error || null,
    hasAnalyticsAccess: acct.hasAnalyticsAccessRaw,
  };
  if (acct.error) diagnostics.warnings.push(`accounts lookup: ${acct.error}`);
  const account = buildAccount(acct.accounts[0]);
  if (!account && !acct.error) {
    diagnostics.warnings.push(
      `Zernio has ${acct.all.length} connected account(s) but none with platform="${platform}"`
    );
  }
  const accountId = account?.zernioAccountId || '';

  // 2 ── fetch everything in parallel ────────────────────────────
  const [followers, postsRes, boardsRes] = await Promise.all([
    getFollowerStats(platform, accountId),
    getPostAnalytics(platform, query, diagnostics).catch((e) => {
      diagnostics.steps.analytics = { ok: false, error: describeError(e) };
      if (e.code === 'ZERNIO_PAYMENT_REQUIRED' || e.code === 'ZERNIO_UNAUTHORIZED') throw e;
      return { posts: [], apiOverview: null, pagesFetched: 0 };
    }),
    platform === 'pinterest'
      ? getPinterestBoards(accountId)
      : Promise.resolve({ ok: false, boards: [], error: 'n/a for ' + platform }),
  ]);

  diagnostics.steps.followerStats = { ok: followers.ok, points: followers.rows.length, error: followers.error || null };
  diagnostics.steps.analytics = diagnostics.steps.analytics || { ok: true, posts: postsRes.posts.length, pages: postsRes.pagesFetched };
  if (platform === 'pinterest') {
    diagnostics.steps.boards = { ok: boardsRes.ok, count: boardsRes.boards.length, error: boardsRes.error || null };
  }
  if (followers.error) diagnostics.warnings.push(`follower-stats: ${followers.error}`);
  if (platform === 'pinterest' && boardsRes.error && boardsRes.error !== 'n/a for pinterest') {
    diagnostics.warnings.push(`boards: ${boardsRes.error}`);
  }

  // 3 ── merge follower history into a dense timeline ────────────
  const dailyFollowers = {};
  for (const f of followers.rows) dailyFollowers[f.date] = f.followers;
  const followerTimeseries = followers.rows.map((p, i) => ({
    date: p.date,
    followers: p.followers,
    growth: i > 0 ? p.followers - followers.rows[i - 1].followers : 0,
  }));

  // 4 ── aggregate posts ─────────────────────────────────────────
  const { totals, rows, platformBreakdown, avgEngagementRate } = aggregate(
    postsRes.posts,
    dates,
    dailyFollowers
  );
  const list = buildPostList(postsRes.posts);
  const topPosts = [...list]
    .sort(
      (a, b) =>
        b.analytics.engagement - a.analytics.engagement ||
        b.analytics.impressions - a.analytics.impressions ||
        String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
    )
    .slice(0, 12);

  // 5 ── sync external posts so their analytics start flowing ────
  let sync = { skipped: true, reason: 'no accountId', attempted: 0 };
  if (accountId && query.sync !== 'false') {
    try {
      sync = await syncExternalPosts(platform, accountId, postsRes.posts);
    } catch (e) {
      sync = { skipped: true, reason: describeError(e) };
    }
  }
  diagnostics.steps.sync = sync;

  // 6 ── overview (always complete, zeros included) ──────────────
  const overview = buildOverview({
    platform,
    totals,
    rows,
    account,
    boards: boardsRes.boards,
    avgEngagementRate,
    postCount: list.length,
    dates,
  });

  // 7 ── human-readable notices ──────────────────────────────────
  const notices = [];
  const noun = platform === 'pinterest' ? 'pins' : 'posts';
  if (!account) {
    notices.push(
      acct.error
        ? `Could not read the Zernio account list (${acct.error}).`
        : `No ${platform} account is connected in Zernio.`
    );
  }
  if (acct.hasAnalyticsAccessRaw === false) {
    notices.push('Zernio reports analytics access is NOT enabled for this API key — post metrics will stay empty until it is enabled on the plan.');
  }
  if (!list.length) {
    notices.push(`No ${noun} published or synced through Zernio in this date range.`);
  } else if (totals.impressions === 0 && totals.engagement === 0) {
    notices.push(
      `${list.length} ${noun} found, but Zernio returned zero impressions/engagement for them. ` +
        (platform === 'pinterest'
          ? 'Pinterest metrics lag 24–48h and only fill in for pins Zernio can read (pins:read + user_accounts:read scopes).'
          : 'LinkedIn only returns analytics for posts published through Zernio on personal profiles; organization pages return all posts.')
    );
  }
  if (sync && sync.attempted) {
    notices.push(`Triggered analytics sync for ${sync.attempted} external ${noun} (${sync.synced || 0} accepted).`);
  }

  return {
    platform,
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'Zernio',
      hasAnalyticsAccess: acct.hasAnalyticsAccess,
      postCount: list.length,
      totalDataPoints: rows.filter((r) => r.hasData).length,
      account,
      boards: platform === 'pinterest' ? boardsRes.boards : undefined,
      boardCount: platform === 'pinterest' ? boardsRes.boards.length || account?.boardCount || 0 : undefined,
      sync,
      diagnostics,
      apiOverview: postsRes.apiOverview || undefined,
    },
    overview,
    timeseries: rows,
    topPosts,
    posts: list,
    totals,
    avgEngagementRate,
    platformBreakdown,
    followerTimeseries,
    notice: notices.length ? notices.join(' ') : undefined,
  };
}

/** GET /api/zernio/debug — tells you exactly which Zernio call is failing. */
async function debugZernio() {
  const out = { configured: Boolean(config.ZERNIO_API_KEY), baseUrl: ZB, steps: {} };
  if (!out.configured) {
    out.summary = 'FAILED — ZERNIO_API_KEY missing';
    return out;
  }
  const acct = await getAccounts(null);
  out.steps.accounts = {
    ok: !acct.error,
    error: acct.error,
    count: acct.all.length,
    platforms: acct.all.map((a) => `${a.platform}:${a.username || a.displayName || a._id}`),
    hasAnalyticsAccess: acct.hasAnalyticsAccessRaw,
    sample: acct.all[0] || null,
  };
  for (const platform of ['linkedin', 'pinterest']) {
    const a = buildAccount(acct.accounts.find((x) => x.platform === platform) || acct.all.find((x) => x.platform === platform));
    if (!a) {
      out.steps[platform] = { ok: false, error: 'no account for this platform' };
      continue;
    }
    const diagnostics = { warnings: [], steps: {} };
    const today = new Date();
    const from = new Date(Date.now() - 90 * 86400000);
    try {
      const res = await getPostAnalytics(platform, { since: from.toISOString(), until: today.toISOString() }, diagnostics);
      out.steps[platform] = {
        ok: true,
        accountId: a.zernioAccountId,
        posts: res.posts.length,
        firstPost: res.posts[0] || null,
        warnings: diagnostics.warnings,
      };
    } catch (e) {
      out.steps[platform] = { ok: false, accountId: a.zernioAccountId, error: describeError(e) };
    }
    if (platform === 'pinterest') {
      out.steps.boards = await getPinterestBoards(a.zernioAccountId);
    }
    out.steps[platform + '_followers'] = await getFollowerStats(platform, a.zernioAccountId);
  }
  const failed = Object.entries(out.steps).filter(([, v]) => v && v.ok === false);
  out.summary = failed.length ? `ISSUES — ${failed.map(([k]) => k).join(', ')}` : 'ALL OK';
  return out;
}

async function fetchLinkedIn(query) {
  return fetchPlatform('linkedin', query).catch((e) => {
    const { since, until } = parseDateRange(query, true);
    return emptyPayload('linkedin', since, until, `linkedin error: ${e.message}`, { warnings: [e.message] });
  });
}
async function fetchPinterest(query) {
  return fetchPlatform('pinterest', query).catch((e) => {
    const { since, until } = parseDateRange(query, true);
    return emptyPayload('pinterest', since, until, `pinterest error: ${e.message}`, { warnings: [e.message] });
  });
}

module.exports = { fetchLinkedIn, fetchPinterest, fetchPlatform, debugZernio, getAccounts, buildAccount, CATALOG, EMPTY_TOTALS };
