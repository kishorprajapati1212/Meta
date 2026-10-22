/**
 * metaPosts.js — Facebook Page posts and Instagram media, with their real
 * per-post numbers.
 *
 * Why this exists (v4.2.5): the dashboard showed an empty "Content" section for
 * Facebook and Instagram and zero engagement, even though the accounts had posts
 * with likes and comments. Two reasons:
 *
 *   1. Nothing ever asked Meta for the posts. Insights metrics are account-level;
 *      they say nothing about individual posts.
 *   2. Several account-level engagement insights (page_impressions, page_fans,
 *      IG email_clicks/get_direction_clicks/…) have been retired by Meta, so the
 *      card grid had no numbers to show at all.
 *
 * So the post lists are fetched here and used two ways: they render in the
 * Content grid, and when an account-level insight is missing or empty their
 * per-post counts are summed into the card — always labelled `source: 'posts'`
 * so the number is never mistaken for an insight.
 *
 * Every call is optional. If the token cannot read posts (missing
 * pages_read_user_content / instagram_manage_insights) the failure is returned
 * as data, never thrown: the rest of the platform payload still renders.
 */
const axios = require('axios');
const config = require('../config');
const { scalarOf } = require('./transform');
const { mapLimit } = require('./graphInsights');

const CONCURRENCY = 3;
const DEEP_INSIGHT_CAP = 12; // per-media insight calls are the slow part

/** GET that never throws — Meta errors come back as `{ ok:false, message }`. */
async function tryGet(url, params, timeout = 25000) {
  try {
    const { data } = await axios.get(url, { params, timeout });
    return { ok: true, data };
  } catch (e) {
    const fb = e.response?.data?.error;
    return {
      ok: false,
      message: fb?.message || e.message || 'Request failed',
      code: fb?.code ?? null,
      status: e.response?.status ?? null,
      network: !e.response,
    };
  }
}

function inRange(iso, since, until) {
  if (!iso || !since || !until) return true;
  const t = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(t)) return true;
  return t >= since && t <= until + 86400; // include the whole final day
}

/** The post shape the dashboard's PostGrid + topContent() already understand. */
function postShape(p) {
  const a = p.analytics;
  const denom = a.impressions || a.reach || a.views || 0;
  return {
    // Which metrics this post's source really exposed. Every other key is
    // coerced to 0 below for a stable shape, and a coerced 0 must never be
    // mistaken for a measured one — that is what invents cards like
    // "Impressions 0 (summed from posts)" on Facebook, whose post endpoint does
    // not serve impressions at all.
    analyticsProvided: Array.isArray(p.provided) ? [...new Set(p.provided)] : [],
    postId: p.postId,
    content: (p.content || '').slice(0, 400),
    title: p.title || null,
    publishedAt: p.publishedAt || null,
    date: p.publishedAt ? String(p.publishedAt).slice(0, 10) : null,
    platformUrl: p.platformUrl || '',
    mediaType: p.mediaType || 'text',
    mediaItems: p.mediaItems || [],
    thumbnailUrl: p.thumbnailUrl || '',
    status: 'published',
    platform: p.platform,
    boardName: null,
    isExternal: false,
    syncStatus: 'native',
    analytics: {
      impressions: a.impressions || 0,
      reach: a.reach || 0,
      likes: a.likes || 0,
      comments: a.comments || 0,
      shares: a.shares || 0,
      saves: a.saves || 0,
      sends: 0,
      clicks: 0,
      outboundClicks: 0,
      views: a.views || 0,
      follows: 0,
      engagement: a.engagement || 0,
      engagementRate: denom > 0 ? Math.round(((a.engagement || 0) / denom) * 10000) / 100 : 0,
    },
  };
}

const ZERO_TOTALS = () => ({
  posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0,
  impressions: 0, reach: 0, engagement: 0,
});

/** Sum the per-post analytics of the posts that fall inside the range. */
const SUM_KEYS = ['likes', 'comments', 'shares', 'saves', 'views', 'impressions', 'reach', 'engagement'];

function sumPosts(posts, since, until) {
  const t = ZERO_TOTALS();
  // Which metrics the post source actually publishes. A real 0 measured from the
  // posts must still produce a card; a metric the posts never exposed must not
  // invent one. Without this, "0 comments" vanished from Facebook entirely
  // instead of showing as a measured zero.
  const provided = new Set();
  for (const p of posts) {
    if (!inRange(p.publishedAt, since, until)) continue;
    const a = p.analytics || {};
    t.posts += 1;
    // Trust the mapper's declaration, not the coerced shape.
    const exposed = Array.isArray(p.analyticsProvided) && p.analyticsProvided.length ? p.analyticsProvided : SUM_KEYS;
    for (const k of SUM_KEYS) {
      const v = Number(a[k]);
      if (!Number.isFinite(v)) continue;
      t[k] = (t[k] || 0) + v;
      if (exposed.includes(k)) provided.add(k);
    }
  }
  t.provided = [...provided];
  return t;
}

// ────────────────────────────────────────────────────────────────
// Facebook Page posts
// ────────────────────────────────────────────────────────────────
const FB_POST_FIELDS =
  'id,message,created_time,permalink_url,status_type,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)';

function mapFbPost(p) {
  const likes = Number(p.reactions?.summary?.total_count) || 0;
  const comments = Number(p.comments?.summary?.total_count) || 0;
  const shares = Number(p.shares?.count) || 0;
  const type = String(p.status_type || '').toLowerCase();
  return postShape({
    postId: p.id,
    content: p.message || '',
    publishedAt: p.created_time || null,
    platformUrl: p.permalink_url || (p.id ? `https://www.facebook.com/${p.id}` : ''),
    mediaType: type.includes('video') ? 'video' : type.includes('photo') || p.full_picture ? 'image' : 'text',
    thumbnailUrl: p.full_picture || '',
    platform: 'facebook',
    // The Page posts edge serves reactions, comments and shares — nothing else.
    // No impressions, no reach, no saves: those must not become zero cards.
    provided: ['likes', 'comments', 'shares', 'engagement'],
    analytics: { likes, comments, shares, engagement: likes + comments + shares },
  });
}

/**
 * Page posts. `posts`, `feed` and `published_posts` need different permissions,
 * so they are tried in order and the first one Meta accepts wins — a token that
 * can only read published posts still fills the grid.
 */
async function fetchPagePosts(pageToken, { since, until, limit = 25 } = {}) {
  if (!config.FACEBOOK_PAGE_ID || !pageToken) {
    return { ok: false, endpoint: null, posts: [], totals: ZERO_TOTALS(), errors: [{ endpoint: 'posts', message: 'page id or token missing' }] };
  }
  const base = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.FACEBOOK_PAGE_ID}`;
  const errors = [];
  for (const endpoint of ['posts', 'feed', 'published_posts']) {
    const r = await tryGet(`${base}/${endpoint}`, { fields: FB_POST_FIELDS, limit, access_token: pageToken });
    if (r.ok) {
      const list = (r.data?.data || []).filter((p) => p && p.id);
      const posts = list.map(mapFbPost);
      return { ok: true, endpoint, posts, totals: sumPosts(posts, since, until), fetched: posts.length, errors: [] };
    }
    errors.push({ endpoint, message: r.message, code: r.code, status: r.status });
    if (r.code === 190 || r.status === 401 || r.status === 403) {
      // A token problem will not be fixed by trying another endpoint shape,
      // but the other endpoints need different permissions, so keep trying.
    }
  }
  return { ok: false, endpoint: null, posts: [], totals: ZERO_TOTALS(), fetched: 0, errors };
}

// ────────────────────────────────────────────────────────────────
// Instagram media
// ────────────────────────────────────────────────────────────────
const IG_MEDIA_FIELDS =
  'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,view_count,thumbnail_url,children.fields(id,media_type,media_url,thumbnail_url)';

/** Per-media insights: shares/saved are only published here, not on the node. */
async function fetchMediaInsights(mediaId, mediaType) {
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${mediaId}/insights`;
  const isReel = String(mediaType || '').toUpperCase() === 'REELS' || String(mediaType || '').toUpperCase() === 'VIDEO';
  const attempts = [
    isReel ? 'plays,likes,comments,shares,saved' : 'likes,comments,shares,saved,impressions,reach',
    'likes,comments,saved',
  ];
  for (const metric of attempts) {
    const r = await tryGet(url, { metric, access_token: config.USER_ACCESS_TOKEN }, 20000);
    if (r.ok && Array.isArray(r.data?.data)) {
      const out = {};
      for (const block of r.data.data) {
        const name = block.name;
        const value = Array.isArray(block.values) ? scalarOf(name, block.values[0] || {}) : scalarOf(name, block);
        out[name] = Number(value) || 0;
      }
      return out;
    }
  }
  return null;
}

function mapIgPost(m) {
  const ins = m._insights || {};
  const likes = Number(m.like_count) || ins.likes || 0;
  const comments = Number(m.comments_count) || ins.comments || 0;
  const shares = Number(ins.shares) || 0;
  const saves = Number(ins.saved) || 0;
  const views = Number(m.view_count) || Number(ins.plays) || Number(ins.impressions) || 0;
  const type = String(m.media_type || '').toUpperCase();
  const children = Array.isArray(m.children?.data) ? m.children.data : [];
  return postShape({
    postId: m.id,
    content: m.caption || '',
    publishedAt: m.timestamp || null,
    platformUrl: m.permalink || (m.id ? `https://instagram.com/p/${m.id}` : ''),
    mediaType: type === 'REELS' ? 'video' : type === 'VIDEO' ? 'video' : type === 'CAROUSEL_ALBUM' ? 'carousel' : 'image',
    mediaItems: children.map((c) => ({ id: c.id, type: (c.media_type || '').toLowerCase(), url: c.media_url || c.thumbnail_url || '' })),
    thumbnailUrl: m.thumbnail_url || (type === 'IMAGE' ? m.media_url : '') || '',
    platform: 'instagram',
    // like_count / comments_count / view_count ride on the media node itself;
    // shares, saves, impressions and reach only exist when the per-media insight
    // call succeeded (m._insights), so they are declared per post.
    provided: [
      'likes',
      'comments',
      'views',
      'engagement',
      ...(m._insights ? ['shares', 'saves', 'impressions', 'reach'] : []),
    ],
    analytics: {
      likes, comments, shares, saves, views,
      impressions: Number(ins.impressions) || 0,
      reach: Number(ins.reach) || 0,
      engagement: likes + comments + shares + saves,
    },
  });
}

/**
 * Instagram media for the connected business account.
 *
 * `like_count` / `comments_count` come with instagram_basic and are always
 * present; shares/saved need instagram_manage_insights, so the per-media insight
 * calls are best-effort (capped and run 3 at a time) and their failure is
 * invisible — the node counts still render.
 */
/**
 * Meta's own (#36104) says the media field is refused "outside of the Business
 * Discovery API" — which is Meta telling us where it IS available. So when the
 * direct list is refused, ask the account's own `business_discovery` edge for the
 * same fields. Live evidence, /api/report 2026-10-21: `/{IG_ID}/media` answered
 * (#36104) while `/{IG_ID}?fields=media_count,followers_count` read fine, so the
 * profile node is reachable and only the media edge is gated.
 */
async function fetchIgMediaViaDiscovery({ limit }) {
  const base = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.INSTAGRAM_ID}`;
  const profile = await tryGet(base, { fields: 'username', access_token: config.USER_ACCESS_TOKEN }, 20000);
  const username = profile.ok ? profile.data?.username : null;
  if (!username) {
    return { ok: false, error: profile.ok ? 'the profile node reports no username to discover' : profile.message };
  }
  const inner = `media.limit(${limit}){id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,view_count,thumbnail_url}`;
  const r = await tryGet(base, {
    fields: `business_discovery.username(${username}){${inner}}`,
    access_token: config.USER_ACCESS_TOKEN,
  });
  if (!r.ok) return { ok: false, error: r.message, code: r.code, status: r.status };
  const items = (r.data?.business_discovery?.media?.data || []).filter((m) => m && m.id);
  return { ok: true, items };
}

async function fetchIgMedia({ since, until, limit = 25, deepInsights = true } = {}) {
  if (!config.INSTAGRAM_ID || !config.USER_ACCESS_TOKEN) {
    return { ok: false, posts: [], totals: ZERO_TOTALS(), fetched: 0, insightsOk: false, errors: [{ endpoint: 'media', message: 'INSTAGRAM_ID or ACCESS_TOKEN missing' }] };
  }
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.INSTAGRAM_ID}/media`;
  const r = await tryGet(url, { fields: IG_MEDIA_FIELDS, limit, access_token: config.USER_ACCESS_TOKEN });
  let items = [];
  let source = 'media';
  let recoveredError = null;
  if (!r.ok) {
    const discovery = await fetchIgMediaViaDiscovery({ limit });
    if (!discovery.ok || !discovery.items.length) {
      return {
        ok: false,
        posts: [],
        totals: ZERO_TOTALS(),
        fetched: 0,
        insightsOk: false,
        source: 'unavailable',
        errors: [
          { endpoint: 'media', message: r.message, code: r.code, status: r.status },
          {
            endpoint: 'business_discovery',
            optional: true,
            message: discovery.error || 'Business Discovery returned no media',
            code: discovery.code ?? null,
            status: discovery.status ?? null,
          },
        ],
      };
    }
    items = discovery.items;
    source = 'business_discovery';
    // The direct route was still refused — say so, marked recovered, so the
    // dashboard's diagnostics show both facts instead of hiding the workaround.
    recoveredError = {
      endpoint: 'media',
      recovered: true,
      message: r.message,
      code: r.code,
      status: r.status,
      note: 'the direct media list was refused; the posts were read through Business Discovery instead',
    };
  } else {
    items = (r.data?.data || []).filter((m) => m && m.id);
  }

  let insightsOk = false;
  // Per-media insights need the same permission the direct media list needed, so
  // they are only attempted on the direct path. Discovery already carries
  // like_count / comments_count / view_count, which is what the cards need.
  if (deepInsights && items.length && source === 'media') {
    // Only spend insight calls on media inside the requested range.
    const wanted = items.filter((m) => inRange(m.timestamp, since, until)).slice(0, DEEP_INSIGHT_CAP);
    if (wanted.length) {
      const results = await mapLimit(wanted, CONCURRENCY, async (m) => fetchMediaInsights(m.id, m.media_type));
      results.forEach((ins, i) => {
        if (ins) { wanted[i]._insights = ins; insightsOk = true; }
      });
    }
  }

  const posts = items.map(mapIgPost);
  return {
    ok: true,
    posts,
    totals: sumPosts(posts, since, until),
    fetched: posts.length,
    insightsOk,
    source,
    errors: recoveredError ? [recoveredError] : [],
  };
}

/**
 * Fill overview cards from summed post analytics.
 *
 * Only touches a card when the account-level insight gave nothing (absent, or
 * `total === 0` with `hasData === false`) — a real insight always wins, so a
 * post-derived number can never overwrite a measured one.
 */
function backfillFromPosts(overview, totals, { label, platform, note }) {
  if (!totals || !totals.posts) return [];
  const filled = [];
  const map = [
    ['likes', totals.likes, 'Likes'],
    ['comments', totals.comments, 'Comments'],
    ['shares', totals.shares, 'Shares'],
    ['saves', totals.saves, 'Saves'],
    ['views', totals.views, 'Views'],
    ['impressions', totals.impressions, 'Impressions'],
    ['engagement', totals.engagement, 'Engagement'],
  ];
  const provided = new Set(Array.isArray(totals.provided) ? totals.provided : map.map((m) => m[0]));
  for (const [key, value, fallbackLabel] of map) {
    if (value === null || value === undefined) continue;
    // 0 is a measurement when the posts expose that metric — show it. 0 is noise
    // when they do not (Facebook posts have no "saves"), so skip it.
    if (!value && !provided.has(key)) continue;
    const cur = overview[key];
    const usable = cur && typeof cur === 'object' && Number(cur.total) > 0;
    if (usable) continue;
    overview[key] = {
      key,
      id: `${platform}_posts_${key}`,
      label: cur?.label || fallbackLabel,
      description: `Summed from ${totals.posts} ${label} in this range${note ? ` — ${note}` : ''}.`,
      kind: 'sum',
      unit: '',
      group: cur?.group || (key === 'engagement' ? 'Engagement' : 'Performance'),
      total: value,
      previous: null,
      // A post sum has no previous window: no percentage is published for it.
      trend: null,
      trendBasis: null,
      hasData: true,
      derived: true,
      source: 'posts',
    };
    filled.push(key);
  }
  return filled;
}

module.exports = {
  fetchPagePosts,
  fetchIgMedia,
  backfillFromPosts,
  sumPosts,
  postShape,
  inRange,
  ZERO_TOTALS,
};
