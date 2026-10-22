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
const { summarize, pctChange, justifiedTrend, round, sum, labelOf } = require('../utils/metrics');
const demo = require('../utils/demographics');

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
  // v4.3.4: `?limit=50` alone is REJECTED by Zernio with
  //   400 "page and limit must be provided together"
  // — proved by the user's live /api/report capture, where the probe that sent
  // limit without page reported "no pinterest account" for an account whose
  // pins were being served in the same response. So page+limit goes first, the
  // parameterless call (which some plans paginate by default) stays as a
  // fallback, and a filtered variant closes the list.
  const attempts = [{ page: 1, limit: 50 }, {}, { page: 1, limit: 50, platform }];
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
    followers:
      pick(
        a.currentFollowers, a.followersCount, a.followerCount, a.totalFollowers, a.numFollowers,
        stats.followers, stats.followerCount, stats.totalFollowers, stats.currentFollowers,
        a.followers
      ) || 0,
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
    // Entitlement diagnostics. These are the fields that explain why a channel
    // is connected but silent — Pinterest returning no analytics at all, a
    // token that needs reconnecting, a rate-limited account. Non-secret, and
    // redactDeep() still sweeps the whole payload before it leaves the process.
    permissions: Array.isArray(a.permissions) ? a.permissions : a.permissions || null,
    platformStatus: a.platformStatus || null,
    platformStatusReason: a.platformStatusReason || null,
    needsReconnection: a.needsReconnection === true,
    enabled: a.enabled !== false,
    scopes: typeof a.metadata?.scope === 'string' ? a.metadata.scope.split(',').map((x) => x.trim()).filter(Boolean) : null,
    followersCount: typeof a.followersCount === 'number' ? a.followersCount : null,
    followersLastUpdated: a.followersLastUpdated || null,
    lastSuccessfulPublishAt: a.lastSuccessfulPublishAt || null,
    rateLimitedUntil: a.rateLimitedUntil || null,
    byokConfigured: Boolean(a.byokCredentials && Object.keys(a.byokCredentials).length),
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
          followers: pick(r.followers, r.followerCount, r.currentFollowers, r.totalFollowers, r.count) || 0,
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

  // Dedupe on the DOCUMENT id. Zernio's `latePostId` groups the platform copies
  // of one piece of content, so using it as the key silently dropped every post
  // after the first whenever a batch shared a group id. `_id` is unique per
  // platform copy; the per-platform `platformPostId` is the next best thing.
  const seen = new Set();
  const posts = all.filter((p) => {
    const pe = platformEntry(p, platform);
    const id = p._id || p.postId || pe?.platformPostId || p.latePostId || p.platformPostUrl || p.id;
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
/**
 * Which posts are worth asking Zernio to import analytics for. The URL and the
 * authoritative sync state both live on the per-platform entry.
 */
function syncCandidates(posts, platform) {
  return (posts || [])
    .map((p) => {
      const pe = platformEntry(p, platform);
      const url = pe?.platformPostUrl || p.platformPostUrl || pe?.permalink || p.permalink || '';
      const status = String(pe?.syncStatus || p.syncStatus || '').toLowerCase();
      return { doc: p, url, status, external: Boolean(p.isExternal) || (status && status !== 'synced') };
    })
    .filter((c) => c.external);
}

async function syncExternalPosts(platform, accountId, posts) {
  const now = Date.now();
  const key = `${platform}:${accountId}`;
  const candidates = syncCandidates(posts, platform);
  const withUrl = candidates.filter((c) => c.url).slice(0, 5);
  // A cached skip used to hide everything: the caller could not tell whether
  // the last real attempt had succeeded, or whether there was nothing to sync.
  // Both are now reported alongside the skip.
  if (syncCache[key] && now - syncCache[key].at < SYNC_TTL_MS) {
    return {
      skipped: true,
      reason: 'synced within the last 10 minutes',
      at: new Date(syncCache[key].at).toISOString(),
      externalPosts: candidates.length,
      lastResult: syncCache[key].result || null,
    };
  }
  if (!accountId) {
    return { skipped: true, reason: 'no accountId', attempted: 0, externalPosts: candidates.length };
  }
  if (!withUrl.length) {
    // External posts Zernio has no URL for cannot be imported one by one; the
    // account-level endpoint asks it to sweep the whole account instead.
    if (!candidates.length) {
      syncCache[key] = { at: now, result: { skipped: true, reason: 'no external posts to sync', attempted: 0 } };
      return { ...syncCache[key].result, externalPosts: 0 };
    }
    try {
      await zPost('/v1/analytics/sync-external-posts', { accountId });
      const res = {
        skipped: false,
        attempted: 0,
        accountSweep: true,
        externalPosts: candidates.length,
        note: 'No per-post URL was available, so an account-level analytics sweep was requested instead.',
      };
      syncCache[key] = { at: now, result: res };
      return res;
    } catch (e) {
      const res = {
        skipped: true,
        reason: `account-level sync failed: ${describeError(e)}`,
        attempted: 0,
        externalPosts: candidates.length,
      };
      syncCache[key] = { at: now, result: res };
      return res;
    }
  }
  const results = await Promise.allSettled(
    withUrl.map((c) =>
      zPost('/v1/posts/sync-external', { accountId, url: c.url }).catch(async (e) => {
        // Older deployments expose the legacy path.
        if (e.response?.status === 404) {
          return zPost('/v1/analytics/sync-external-posts', { accountId });
        }
        throw e;
      })
    )
  );
  // External posts without a URL cannot be imported one by one; ask for an
  // account-level sweep as well so they are not silently left unmeasured.
  const missingUrl = candidates.length - withUrl.length;
  let swept = false;
  if (missingUrl > 0) {
    try {
      await zPost('/v1/analytics/sync-external-posts', { accountId });
      swept = true;
    } catch {
      swept = false;
    }
  }
  const res = {
    skipped: false,
    attempted: withUrl.length,
    synced: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
    alreadySynced: candidates.filter((c) => c.status === 'synced').length,
    externalPosts: candidates.length,
    withoutUrl: missingUrl,
    accountSweep: swept,
    errors: results
      .filter((r) => r.status === 'rejected')
      .slice(0, 3)
      .map((r) => describeError(r.reason)),
    note:
      platform === 'pinterest'
        ? 'Sync asks Pinterest for the pin metrics. If they stay 0 after 48 h, the account is not entitled to organic analytics (Pinterest serves those to Business accounts only).'
        : 'Analytics for freshly synced posts can still lag 24–48h.',
  };
  syncCache[key] = { at: now, result: res };
  return res;
}

/**
 * Is a zero a lag, a distribution problem, or a platform that is not reporting
 * at all? Built from the real 2026-10-21 capture of this account (see
 * scripts/fixtures/zernio-real-pinterest.json): 6 Pinterest pins, each with a
 * real pin id + URL and syncStatus "synced", every metric 0, the oldest 33 days
 * old, and pinCount/boardCount/monthlyViews/accountType all empty upstream.
 */
function metricAvailability(platform, list, account, totals) {
  if (!list.length) return { posts: 0, verdict: 'no-posts' };
  const hours = list
    .map((p) => {
      const t = new Date(p.publishedAt || p.date || 0).getTime();
      return Number.isFinite(t) ? (Date.now() - t) / 36e5 : null;
    })
    .filter((v) => v !== null);
  const newestHours = hours.length ? Math.min(...hours) : null;
  const oldestHours = hours.length ? Math.max(...hours) : null;
  const identified = list.filter((p) => p.postId || p.platformUrl).length;
  const synced = list.filter((p) => String(p.syncStatus || '').toLowerCase() === 'synced').length;
  const external = list.filter((p) => p.isExternal).length;
  const allZero = (totals.impressions || 0) === 0 && (totals.engagement || 0) === 0;
  const gaugesEmpty = ['pinCount', 'boardCount', 'monthlyViews'].every(
    (k) => account?.[k] === null || account?.[k] === undefined
  );
  // "Beyond the lag" is about the pins that are old enough to have been
  // reported. One fresh pin does not excuse five that are a month old.
  const aged = list.filter((p) => {
    const t = new Date(p.publishedAt || p.date || 0).getTime();
    return Number.isFinite(t) && Date.now() - t >= 48 * 36e5;
  }).length;
  const beyondLag = aged > 0;
  let verdict = 'reporting';
  if (allZero) {
    if (platform === 'pinterest' && beyondLag && synced > 0 && identified === list.length && gaugesEmpty) verdict = 'not-reported';
    else if (!beyondLag) verdict = 'lagging';
    else verdict = 'stale';
  }
  return {
    posts: list.length,
    allZero,
    identified,
    synced,
    external,
    agedPastLag: aged,
    newestHours: newestHours === null ? null : Math.round(newestHours * 10) / 10,
    oldestDays: oldestHours === null ? null : Math.floor(oldestHours / 24),
    beyondLag,
    accountGaugesEmpty: gaugesEmpty,
    verdict,
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
/**
 * Zernio stores one document per *post*, with a `platforms[]` array holding the
 * per-platform copy (its own id, URL and analytics). A post published to both
 * LinkedIn and Pinterest appears in both platform feeds, and the document-level
 * `analytics` block is not guaranteed to belong to the platform being queried —
 * reading it gave Pinterest LinkedIn's impressions (and vice versa).
 * So: prefer the matching `platforms[]` entry, fall back to the document level.
 */
function platformEntry(p, platform) {
  const list = Array.isArray(p?.platforms) ? p.platforms : [];
  if (!platform) return null;
  const want = String(platform).toLowerCase();
  return list.find((x) => String(x?.platform || '').toLowerCase() === want) || null;
}

function readAnalytics(p, platform) {
  const pe = platformEntry(p, platform);
  const a = pe?.analytics || p.analytics || {};
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

function buildPostList(posts, platform) {
  return posts.map((p) => {
    const a = readAnalytics(p, platform);
    const pe = platformEntry(p, platform);
    const denom = a.impressions || a.reach || 0;
    const er =
      a.engagementRate !== null
        ? round(a.engagementRate, 2)
        : denom > 0
        ? round((a.engagement / denom) * 100, 2)
        : 0;
    return {
      postId: pe?.platformPostId || p.postId || p.platformPostId || p.latePostId || p._id || p.id || '',
      content: (p.content || p.title || '').slice(0, 400),
      title: p.title || null,
      publishedAt: pe?.publishedAt || p.publishedAt || p.scheduledFor || null,
      date: dateOf(p) || null,
      platformUrl:
        pe?.platformPostUrl || pe?.permalink || p.platformPostUrl || p.permalink || p.platformPostUrl || '',
      mediaType: pe?.mediaType || p.mediaType || p.type || 'text',
      mediaItems: pe?.mediaItems || p.mediaItems || [],
      thumbnailUrl:
        pe?.thumbnailUrl || p.thumbnailUrl || p.mediaItems?.[0]?.thumbnail || p.mediaItems?.[0]?.url || '',
      status: pe?.status || p.status || 'unknown',
      platform: pe?.platform || platform || p.platform || 'unknown',
      accountUsername: pe?.accountUsername || null,
      boardName: p.boardName || p.board?.name || null,
      isExternal: Boolean(p.isExternal),
      // The per-platform entry carries the authoritative sync state. Reading
      // only the document level reported "external" for pins Zernio had in
      // fact already synced (real pin id + pin URL), which is exactly the
      // distinction between "never measured" and "measured as zero".
      syncStatus:
        pe?.syncStatus || p.syncStatus || (p.isExternal ? 'external' : 'late'),
      latePostId: p.latePostId || null,
      zernioDocId: p._id || null,
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

function aggregate(posts, dates, dailyFollowers, platform) {
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
    const a = readAnalytics(p, platform);
    for (const k of Object.keys(totals)) if (k in a) totals[k] += a[k];
    if (a.engagementRate !== null) ers.push(a.engagementRate);

    const pe = platformEntry(p, platform);
    const pf = pe?.platform || platform || p.platform || 'unknown';
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
    // Zernio has no previous-window query, so this compares the second half of
    // the selected range with the first half — and only when that is justified.
    trend: previous === null || previous === undefined ? null : justifiedTrend(value, previous, kind),
    trendBasis:
      previous === null || previous === undefined || justifiedTrend(value, previous, kind) === null
        ? null
        : 'second-half-vs-first-half',
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
      // Some platforms simply do not publish a follower count through their API.
      // Zernio then reports 0, which reads like a measurement — flag it instead
      // so the dashboard can drop the card rather than show a wrong zero.
      const personal = String(account?.accountType || '').toLowerCase() === 'personal';
      const notPublished =
        platform === 'pinterest'
          ? "Pinterest's API does not publish a follower count for business accounts, so Zernio has nothing to report."
          : platform === 'linkedin' && personal
          ? 'LinkedIn only publishes follower counts for Company Pages. Personal profiles expose neither followers nor connections through the API.'
          : null;
      o[k] = entry(k, c.label, 'gauge', last, first, {
        group: c.group,
        change: first === null ? null : last - first,
        source: followerRows.length ? 'follower-stats' : 'account',
        ...(last ? {} : notPublished ? { unavailable: true, unavailableReason: notPublished } : {}),
      });
      continue;
    }
    if (k === 'pins') {
      // Zernio's Pinterest account often has no pinCount and boards come back
      // without per-board counts, but the pins themselves are known — use them
      // rather than reporting 0 pins on an account that has published pins.
      const boardPins = boards.reduce((sum, b) => sum + (b.pinCount || 0), 0);
      let v = account?.pinCount ?? null;
      let source = 'account';
      if (v === null && boardPins > 0) { v = boardPins; source = 'boards'; }
      if ((v === null || v === 0) && postCount > 0) { v = postCount; source = 'published pins'; }
      o[k] = entry(k, c.label, 'gauge', v || 0, null, {
        group: c.group,
        source,
        ...(v ? {} : { unavailable: true, unavailableReason: 'Zernio has no pin count for this account yet.' }),
      });
      continue;
    }
    if (k === 'boards') {
      const v = boards.length || account?.boardCount || 0;
      o[k] = entry(k, c.label, 'gauge', v, null, { group: c.group, trend: null, trendBasis: null });
      continue;
    }
    if (k === 'monthlyViews') {
      const mv = account?.monthlyViews ?? null;
      o[k] = entry(k, c.label, 'gauge', mv || 0, null, {
        group: c.group,
        ...(mv ? {} : { unavailable: true, unavailableReason: "Pinterest's public API does not expose monthly views, so Zernio cannot report them." }),
      });
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
    demographics: demo.empty(
      'Zernio',
      `Zernio\u2019s public API does not expose audience demographics (age, gender, location) for ${platform === 'pinterest' ? 'Pinterest' : 'LinkedIn'}. The audience section below therefore only shows what the platform itself publishes.`,
      ['age', 'gender', 'countries', 'cities', 'devices']
    ),
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
    dailyFollowers,
    platform
  );
  const list = buildPostList(postsRes.posts, platform);
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
  diagnostics.metricAvailability = metricAvailability(platform, list, account, totals);

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
    const avail = metricAvailability(platform, list, account, totals);
    const who = account?.username ? `@${account.username}` : `the ${platform} account`;
    if (platform === 'pinterest' && avail.verdict === 'not-reported') {
      // Live evidence, /api/report 2026-10-21: the connection carries
      // pins:read, pins:write, boards:read, boards:write, user_accounts:read,
      // ads:read/write and platformStatus "active" — so the scopes are NOT the
      // problem, and saying so would send the user re-authorising for nothing.
      // What is missing is the account entitlement: accountType is empty and
      // every account-level gauge comes back null.
      const perms = Array.isArray(account?.permissions) ? account.permissions : [];
      const hasRead = perms.some((x) => /pins:read|user_accounts:read|boards:read/i.test(String(x)));
      notices.push(
        `${list.length} pins found and every one of them is known to Pinterest (real pin id + URL, syncStatus "${
          list[0]?.syncStatus || 'synced'
        }"), yet Pinterest reported 0 impressions/engagement for all of them — the oldest is ${avail.oldestDays} day(s) old, far beyond Pinterest's 24–48 h reporting lag. ` +
          `Pin count, board count, monthly views and account type all come back empty for ${who} as well. ` +
          (hasRead
            ? `The connection itself is fine — it is marked ${account?.platformStatus || 'active'} and already grants ${perms.filter((x) => /read/i.test(String(x))).join(', ')} — so this is not a missing scope and re-authorising will not change it. `
            : '') +
          'Pinterest only serves organic analytics (impressions, saves, pin clicks, outbound clicks) to BUSINESS accounts, so these zeros mean "not measured", not "nobody saw your pins". ' +
          `Fix: convert ${who} to a free Business account (Pinterest → Settings → Account management → Convert to business), then reconnect it in Zernio so the new entitlement is picked up. Until then, read the real numbers in Pinterest's own analytics.` +
          (avail.agedPastLag < list.length
            ? ` (${list.length - avail.agedPastLag} pin(s) are still under 48 h old and may simply be lagging.)`
            : '')
      );
    } else if (platform === 'pinterest' && avail.verdict === 'lagging') {
      notices.push(
        `${list.length} pins found, but Pinterest has not reported metrics for them yet — the newest is under 48 h old. Pinterest metrics lag 24–48 h after a pin is published, and impressions and pin clicks arrive first; saves, closeups and video views fill in later. Nothing is broken; refresh tomorrow and these cards start moving.`
      );
    } else {
      notices.push(
        `${list.length} ${noun} found, but Zernio returned zero impressions/engagement for them` +
          (avail.oldestDays ? ` (the oldest is ${avail.oldestDays} day(s) old)` : '') +
          '. ' +
          (platform === 'pinterest'
            ? 'Zernio can see the pins but Pinterest is not returning metrics for them — check whether the account is a Business account and whether the connection still has pins:read / user_accounts:read.'
            : `LinkedIn returned no metrics for ${avail.synced}/${list.length} synced post(s). Personal profiles report impressions but not follower counts; if impressions are 0 too, the posts were not distributed.`)
      );
    }
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
    demographics: demo.empty(
      'Zernio',
      `Zernio\u2019s public API does not expose audience demographics (age, gender, location) for ${platform === 'pinterest' ? 'Pinterest' : 'LinkedIn'}. The audience section below therefore only shows what the platform itself publishes.`,
      ['age', 'gender', 'countries', 'cities', 'devices']
    ),
    notice: notices.length ? notices.join(' ') : undefined,
  };
}

/** GET /api/zernio/debug — tells you exactly which Zernio call is failing. */
/**
 * rawDump — the VERBATIM Zernio bodies behind LinkedIn and Pinterest.
 *
 * "Pinterest shows 0" has three completely different causes: no Pinterest
 * account connected, analytics not on the plan, or pins published but not yet
 * reported. The transformed payload cannot distinguish them; the raw bodies can.
 * This is what `GET /api/report?raw=true` ships (redacted by utils/redact.js
 * before it leaves the process, because Zernio account documents carry tokens).
 *
 * Never throws: every call is captured with its status, timing and error.
 */
async function rawDump(query = {}) {
  const started = Date.now();
  const out = {
    configured: Boolean(config.ZERNIO_API_KEY),
    baseUrl: ZB,
    generatedAt: new Date().toISOString(),
    window: null,
    calls: {},
    summary: '',
  };
  if (!out.configured) {
    out.summary = 'ZERNIO_API_KEY is not set — LinkedIn and Pinterest cannot be read at all';
    return out;
  }

  const { since, until } = parseDateRange(query, true);
  const fromDate = toDateStr(since);
  const toDate = toDateStr(until);
  out.window = { fromDate, toDate };

  // `optional` marks a call whose failure is expected on some plans (the
  // alternate boards path). It is recorded, but it must not turn the whole
  // Zernio summary into "ISSUES" — that would send the user chasing a 404 that
  // was only ever a fallback.
  const call = async (name, fn, note, opts = {}) => {
    const t = Date.now();
    try {
      const data = await fn();
      out.calls[name] = { ok: true, ms: Date.now() - t, ...(note ? { note } : {}), data };
      return data;
    } catch (e) {
      out.calls[name] = {
        ok: false,
        ms: Date.now() - t,
        ...(note ? { note } : {}),
        ...(opts.optional ? { optional: true } : {}),
        status: e.response?.status ?? null,
        error: describeError(e),
      };
      return null;
    }
  };

  // Zernio rejects a bare `limit`: "page and limit must be provided together"
  // (HTTP 400). The live /api/report capture of 2026-10-21 proved it — the raw
  // dump then claimed neither channel was connected, while the very same
  // response served 5 pins and 7 posts through getAccounts(), which paginates
  // correctly. Keep the two in sync.
  const accountsRaw = await call('GET /v1/accounts', () => zGet('/v1/accounts', { page: 1, limit: 100 }));
  out.accountsCallFailed = accountsRaw === null;
  const docs = Array.isArray(accountsRaw) ? accountsRaw : accountsRaw?.accounts || accountsRaw?.data || [];
  const list = Array.isArray(docs) ? docs : [];
  out.accountDocs = list.length;
  // Zernio reports analytics entitlement once per API key, on the response —
  // not on each account document. Reading it per account returned null.
  out.hasAnalyticsAccess = accountsRaw?.hasAnalyticsAccess ?? null;

  for (const platform of ['pinterest', 'linkedin']) {
    const acct = list.find((d) => String(d?.platform || '').toLowerCase() === platform) || null;
    const id = acct?._id || acct?.accountId || acct?.id || null;
    if (!acct) {
      // "The accounts call failed" and "no account is connected" are different
      // facts and need different fixes. Conflating them told the user to
      // reconnect a channel that was connected and serving data.
      const accountsCall = out.calls['GET /v1/accounts'];
      out.calls[`account:${platform}`] = {
        ok: false,
        ...(accountsCall && accountsCall.ok === false
          ? {
              reason: 'accounts-call-failed',
              error: `GET /v1/accounts failed (${accountsCall.status ? `HTTP ${accountsCall.status} — ` : ''}${accountsCall.error}), so the ${platform} account could not be looked up. This says nothing about whether the channel is connected.`,
              upstreamStatus: accountsCall.status ?? null,
            }
          : {
              reason: 'no-account',
              error: `Zernio returned no ${platform} account for this API key — the channel is not connected upstream, so every metric is legitimately empty`,
            }),
      };
      continue;
    }
    const stats = acct.accountStats || acct.stats || {};
    const scopes =
      typeof acct.metadata?.scope === 'string'
        ? acct.metadata.scope.split(',').map((x) => x.trim()).filter(Boolean)
        : acct.scopes || acct.metadata?.scopes || null;
    out.calls[`account:${platform}`] = {
      ok: true,
      accountId: id,
      username: acct.username || acct.accountUsername || acct.displayName || null,
      accountType: acct.metadata?.accountType || null,
      hasAnalyticsAccess: acct.hasAnalyticsAccess ?? out.hasAnalyticsAccess ?? null,
      // Entitlement evidence. Pinterest only serves organic analytics to
      // BUSINESS accounts, and when it does not, every account-level gauge
      // (pin count, board count, monthly views) comes back empty while the pins
      // themselves are still listed and marked synced. That combination is what
      // separates "not measured" from "measured as zero".
      scopes,
      permissions: acct.permissions || null,
      platformStatus: acct.platformStatus || null,
      platformStatusReason: acct.platformStatusReason || null,
      needsReconnection: acct.needsReconnection === true,
      enabled: acct.enabled !== false,
      followersCount: typeof acct.followersCount === 'number' ? acct.followersCount : null,
      pinCount: stats.pinCount ?? acct.pinCount ?? null,
      boardCount: stats.boardCount ?? acct.boardCount ?? null,
      monthlyViews: stats.monthlyViews ?? acct.monthlyViews ?? null,
      lastSuccessfulPublishAt: acct.lastSuccessfulPublishAt || null,
      rateLimitedUntil: acct.rateLimitedUntil || null,
      syncStatus: acct.syncStatus || null,
      // Verbatim document — utils/redact.js scrubs credentials before it leaves
      // the process, and this is the only place the real field names are kept.
      doc: acct,
    };

    await call(
      `GET /v1/analytics?platform=${platform}`,
      () => zGet('/v1/analytics', { platform, fromDate, toDate, limit: 100, page: 1, source: 'all', sortBy: 'date', order: 'desc' }),
      'verbatim body — this is exactly what the dashboard transforms'
    );
    await call(`GET /v1/accounts/follower-stats?platform=${platform}`, () =>
      zGet('/v1/accounts/follower-stats', { platform, ...(id ? { accountId: id } : {}), limit: 100 })
    );

    if (platform === 'pinterest' && id) {
      await call(`GET /v1/accounts/{id}/pinterest-boards`, () => zGet(`/v1/accounts/${id}/pinterest-boards`, { limit: 100 }));
      await call(
        `GET /v1/accounts/{id}/boards`,
        () => zGet(`/v1/accounts/${id}/boards`, { limit: 100 }),
        'fallback path some Zernio plans use — a 404 here is normal',
        { optional: true }
      );
    }
  }

  const entries = Object.entries(out.calls);
  const failed = entries.filter(([, v]) => v && v.ok === false && !v.optional).map(([k]) => k);
  out.optionalFailures = entries.filter(([, v]) => v && v.ok === false && v.optional).map(([k]) => k);
  out.summary = failed.length ? `ISSUES — ${failed.join(', ')}` : 'ALL OK';
  out.ms = Date.now() - started;
  return out;
}

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

module.exports = { fetchLinkedIn, fetchPinterest, fetchPlatform, debugZernio, rawDump, getAccounts, buildAccount, CATALOG, EMPTY_TOTALS };
