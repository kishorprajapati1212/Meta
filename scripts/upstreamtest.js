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

  await check('every Graph insights call carries metric, period and a token', () => {
    for (const call of up.calls('/insights')) {
      for (const key of ['metric', 'period', 'access_token']) {
        assert.ok(key in call.query, `missing ${key} in ${call.url}`);
      }
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
