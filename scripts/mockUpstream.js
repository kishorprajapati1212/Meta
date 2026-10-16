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

function graphInsightsBody(query) {
  const metrics = String(query.metric || '').split(',').map((m) => m.trim()).filter(Boolean);
  const period = query.period || 'day';
  const days = period === 'lifetime' ? 1 : 2;
  const data = metrics.map((metric) => {
    const values = [];
    for (let i = 0; i < days; i += 1) {
      const end_time = `${isoDay(i - days + 1)}T00:00:00+0000`;
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
  return out;
}

function ytReportBody(query) {
  const dims = String(query.dimensions || '').split(',').filter(Boolean);
  const mets = String(query.metrics || '').split(',').filter(Boolean);
  const columnHeaders = [
    ...dims.map((name) => ({ name, columnType: 'DIMENSION', dataType: 'STRING' })),
    ...mets.map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })),
  ];
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
      return send(res, 200, { access_token: 'ya29.mock-access-token', expires_in: 3599, scope: 'https://www.googleapis.com/auth/yt-analytics.readonly', token_type: 'Bearer' });
    }

    // ── YouTube Analytics reports ──────────────────────────────────
    if (url.pathname.includes('/yt/v2/reports')) {
      requests.push(record);
      return send(res, 200, ytReportBody(query));
    }

    // ── YouTube Data API ───────────────────────────────────────────
    if (url.pathname.includes('/youtube/v3/channels')) {
      requests.push(record);
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
      return send(res, 200, graphInsightsBody(query));
    }

    if (node) {
      requests.push(record);
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
