/**
 * scripts/mockUpstream.js — an offline stand-in for Meta Graph, Google OAuth,
 * YouTube (Analytics + Data) and Google Search Console.
 *
 * Why it exists: two production bugs could only be caught by looking at what
 * the services actually put ON THE WIRE.
 *
 *   1. Instagram spread its internal metric-group keys into the Graph query
 *      string (`?id=g1&optional=true`). Graph answered
 *      `(#100) Invalid token: "<ig-id>". An ID has already been specified.`
 *      and every group failed → IG_ALL_FAILED, no data.
 *   2. gscService.js used the shared `demo` demographics helper without
 *      requiring it → `ReferenceError: demo is not defined`, reported to the
 *      client as `[ERROR] UNKNOWN demo is not defined`.
 *
 * Every request is recorded in `requests` so tests can assert on the exact
 * query parameters, not just on the parsed response.
 *
 *   const up = createMockUpstream({ port: 4988 });
 *   await up.ready();
 *   ... point config.*_BASE / *_URL env vars at http://127.0.0.1:4988/... ...
 *   up.requests.filter(r => r.path.endsWith('/insights'))
 *   await up.close();
 */
const http = require('http');

const DAY = 86400000;
const isoDay = (offsetFromToday) => new Date(Date.now() + offsetFromToday * DAY).toISOString().slice(0, 10);

/** Metrics that Meta returns as a { metric: value } object (metric_type=total_value). */
const TOTAL_VALUE_METRICS = new Set([
  'profile_views', 'likes', 'comments', 'shares', 'saves', 'total_interactions',
  'website_clicks', 'email_clicks', 'get_direction_clicks', 'calls_clicks',
  'text_message_clicks', 'page_actions',
]);

/** Audience/demographic metrics whose `value` is a map keyed by segment. */
const MAP_METRICS = {
  page_fans_country: { US: 42, IN: 18, GB: 7 },
  page_fans_gender_age: { 'male.18-24': 12, 'female.18-24': 21, 'male.25-34': 15, 'female.25-34': 24 },
  audience_country: { US: 55, IN: 22, DE: 6 },
  audience_city: { 'New York, New York': 14, 'Ahmedabad, Gujarat': 9, 'London, England': 5 },
  audience_gender_age: { 'male.18-24': 8, 'female.18-24': 17, 'male.25-34': 12, 'female.25-34': 19 },
};

/** A deterministic, plausible number per metric name so trends are non-zero. */
function valueFor(metric, dayIndex) {
  const base = {
    reach: 320, impressions: 480, follower_count: 1250, follows_count: 310,
    profile_views: 64, likes: 18, comments: 4, shares: 3, saves: 6,
    total_interactions: 31, website_clicks: 9, email_clicks: 1,
    get_direction_clicks: 0, calls_clicks: 0, text_message_clicks: 1,
    page_views_total: 140, page_fans: 980, page_fans_online: 27,
    page_impressions: 610, page_engaged_users: 44, page_post_engagements: 71,
    views: 96, comments_yt: 5, likes_yt: 12, shares_yt: 2,
    estimated_minutes_watched: 210, average_view_duration: 131,
    annotation_clicks: 2, subscribers_gained: 3, subscribers_lost: 1,
  }[metric] ?? 25;
  return base + dayIndex * 7;
}

/**
 * Meta's real rejections, reproduced so the suite can prove the client survives
 * them:
 *   • "(#100) There cannot be more than 30 days (2592000 s) between since and
 *     until." — Instagram and several Page metrics refuse longer windows.
 *   • "(#100) Invalid parameter" — a retired/unsupported metric in the list.
 * Set MOCK_UPSTREAM_REJECT_METRICS=shares,page_media_view to exercise the second.
 */
function graphInsightsError(query) {
  const since = Number(query.since);
  const until = Number(query.until);
  if (Number.isFinite(since) && Number.isFinite(until) && until - since > 2592000) {
    return {
      status: 400,
      body: {
        error: {
          message: '(#100) There cannot be more than 30 days (2592000 s) between since and until.',
          type: 'OAuthException',
          code: 100,
          fbtrace_id: 'mock_trace_window',
        },
      },
    };
  }
  const rejected = String(process.env.MOCK_UPSTREAM_REJECT_METRICS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const asked = String(query.metric || '').split(',').map((m) => m.trim());
  const hit = asked.filter((m) => rejected.includes(m));
  if (hit.length) {
    return {
      status: 400,
      body: {
        error: {
          message: `(#100) Invalid parameter — metric ${hit.join(', ')} is not supported for this account`,
          type: 'OAuthException',
          code: 100,
          fbtrace_id: 'mock_trace_metric',
        },
      },
    };
  }
  return null;
}

function graphInsightsBody(query) {
  // The live account (captured 2026-10-21 via /api/report) answers
  // `metric_type=total_value` combined with `period=day` with an EMPTY 200 — no
  // error, no rows — while `reach` on the daily form comes back fine. That is how
  // likes/comments hid behind silent 0 cards: nothing threw, so nothing was
  // reported. MOCK_IG_INSIGHT_FORM=empty-total-value-day reproduces it so the
  // variant fallback in instagramService is actually exercised.
  if (
    process.env.MOCK_IG_INSIGHT_FORM === 'empty-total-value-day' &&
    query.metric_type === 'total_value' &&
    query.period === 'day'
  ) {
    return { data: [] };
  }
  const metrics = String(query.metric || '').split(',').map((m) => m.trim()).filter(Boolean);
  const period = query.period || 'day';

  // Real Graph returns one value per day INSIDE the requested window, so a
  // client that splits a 120-day range into 30-day windows must merge them back
  // into a 120-point series. Emitting a fixed 2 days relative to "today" would
  // hide exactly that bug.
  const since = Number(query.since);
  const until = Number(query.until);
  const windowDays = Number.isFinite(since) && Number.isFinite(until) && until > since
    ? Math.min(31, Math.max(1, Math.round((until - since) / 86400)))
    : 2;
  const days = period === 'lifetime' ? 1 : windowDays;
  const anchor = Number.isFinite(until) ? until : Math.floor(Date.now() / 1000);

  const data = metrics.map((metric) => {
    const values = [];
    for (let i = 0; i < days; i += 1) {
      const dayTs = anchor - (days - 1 - i) * 86400;
      const end_time = `${new Date(dayTs * 1000).toISOString().slice(0, 10)}T00:00:00+0000`;
      if (MAP_METRICS[metric]) {
        values.push({ value: { ...MAP_METRICS[metric] }, end_time });
      } else if (TOTAL_VALUE_METRICS.has(metric) || query.metric_type === 'total_value') {
        values.push({ value: { [metric]: valueFor(metric, i) }, end_time });
      } else {
        values.push({ value: valueFor(metric, i), end_time });
      }
    }
    return { name: metric, period, values, title: metric, description: `mock ${metric}`, id: `${metric}_mock` };
  });
  return { data };
}

/** Mock media ids, so /{media-id}/insights can answer like a media node. */
const MOCK_MEDIA_IDS = new Set(['17900000000000001', '17900000000000002', '17900000000000003']);

/** Fields the mock refuses, like Meta does for a token/version that lacks them. */
function badFields() {
  return String(process.env.MOCK_FB_BAD_FIELDS || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Fields a Graph node request may ask for. */
function graphNodeBody(query, node) {
  const fields = String(query.fields || '').split(',').map((f) => f.split('.')[0].split('(')[0]).filter(Boolean);
  const out = { id: node };
  const catalogue = {
    name: 'Mock Business',
    username: 'mockbusiness',
    fan_count: 980,
    followers_count: 1250,
    follows_count: 310,
    media_count: 42,
    category: 'Community',
    link: `https://facebook.com/${node}`,
    website: 'https://example.com',
    verification_status: { value: 'not_verified' },
    rating: null,
    picture: { data: { url: 'https://example.invalid/pic.png', width: 200, height: 200 } },
    profile_picture_url: 'https://example.invalid/pic.png',
    instagram_business_account: { id: '17841432245164684' },
  };
  for (const f of fields) {
    if (f === 'id') continue;
    out[f] = f in catalogue ? catalogue[f] : null;
  }
  // Meta's (#36104) on /{ig-id}/media says the field is available "outside of the
  // Business Discovery API" — i.e. through it. Answer that route so the fallback
  // in metaPosts.fetchIgMedia can be tested end to end.
  if (String(query.fields || '').includes('business_discovery')) {
    if (process.env.MOCK_IG_DISCOVERY === 'denied') {
      out.business_discovery = null;
    } else {
      out.business_discovery = {
        id: '17840000000000999',
        username: catalogue.username,
        media: {
          data: [
            {
              id: '17900000000000011', caption: 'Discovery reel — like_count without /media access',
              media_type: 'REELS', timestamp: new Date(Date.now() - 4 * 86400000).toISOString(),
              permalink: 'https://instagram.com/reel/d1', like_count: 21, comments_count: 5, view_count: 1200,
              thumbnail_url: 'https://example.invalid/d1.jpg',
            },
            {
              id: '17900000000000012', caption: 'Discovery carousel',
              media_type: 'CAROUSEL_ALBUM', timestamp: new Date(Date.now() - 9 * 86400000).toISOString(),
              permalink: 'https://instagram.com/p/d2', like_count: 8, comments_count: 2,
            },
          ],
        },
      };
    }
  }
  return out;
}

// Whole-history totals, so a channel whose Data API access is missing can still
// show real lifetime views and an estimated subscriber count (137 gained − 5 lost
// = 132, matching the Data API's subscriberCount so tests can compare directly).
const LIFETIME_TOTALS = {
  views: 4820,
  estimatedMinutesWatched: 15230,
  likes: 210,
  comments: 44,
  shares: 31,
  subscribersGained: 137,
  subscribersLost: 5,
};
const MOCK_VIDEOS = [
  ['MOCKVID000000001', 2100, 6400, 96, 21, 12],
  ['MOCKVID000000002', 1500, 4800, 62, 14, 9],
  ['MOCKVID000000003', 1220, 4030, 52, 9, 10],
];

function ytReportBody(query) {
  const dims = String(query.dimensions || '').split(',').filter(Boolean);
  const mets = String(query.metrics || '').split(',').filter(Boolean);
  const columnHeaders = [
    ...dims.map((name) => ({ name, columnType: 'DIMENSION', dataType: 'STRING' })),
    ...mets.map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })),
  ];

  // "Top videos" report: dimensions=video + sort + maxResults.
  if (dims.includes('video')) {
    const limit = Math.max(1, Math.min(Number(query.maxResults) || 200, MOCK_VIDEOS.length));
    const rows = MOCK_VIDEOS.slice(0, limit).map((v) => [v[0], ...mets.map((m) => v[1 + ['views', 'estimatedMinutesWatched', 'likes', 'comments', 'shares'].indexOf(m)] ?? 0)]);
    return { kind: 'youtubeAnalytics#resultTable', columnHeaders, rows };
  }

  // Lifetime/basic report: no dimensions → exactly one row of totals.
  if (!dims.length) {
    return {
      kind: 'youtubeAnalytics#resultTable',
      columnHeaders,
      rows: [mets.map((m) => LIFETIME_TOTALS[m] ?? valueFor(m, 0))],
    };
  }

  const rows = [];
  for (let i = 0; i < 2; i += 1) {
    const dimValues = dims.map((d) => {
      if (d === 'day') return isoDay(i - 1);
      if (d === 'ageGroup') return i === 0 ? 'age18-24' : 'age25-34';
      if (d === 'gender') return i === 0 ? 'male' : 'female';
      if (d === 'country') return i === 0 ? 'US' : 'IN';
      if (d === 'device') return i === 0 ? 'MOBILE' : 'DESKTOP';
      if (d === 'uploadType') return 'REGULAR';
      return 'mock';
    });
    rows.push([...dimValues, ...mets.map((m) => valueFor(m === 'viewerPercentage' ? 'views' : m, i))]);
  }
  return { kind: 'youtubeAnalytics#resultTable', columnHeaders, rows };
}

function gscQueryBody(body) {
  const dims = (body && body.dimensions) || [];
  const rows = [];
  for (let i = 0; i < 3; i += 1) {
    const keys = dims.map((d) => {
      if (d === 'date') return isoDay(i - 2);
      if (d === 'country') return ['USA', 'IND', 'GBR'][i];
      if (d === 'device') return ['MOBILE', 'DESKTOP', 'TABLET'][i];
      if (d === 'page') return `https://example.com/post-${i}`;
      if (d === 'query') return ['analytics dashboard', 'social metrics', 'seo report'][i];
      return 'mock';
    });
    rows.push({ keys, clicks: 12 - i * 3, impressions: 340 - i * 40, ctr: 0.035 - i * 0.004, position: 11.4 + i });
  }
  return { responseType: 'byPage', rows };
}

function createMockUpstream({ port = 4988 } = {}) {
  const requests = [];
  let server = null;

  const send = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (!raw) return resolve(undefined);
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });

  async function handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const query = Object.fromEntries(url.searchParams.entries());
    const record = {
      method: req.method,
      path: url.pathname,
      query,
      url: req.url,
      auth: req.headers.authorization || null,
    };

    // ── Google OAuth (YouTube + GSC token refresh) ─────────────────
    if (url.pathname.endsWith('/token')) {
      const raw = await readBody(req);
      record.body = raw;
      requests.push(record);
      return send(res, 200, { access_token: 'ya29.mock-access-token', expires_in: 3599, scope: process.env.MOCK_GOOGLE_SCOPE || 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly', token_type: 'Bearer' });
    }

    // ── YouTube Analytics reports ──────────────────────────────────
    if (url.pathname.includes('/yt/v2/reports')) {
      requests.push(record);
      return send(res, 200, ytReportBody(query));
    }

    // ── YouTube Data API ───────────────────────────────────────────
    if (url.pathname.includes('/youtube/v3/channels')) {
      requests.push(record);
      const mode = process.env.MOCK_YT_DATA_API || 'ok';
      if (mode === 'denied') {
        // Exactly what the real deployment returns when the refresh token lacks
        // youtube.readonly: the Analytics API works, the Data API does not.
        return send(res, 403, {
          error: {
            code: 403,
            message: 'Request had insufficient authentication scopes.',
            errors: [{ message: 'Request had insufficient authentication scopes.', domain: 'youtube', reason: 'forbidden', extendedHelp: 'https://developers.google.com/youtube/v3/docs/channels/list' }],
            status: 'PERMISSION_DENIED',
          },
        });
      }
      if (mode === 'notConfigured') {
        return send(res, 403, {
          error: {
            code: 403,
            message: 'YouTube Data API v3 has not been used in project 123456 before or it is disabled.',
            errors: [{ message: 'access not configured', domain: 'usageLimits', reason: 'accessNotConfigured' }],
            status: 'PERMISSION_DENIED',
          },
        });
      }
      return send(res, 200, {
        items: [{
          id: 'UCmockchannel',
          snippet: { title: 'Mock Channel', description: 'offline test channel', customUrl: '@mockchannel' },
          statistics: { viewCount: '4820', subscriberCount: '132', hiddenSubscriberCount: false, videoCount: '27' },
        }],
      });
    }
    if (url.pathname.includes('/youtube/v3/')) {
      requests.push(record);
      return send(res, 200, { items: [], pageInfo: { totalResults: 0 } });
    }

    // ── Google Search Console ──────────────────────────────────────
    if (url.pathname.includes('/webmasters/v3/sites') || url.pathname.includes('/searchConsole/v1/sites')) {
      if (req.method === 'POST') {
        record.body = await readBody(req);
        requests.push(record);
        return send(res, 200, gscQueryBody(record.body));
      }
      requests.push(record);
      return send(res, 200, { siteEntry: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] });
    }

    // ── Meta Graph ─────────────────────────────────────────────────
    const graph = url.pathname.match(/^\/graph\/[^/]+\/(.+)$/);
    const node = graph ? graph[1] : null;

    if (node === 'me/accounts') {
      requests.push(record);
      return send(res, 200, {
        data: [{
          access_token: 'mock-page-access-token',
          id: process.env.FACEBOOK_PAGE_ID || '123456789012345',
          name: 'Mock Page',
          category: 'Community',
          tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
        }],
        paging: {},
      });
    }

    if (node === 'oauth/access_token') {
      requests.push(record);
      return send(res, 200, { access_token: 'mock-long-lived-token', token_type: 'bearer', expires_in: 5183944 });
    }

    if (node && node.endsWith('/insights')) {
      requests.push(record);
      const mediaId = node.split('/')[0];
      if (MOCK_MEDIA_IDS.has(mediaId)) {
        // Per-media insights: lifetime scalars, no end_time.
        if (process.env.MOCK_IG_MEDIA_INSIGHTS === 'denied') {
          return send(res, 403, { error: { message: '(#10) This endpoint requires the instagram_manage_insights permission.', type: 'OAuthException', code: 10 } });
        }
        const wanted = String(query.metric || '').split(',').filter(Boolean);
        const perMedia = { likes: 7, comments: 2, shares: 1, saved: 3, impressions: 540, reach: 402, plays: 1180 };
        return send(res, 200, {
          data: wanted.filter((m) => m in perMedia).map((m) => ({ name: m, period: 'lifetime', values: [{ value: perMedia[m] }] })),
        });
      }
      const rejection = graphInsightsError(query);
      if (rejection) return send(res, rejection.status, rejection.body);
      return send(res, 200, graphInsightsBody(query));
    }

    // ── Facebook Page posts (three endpoints need different permissions) ──
    const postsMatch = node && node.match(/^(?:[^/]+)\/(posts|feed|published_posts)$/);
    if (postsMatch) {
      requests.push(record);
      const denied = String(process.env.MOCK_FB_POSTS_DENY || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (denied.includes(postsMatch[1])) {
        return send(res, 403, {
          error: {
            message: `(#200) Requires extended permission: pages_read_user_content (endpoint: ${postsMatch[1]})`,
            type: 'OAuthException',
            code: 200,
          },
        });
      }
      const list = [
        {
          id: `${node.split('/')[0]}_1001`,
          message: 'Mock post one — the newest thing we shipped.',
          created_time: new Date(Date.now() - 2 * 86400000).toISOString(),
          permalink_url: 'https://facebook.com/permalink1001',
          status_type: 'added_photos',
          full_picture: 'https://example.invalid/p1.jpg',
          shares: { count: 2 },
          reactions: { summary: { total_count: 11, can_reaction: true } },
          comments: { summary: { total_count: 3, can_comment: true } },
        },
        {
          id: `${node.split('/')[0]}_1002`,
          message: 'Mock post two — a short text update.',
          created_time: new Date(Date.now() - 9 * 86400000).toISOString(),
          permalink_url: 'https://facebook.com/permalink1002',
          status_type: 'mobile_status_update',
          reactions: { summary: { total_count: 4 } },
          comments: { summary: { total_count: 1 } },
        },
        {
          id: `${node.split('/')[0]}_1003`,
          message: 'Mock post three — outside the range, must not be summed.',
          created_time: new Date(Date.now() - 400 * 86400000).toISOString(),
          permalink_url: 'https://facebook.com/permalink1003',
          status_type: 'added_video',
          reactions: { summary: { total_count: 99 } },
          comments: { summary: { total_count: 99 } },
          shares: { count: 99 },
        },
      ];
      return send(res, 200, { data: list, paging: {} });
    }

    // ── Instagram media list ──
    if (node && node.endsWith('/media')) {
      requests.push(record);
      if (process.env.MOCK_IG_MEDIA === 'denied') {
        return send(res, 403, { error: { message: '(#200) Requires extended permission: instagram_basic', type: 'OAuthException', code: 200 } });
      }
      // The exact refusal the live account returned on 2026-10-21. Its wording is
      // the useful part: Meta names the route where the field IS available.
      if (process.env.MOCK_IG_MEDIA === 'denied-36104') {
        return send(res, 400, {
          error: {
            message: '(#36104) You do not have permission to access this field outside of the Business Discovery API.',
            type: 'OAuthException',
            code: 36104,
            fbtrace_id: 'mocktrace',
          },
        });
      }
      return send(res, 200, {
        data: [
          {
            id: '17900000000000001', caption: 'Mock reel — behind the scenes', media_type: 'REELS',
            media_url: 'https://example.invalid/r1.mp4', permalink: 'https://instagram.com/reel/r1',
            timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
            like_count: 18, comments_count: 4, view_count: 940, thumbnail_url: 'https://example.invalid/r1.jpg',
          },
          {
            id: '17900000000000002', caption: 'Mock carousel', media_type: 'CAROUSEL_ALBUM',
            media_url: 'https://example.invalid/c1.jpg', permalink: 'https://instagram.com/p/c1',
            timestamp: new Date(Date.now() - 12 * 86400000).toISOString(),
            like_count: 6, comments_count: 1,
            children: { data: [{ id: 'child1', media_type: 'IMAGE', media_url: 'https://example.invalid/c1a.jpg' }] },
          },
          {
            id: '17900000000000003', caption: 'Old mock image — outside the range', media_type: 'IMAGE',
            media_url: 'https://example.invalid/o1.jpg', permalink: 'https://instagram.com/p/o1',
            timestamp: new Date(Date.now() - 500 * 86400000).toISOString(), like_count: 77, comments_count: 77,
          },
        ],
        paging: {},
      });
    }

    if (node) {
      requests.push(record);
      // One unsupported field 400s the WHOLE Graph request — exactly what broke
      // the Facebook page header. Tests use MOCK_FB_BAD_FIELDS to prove the
      // layered fetch in tokenService keeps the fields that are allowed.
      const requested = String(query.fields || '').split(',').map((f) => f.split('.')[0].split('(')[0]);
      const refused = badFields().filter((f) => requested.includes(f));
      if (refused.length) {
        return send(res, 400, {
          error: {
            message: `(#100) Unsupported get request. Object with ID '${node.split('/')[0]}' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Requested fields: ${refused.join(', ')}`,
            type: 'GraphMethodException',
            code: 100,
            fbtrace_id: 'mocktrace',
          },
        });
      }
      return send(res, 200, graphNodeBody(query, node.split('/')[0]));
    }

    requests.push(record);
    return send(res, 404, { error: { message: `mock upstream has no route for ${url.pathname}`, type: 'mock', code: 404 } });
  }

  server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: { message: `mock upstream crashed: ${e.message}`, code: 500 } }));
  });

  const api = {
    port,
    requests,
    ready: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          api.port = server.address().port; // port 0 → the OS picked one
          resolve();
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    reset: () => { requests.length = 0; },
    /** Every recorded request whose path contains `needle`. */
    calls: (needle) => requests.filter((r) => r.path.includes(needle)),
    /** Query keys sent to every request whose path contains `needle`. */
    queryKeysFor: (needle) => [...new Set(requests.filter((r) => r.path.includes(needle)).flatMap((r) => Object.keys(r.query)))],
  };
  return api;
}

module.exports = { createMockUpstream };
