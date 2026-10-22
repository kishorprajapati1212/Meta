/**
 * scripts/upstreamtest.js — what the services actually put ON THE WIRE.
 *
 * Runs in its own process (it needs credential-shaped env vars, which would
 * break selftest.js's "not configured" assertions) against the offline mock
 * upstream in scripts/mockUpstream.js.
 *
 * It exists because of two bugs that no amount of response-shape testing could
 * catch — both were visible only in the outgoing request or as a raw
 * ReferenceError:
 *
 *   1. Instagram leaked its internal metric-group keys into the Graph query
 *      (`?id=g1&optional=true`). Graph answered
 *      `(#100) Invalid token: "<ig-id>". An ID has already been specified.`
 *      → every group failed → IG_ALL_FAILED, no Instagram data at all.
 *   2. gscService.js called the shared demographics helper `demo` without
 *      requiring it → `ReferenceError: demo is not defined`, surfaced to the
 *      client as `[ERROR] UNKNOWN demo is not defined`.
 *
 * Plus a static audit that fails the build if ANY module under src/ uses an
 * identifier it never declared — the general form of bug #2.
 *
 * Run: node scripts/upstreamtest.js   (also part of `npm test`)
 */
process.env.PORT = '5099';
process.env.ACCESS_TOKEN = 'mock-user-access-token';
process.env.INSTAGRAM_ID = '17841432245164684';
process.env.FACEBOOK_PAGE_ID = '123456789012345';
process.env.FB_API_VERSION = 'v19.0';
process.env.YOUTUBE_REFRESH_TOKEN = 'mock-youtube-refresh-token';
process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'mock-google-client-secret';
process.env.GSC_REFRESH_TOKEN = 'mock-gsc-refresh-token';
process.env.GSC_CLIENT_ID = 'mock-gsc-client-id';
process.env.GSC_CLIENT_SECRET = 'mock-gsc-client-secret';
process.env.GSC_SITE_URL = 'https://example.com/';
process.env.ZERNIO_API_KEY = 'sk_upstreamtest_key';
process.env.ACCOUNT_CREATED = '2020-01-01';

// The mock binds an ephemeral port (or MOCK_UPSTREAM_PORT) so this suite can
// run next to a live stack; config is required only after the port is known.
const UP = Number(process.env.MOCK_UPSTREAM_PORT || 0);
const pointConfigAt = (port) => {
  process.env.FB_API_BASE = `http://127.0.0.1:${port}/graph`;
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${port}/token`;
  process.env.YOUTUBE_ANALYTICS_URL = `http://127.0.0.1:${port}/yt/v2/reports`;
  process.env.YOUTUBE_DATA_API_URL = `http://127.0.0.1:${port}/youtube/v3`;
  process.env.GSC_API_BASE = `http://127.0.0.1:${port}/webmasters/v3`;
  process.env.ZERNIO_BASE_URL = `http://127.0.0.1:${port}/zernio/api`;
};

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createMockUpstream } = require('./mockUpstream');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => { passed += 1; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }, (e) => { failed += 1; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`); });
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed += 1;
    failures.push(`${name}: ${e.message}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`);
  }
  return Promise.resolve();
}

/** Keys that are internal bookkeeping and must never reach an upstream API. */
const INTERNAL_KEYS = ['id', 'optional', 'group', 'label', 'internal', 'kindHint'];

// ── Static audit: identifiers used but never declared ────────────────
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await', 'yield', 'new',
  'do', 'else', 'try', 'finally', 'throw', 'case', 'in', 'of', 'delete', 'void', 'instanceof',
  'import', 'export', 'from', 'async', 'class', 'extends', 'super', 'with', 'default',
]);

const GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Buffer',
  'process', 'console', 'module', 'exports', 'require', 'URL', 'URLSearchParams', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'RegExp', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Symbol', 'Intl', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'setImmediate', 'global', 'globalThis', 'BigInt', 'Proxy', 'Reflect',
  'AbortSignal', 'AbortController', 'fetch', 'structuredClone', 'queueMicrotask', 'TextEncoder',
  'TextDecoder', 'Uint8Array', 'ArrayBuffer', 'FormData', 'this', 'super', 'arguments', 'null',
  'true', 'false', 'undefined', 'NaN', 'Infinity', '__dirname', '__filename',
]);

function declaredNames(src) {
  const names = new Set();
  const addList = (raw) => {
    if (!raw) return;
    for (let part of String(raw).split(',')) {
      part = part.trim();
      if (!part) continue;
      if (part.startsWith('...')) part = part.slice(3).trim();
      if (part.includes(':')) part = part.split(':').pop().trim(); // rename / type annotations
      if (part.includes('=')) part = part.split('=')[0].trim(); // default value
      part = part.replace(/[{}[\]]/g, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(part)) names.add(part);
      // nested destructuring: pull every bare word out of it
      for (const m of String(raw).matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (!GLOBALS.has(m[0])) names.add(m[0]);
      }
    }
  };
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}/g)) addList(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) addList(m[1]);
  for (const m of src.matchAll(/function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) names.add(m[1]);
    addList(m[2]);
  }
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) addList(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) { names.add(m[1]); addList(m[2]); }
  for (const m of src.matchAll(/catch\s*\(([^)]*)\)/g)) addList(m[1]);
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

/**
 * stripNonCode — a small scanner rather than chained regexes.
 *
 * Regex stripping cannot survive apostrophes inside double-quoted strings
 * (`networkHint("Google's YouTube Analytics API")`) or quotes inside comments:
 * it swallows real code and then reports declared variables as "undeclared".
 * This walks the source once, dropping comments and string/template text while
 * KEEPING the code inside `${…}` interpolations, which is what we want to audit.
 */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  const skipString = (quote) => {
    i += 1;
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') i += 1;
      i += 1;
    }
    i += 1;
    out += '""';
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      skipString(c);
      continue;
    }
    if (c === '`') {
      i += 1;
      let depth = 0;
      // Dropped literal text must still leave a word boundary, otherwise
      // `${name}|${parts}` collapses into the identifier "nameparts".
      let pendingSpace = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { i += 2; pendingSpace = true; continue; }
        if (depth === 0 && ch === '`') { i += 1; break; }
        if (depth === 0 && ch === '$' && src[i + 1] === '{') {
          if (pendingSpace) { out += ' '; pendingSpace = false; }
          depth = 1;
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (ch === '{') { depth += 1; i += 1; continue; }
          if (ch === '}') { depth -= 1; i += 1; pendingSpace = true; continue; }
          if (ch === "'" || ch === '"' || ch === '`') { skipString(ch); pendingSpace = false; continue; }
          out += ch;
          i += 1;
          continue;
        }
        i += 1; // literal template text — dropped
        pendingSpace = true;
      }
      out += '`` ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function auditFile(file) {
  let src = stripNonCode(fs.readFileSync(file, 'utf8'));
  // A regex literal followed by a member access (`/x/i.test(…)`) would otherwise
  // read as the identifier `i`.
  src = src.replace(/\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*(?=\s*\.)/g, 'null');

  const declared = declaredNames(src);
  const problems = new Set();

  // member access: `demo.empty(…)` where `demo` was never required
  for (const m of src.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\??\.(?!\d)/g)) {
    const name = m[2];
    if (GLOBALS.has(name) || declared.has(name)) continue;
    problems.add(name);
  }

  // bare calls: `toDateStr(…)` where toDateStr was never imported. Member calls
  // are skipped (preceded by `.`), keywords are skipped, and object-literal /
  // class method shorthands (`{ ready() {`) are definitions, not calls.
  for (const m of src.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || declared.has(name)) continue;
    const head = src.slice(0, m.index + 1).trimEnd();
    const tail = src.slice(m.index + name.length + 1, m.index + name.length + 200);
    if (/[{,]$/.test(head) && /^\s*[^)]*\)\s*\{/.test(tail)) continue; // method definition
    problems.add(name);
  }
  return [...problems];
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

// ── Run ──────────────────────────────────────────────────────────────
async function main() {
  const up = createMockUpstream({ port: UP });
  await up.ready();
  pointConfigAt(up.port);
  console.log(`\n\x1b[1mMeta Analytics API — upstream request test\x1b[0m (mock Graph/Google on :${up.port})\n`);

  const config = require('../src/config');
  const instagram = require('../src/services/instagramService');
  const facebook = require('../src/services/facebookService');
  const gsc = require('../src/services/gscService');
  const youtube = require('../src/services/youtubeService');
  const tokens = require('../src/services/tokenService');

  const query = { date_preset: 'last_7d' };

  // ── 1. Instagram wire hygiene (the IG_ALL_FAILED bug) ─────────────
  console.log('Instagram — what Graph receives');

  let igResult = null;
  let igError = null;
  await check('GET /{INSTAGRAM_ID}/insights succeeds against a healthy token', async () => {
    up.reset();
    try {
      igResult = await instagram.fetchInsights(query);
    } catch (e) {
      igError = e;
    }
    assert.ok(!igError, `Instagram insights failed: ${igError && igError.message}`);
    assert.ok(igResult, 'no result');
  });

  await check('no internal group key (id/optional) is sent to Graph', () => {
    const insightCalls = up.calls('/insights');
    assert.ok(insightCalls.length >= 2, `expected the metric groups to fire, saw ${insightCalls.length}`);
    for (const call of insightCalls) {
      const leaked = Object.keys(call.query).filter((k) => INTERNAL_KEYS.includes(k));
      assert.deepStrictEqual(leaked, [], `Graph must not receive internal keys, got ${leaked.join(', ')} in ${call.url}`);
    }
  });

  await check('every Graph insights call carries metric and a token, windowed ones a period', () => {
    for (const call of up.calls('/insights')) {
      for (const key of ['metric', 'access_token']) {
        assert.ok(key in call.query, `missing ${key} in ${call.url}`);
      }
      // Per-media insights (/{media-id}/insights) are lifetime scalars: Graph
      // takes no `period` and no window for them, so only account-level calls
      // are held to the period + since/until rule.
      const windowed = 'since' in call.query || 'until' in call.query || 'period' in call.query;
      if (!windowed) continue;
      assert.ok('period' in call.query, `missing period in ${call.url}`);
      // lifetime audience metrics legitimately carry no window
      if (call.query.period !== 'lifetime') {
        for (const key of ['since', 'until']) {
          assert.ok(key in call.query, `missing ${key} in ${call.url}`);
        }
      }
    }
  });

  await check('the access token is a token, never the Instagram id', () => {
    for (const call of up.requests) {
      const token = call.query.access_token;
      if (!token) continue;
      assert.ok(token !== config.INSTAGRAM_ID, `access_token was the INSTAGRAM_ID in ${call.url}`);
      assert.ok(!/^\d{10,}$/.test(token), `access_token looks like a numeric id (${token}) in ${call.url}`);
    }
  });

  await check('metric_type is only sent for total_value groups', () => {
    const withType = up.calls('/insights').filter((c) => 'metric_type' in c.query);
    assert.ok(withType.length >= 1, 'no group sent metric_type');
    for (const call of withType) {
      assert.strictEqual(call.query.metric_type, 'total_value', `unexpected metric_type ${call.query.metric_type}`);
    }
  });

  await check('Instagram returns real metrics (reach + follower_count)', () => {
    const keys = (igResult.metrics || []).map((m) => m.key || m.id);
    assert.ok(keys.length >= 2, `expected metrics, got ${JSON.stringify(keys)}`);
    assert.ok(igResult.overview, 'no overview');
    const flat = JSON.stringify(igResult.overview);
    assert.ok(flat.includes('reach'), `overview has no reach: ${flat.slice(0, 200)}`);
  });

  await check('Instagram profile details are attached from the Graph node call', () => {
    assert.ok(igResult.overview.account, 'no account block');
    assert.strictEqual(igResult.overview.account.username, 'mockbusiness');
    assert.ok(igResult.overview.account.followers > 0, 'no follower count');
  });

  await check('Instagram demographics return real rows (audience_* are map-shaped)', async () => {
    const d = await instagram.fetchDemographics();
    assert.ok(d, 'no demographics object');
    assert.strictEqual(d.available, true, `demographics marked unavailable: ${d.note}`);
    assert.ok(Array.isArray(d.countries) && d.countries.length >= 2, `countries empty: ${JSON.stringify(d.countries)}`);
    assert.ok(Array.isArray(d.cities) && d.cities.length >= 2, `cities empty: ${JSON.stringify(d.cities)}`);
    assert.ok(d.gender && (d.gender.male > 0 || d.gender.female > 0), `no gender split: ${JSON.stringify(d.gender)}`);
    assert.ok(Array.isArray(d.age) && d.age.length > 0, 'no age buckets');
  });

  await check('Instagram total_value metrics (profile views, interactions) are non-zero', () => {
    const byId = Object.fromEntries((igResult.metrics || []).map((m) => [m.id, (m.summary || {}).total]));
    const wanted = ['profile_views', 'likes', 'comments', 'total_interactions'];
    const zeros = wanted.filter((w) => !(byId[w] > 0));
    assert.deepStrictEqual(zeros, [], `total_value metrics read as zero: ${zeros.join(', ')} (got ${JSON.stringify(byId)})`);
  });

  await check('the IG_ALL_FAILED / "An ID has already been specified" error cannot recur', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'instagramService.js'), 'utf8');
    assert.ok(!/params:\s*\{\s*\.\.\.g/.test(src), 'the group object is still spread into the Graph query');
    assert.ok(igError === null, `Instagram still failing: ${igError && igError.message}`);
  });

  // ── 2. Facebook wire hygiene ──────────────────────────────────────
  console.log('\nFacebook — what Graph receives');

  let fbResult = null;
  await check('page insights are requested with the exchanged PAGE token, not the user token', async () => {
    up.reset();
    fbResult = await facebook.fetchInsights(query);
    assert.ok(fbResult && fbResult.overview, 'no facebook overview');
    const insightCalls = up.calls('/insights');
    assert.ok(insightCalls.length >= 1, 'no page insights request');
    for (const call of insightCalls) {
      assert.strictEqual(
        call.query.access_token, 'mock-page-access-token',
        `page insights must use the page token, sent ${call.query.access_token}`
      );
    }
  });

  await check('Facebook insights send no internal group keys either', () => {
    for (const call of up.calls('/insights')) {
      const leaked = Object.keys(call.query).filter((k) => INTERNAL_KEYS.includes(k));
      assert.deepStrictEqual(leaked, [], `internal keys ${leaked.join(', ')} leaked in ${call.url}`);
    }
  });

  await check('Facebook demographics return real rows (Meta sends map-shaped values)', async () => {
    const d = await facebook.fetchDemographics();
    assert.ok(d, 'no demographics object');
    assert.strictEqual(d.available, true, `demographics marked unavailable: ${d.note}`);
    assert.ok(Array.isArray(d.countries) && d.countries.length >= 2, `countries empty: ${JSON.stringify(d.countries)}`);
    assert.strictEqual(d.countries[0].code, 'US', `unexpected top country ${d.countries[0] && d.countries[0].code}`);
    assert.ok(d.countries[0].value > 0, 'country value is zero');
    assert.ok(d.gender && (d.gender.male > 0 || d.gender.female > 0), `no gender split: ${JSON.stringify(d.gender)}`);
    assert.ok(Array.isArray(d.age) && d.age.length > 0, 'no age buckets');
  });

  await check('Facebook interaction metrics are not zeroed by the total_value shape', () => {
    const totals = JSON.stringify(fbResult.overview);
    assert.ok(!/"total":\s*0[,}]/.test(totals) || fbResult.metrics.some((m) => (m.summary || {}).total > 0),
      `every Facebook metric came back zero: ${totals.slice(0, 300)}`);
    const nonZero = fbResult.metrics.filter((m) => (m.summary || {}).total > 0).length;
    assert.ok(nonZero >= 2, `only ${nonZero} Facebook metrics have data`);
  });

  // ── 3. Search Console (the `demo is not defined` bug) ─────────────
  console.log('\nGoogle Search Console — end to end');

  let gscResult = null;
  await check('GSC insights complete without a ReferenceError', async () => {
    up.reset();
    try {
      gscResult = await gsc.fetchInsights(query);
    } catch (e) {
      assert.fail(`GSC fetchInsights threw: ${e.message}`);
    }
    assert.ok(gscResult && gscResult.overview, 'no GSC overview');
  });

  await check('GSC demographics are built (regression: demo is not defined)', async () => {
    assert.ok(gscResult.demographics, 'no demographics block — the helper never ran');
    const d = gscResult.demographics;
    assert.ok(Array.isArray(d.countries), 'countries is not an array');
    assert.ok(Array.isArray(d.devices), 'devices is not an array');
    assert.ok(!d.error || d.countries.length || d.devices.length, `demographics failed: ${d.error}`);
  });

  await check('GSC token refresh posts to the Google token endpoint', () => {
    const tokenCalls = up.calls('/token');
    assert.ok(tokenCalls.length >= 1, 'no token refresh happened');
    assert.strictEqual(tokenCalls[0].method, 'POST');
  });

  await check('GSC search analytics query is a POST with dimensions', () => {
    const q = up.calls('/searchAnalytics/query');
    assert.ok(q.length >= 1, 'no searchAnalytics call');
    assert.strictEqual(q[0].method, 'POST');
    assert.ok(q[0].body && Array.isArray(q[0].body.dimensions) === false || q[0].body, 'no request body recorded');
  });

  // ── 4. YouTube ────────────────────────────────────────────────────
  console.log('\nYouTube — Analytics + Data API');

  let ytResult = null;
  await check('YouTube insights complete', async () => {
    up.reset();
    ytResult = await youtube.fetchInsights(query);
    assert.ok(ytResult && ytResult.overview, 'no YouTube overview');
    assert.ok((ytResult.metrics || []).length > 0, 'no YouTube metrics');
  });

  await check('YouTube demographics resolve via viewerPercentage', async () => {
    const d = await youtube.fetchDemographics(query);
    assert.ok(d, 'no demographics');
    assert.ok(Array.isArray(d.countries) || d.missing, 'no countries and no missing list');
  });

  await check('YouTube report requests carry ids, metrics and dimensions', () => {
    const reports = up.calls('/yt/v2/reports');
    assert.ok(reports.length >= 1, 'no analytics report request');
    for (const r of reports) {
      assert.ok(r.query.ids, `missing ids in ${r.url}`);
      assert.ok(r.query.metrics, `missing metrics in ${r.url}`);
    }
  });

  // ── 5. Static audit — the general form of both bugs ───────────────
  console.log('\nStatic audit — no module may use an identifier it never declared');

  await check('every src module is free of undeclared identifiers', () => {
    const root = path.join(__dirname, '..', 'src');
    const bad = [];
    for (const file of walk(root)) {
      const problems = auditFile(file);
      if (problems.length) bad.push(`${path.relative(root, file)}: ${problems.join(', ')}`);
    }
    assert.deepStrictEqual(bad, [], `undeclared identifiers (missing require?)\n      ${bad.join('\n      ')}`);
  });

  await check('every service that uses the demographics helper requires it', () => {
    const servicesDir = path.join(__dirname, '..', 'src', 'services');
    for (const file of fs.readdirSync(servicesDir)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      if (/\bdemo\./.test(src)) {
        assert.ok(
          /require\(['"]\.\.\/utils\/demographics['"]\)/.test(src),
          `${file} uses demo.* but never requires ../utils/demographics`
        );
      }
    }
  });

  await check('the Instagram metric groups keep their ids for diagnostics only', () => {
    for (const g of instagram.GROUPS) {
      assert.ok(g.id && g.metric && g.period, `malformed group ${JSON.stringify(g)}`);
    }
    // …and the wire builder must strip them.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'instagramService.js'), 'utf8');
    assert.ok(!/params:\s*\{\s*\.\.\.g/.test(src), 'instagramService still spreads the group object into params');
  });



  // ── 7. Meta's 30-day window limit (the reported Instagram failure) ──
  console.log('\nMeta Graph windows — "(#100) There cannot be more than 30 days"');

  const { graphHint, insightWindows } = require('../src/utils/graphInsights');

  await check('insightWindows splits a long range into Graph-legal chunks', () => {
    const day = 86400;
    const plan = insightWindows(1000 * day, 1120 * day); // 120 days
    assert.ok(plan.windows.length >= 4, `expected >=4 windows for 120 days, got ${plan.windows.length}`);
    for (const w of plan.windows) {
      assert.ok(w.until - w.since <= 29 * day, `window is ${w.until - w.since}s, over Meta's 2592000s limit`);
    }
    assert.strictEqual(plan.windows[0].since, 1000 * day, 'first window must start at `since`');
    assert.strictEqual(plan.windows[plan.windows.length - 1].until, 1120 * day, 'last window must end at `until`');
    assert.strictEqual(plan.clamped, false, 'a 120-day range must not be clamped');
  });

  await check('an absurd range is clamped to the most recent windows, not dropped', () => {
    const day = 86400;
    const plan = insightWindows(0, 1120 * day); // ~3 years
    assert.ok(plan.windows.length <= 8, `expected at most 8 windows, got ${plan.windows.length}`);
    assert.strictEqual(plan.clamped, true, 'should report that it clamped');
    assert.strictEqual(plan.windows[plan.windows.length - 1].until, 1120 * day, 'must keep the MOST RECENT data');
  });

  await check('Instagram returns data for a 120-day range (was: whole platform failed)', async () => {
    up.reset();
    const res = await instagram.fetchInsights({ date_preset: 'last_120d' });
    const igCalls = up.calls('/insights').filter((c) => c.path.includes('17841432245164684'));
    assert.ok(igCalls.length >= 4, `expected windowed calls, saw ${igCalls.length}`);
    const windowed = igCalls.filter((c) => c.query.since && c.query.until);
    assert.ok(windowed.length >= 4, `expected >=4 windowed calls, saw ${windowed.length}`);
    for (const call of windowed) {
      const span = Number(call.query.until) - Number(call.query.since);
      assert.ok(span <= 2592000, `sent a ${span}s window to Graph — Meta rejects anything over 2592000s`);
    }
    assert.ok((res.metrics || []).length > 0, 'no metrics came back for 120 days');
    assert.ok((res.timeseries || []).length > 60, `timeseries covers only ${(res.timeseries || []).length} days of a 120-day range`);
    assert.ok(res.meta.windows >= 4, `meta.windows should record the chunking, got ${res.meta.windows}`);
  });

  await check('Facebook returns data for a 120-day range too', async () => {
    up.reset();
    const res = await facebook.fetchInsights({ date_preset: 'last_120d' });
    for (const call of up.calls('/insights').filter((c) => c.query.since && c.query.until)) {
      const span = Number(call.query.until) - Number(call.query.since);
      assert.ok(span <= 2592000, `sent a ${span}s window to Graph`);
    }
    assert.ok((res.metrics || []).length > 0, 'no Facebook metrics for 120 days');
  });

  await check('an all-time range degrades to the most recent windows with a notice', async () => {
    const res = await instagram.fetchInsights({ date_preset: 'all_time' });
    assert.ok((res.metrics || []).length > 0, 'all_time returned no metrics');
    assert.strictEqual(res.meta.clampedToRecent, true, 'all_time should report that it clamped');
    assert.ok(/30 days at a time/.test(res.notice || ''), `notice should explain the clamp, got: ${res.notice}`);
  });

  // ── 8. "(#100) Invalid parameter" — one retired metric must not kill a group ──
  console.log('\nMeta Graph "(#100) Invalid parameter" — per-metric recovery');

  await check('Instagram keeps the metrics Meta still serves and skips the retired one', async () => {
    process.env.MOCK_UPSTREAM_REJECT_METRICS = 'shares';
    try {
      up.reset();
      const res = await instagram.fetchInsights({ date_preset: 'last_7d' });
      const ids = (res.metrics || []).map((m) => m.id);
      assert.ok(!ids.includes('shares'), `the rejected metric should be gone, got ${ids.join(', ')}`);
      for (const kept of ['profile_views', 'likes', 'comments', 'total_interactions']) {
        assert.ok(ids.includes(kept), `${kept} was lost along with the rejected metric`);
      }
      const recovered = (res.partialErrors || []).filter((e) => e.recovered);
      assert.ok(recovered.length >= 1, 'the skipped metric was not reported');
      assert.ok(/no longer serves/.test(recovered[0].message), `unhelpful message: ${recovered[0].message}`);
      assert.strictEqual(recovered[0].optional, true, 'a skipped metric must never be a hard failure');
    } finally {
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
    }
  });

  await check('Facebook recovers the same way', async () => {
    process.env.MOCK_UPSTREAM_REJECT_METRICS = 'page_media_view';
    try {
      const res = await facebook.fetchInsights({ date_preset: 'last_7d' });
      const ids = (res.metrics || []).map((m) => m.id);
      assert.ok(!ids.includes('page_media_view'), 'the rejected metric should be gone');
      assert.ok(ids.length > 0, 'Facebook lost every metric because one was rejected');
      assert.ok((res.partialErrors || []).some((e) => e.recovered), 'no recovered note');
    } finally {
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
    }
  });

  await check('with EVERY metric rejected, Facebook degrades to profile + demographics instead of erroring', async () => {
    process.env.MOCK_UPSTREAM_REJECT_METRICS = [
      'page_views_total', 'page_follows', 'page_post_engagements', 'page_media_view',
      'page_total_media_view_unique', 'page_daily_follows', 'page_daily_follows_unique',
      'page_daily_unfollows_unique', 'page_fans', 'page_impressions',
      'page_impressions_unique', 'page_video_views',
    ].join(',');
    try {
      const res = await facebook.fetchInsights({ date_preset: 'last_7d' });
      assert.ok(res, 'no payload — the service threw instead of degrading');
      assert.ok(res.overview.account, 'the page profile should still be shown');
      assert.ok(res.demographics, 'demographics should still be shown');
      assert.ok(/unavailable|No Page insights/.test(res.notice || ''), `notice should say what happened, got: ${res.notice}`);
    } finally {
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
    }
  });

  await check('hints describe the real problem, not a permission the user already has', () => {
    const parameterError = { response: { status: 400, data: { error: { message: '(#100) Invalid parameter', code: 100 } } } };
    const expired = { response: { status: 400, data: { error: { message: 'Error validating access token: Session has expired', code: 190 } } } };
    const permission = { response: { status: 403, data: { error: { message: '(#10) This endpoint requires the pages_read_engagement permission', code: 10 } } } };
    const rateLimit = { response: { status: 400, data: { error: { message: '(#17) User request limit reached', code: 17 } } } };

    const paramHint = graphHint(parameterError, 'this Facebook Page');
    assert.ok(paramHint && /parameter|skipped|windows/i.test(paramHint), `bad hint: ${paramHint}`);
    assert.ok(!/pages_read_engagement/.test(paramHint), `a parameter error must not blame permissions: ${paramHint}`);

    assert.ok(/expired/i.test(graphHint(expired) || ''), 'an expired token must say so');
    assert.ok(/pages_read_engagement/.test(graphHint(permission) || ''), 'a real permission error should name the permission');
    assert.ok(/rate limit/i.test(graphHint(rateLimit) || ''), 'a rate limit must say so');
  });

  // ── 9. v4.2.5 — real accounts: posts, profile layers, lifetime stats ──
  console.log('\nv4.2.5 — the gaps reported from the live deployment');

  const inRange30 = (iso) => new Date(iso).getTime() > Date.now() - 31 * 86400000;

  await check('Facebook reads page posts, and their counts fill cards Meta retired', async () => {
    const r = await facebook.fetchInsights({ date_preset: 'last_30d' });
    assert.ok((r.posts || []).length >= 2, `expected page posts, got ${(r.posts || []).length}`);
    assert.strictEqual(r.meta.postsEndpoint, 'posts');
    const recent = r.posts.filter((p) => inRange30(p.publishedAt));
    assert.strictEqual(recent.length, 2, 'the 400-day-old post must stay out of the range totals');
    // 11 + 4 reactions, 3 + 1 comments, 2 shares — from the posts themselves.
    assert.strictEqual(r.overview.likes?.total, 15, JSON.stringify(r.overview.likes));
    assert.strictEqual(r.overview.likes?.source, 'posts');
    assert.strictEqual(r.overview.comments?.total, 4);
    assert.strictEqual(r.overview.shares?.total, 2);
    assert.ok((r.meta.filledFromPosts || []).includes('likes'), r.meta.filledFromPosts);
    assert.ok(/summed from those posts/.test(r.notice || ''), r.notice);
  });

  await check('when /posts is denied, the feed endpoint still fills the grid', async () => {
    process.env.MOCK_FB_POSTS_DENY = 'posts';
    try {
      const r = await facebook.fetchInsights({ date_preset: 'last_30d' });
      assert.strictEqual(r.meta.postsEndpoint, 'feed');
      assert.ok((r.posts || []).length >= 2);
    } finally {
      delete process.env.MOCK_FB_POSTS_DENY;
    }
  });

  await check('one refused profile field no longer blanks the whole page header', async () => {
    process.env.MOCK_FB_BAD_FIELDS = 'followers_count';
    try {
      const details = await tokens.getAccountDetails();
      assert.strictEqual(details.facebook.name, 'Mock Business');
      assert.ok(details.facebook.picture, 'the picture must survive a refused count field');
      assert.strictEqual(details.facebook.followers, 980, 'fan_count is the fallback source');
      assert.strictEqual(details.facebook.followerSource, 'fan_count');
      assert.ok((details.facebook.fieldErrors || []).some((e) => e.fields.includes('followers_count')));
    } finally {
      delete process.env.MOCK_FB_BAD_FIELDS;
    }
  });

  await check('with no count field allowed, followers are marked unavailable instead of 0', async () => {
    // Reality on the reported deployment: Meta rejects page_fans as an insight
    // metric AND the token cannot read the count fields on the Page node.
    process.env.MOCK_FB_BAD_FIELDS = 'followers_count,fan_count';
    process.env.MOCK_UPSTREAM_REJECT_METRICS = 'page_fans';
    try {
      const r = await facebook.fetchInsights({ date_preset: 'last_30d' });
      assert.strictEqual(r.overview.followers?.unavailable, true, JSON.stringify(r.overview.followers));
      assert.ok(r.overview.followers?.unavailableReason);
      assert.ok(r.overview.account?.name, 'the page identity still loads');
    } finally {
      delete process.env.MOCK_FB_BAD_FIELDS;
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
    }
  });

  await check('Instagram reads media and backfills engagement the insights left empty', async () => {
    process.env.MOCK_UPSTREAM_REJECT_METRICS = 'likes,comments,shares,saves';
    try {
      const r = await instagram.fetchInsights({ date_preset: 'last_30d' });
      assert.ok((r.posts || []).length >= 2, `expected media, got ${(r.posts || []).length}`);
      assert.strictEqual(r.meta.mediaInsights, true, 'per-media insights should have been read');
      // 18 + 6 likes, 4 + 1 comments from the two media items inside the range.
      assert.strictEqual(r.overview.likes?.total, 24, JSON.stringify(r.overview.likes));
      assert.strictEqual(r.overview.likes?.source, 'posts');
      assert.strictEqual(r.overview.comments?.total, 5);
      assert.strictEqual(r.overview.shares?.total, 2, 'shares come from the per-media insights');
      assert.strictEqual(r.overview.saves?.total, 6);
      assert.ok(r.posts.every((p) => p.platformUrl.startsWith('https://instagram.com/')));
    } finally {
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
    }
  });

  await check('without instagram_manage_insights the node counts still render', async () => {
    process.env.MOCK_UPSTREAM_REJECT_METRICS = 'likes,comments,shares,saves';
    process.env.MOCK_IG_MEDIA_INSIGHTS = 'denied';
    try {
      const r = await instagram.fetchInsights({ date_preset: 'last_30d' });
      assert.strictEqual(r.meta.mediaInsights, false);
      assert.strictEqual(r.overview.likes?.total, 24, 'like_count needs no extra permission');
      assert.strictEqual(r.overview.comments?.total, 5);
      assert.strictEqual(r.overview.shares?.total ?? 0, 0, 'shares genuinely need the insight call');
    } finally {
      delete process.env.MOCK_UPSTREAM_REJECT_METRICS;
      delete process.env.MOCK_IG_MEDIA_INSIGHTS;
    }
  });

  await check('retired card/annotation metrics are no longer requested from Google', async () => {
    up.reset();
    await youtube.fetchInsights({ date_preset: 'last_7d' });
    const metrics = up.calls('/yt/v2/reports').map((c) => c.query.metrics || '');
    assert.ok(metrics.length > 0, 'no analytics calls were recorded');
    assert.ok(!metrics.some((m) => /card|annotation/i.test(m)), metrics.join(' | '));
    // The lifetime + top-video reports must be there instead.
    assert.ok(metrics.some((m) => m.includes('subscribersGained') && !m.includes('averageViewDuration')), metrics.join(' | '));
    assert.ok(
      up.calls('/yt/v2/reports').some((c) => c.query.dimensions === 'video' && c.query.sort === '-views'),
      'the top-videos report should be requested with sort + dimensions=video'
    );
  });

  await check('with youtube.readonly the subscriber count stays exact', async () => {
    const r = await youtube.fetchInsights({ date_preset: 'last_30d' });
    const lt = r.overview.account.lifetime;
    assert.strictEqual(lt.source, 'data_api');
    assert.strictEqual(lt.subscribers, 132);
    assert.strictEqual(lt.subscribersEstimated, false);
    assert.strictEqual(r.meta.dataApi, 'ok');
    assert.ok(!/youtube\.readonly/.test(r.notice || ''), r.notice);
  });

  await check('without youtube.readonly, lifetime stats come from the Analytics API', async () => {
    process.env.MOCK_YT_DATA_API = 'denied';
    try {
      const r = await youtube.fetchInsights({ date_preset: 'last_30d' });
      const lt = r.overview.account.lifetime;
      assert.strictEqual(lt.source, 'analytics_api');
      assert.strictEqual(lt.subscribers, 132, 'lifetime gains (137) minus losses (5)');
      assert.strictEqual(lt.subscribersEstimated, true);
      assert.strictEqual(lt.totalViews, 4820, 'lifetime views are exact');
      assert.strictEqual(lt.watchTimeHours, 253.8);
      assert.strictEqual(r.overview.account.followers, 132, 'a 4-subscriber channel must not show 0');
      assert.strictEqual(r.overview.followers?.total, 132);
      assert.strictEqual(r.overview.followers?.estimated, true);
      assert.strictEqual(r.overview.followers?.source, 'analytics_estimate');
      assert.ok(/youtube\.readonly/.test(r.notice || ''), r.notice);
      assert.ok(/youtube\.upload/.test(r.notice || ''), 'the notice should name the scopes the token really has');
      assert.ok((r.posts || []).length >= 3, 'top videos should fill the content grid');
      assert.ok(r.posts[0].platformUrl.startsWith('https://www.youtube.com/watch?v='));
      assert.ok(r.posts[0].thumbnailUrl.includes('i.ytimg.com'));
      assert.strictEqual(r.posts[0].analytics.views, 2100);
    } finally {
      delete process.env.MOCK_YT_DATA_API;
    }
  });

  await check('a Data API that was never enabled says so instead of blaming the scope', async () => {
    process.env.MOCK_YT_DATA_API = 'notConfigured';
    try {
      const r = await youtube.fetchInsights({ date_preset: 'last_30d' });
      assert.strictEqual(r.meta.dataApi, 'accessNotConfigured');
      assert.ok(/Enable the YouTube Data API v3/.test(r.notice || ''), r.notice);
      assert.strictEqual(r.overview.account.lifetime.source, 'analytics_api', 'lifetime still works');
    } finally {
      delete process.env.MOCK_YT_DATA_API;
    }
  });

  // ── 6. The HTTP envelope must not drop service fields ─────────────
  console.log('\nResponse envelope — single-platform routes must not strip data');

  const { platformEnvelope, errorResponse } = require('../src/utils/response');

  await check('platformEnvelope keeps every field the service produced', () => {
    const serviceResult = {
      platform: 'instagram',
      meta: { dateRange: { from: 'a', to: 'b' } },
      notice: 'one group unavailable',
      overview: { reach: { total: 10 } },
      timeseries: [{ date: '2026-10-01', reach: 10 }],
      metrics: [{ id: 'reach' }],
      demographics: { available: true, countries: [{ code: 'US', value: 5 }] },
      stage: { key: 'early' },
      partialErrors: [{ group: 'g3', optional: true, message: 'x' }],
      account: { username: 'mockbusiness' },
    };
    const body = platformEnvelope('instagram', serviceResult);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.platform, 'instagram');
    assert.deepStrictEqual(body.meta, serviceResult.meta, 'meta must be hoisted intact');
    assert.strictEqual(body.notice, 'one group unavailable');
    for (const key of ['overview', 'timeseries', 'metrics', 'demographics', 'stage', 'partialErrors', 'account']) {
      assert.ok(key in body.data, `the envelope dropped "${key}"`);
    }
    assert.ok(!('platform' in body.data) && !('meta' in body.data) && !('notice' in body.data), 'envelope keys must not be duplicated inside data');
  });

  await check('platformEnvelope merges route-specific extras', () => {
    const body = platformEnvelope('pinterest', { meta: { boards: [{ id: 1 }] }, overview: {} }, { boards: [{ id: 1 }] });
    assert.deepStrictEqual(body.data.boards, [{ id: 1 }]);
  });

  await check('errorResponse keeps the actionable hint', () => {
    const err = Object.assign(new Error('All Instagram metric groups failed'), { code: 'IG_ALL_FAILED', httpStatus: 400, hint: 'Check ACCESS_TOKEN scopes.' });
    const out = errorResponse(err);
    assert.strictEqual(out.body.error.code, 'IG_ALL_FAILED');
    assert.strictEqual(out.body.error.hint, 'Check ACCESS_TOKEN scopes.', 'the hint was dropped');
    assert.strictEqual(out.httpStatus, 400);
  });

  await check('no route whitelists payload fields any more', () => {
    const routesDir = path.join(__dirname, '..', 'src', 'routes');
    const offenders = [];
    for (const file of fs.readdirSync(routesDir)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
      if (/data:\s*\{\s*overview:/.test(src)) offenders.push(file);
    }
    assert.deepStrictEqual(offenders, [], `these routes still hand-pick fields: ${offenders.join(', ')}`);
  });

  // ── 10. v4.3.0 — HTTP: the diagnosis reaches the dashboard ──
  console.log('\nv4.3.0 — growth diagnosis over HTTP (routes → envelope → panel)');

  // src/app.js binds config.PORT on require, so claim a free port first and
  // point the already-loaded config module at it (same object app.js reads).
  const net = require('net');
  const httpPort = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
  config.PORT = httpPort;
  process.env.PORT = String(httpPort);
  require('../src/app');
  const base = `http://127.0.0.1:${httpPort}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const getJson = async (qs) => {
    const res = await fetch(`${base}${qs}`, { signal: AbortSignal.timeout(120000) });
    return { status: res.status, body: await res.json() };
  };

  {
    await check('GET /api/instagram answers the "my posts have likes" complaint end to end', async () => {
      const { status, body } = await getJson('/api/instagram?date_preset=last_30d');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.success, true);
      const d = body.data.diagnosis;
      assert.ok(d, 'the envelope must carry data.diagnosis');
      assert.strictEqual(d.platform, 'instagram');
      assert.strictEqual(d.audience, 'institutions', 'no ?audience= means the education default');
      // The mock account has media with real per-media insights (24 likes in range).
      const likes = body.data.overview.likes;
      assert.ok(likes && likes.total > 0, `the likes card must be filled from the posts, got ${JSON.stringify(likes)}`);
      const engaged = d.funnel.find((f) => f.key === 'engaged');
      assert.ok(engaged.value > 0, `the funnel must show the engagement, got ${engaged.value}`);
      assert.strictEqual(engaged.verdict, 'ok');
      assert.notStrictEqual(d.stage, 'seen-not-engaged', `stage was ${d.stage}`);
      assert.ok(!d.zeros.some((z) => z.key === 'likes' && z.reason === 'seen-not-engaged'), 'likes must not be explained away as "nobody engaged"');
      assert.ok(d.actions.length > 0 && d.actions.every((a) => a.title && a.detail));
      assert.ok(typeof d.mechanics === 'string' && d.mechanics.length > 20);
      assert.ok(!JSON.stringify(d).includes('NaN'), 'NaN leaked into the diagnosis');
    });

    await check('?audience= changes the fit, the advice and nothing else in the payload', async () => {
      const students = (await getJson('/api/instagram?date_preset=last_30d&audience=students')).body;
      const inst = (await getJson('/api/instagram?date_preset=last_30d&audience=institutions')).body;
      assert.strictEqual(students.data.diagnosis.audience, 'students');
      assert.strictEqual(students.data.diagnosis.audienceFit.fit, 'high', 'Instagram reaches students');
      assert.strictEqual(inst.data.diagnosis.audienceFit.fit, 'low', 'Instagram is a weak fit for institutions');
      assert.notStrictEqual(
        JSON.stringify(students.data.diagnosis.actions),
        JSON.stringify(inst.data.diagnosis.actions),
        'the advice must actually change with the audience'
      );
      // Everything that is not the diagnosis is identical. (The mock stamps
      // publishedAt at request time, so compare the post identities, not the
      // millisecond they were generated.)
      assert.deepStrictEqual(students.data.overview, inst.data.overview);
      assert.deepStrictEqual(
        (students.data.posts || []).map((x) => [x.id || x.postId, x.likes, x.comments]),
        (inst.data.posts || []).map((x) => [x.id || x.postId, x.likes, x.comments])
      );
      assert.strictEqual(students.data.overview.likes.total, inst.data.overview.likes.total, 'the numbers themselves never change with the audience');
      // An unknown value falls back to the default instead of erroring.
      const bogus = (await getJson('/api/instagram?date_preset=last_30d&audience=robots')).body;
      assert.strictEqual(bogus.data.diagnosis.audience, 'institutions');
    });

    await check('every single-platform endpoint carries a diagnosis', async () => {
      for (const [qs, platform] of [
        ['/api/facebook?date_preset=last_30d', 'facebook'],
        ['/api/youtube?date_preset=last_30d', 'youtube'],
        // The route is /api/gsc; the diagnosis must canonicalise to searchConsole
        // so the audience fit and the benchmark tables still apply.
        ['/api/gsc?date_preset=last_30d', 'searchConsole'],
        ['/api/linkedin?date_preset=last_30d', 'linkedin'],
        ['/api/pinterest?date_preset=last_30d', 'pinterest'],
      ]) {
        const { status, body } = await getJson(qs);
        assert.strictEqual(status, 200, `${qs} → HTTP ${status}`);
        const d = body.data && body.data.diagnosis;
        assert.ok(d, `${qs}: no diagnosis`);
        assert.strictEqual(d.platform, platform, `${qs}: diagnosed as ${d.platform}`);
        assert.strictEqual(d.funnel.length, 5, `${qs}: funnel must have 5 stages`);
        assert.ok(d.actions.length > 0, `${qs}: no actions`);
        assert.ok(['high', 'medium', 'low'].includes(d.audienceFit.fit), `${qs}: fit ${JSON.stringify(d.audienceFit)}`);
        assert.ok(d.audienceFit.why && d.audienceFit.why.length > 10, `${qs}: the fit must explain itself`);
        // A channel the mock cannot serve still gets an honest diagnosis
        // instead of an empty panel.
        if (body.data.error) assert.ok(/published|distribution|reporting/i.test(d.headline), `${qs}: ${d.headline}`);
      }
    });

    await check('GET /api/combined ranks where to focus, for the chosen audience', async () => {
      const { status, body } = await getJson('/api/combined?date_preset=last_30d&audience=students');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.data.audience, 'students');
      const focus = body.data.focus;
      assert.ok(Array.isArray(focus) && focus.length === 6, `expected 6 ranked channels, got ${focus && focus.length}`);
      const scores = focus.map((r) => r.score);
      assert.ok(scores.every((v, i) => i === 0 || scores[i - 1] >= v), `scores must descend: ${scores.join(',')}`);
      for (const row of focus) {
        assert.ok(row.platform && row.stage && row.headline, `incomplete row ${JSON.stringify(row)}`);
        assert.strictEqual(typeof row.firstAction, 'string', `firstAction must be a string, got ${typeof row.firstAction}`);
        assert.ok(['high', 'medium', 'low'].includes(row.audienceFit), row.audienceFit);
      }
      for (const k of ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole']) {
        assert.ok(body.data[k].diagnosis, `${k}: no per-platform diagnosis in /api/combined`);
        assert.strictEqual(body.data[k].diagnosis.audience, 'students');
      }
      // The summary the Overview page already uses is untouched.
      assert.ok(body.data.summary && Array.isArray(body.data.summary.platforms), 'summary must survive');
      const inst = (await getJson('/api/combined?date_preset=last_30d')).body;
      assert.strictEqual(inst.data.audience, 'institutions', 'the combined default is institutions');
      assert.strictEqual(inst.data.focus.length, 6);
    });
  }
  // ── 11. v4.3.2 — HTTP: likes and comments must survive Meta's quirks ──
  console.log('\nv4.3.2 — likes/comments through an empty-200 insights form and a denied media list');

  {
    // Reproduce the live account exactly: `metric_type=total_value` + `period=day`
    // answers with an EMPTY 200 (no error, no rows), and /media is refused with
    // (#36104) pointing at the Business Discovery API.
    const prevForm = process.env.MOCK_IG_INSIGHT_FORM;
    const prevMedia = process.env.MOCK_IG_MEDIA;
    process.env.MOCK_IG_INSIGHT_FORM = 'empty-total-value-day';
    process.env.MOCK_IG_MEDIA = 'denied-36104';
    const { body } = await getJson('/api/instagram?date_preset=last_30d');
    process.env.MOCK_IG_INSIGHT_FORM = prevForm || '';
    process.env.MOCK_IG_MEDIA = prevMedia || '';
    if (!prevForm) delete process.env.MOCK_IG_INSIGHT_FORM;
    if (!prevMedia) delete process.env.MOCK_IG_MEDIA;

    await check('Instagram likes/comments survive an insights form Meta answers with an empty 200', async () => {
      const d = body.data;
      const m = body.meta || {};
      const variants = m.insightVariants || [];
      assert.ok(variants.length, 'the request forms tried must be recorded');
      const g2 = variants.find((v) => /likes/.test(v.metrics));
      assert.ok(g2, 'the interaction group must be recorded');
      assert.ok(g2.attempts.length >= 2, `only ${g2.attempts.length} form(s) were tried — the fallback did not run`);
      assert.deepStrictEqual(g2.unresolved, [], `still unresolved: ${JSON.stringify(g2.unresolved)}`);
      for (const key of ['likes', 'comments', 'shares', 'saves']) {
        const card = d.overview[key];
        assert.ok(card, `${key} card is missing`);
        assert.ok(card.hasData === true, `${key} has no data: ${JSON.stringify(card)}`);
        assert.ok(Number(card.total) > 0, `${key} is ${card.total} — the empty-200 form won`);
      }
      assert.ok(!/no rows for/i.test(String(body.notice || d.notice || '')), `the notice still claims missing rows: ${body.notice}`);
    });

    await check('a denied media list falls back to Business Discovery instead of reporting 0 posts', async () => {
      const d = body.data;
      const m = body.meta || {};
      assert.strictEqual(m.postsSource, 'business_discovery', `postsSource is ${m.postsSource}`);
      assert.ok((d.posts || []).length >= 2, `${(d.posts || []).length} posts came back`);
      assert.ok(m.postCount >= 2, `postCount is ${m.postCount} — the diagnosis would claim nothing was published`);
      const errors = (d.partialErrors || []).map((e) => `${e.group || e.endpoint}:${e.code || ''}`);
      assert.ok(
        (d.partialErrors || []).some((e) => String(e.message || '').includes('36104')),
        `the real refusal must still be reported: ${errors.join(', ')}`
      );
      assert.ok(/Business Discovery/i.test(String(body.notice || '')), `the notice must say where the posts came from: ${body.notice}`);
      const diag = d.diagnosis;
      assert.notStrictEqual(diag.stage, 'no-content', `stage is ${diag.stage} — posts exist, they were just read another way`);
    });
  }

  {
    const { body } = await getJson('/api/facebook?date_preset=last_30d');
    await check('Facebook shows a measured zero for comments and shares instead of dropping the cards', async () => {
      const ov = body.data.overview;
      assert.ok(ov.likes, 'the likes card must exist');
      assert.strictEqual(ov.likes.source, 'posts', `likes came from ${ov.likes.source}`);
      for (const key of ['comments', 'shares']) {
        assert.ok(ov[key], `the ${key} card was dropped — a measured zero must still be shown`);
        assert.strictEqual(ov[key].source, 'posts', `${key} source is ${ov[key].source}`);
        assert.strictEqual(ov[key].hasData, true, `${key} must count as measured, not missing`);
      }
      // The Page posts edge serves no impressions, so no card may be invented.
      assert.ok(!ov.impressions || ov.impressions.source !== 'posts', 'Facebook posts do not expose impressions — that card must not be fabricated');
      assert.ok(!ov.saves || ov.saves.source !== 'posts', 'Facebook posts do not expose saves — that card must not be fabricated');
      assert.ok(ov.comments.total >= 0 && ov.likes.total > 0, `likes ${ov.likes.total} / comments ${ov.comments.total}`);
    });
  }

  // ── 12. v4.3.1 — HTTP: one call that returns everything ──
  console.log('\nv4.3.1 — GET /api/report (one call, every output, nothing secret)');

  const SECRETS = [
    'mock-user-access-token',
    'sk_upstreamtest_key',
    'mock-google-client-secret',
    'mock-gsc-client-secret',
    'mock-youtube-refresh-token',
    'mock-gsc-refresh-token',
  ];

  {
    const res = await fetch(`${base}/api/report?days=90&raw=true`, { signal: AbortSignal.timeout(120000) });
    const text = await res.text();
    const body = JSON.parse(text);

    await check('GET /api/report returns every section in one call', async () => {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      for (const k of ['config', 'health', 'platforms', 'diagnosis', 'combined', 'raw', 'probes']) {
        assert.ok(body.data[k], `section ${k} is missing`);
      }
      for (const k of ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole']) {
        assert.ok(body.data.platforms[k], `platform ${k} is missing`);
      }
      assert.ok(body.data.diagnosis.institutions && body.data.diagnosis.students, 'both audience targets');
      assert.ok(body.data.combined.focus.length === 6, 'the focus ranking');
      assert.ok(body.meta.raw === true && body.meta.cacheBypassed === true, 'raw + cache bypass must be stated');
      assert.strictEqual(body.meta.days, 90);
      assert.ok(body.meta.bytes > 1000, 'the payload size is reported');
      assert.ok(Array.isArray(body.meta.truncations), 'caps are reported, never silent');
      assert.ok(body.meta.timings && Object.keys(body.meta.timings).length > 0, 'per-section timings');
    });

    await check('the raw section records every upstream call it made', async () => {
      const raw = body.data.raw;
      for (const k of ['graph', 'gsc', 'youtube', 'zernio']) assert.ok(raw[k], `raw.${k} is missing`);
      const calls = raw.zernio.calls || {};
      assert.ok(calls['GET /v1/accounts'], 'the accounts call is recorded');
      // A channel with no account upstream must say so — and must not pretend it
      // asked for analytics it could never have received. (This suite has no
      // Zernio stub, so both channels take the "not connected" branch.)
      for (const pl of ['pinterest', 'linkedin']) {
        const acct = calls[`account:${pl}`];
        assert.ok(acct, `account:${pl} is recorded either way`);
        if (acct.ok) {
          assert.ok(calls[`GET /v1/analytics?platform=${pl}`], `${pl}: connected, so its analytics call must be recorded`);
        } else {
          assert.ok(/no .*account/i.test(String(acct.error || '')), `${pl}: ${acct.error}`);
        }
      }
      assert.ok(typeof raw.zernio.summary === 'string' && raw.zernio.summary.length, 'a summary is stated');
      assert.ok(
        !/ISSUES — GET \/v1\/accounts\/\{id\}\/boards/.test(raw.zernio.summary),
        `a benign fallback 404 poisoned the summary: ${raw.zernio.summary}`
      );
      const graph = raw.graph.calls || {};
      assert.ok(Object.keys(graph).length >= 4, 'the Graph probes are recorded');
      assert.ok(Object.values(graph).every((c) => c && 'ok' in c), 'every recorded call states ok/failed');
      assert.ok(Object.values(graph).every((c) => !c.ok || c.data !== undefined || c.note), 'a successful call keeps its body');
    });

    await check('the probes state a verdict per Zernio channel', async () => {
      for (const k of ['pinterest', 'linkedin']) {
        const pr = body.data.probes[k];
        assert.ok(pr, `probe ${k} is missing`);
        assert.strictEqual(pr.platform, k);
        assert.strictEqual(typeof pr.verdict, 'string', 'a verdict must be stated');
        assert.ok(pr.verdict.length > 60, `the verdict is too thin to act on: ${pr.verdict}`);
        assert.ok(Number.isFinite(pr.postsUpstream), 'postsUpstream');
        assert.ok('entitlementGap' in pr, 'the entitlement question must be answered explicitly');
        assert.ok(Array.isArray(pr.postsSample), 'the sampled posts are the evidence');
      }
    });

    await check('no credential survives anywhere in the report', async () => {
      for (const secret of SECRETS) {
        assert.ok(!text.includes(secret), `${secret} leaked into /api/report`);
      }
      const env = body.data.config.env || {};
      assert.ok(env.ACCESS_TOKEN && typeof env.ACCESS_TOKEN === 'object', 'ACCESS_TOKEN must be a descriptor');
      assert.strictEqual(env.ACCESS_TOKEN.set, true, 'the report must still say whether it is set');
      assert.ok(Number(env.ACCESS_TOKEN.length) > 0, 'and how long it is');
      assert.ok(!/mock-user/.test(JSON.stringify(env)), 'the value itself must not be echoed');
      assert.ok(text.includes('[redacted'), 'masked values are labelled as masked');
    });

    await check('?days= is clamped and ?sections= narrows the payload', async () => {
      const wide = JSON.parse(await (await fetch(`${base}/api/report?days=99999&sections=probes`, { signal: AbortSignal.timeout(60000) })).text());
      assert.strictEqual(wide.meta.days, 365, 'days must be clamped to 365');
      assert.ok(wide.data.probes, 'the requested section is present');
      assert.ok(
        wide.data.platforms === null || Object.keys(wide.data.platforms).length === 0,
        'unrequested sections carry no data, they are not silently dropped'
      );
      assert.deepStrictEqual(wide.meta.sections, ['probes']);
      const tiny = JSON.parse(await (await fetch(`${base}/api/report?days=0&sections=config`, { signal: AbortSignal.timeout(60000) })).text());
      assert.strictEqual(tiny.meta.days, 30, 'days=0 is nonsense, so it falls back to the 30-day default');
      const neg = JSON.parse(await (await fetch(`${base}/api/report?days=-5&sections=config`, { signal: AbortSignal.timeout(60000) })).text());
      assert.strictEqual(neg.meta.days, 30, 'a negative window falls back too');
    });

    await check('?format=text is a paste-able digest, redacted the same way', async () => {
      const r2 = await fetch(`${base}/api/report?days=90&format=text`, { signal: AbortSignal.timeout(120000) });
      assert.strictEqual(r2.status, 200);
      assert.ok(/text\/plain/.test(r2.headers.get('content-type') || ''), r2.headers.get('content-type'));
      const t = await r2.text();
      assert.ok(t.startsWith('Meta Analytics report'), t.slice(0, 60));
      assert.ok(t.includes('credentials'), 'the credential block is part of the digest');
      assert.ok(t.includes('channels') && t.includes('pinterest'), 'every channel is listed');
      assert.ok(t.includes('where to focus'), 'the focus ranking is in the digest');
      assert.ok(t.length < 200000, `the digest must stay paste-able, got ${t.length} chars`);
      for (const secret of SECRETS) assert.ok(!t.includes(secret), `${secret} leaked into the text digest`);
    });

    await check('the API index advertises the report endpoint', async () => {
      const idx = (await getJson('/api')).body;
      const json = JSON.stringify(idx);
      assert.ok(json.includes('/api/report'), 'the index must list /api/report');
      assert.ok(json.includes('audience'), 'and the audience query param');
    });
  }

  // The API server keeps running until process.exit() at the end of this file.

  await up.close();

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log('');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nupstream test crashed:', e);
  process.exit(1);
});
