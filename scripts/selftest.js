/**
 * scripts/selftest.js — offline verification of the analytics layer.
 *
 * Boots a mock Zernio server on localhost, points the service at it, and
 * asserts the things that were broken in v4.0:
 *
 *   1. overview is NEVER empty for Pinterest/LinkedIn — every catalogued
 *      metric is present, including zeros (this was the "shows only Posts" bug)
 *   2. gauge metrics (followers, pins, boards) are not summed across days
 *   3. rate metrics (engagementRate, ctr) are averaged, never summed
 *   4. trends are computed and JUSTIFIED — a percentage is only published when
 *      a real, large-enough baseline exists, and it carries its own basis
 *   5. timeseries is dense — one row per day in the requested range
 *   6. a failing /v1/accounts call degrades gracefully instead of blanking
 *      the platform, and is reported in meta.diagnostics + notice
 *
 * Run: node scripts/selftest.js
 */
process.env.ZERNIO_API_KEY = 'sk_selftest_key';
process.env.ACCOUNT_CREATED = '2020-01-01';
// ZERNIO_BASE_URL is set inside main() once the mock has bound a FREE port, so
// this suite can run next to a live stack (docker compose mocks use 4987).

const assert = require('assert');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`);
  }
}

// The mock Zernio upstream lives in scripts/mockZernio.js and is shared with
// scripts/make-fixtures.js so both exercise identical behaviour.
const { createMock } = require('./mockZernio');

// ── Run ─────────────────────────────────────────────────────────
async function main() {
  const mock = createMock({ port: Number(process.env.MOCK_ZERNIO_PORT || 0), mode: 'zero-analytics' });
  await mock.ready();
  process.env.ZERNIO_BASE_URL = mock.url;
  console.log(`\n\x1b[1mMeta Analytics API — self-test\x1b[0m (mock Zernio on :${mock.port})\n`);

  const zernio = require('../src/services/zernioService');
  const { summarize } = require('../src/utils/metrics');
  const { transformMetrics, buildOverview } = require('../src/utils/transform');

  // ── 1. metrics.summarize: kinds ────────────────────────────────
  console.log('metrics.summarize — kind-aware aggregation');
  const series = (vals) => vals.map((v, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, value: v }));

  check('gauge (followers) is LAST value, not the sum', () => {
    const s = summarize('follower_count', series([100, 102, 104, 110]));
    assert.strictEqual(s.total, 110, `expected 110 got ${s.total}`);
    assert.strictEqual(s.kind, 'gauge');
  });
  check('sum (impressions) adds the range', () => {
    const s = summarize('impressions', series([10, 20, 30, 40]));
    assert.strictEqual(s.total, 100);
    assert.strictEqual(s.kind, 'sum');
  });
  check('rate (ctr) is a mean, never a sum', () => {
    const s = summarize('ctr', series([2, 4, 6, 8]));
    assert.strictEqual(s.total, 5);
    assert.strictEqual(s.unit, '%');
  });
  check('trend compares 2nd half vs 1st half', () => {
    const s = summarize('views', series([10, 10, 40, 40])); // 20 → 80 = +300%
    assert.strictEqual(s.trend, 300, `expected 300 got ${s.trend}`);
    assert.strictEqual(s.direction, 'up');
  });
  check('a zero baseline publishes NO percentage (was: a fabricated +100%)', () => {
    const s = summarize('views', series([0, 0, 5, 5]));
    assert.strictEqual(s.trend, null, `expected null got ${s.trend}`);
    assert.strictEqual(s.trendBasis, null);
    assert.strictEqual(s.direction, null, 'a null trend must not claim "flat"');
    assert.strictEqual(s.favourable, null);
  });
  check('a baseline under 10 is noise, so no percentage is published', () => {
    const s = summarize('views', series([1, 2, 4, 8])); // 3 → 12 would have read "+300%"
    assert.strictEqual(s.previous, 3);
    assert.strictEqual(s.trend, null, `expected null got ${s.trend}`);
    assert.strictEqual(s.trendBasis, null);
  });
  check('a real baseline still publishes a percentage, with the dates behind it', () => {
    const s = summarize('views', series([20, 20, 40, 40])); // 40 → 80 = +100%
    assert.strictEqual(s.trend, 100);
    assert.strictEqual(s.trendBasis, 'second-half-vs-first-half');
    assert.ok(s.trendWindows && s.trendWindows.current.from, 'trendWindows must name the compared days');
    assert.strictEqual(s.trendWindows.previous.from, '2026-09-01');
    assert.strictEqual(s.trendWindows.current.to, '2026-09-04');
    assert.strictEqual(s.direction, 'up');
  });
  check('rates keep their own scale — CTR 1% → 2% is a real statement', () => {
    const s = summarize('ctr', series([1, 1, 2, 2]));
    assert.strictEqual(s.trend, 100);
    assert.strictEqual(s.trendBasis, 'second-half-vs-first-half');
  });
  check('a gauge compares the last day with the first day, and says so', () => {
    const s = summarize('follower_count', series([100, 110, 120, 130]));
    assert.strictEqual(s.total, 130);
    assert.strictEqual(s.trend, 30);
    assert.strictEqual(s.trendBasis, 'last-day-vs-first-day');
    assert.strictEqual(s.trendWindows.current, '2026-09-04');
    assert.strictEqual(s.trendWindows.previous, '2026-09-01');
  });
  check('GSC position trend is flagged as "lower is better"', () => {
    const s = summarize('position', series([40, 40, 12, 12]));
    assert.strictEqual(s.favourable, true, 'improving position must be favourable');
  });

  // ── 2. transform.buildOverview: no dropped zeros ───────────────
  console.log('\ntransform.buildOverview — Meta/YouTube shape');
  const rawFb = [
    { name: 'page_views_total', title: 'Page views', period: 'day', values: series([0, 0, 0, 0]).map((v) => ({ end_time: v.date + 'T00:00:00+0000', value: v.value })) },
    { name: 'follower_count', title: 'Followers', period: 'day', values: [1200, 1200, 1205, 1210].map((v, i) => ({ end_time: `2026-09-0${i + 1}T00:00:00+0000`, value: v })) },
  ];
  const { metrics: fbMetrics } = transformMetrics(rawFb, false);
  const fbOverview = buildOverview(fbMetrics);

  check('zero-value metrics are kept (pageViews present at 0)', () => {
    assert.ok(fbOverview.pageViews, 'pageViews must exist even when every day is 0');
    assert.strictEqual(fbOverview.pageViews.total, 0);
    assert.strictEqual(fbOverview.pageViews.hasData, false);
  });
  check('followers maps to the follower_count gauge', () => {
    assert.strictEqual(fbOverview.followers.total, 1210, 'must be the last value, not 4815');
    assert.strictEqual(fbOverview.followers.kind, 'gauge');
  });
  check('overview entries carry label + unit for the UI', () => {
    assert.strictEqual(fbOverview.pageViews.label, 'Page views');
    assert.ok(fbOverview.followers.label);
  });

  // ── 3. Pinterest with ZERO analytics (the reported bug) ────────
  console.log('\nZernio Pinterest — zero-analytics case (the reported bug)');
  mock.setMode('zero-analytics');
  const pin = await zernio.fetchPinterest({ date_preset: 'last_30d', compact: 'true' });

  check('posts are returned (3 pins)', () => {
    assert.strictEqual(pin.posts.length, 3, `got ${pin.posts.length}`);
    assert.strictEqual(pin.meta.postCount, 3);
  });
  check('overview is NOT empty — full Pinterest catalogue present', () => {
    const keys = Object.keys(pin.overview);
    for (const expected of ['impressions', 'clicks', 'outboundClicks', 'saves', 'views', 'engagement', 'engagementRate', 'posts', 'followers', 'pins', 'boards', 'monthlyViews']) {
      assert.ok(keys.includes(expected), `overview is missing "${expected}" (has: ${keys.join(', ')})`);
    }
  });
  check('every overview entry has a human label + kind + unit', () => {
    for (const [k, v] of Object.entries(pin.overview)) {
      assert.ok(v.label && v.label.length > 1, `${k} has no label`);
      assert.ok(v.kind, `${k} has no kind`);
      assert.ok(typeof v.total === 'number' && Number.isFinite(v.total), `${k} total is not a number`);
      assert.ok(
        v.trend === null || v.trend === undefined || (typeof v.trend === 'number' && Number.isFinite(v.trend)),
        `${k} trend must be a finite number or null, got ${JSON.stringify(v.trend)}`
      );
      if (v.trend !== null && v.trend !== undefined) {
        assert.ok(v.previous !== null && v.previous !== undefined, `${k} publishes ${v.trend}% with no baseline`);
        if (v.kind !== 'rate') {
          assert.ok(Math.abs(v.previous) >= 10, `${k} publishes ${v.trend}% off a baseline of ${v.previous}`);
        }
      }
    }
  });
  check('Pinterest account stats surface as metrics (pins/boards/monthlyViews)', () => {
    assert.strictEqual(pin.overview.pins.total, 342, `pins: ${pin.overview.pins.total}`);
    assert.strictEqual(pin.overview.monthlyViews.total, 96400);
    assert.strictEqual(pin.overview.followers.total, 1284);
  });
  check('boards are read from Zernio and exposed in meta', () => {
    assert.strictEqual(pin.overview.boards.total, 3, `boards: ${pin.overview.boards.total}`);
    assert.strictEqual(pin.meta.boards.length, 3);
    assert.strictEqual(pin.meta.boards[0].name, 'UI Design');
  });
  check('posts metric shows the real pin count', () => {
    assert.strictEqual(pin.overview.posts.total, 3);
    assert.strictEqual(pin.overview.posts.kind, 'count');
  });
  check('timeseries is dense (one row per day of the range)', () => {
    assert.ok(pin.timeseries.length >= 29 && pin.timeseries.length <= 32, `got ${pin.timeseries.length} rows`);
    const dates = pin.timeseries.map((r) => r.date);
    assert.strictEqual(new Set(dates).size, dates.length, 'dates must be unique');
    assert.deepStrictEqual(dates, [...dates].sort(), 'dates must be ascending');
  });
  check('follower history is merged into the timeline', () => {
    const withFollowers = pin.timeseries.filter((r) => r.followers != null);
    assert.ok(withFollowers.length >= 25, `only ${withFollowers.length} rows carry followers`);
    assert.ok(pin.followerTimeseries.length > 0);
  });
  check('notice explains WHY the numbers are zero', () => {
    assert.ok(pin.notice, 'expected an explanatory notice');
    assert.ok(/zero impressions/i.test(pin.notice), `notice was: ${pin.notice}`);
  });
  check('diagnostics record each upstream step', () => {
    const steps = pin.meta.diagnostics.steps;
    assert.ok(steps.accounts && steps.analytics && steps.followerStats && steps.boards && steps.sync);
    assert.strictEqual(steps.accounts.ok, true);
  });
  check('post engagementRate is derived when Zernio omits it', () => {
    assert.strictEqual(typeof pin.posts[0].analytics.engagementRate, 'number');
  });

  // ── 4. Pinterest with real numbers ─────────────────────────────
  console.log('\nZernio Pinterest — rich data case');
  mock.setMode('rich');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernio2 = require('../src/services/zernioService');
  const rich = await zernio2.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });

  check('totals sum every post metric', () => {
    assert.strictEqual(rich.totals.impressions, 12400 + 8200 + 3100);
    assert.strictEqual(rich.totals.clicks, 240 + 130 + 42);
    assert.strictEqual(rich.totals.saves, 88 + 41 + 12);
    assert.strictEqual(rich.totals.outboundClicks, 61 + 22 + 9);
  });
  check('engagement is the derived sum of interactions', () => {
    const expected = (240 + 130 + 42) + (88 + 41 + 12); // clicks + saves
    assert.strictEqual(rich.totals.engagement, expected, `got ${rich.totals.engagement} want ${expected}`);
  });
  check('engagementRate is averaged, not summed', () => {
    const er = rich.overview.engagementRate.total;
    assert.ok(er > 1 && er < 5, `expected a mean around 2.7, got ${er}`);
    assert.strictEqual(rich.overview.engagementRate.unit, '%');
  });
  check('topPosts are ranked by engagement', () => {
    assert.ok(rich.topPosts.length > 0);
    const engs = rich.topPosts.map((p) => p.analytics.engagement);
    assert.deepStrictEqual(engs, [...engs].sort((a, b) => b - a));
  });
  check('platformBreakdown keeps per-platform counts', () => {
    assert.strictEqual(rich.platformBreakdown.pinterest.posts, 3);
    assert.strictEqual(rich.platformBreakdown.pinterest.impressions, 23700);
  });

  // ── 5. LinkedIn ────────────────────────────────────────────────
  console.log('\nZernio LinkedIn');
  const li = await zernio2.fetchLinkedIn({ date_preset: 'last_30d', sync: 'false' });
  check('LinkedIn catalogue is complete', () => {
    for (const expected of ['impressions', 'reach', 'clicks', 'likes', 'comments', 'shares', 'engagement', 'engagementRate', 'posts', 'followers']) {
      assert.ok(li.overview[expected], `missing ${expected}`);
    }
  });
  check('LinkedIn labels are platform-correct (Reactions / Reposts / Pins published vs Posts published)', () => {
    assert.strictEqual(li.overview.likes.label, 'Reactions');
    assert.strictEqual(li.overview.shares.label, 'Reposts');
    assert.strictEqual(li.overview.posts.label, 'Posts published');
    assert.strictEqual(rich.overview.posts.label, 'Pins published');
    assert.strictEqual(rich.overview.clicks.label, 'Pin clicks');
  });
  check('LinkedIn follower gauge comes from follower-stats', () => {
    assert.strictEqual(li.overview.followers.total, 512);
    assert.strictEqual(li.overview.followers.kind, 'gauge');
  });

  // ── 6. Graceful degradation ────────────────────────────────────
  console.log('\nFailure handling');
  mock.setMode('accounts-500');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernio3 = require('../src/services/zernioService');
  const degraded = await zernio3.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });
  check('a failing /v1/accounts does NOT blank the platform', () => {
    assert.strictEqual(degraded.posts.length, 3, 'posts must still be fetched');
    assert.ok(Object.keys(degraded.overview).length > 5, 'overview must still be populated');
  });
  check('the account failure is reported, not swallowed', () => {
    assert.strictEqual(degraded.meta.account, null);
    assert.ok(degraded.meta.diagnostics.steps.accounts.error, 'diagnostics must carry the error');
    assert.ok(/could not read the zernio account list/i.test(degraded.notice || ''), `notice was: ${degraded.notice}`);
  });

  mock.setMode('boards-404');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernio4 = require('../src/services/zernioService');
  const noBoards = await zernio4.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });
  check('missing boards endpoint falls back to accountStats.boardCount', () => {
    assert.strictEqual(noBoards.overview.boards.total, 18, `got ${noBoards.overview.boards.total}`);
    assert.ok(noBoards.meta.diagnostics.warnings.some((w) => /boards/.test(w)));
  });

  mock.setMode('no-analytics-access');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernio5 = require('../src/services/zernioService');
  const noAccess = await zernio5.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });
  check('hasAnalyticsAccess=false is surfaced with guidance', () => {
    assert.strictEqual(noAccess.meta.hasAnalyticsAccess, false);
    assert.ok(/analytics access/i.test(noAccess.notice || ''), `notice was: ${noAccess.notice}`);
  });

  // ── 7. Debug endpoint ──────────────────────────────────────────
  console.log('\nDiagnostics endpoint');
  mock.setMode('zero-analytics');
  const report = await zernio5.debugZernio();
  check('debugZernio reports every upstream call', () => {
    assert.strictEqual(report.configured, true);
    assert.ok(report.steps.accounts, 'missing accounts step');
    assert.ok(report.steps.pinterest, 'missing pinterest step');
    assert.ok(report.steps.linkedin, 'missing linkedin step');
    assert.ok(report.summary, 'missing summary');
  });

  console.log('\nDemographics contract + date presets');
  const demo = require('../src/utils/demographics');
  const { parseDateRange } = require('../src/utils/dateUtils');

  check('withShare turns counts into shares that sum to 100', () => {
    const rows = demo.withShare([{ code: 'IN', value: 3 }, { code: 'US', value: 1 }]);
    assert.ok(rows[0].share === 75, 'IN should be 75%');
    assert.ok(rows[1].share === 25, 'US should be 25%');
  });

  check('splitAgeGender tolerates Meta and YouTube segment spellings', () => {
    const meta = demo.splitAgeGender([
      { segment: 'F.18-24', value: 40 },
      { segment: 'M.18-24', value: 60 },
      { segment: 'F.25-34', value: 30 },
      { segment: 'M.25-34', value: 70 },
    ]);
    assert.ok(meta.gender.male === 65, `male should be 65, got ${meta.gender.male}`);
    assert.ok(meta.age.length === 2, 'two age buckets expected');
    assert.ok(meta.age[0].bucket === '18-24', 'bucket ordering');
  });

  check('ytAge/ytGender normalise YouTube dimension codes', () => {
    assert.ok(demo.ytAge('age25-34') === '25-34', 'age bucket code');
    assert.ok(demo.ytAge('age65-') === '65+', 'open-ended bucket');
    assert.ok(demo.ytGender('female') === 'female', 'gender code');
    assert.ok(demo.ytGender('unknown') === 'unknown', 'unknown gender');
  });

  check('deviceLabel humanises device codes', () => {
    assert.ok(demo.deviceLabel('MOBILE') === 'Mobile phone', 'MOBILE label');
    assert.ok(demo.deviceLabel('game_console') === 'Game console', 'game_console label');
  });

  check('empty() reports every missing dimension honestly', () => {
    const e = demo.empty('Zernio', 'not exposed', ['age', 'gender']);
    assert.ok(e.available === false && e.gender === null && e.countries === null, 'empty shape');
    assert.ok(e.missing.includes('age'), 'missing list');
  });

  check('date presets include 60/120/180 day windows', () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [preset, days] of [['last_60d', 60], ['last_120d', 120], ['last_180d', 180]]) {
      const r = parseDateRange({ date_preset: preset }, true);
      const got = Math.round((r.until - r.since) / 86400);
      assert.ok(got === days, `${preset} should span ${days} days, got ${got}`);
    }
  });

  check('all_time starts at ACCOUNT_CREATED', () => {
    const r = parseDateRange({ date_preset: 'all_time' }, true);
    const created = Math.floor(new Date(require('../src/config').ACCOUNT_CREATED).getTime() / 1000);
    assert.ok(r.since === created, `all_time should start at ACCOUNT_CREATED (${created}), got ${r.since}`);
    assert.ok(r.until > r.since, 'window must be positive');
  });

  check('unknown preset still falls back to 30 days', () => {
    const r = parseDateRange({ date_preset: 'nonsense' }, true);
    assert.ok(Math.round((r.until - r.since) / 86400) === 30, 'fallback window');
  });


  console.log('\n.env robustness — names and formatting');
  const cfg = require('../src/config');

  check('config reads exactly the documented .env names', () => {
    const expected = ['ACCESS_TOKEN','INSTAGRAM_ID','FACEBOOK_PAGE_ID','YOUTUBE_REFRESH_TOKEN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GSC_REFRESH_TOKEN','GSC_CLIENT_ID','GSC_CLIENT_SECRET','GSC_SITE_URL','ZERNIO_API_KEY','PORT','FB_API_VERSION','ACCOUNT_CREATED'];
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'config', 'index.js'), 'utf8');
    for (const name of expected) {
      assert.ok(src.includes(`env('${name}')`), `config must read ${name} under its original name`);
    }
    const example = require('fs').readFileSync(require('path').join(__dirname, '..', '.env.example'), 'utf8');
    for (const name of expected) {
      assert.ok(new RegExp(`^${name}=`, 'm').test(example), `.env.example must document ${name}`);
    }
  });

  check('a Windows-copied or quoted .env cannot corrupt a token', () => {
    assert.ok(cfg._clean('x\r') === undefined || true, 'cleaner exists');
    process.env.__T1 = 'tok\r';
    process.env.__T2 = '  "tok2"  ';
    process.env.__T3 = " 'tok3' ";
    assert.ok(cfg._clean('__T1') === 'tok', 'CRLF must be stripped');
    assert.ok(cfg._clean('__T2') === 'tok2', 'double quotes must be stripped');
    assert.ok(cfg._clean('__T3') === 'tok3', 'single quotes must be stripped');
    delete process.env.__T1; delete process.env.__T2; delete process.env.__T3;
    assert.ok(cfg._clean('__MISSING') === undefined, 'missing var stays undefined');
  });

  console.log('\nDeployment hygiene — the thing that ships must be the thing we fixed');
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');

  check('the health endpoint reports the real API version', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'routes', 'health.js'), 'utf8');
    assert.ok(src.includes('version: config.VERSION'), 'health.js must read config.VERSION, not a hardcoded string');
    assert.ok(!/version:\s*['"]\d+\./.test(src), 'no hardcoded version literal in health.js');
  });

  check('package.json version matches config.VERSION', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, cfg.VERSION, `package.json ${pkg.version} vs config ${cfg.VERSION}`);
  });

  check('the built dashboard exists and its assets resolve', () => {
    const dist = path.join(root, 'Pulse', 'dist');
    const html = path.join(dist, 'index.html');
    assert.ok(fs.existsSync(html), 'Pulse/dist/index.html missing — run `npm run build:ui` before deploying');
    const doc = fs.readFileSync(html, 'utf8');
    const refs = [...doc.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, `index.html references no assets: ${refs.length}`);
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(dist, ref)), `index.html points at a missing file: ${ref}`);
    }
  });

  check('the built dashboard is not older than the UI source (stale bundle guard)', () => {
    const builtAt = fs.statSync(path.join(root, 'Pulse', 'dist', 'index.html')).mtimeMs;
    const srcDir = path.join(root, 'Pulse', 'src');
    let newest = 0;
    let newestFile = '';
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) { newest = m; newestFile = path.relative(root, full); }
        }
      }
    };
    walk(srcDir);
    assert.ok(
      newest <= builtAt + 2000,
      `Pulse/dist is stale: ${newestFile} changed after the build — run \`npm run build:ui\` and commit the new dist`
    );
  });

  console.log('\nResilience — timeouts, cache and stale-while-revalidate');
  const { fetchWithFallback, withTimeout, cacheKey, cacheStats, clearCache } = require('../src/utils/resilience');

  await (async () => {
    clearCache();
    let ok = true;
    try {
      const first = await fetchWithFallback('resilienceDemo', async () => ({ overview: { reach: { total: 10 } } }), { date_preset: 'last_7d' });
      assert.strictEqual(first.fromCache, false, 'a fresh fetch must not be marked fromCache');
      assert.strictEqual(first.value.overview.reach.total, 10);

      // the same range now fails → the previous numbers come back, labelled stale
      const second = await fetchWithFallback('resilienceDemo', async () => { throw new Error('upstream 503'); }, { date_preset: 'last_7d' });
      assert.strictEqual(second.fromCache, true, 'a failed refresh must fall back to the cache');
      assert.strictEqual(second.value.stale, true, 'the stale payload must be labelled');
      assert.ok(/last successful load/.test(second.value.notice || ''), `notice should explain the fallback: ${second.value.notice}`);
      assert.strictEqual(second.value.overview.reach.total, 10, 'the cached numbers were lost');
      assert.ok(Array.isArray(second.value.partialErrors) && second.value.partialErrors.length >= 1, 'the fallback must be reported in partialErrors');

      // a different range is a different cache entry → it must fail honestly
      let threw = false;
      try {
        await fetchWithFallback('resilienceDemo', async () => { throw new Error('upstream 503'); }, { date_preset: 'last_90d' });
      } catch (e) { threw = true; assert.strictEqual(e.message, 'upstream 503'); }
      assert.ok(threw, 'with nothing cached for this range the error must surface, not a stale guess');

      assert.notStrictEqual(cacheKey('x', { date_preset: 'last_7d' }), cacheKey('x', { date_preset: 'last_90d' }), 'cache keys must separate ranges');
      const stats = cacheStats();
      assert.ok(stats.entries >= 1, 'cacheStats should report the stored payload');

      // a hanging upstream is cut off instead of holding the response hostage
      const t0 = Date.now();
      let timedOut = false;
      try {
        await withTimeout(new Promise(() => {}), 120, 'slowPlatform');
      } catch (e) {
        timedOut = true;
        assert.strictEqual(e.code, 'UPSTREAM_TIMEOUT');
        assert.ok(/slowPlatform/.test(e.message), `timeout should name the platform: ${e.message}`);
      }
      assert.ok(timedOut, 'a hanging upstream was never cut off');
      assert.ok(Date.now() - t0 < 3000, 'the timeout took too long to fire');
    } catch (e) {
      ok = false;
      failed += 1;
      failures.push(`resilience layer: ${e.message}`);
      console.log(`  \x1b[31m✗\x1b[0m resilience layer\n      ${e.message}`);
    }
    if (ok) {
      passed += 1;
      console.log('  \x1b[32m✓\x1b[0m a failed refresh serves the last good numbers, a hang is cut off, and an uncached range still errors');
    }
    clearCache();
  })();

  // ── 9. Zernio: cross-posted documents + accounts with no stats ──
  console.log('\nZernio — cross-posted items and accounts that publish no counts');

  mock.setMode('cross-posted');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernioX = require('../src/services/zernioService');
  const pinX = await zernioX.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });
  const liX = await zernioX.fetchLinkedIn({ date_preset: 'last_30d', sync: 'false' });

  check("Pinterest never inherits a cross-posted document's LinkedIn numbers", () => {
    assert.strictEqual(pinX.posts.length, 5, `expected the 5 cross-posted pins, got ${pinX.posts.length}`);
    assert.strictEqual(pinX.totals.impressions, 0, `Pinterest showed ${pinX.totals.impressions} impressions that belong to LinkedIn`);
    assert.strictEqual(pinX.totals.views, 0);
    assert.ok(pinX.posts.every((x) => x.platform === 'pinterest'), pinX.posts.map((x) => x.platform).join(','));
    assert.ok(
      String(pinX.posts[0].postId).startsWith('11271666130230880'),
      `Pinterest must carry its own pin id, got ${pinX.posts[0].postId}`
    );
  });

  check('LinkedIn reads its own copy of the same document', () => {
    assert.strictEqual(liX.totals.impressions, 60, '5 documents x 12 impressions');
    assert.strictEqual(liX.totals.views, 5);
    assert.ok(String(liX.posts[0].postId).startsWith('urn:li:ugcPost:'), liX.posts[0].postId);
    assert.strictEqual(Object.keys(liX.platformBreakdown).join(','), 'linkedin');
  });

  mock.setMode('sparse-accounts');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernioS = require('../src/services/zernioService');
  const pinS = await zernioS.fetchPinterest({ date_preset: 'last_30d', sync: 'false' });
  const liS = await zernioS.fetchLinkedIn({ date_preset: 'last_30d', sync: 'false' });

  check('pins come from the published pins when Zernio has no pinCount', () => {
    assert.strictEqual(pinS.overview.pins.total, 3, JSON.stringify(pinS.overview.pins));
    assert.strictEqual(pinS.overview.pins.source, 'published pins');
    assert.strictEqual(pinS.overview.boards.total, 1);
  });

  check('gauges the platform does not publish are flagged instead of zeroed', () => {
    assert.strictEqual(pinS.overview.followers.unavailable, true);
    assert.ok(/does not publish a follower count/.test(pinS.overview.followers.unavailableReason || ''), pinS.overview.followers.unavailableReason);
    assert.strictEqual(pinS.overview.monthlyViews.unavailable, true);
    assert.strictEqual(liS.overview.followers.unavailable, true);
    assert.ok(/Company Pages/.test(liS.overview.followers.unavailableReason || ''), liS.overview.followers.unavailableReason);
    assert.notStrictEqual(pinS.overview.boards.unavailable, true, 'a real number must never be flagged unavailable');
  });

  // ── v4.3.1: the REAL capture from the live account ────────────
  console.log('\nv4.3.1 — the real Pinterest capture (synced pins that report nothing)');

  mock.setMode('real-capture');
  delete require.cache[require.resolve('../src/services/zernioService')];
  const zernioR = require('../src/services/zernioService');
  const pinR = await zernioR.fetchPinterest({ days: 90, sync: 'false' });
  const liR = await zernioR.fetchLinkedIn({ days: 90, sync: 'false' });
  const pinSync = await zernioR.fetchPinterest({ days: 90 });

  check('the captured pins keep their real Pinterest id, URL and sync state', () => {
    assert.strictEqual(pinR.posts.length, 6, `expected the 6 captured pins, got ${pinR.posts.length}`);
    assert.strictEqual(pinR.posts[0].postId, '1127166613023434329', `the pin id was lost: ${pinR.posts[0].postId}`);
    assert.ok(
      String(pinR.posts[0].platformUrl).includes('/pin/1127166613023434329'),
      `the pin URL was lost: ${pinR.posts[0].platformUrl}`
    );
    assert.ok(
      pinR.posts.every((x) => x.syncStatus === 'synced'),
      'the per-platform sync state must win over the document-level "external"'
    );
    assert.ok(pinR.posts.every((x) => x.isExternal === true), 'they really were published outside Zernio');
    assert.strictEqual(pinR.totals.impressions, 0, 'upstream genuinely reports zero');
    assert.strictEqual(pinR.posts[0].latePostId, '6ad462c70edd18bc5d4bd3c9', 'the cross-post group id must survive');
  });

  check('the notice explains WHY, and it is not the 24–48 h lag', () => {
    const n = String(pinR.notice || '');
    assert.ok(/BUSINESS/.test(n), `the notice must name the real cause: ${n.slice(0, 180)}`);
    assert.ok(/not measured/.test(n), 'it must not read as a verdict on the content');
    assert.ok(/day\(s\) old/.test(n), 'it must cite the age that rules the lag out');
    assert.ok(!/refresh tomorrow/.test(n), 'a month-old pin is not a reporting lag');
  });

  check('the Pinterest verdict does not blame scopes the connection already has', () => {
    // Captured live 2026-10-21: permissions include pins:read, boards:read and
    // user_accounts:read and platformStatus is "active". Telling the user to
    // re-authorise would waste their time — the gap is the account type.
    const perms = pinR.meta.account.permissions || [];
    assert.ok(perms.includes('pins:read') && perms.includes('user_accounts:read'), JSON.stringify(perms));
    assert.strictEqual(pinR.meta.account.platformStatus, 'active');
    const n = String(pinR.notice || '');
    assert.ok(/not a missing scope/i.test(n), `the notice must rule the scopes out: ${n.slice(0, 240)}`);
    assert.ok(/pins:read/.test(n), 'and name the scopes that ARE granted');
    const { diagnose } = require('../src/utils/diagnosis');
    const d = diagnose('pinterest', pinR, { audience: 'institutions' });
    const reconnect = d.actions.find((a) => /Reconnect/i.test(a.title));
    assert.ok(reconnect, 'the reconnect action must still be there');
    assert.ok(/already grants/i.test(reconnect.detail), reconnect.detail.slice(0, 200));
    assert.ok(/no scope is missing/i.test(reconnect.detail), 'it must say re-authorising alone changes nothing');
    assert.deepStrictEqual(d.evidence.accountPermissions, perms, 'the evidence must carry the permissions');
    assert.strictEqual(d.evidence.accountPlatformStatus, 'active');
  });

  check('metricAvailability separates lag from "never reported"', () => {
    const a = pinR.meta.diagnostics.metricAvailability;
    assert.strictEqual(a.verdict, 'not-reported', JSON.stringify(a));
    assert.strictEqual(a.agedPastLag, 5, 'five pins are past the lag window and still zero');
    assert.strictEqual(a.synced, 6);
    assert.strictEqual(a.accountGaugesEmpty, true);
    const l = liR.meta.diagnostics.metricAvailability;
    assert.strictEqual(l.verdict, 'reporting', `LinkedIn must stay measurable, got ${l.verdict}`);
  });

  check('the diagnosis says "not measured" for Pinterest and keeps LinkedIn honest', () => {
    const { diagnose } = require('../src/utils/diagnosis');
    const dp = diagnose('pinterest', pinR, { audience: 'institutions' });
    assert.strictEqual(dp.stage, 'not-reported', dp.stage);
    assert.ok(dp.evidence.oldestPostDays >= 30, `oldestPostDays is ${dp.evidence.oldestPostDays}`);
    assert.ok(/Business account/.test(dp.actions[0].title), dp.actions[0].title);
    assert.strictEqual(dp.benchmark.yours, null, 'no rate can be computed from nothing');
    const dl = diagnose('linkedin', liR, { audience: 'institutions' });
    assert.notStrictEqual(dl.stage, 'not-reported', 'the control channel must not inherit the verdict');
    assert.strictEqual(dl.evidence.seen, 93, 'the captured impressions must survive');
    assert.strictEqual(dl.evidence.engaged, 2, 'the captured engagement must survive');
    assert.strictEqual(dl.evidence.lowReach, true, '11.6 impressions per post is a reach problem');
    assert.strictEqual(dl.evidence.seenPerPost, 11.6);
    assert.ok(/Reach is the binding constraint/.test(dl.headline), dl.headline.slice(0, 160));
  });

  check('low reach is only claimed where "seen" means the algorithm chose to show it', () => {
    const { diagnose } = require('../src/utils/diagnosis');
    const yt = diagnose('youtube', {
      overview: { views: { total: 199, hasData: true }, posts: { total: 3, hasData: true } },
      posts: [],
    });
    assert.strictEqual(yt.evidence.lowReach, false, 'YouTube views per video is not a distribution failure');
  });

  check('the external sync reports what it could and could not do', () => {
    const sy = pinSync.meta.sync;
    assert.ok(sy && sy.skipped === false, JSON.stringify(sy));
    assert.strictEqual(sy.externalPosts, 6);
    assert.strictEqual(sy.withoutUrl, 5, 'only the newest captured pin carries a URL');
    assert.strictEqual(sy.accountSweep, true, 'posts without a URL must trigger the account-level sweep');
    assert.ok(/Business accounts/.test(String(sy.note)), sy.note);
  });

  check('the account projection now carries the entitlement evidence', async () => {
    const acct = await zernioR.getAccounts('pinterest');
    const a = acct.accounts[0];
    assert.ok(a, 'no pinterest account');
    assert.strictEqual(a.platformStatus, null);
    assert.strictEqual(a.needsReconnection, false);
    assert.strictEqual(a.enabled, true);
    assert.strictEqual(a.byokConfigured, false);
    assert.ok('scopes' in a && 'permissions' in a, 'the entitlement fields must exist even when upstream is silent');
    assert.strictEqual(a.pinCount, null, 'Pinterest reported no pin count — that IS the evidence');
  });

  // ── v4.3.1: redaction — the report is meant to be handed to a human ──
  console.log('\nv4.3.1 — redaction (nothing secret may leave /api/report)');
  const { redactDeep } = require('../src/utils/redact');

  check('credentials are masked wherever they appear', () => {
    const token = `EAAG${'x'.repeat(60)}`;
    const { data } = redactDeep({
      access_token: token,
      nested: { refreshToken: `ya29.${'a'.repeat(50)}` },
      url: `https://graph.facebook.com/v21.0/me?access_token=${token}&fields=id`,
      innocentKeyButTokenValue: 'Z'.repeat(64),
      keep: 'a normal sentence',
    });
    const json = JSON.stringify(data);
    assert.ok(!json.includes(token), 'the access token leaked');
    assert.ok(!json.includes('Z'.repeat(64)), 'a token-like value leaked under an innocent key');
    assert.ok(data.url.includes('access_token=[redacted]'), data.url);
    assert.ok(data.url.includes('fields=id'), 'the readable part of a URL must survive');
    assert.strictEqual(data.keep, 'a normal sentence');
  });

  check('a credential descriptor survives, so "is it even set?" stays answerable', () => {
    const { data } = redactDeep({ ACCESS_TOKEN: { set: true, length: 40, preview: 'EAAG…' } });
    assert.strictEqual(data.ACCESS_TOKEN.set, true);
    assert.strictEqual(data.ACCESS_TOKEN.length, 40);
    assert.strictEqual(data.ACCESS_TOKEN.preview, 'EAA…', 'the preview is capped, never the whole value');
  });

  check('long lists are capped and every cap is reported', () => {
    const { data, truncations } = redactDeep({ rows: Array.from({ length: 200 }, (_, i) => i) }, { maxItems: 25 });
    assert.strictEqual(data.rows.length, 25);
    assert.ok(truncations.some((t) => /200 items → first 25/.test(t)), JSON.stringify(truncations));
  });

  check('a shared object is not mistaken for a circular one', () => {
    const shared = { id: 1, tokenExpiresAt: '2026-11-17T00:00:00.000Z' };
    const { data } = redactDeep({ list: [shared], account: { doc: shared } });
    assert.deepStrictEqual(data.list[0], shared, 'the first reference must survive');
    assert.deepStrictEqual(data.account.doc, shared, 'the second reference must survive too — the report keeps the same account doc in two places');
    assert.strictEqual(data.account.doc.tokenExpiresAt, '2026-11-17T00:00:00.000Z', 'an expiry date is a fact, not a credential');
  });

  check('a strong credential key masks its whole subtree, a call label does not', () => {
    const { data } = redactDeep({
      byokCredentials: { accessToken: 'abc', refreshToken: 'def' },
      'page token exchange': { ok: true, note: 'ACCESS_TOKEN was exchanged for a Page token' },
    });
    assert.strictEqual(typeof data.byokCredentials, 'string', 'a credentials object must be masked whole');
    assert.ok(!JSON.stringify(data).includes('abc'), 'nested credential leaked');
    assert.strictEqual(data['page token exchange'].ok, true, 'an upstream call recorded under a label must keep its evidence');
  });

  check('redaction never throws on hostile input', () => {
    const circular = { a: 1 };
    circular.self = circular;
    const { data } = redactDeep(circular);
    assert.strictEqual(data.self, '[circular]');
    assert.doesNotThrow(() => redactDeep([1, 'x', null, undefined, { fn: () => 1, big: 'y'.repeat(9000) }], { maxString: 100 }));
  });

  mock.setMode('zero-analytics');

  // ── v4.3.0 growth diagnosis ───────────────────────────────────
  console.log('\nv4.3.0 diagnosis — why a metric is 0, and what to do about it');
  const { diagnose, focusOrder } = require('../src/utils/diagnosis');
  const { platformEnvelope } = require('../src/utils/response');

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const ov = (obj) => obj;

  // The user's actual complaint: Instagram shows likes on the post, the card
  // shows 0. The account-level insight is empty; the posts are not.
  const igPostsWithLikes = {
    overview: ov({
      reach: { total: 330, hasData: true, label: 'Reach' },
      followers: { total: 6, hasData: true, label: 'Followers', kind: 'gauge' },
      likes: { total: 0, hasData: false, label: 'Likes' },
      comments: { total: 0, hasData: false, label: 'Comments' },
      shares: { total: 0, hasData: false, label: 'Shares' },
      saves: { total: 0, hasData: false, label: 'Saves' },
      total_interactions: { total: 0, hasData: false, label: 'Interactions' },
      posts: { total: 3, hasData: true, label: 'Posts' },
      profileViews: { total: 0, hasData: false, label: 'Profile views' },
    }),
    posts: [
      { id: 'a', publishedAt: daysAgo(2), analytics: { likes: 12, comments: 3, shares: 1, saves: 2 } },
      { id: 'b', publishedAt: daysAgo(5), analytics: { likes: 7, comments: 0, shares: 0, saves: 1 } },
      { id: 'c', publishedAt: daysAgo(9), analytics: { likes: 0, comments: 1, shares: 0, saves: 0 } },
    ],
    meta: { postCount: 3 },
  };
  const dIg = diagnose('instagram', igPostsWithLikes, { audience: 'institutions' });

  check('engagement is recovered from the posts when the account card is empty', () => {
    const engaged = dIg.funnel.find((f) => f.key === 'engaged');
    assert.strictEqual(engaged.value, 27, `expected 18 + 8 + 1 = 27, got ${engaged.value}`);
    assert.strictEqual(engaged.verdict, 'ok', 'the funnel must read as moving, not blocked');
    assert.strictEqual(dIg.evidence.engagedSource, 'summed from posts');
    assert.ok(/summed from your posts/.test(engaged.note || ''), engaged.note);
    assert.notStrictEqual(dIg.stage, 'seen-not-engaged', `reach + real post engagement must not read as "seen, not engaged" (got ${dIg.stage})`);
  });

  check('a real number is never over-written by the post backfill', () => {
    const withAccount = diagnose('instagram', {
      overview: { reach: { total: 900 }, likes: { total: 40 }, posts: { total: 2 } },
      posts: [{ id: 'a', publishedAt: daysAgo(1), analytics: { likes: 3 } }],
    }, { audience: 'students' });
    const engaged = withAccount.funnel.find((f) => f.key === 'engaged');
    assert.strictEqual(engaged.value, 40, `account-level likes win, got ${engaged.value}`);
    assert.strictEqual(withAccount.evidence.engagedSource, 'account metric');
  });

  check('each zero card explains itself instead of just reading 0', () => {
    const zeroKeys = dIg.zeros.map((z) => z.key);
    assert.ok(zeroKeys.includes('profileViews'), `profileViews should be explained, got ${zeroKeys.join(',')}`);
    for (const z of dIg.zeros) {
      assert.ok(z.label && z.reason && z.explanation, `incomplete explanation for ${z.key}`);
      assert.ok(z.explanation.length > 25, `explanation too thin for ${z.key}: ${z.explanation}`);
    }
    // likes/comments still read 0 on the card, and the list must say WHY: the
    // number was recovered from the posts, not "nobody engaged".
    const likes = dIg.zeros.find((z) => z.key === 'likes');
    assert.ok(likes, 'the empty likes card is still explained, not silently dropped');
    assert.strictEqual(likes.reason, 'recovered-from-posts', likes.reason);
    assert.ok(/27 interaction/.test(likes.explanation), likes.explanation);
    assert.ok(!dIg.zeros.some((z) => z.reason === 'seen-not-engaged'), 'a channel with 27 post interactions must not be told nobody engaged');
  });

  check('a platform that publishes nothing says so, and never invents a reason', () => {
    const d = diagnose('facebook', { overview: { followers: { total: 980 } }, posts: [], meta: { postCount: 0 } }, { audience: 'institutions' });
    assert.strictEqual(d.stage, 'no-content');
    assert.ok(/published/i.test(d.headline), d.headline);
    const pub = d.funnel.find((f) => f.key === 'published');
    assert.strictEqual(pub.verdict, 'zero', 'a known 0 is a zero, not an unknown');
    assert.strictEqual(pub.value, 0);
    // When the API could not report a post count at all, say "not published"
    // instead of pretending the account is idle.
    const unknown = diagnose('facebook', { overview: { followers: { total: 980 } } }, { audience: 'institutions' });
    const pubU = unknown.funnel.find((f) => f.key === 'published');
    assert.strictEqual(pubU.verdict, 'unavailable', `expected unavailable, got ${pubU.verdict}`);
    assert.strictEqual(pubU.display, 'not published');
    // An unknown post count with no reach is a distribution question, not proof
    // the account is idle — Search Console never reports a post count at all.
    assert.strictEqual(unknown.stage, 'no-distribution', `expected no-distribution, got ${unknown.stage}`);
    assert.ok(/did not report a post count/.test(unknown.headline), unknown.headline);
  });

  check('a channel that answered with an error is not told to publish more', () => {
    const d = diagnose('instagram', {
      error: 'INSTAGRAM_ID is not set in .env',
      hint: 'Find the id via GET /{page-id}?fields=instagram_business_account',
      overview: {}, timeseries: [],
    }, { audience: 'institutions' });
    assert.strictEqual(d.stage, 'unreachable');
    assert.ok(/INSTAGRAM_ID/.test(d.headline), d.headline);
    assert.ok(/Find the id via/.test(d.actions[0].detail), d.actions[0].detail);
    assert.strictEqual(d.funnel.length, 5);
    assert.ok(d.funnel.every((f) => f.verdict === 'unavailable' && f.value === null), 'no stage is readable');
    assert.ok(!d.zeros.length || d.zeros.length === 1, 'one explanation, not one per empty card');
    assert.ok(!JSON.stringify(d).includes('NaN'));
  });

  check('no reach means no engagement rate to compare against a benchmark', () => {
    const d = diagnose('pinterest', { overview: { impressions: { total: 0 }, pins: { total: 3 } }, posts: [] }, { audience: 'institutions' });
    assert.ok(d.benchmark, 'the reference is still shown');
    assert.strictEqual(d.benchmark.yours, null, `expected null, got ${d.benchmark.yours}`);
    assert.ok(/%/.test(String(d.benchmark.typical)), d.benchmark.typical);
    // Pinterest has no like button: a pin click IS the engagement, and the
    // conversion is the click that leaves Pinterest.
    const withReach = diagnose('pinterest', { overview: { impressions: { total: 1000 }, clicks: { total: 20 }, pins: { total: 3 } }, posts: [] }, { audience: 'institutions' });
    assert.strictEqual(typeof withReach.benchmark.yours, 'number', 'a real rate is a number');
    assert.strictEqual(withReach.benchmark.yours, 2, `expected 20/1000 = 2%, got ${withReach.benchmark.yours}`);
    const engStage = withReach.funnel.find((f) => f.key === 'engaged');
    assert.strictEqual(engStage.value, 20, `pin clicks are Pinterest engagement, got ${engStage.value}`);
    assert.strictEqual(engStage.sourceKey, 'clicks');
    assert.strictEqual(withReach.stage, 'no-conversion', `no outbound clicks yet, got ${withReach.stage}`);
    // Search Console: the click is the engagement and the conversion at once.
    const gsc = diagnose('searchConsole', { overview: { impressions: { total: 5000 }, clicks: { total: 120 }, ctr: { total: 2.4 } } }, { audience: 'institutions' });
    assert.strictEqual(gsc.funnel.find((f) => f.key === 'engaged').value, 120);
    const gscConv = gsc.funnel.find((f) => f.key === 'converted');
    assert.strictEqual(gscConv.verdict, 'unavailable', 'search has no separate destination metric');
    assert.strictEqual(gscConv.display, 'same as clicks');
    assert.strictEqual(gsc.stage, 'healthy', `expected healthy, got ${gsc.stage}`);
  });

  check('fresh Zernio posts waiting on reporting are called a lag, not a failure', () => {
    const lagging = diagnose('pinterest', {
      overview: { impressions: { total: 0 }, pins: { total: 2 }, followers: { total: 0, unavailable: true, unavailableReason: 'Pinterest does not publish a follower count.' } },
      posts: [
        { id: 'p1', publishedAt: new Date(Date.now() - 3600000).toISOString(), analytics: { impressions: 0 } },
        { id: 'p2', publishedAt: new Date(Date.now() - 7200000).toISOString(), analytics: { impressions: 0 } },
      ],
    }, { audience: 'institutions' });
    assert.strictEqual(lagging.stage, 'pending-lag', `expected pending-lag, got ${lagging.stage}`);
    assert.strictEqual(lagging.evidence.lagging, true);
    assert.strictEqual(lagging.evidence.youngPosts, 2);
    assert.ok(/48 h|tomorrow/i.test(lagging.headline), lagging.headline);
    // The same pins, a week old, are a distribution problem instead.
    const old = diagnose('pinterest', {
      overview: { impressions: { total: 0 }, pins: { total: 2 } },
      posts: [{ id: 'p1', publishedAt: daysAgo(7), analytics: { impressions: 0 } }],
    }, { audience: 'institutions' });
    assert.strictEqual(old.stage, 'no-distribution', `expected no-distribution, got ${old.stage}`);
    assert.ok(/algorithm/.test(old.headline), `the headline must name the algorithm: ${old.headline}`);
  });

  check('a gauge the platform does not publish is "not published", never a red zero', () => {
    const d = diagnose('pinterest', {
      overview: { impressions: { total: 4600 }, clicks: { total: 96 }, pins: { total: 4 }, followers: { total: 0, unavailable: true, unavailableReason: 'Pinterest does not publish a follower count.' } },
      posts: [],
    }, { audience: 'institutions' });
    const followed = d.funnel.find((f) => f.key === 'followed');
    assert.strictEqual(followed.verdict, 'unavailable');
    assert.strictEqual(followed.value, null);
    assert.strictEqual(followed.display, 'not published');
    assert.ok(/does not publish a follower count/.test(followed.note || ''), followed.note);
    assert.notStrictEqual(d.stage, 'engaged-not-followed', 'an unpublished gauge must not be diagnosed as a follower problem');
  });

  check('the audience target drives fit, ranking and advice', () => {
    const inst = diagnose('linkedin', igPostsWithLikes, { audience: 'institutions' });
    const stud = diagnose('linkedin', igPostsWithLikes, { audience: 'students' });
    assert.strictEqual(inst.audienceFit.fit, 'high');
    assert.strictEqual(stud.audienceFit.fit, 'medium');
    assert.ok(/universit|admission|institution|decision|department|registrar|placement/i.test(inst.audienceFit.why), inst.audienceFit.why);
    assert.strictEqual(diagnose('instagram', igPostsWithLikes, { audience: 'institutions' }).audienceFit.fit, 'low');
    assert.strictEqual(diagnose('instagram', igPostsWithLikes, { audience: 'students' }).audienceFit.fit, 'high');
    // an unknown audience falls back to the institutions default, never crashes
    assert.strictEqual(diagnose('youtube', igPostsWithLikes, { audience: 'robots' }).audience, 'institutions');
    assert.strictEqual(diagnose('youtube', igPostsWithLikes).audience, 'institutions');
  });

  check('focusOrder ranks a blocked high-fit channel first and returns strings', () => {
    const list = [
      diagnose('instagram', igPostsWithLikes, { audience: 'institutions' }),
      diagnose('linkedin', { overview: { impressions: { total: 1 }, posts: { total: 1 } }, posts: [{ id: 'x', publishedAt: daysAgo(3), analytics: { impressions: 1, likes: 0 } }] }, { audience: 'institutions' }),
      diagnose('pinterest', { overview: { impressions: { total: 4600 }, clicks: { total: 96 }, pins: { total: 4 } }, posts: [] }, { audience: 'institutions' }),
    ];
    const ranked = focusOrder(list, 'institutions');
    assert.strictEqual(ranked.length, 3);
    assert.ok(ranked.every((r, i) => i === 0 || ranked[i - 1].score >= r.score), 'scores must descend');
    assert.strictEqual(ranked[0].platform, 'linkedin', `expected LinkedIn first, got ${ranked[0].platform}`);
    for (const r of ranked) {
      assert.strictEqual(typeof r.firstAction, 'string', `firstAction must be a string for the UI, got ${typeof r.firstAction}`);
      assert.ok(r.firstAction.length > 3, r.firstAction);
      assert.ok(['high', 'medium', 'low'].includes(r.audienceFit), r.audienceFit);
      assert.ok(typeof r.score === 'number' && Number.isFinite(r.score));
    }
    // The same channels, aimed at students, must re-rank.
    const students = focusOrder([
      diagnose('instagram', { overview: { reach: { total: 0 }, posts: { total: 1 } }, posts: [] }, { audience: 'students' }),
      diagnose('linkedin', { overview: { reach: { total: 0 }, posts: { total: 1 } }, posts: [] }, { audience: 'students' }),
    ], 'students');
    assert.strictEqual(students[0].platform, 'instagram', `expected Instagram first for students, got ${students[0].platform}`);
    assert.deepStrictEqual(focusOrder([], 'institutions'), []);
    assert.deepStrictEqual(focusOrder([null, undefined], 'students'), []);
  });

  check('the diagnosis never throws, whatever the payload looks like', () => {
    const junk = [undefined, null, {}, { overview: null }, { overview: { likes: { total: 'abc' } } },
      { overview: { impressions: { total: NaN }, posts: { total: -4 } }, posts: 'nope' },
      { overview: { followers: { total: Infinity } }, posts: [{ analytics: null }, {}] }];
    for (const payload of junk) {
      for (const platform of ['instagram', 'pinterest', 'youtube', 'searchConsole', 'made-up-platform']) {
        const d = diagnose(platform, payload, { audience: 'institutions' });
        assert.ok(d && typeof d.stage === 'string' && d.stage.length > 0, `${platform}: no stage`);
        assert.strictEqual(d.funnel.length, 5, `${platform}: funnel must always have 5 stages`);
        assert.ok(Array.isArray(d.actions) && d.actions.length > 0, `${platform}: always give the user something to do`);
        for (const f of d.funnel) {
          assert.ok(['ok', 'zero', 'unavailable'].includes(f.verdict), `${platform}/${f.key}: ${f.verdict}`);
          assert.ok(typeof f.display === 'string' && f.display !== 'NaN' && f.display !== 'undefined', `${platform}/${f.key}: display ${f.display}`);
        }
        assert.ok(!JSON.stringify(d).includes('NaN'), `${platform}: NaN leaked into the diagnosis`);
      }
    }
  });

  check('every platform envelope carries the diagnosis for the requested audience', () => {
    const env = platformEnvelope('instagram', { platform: 'instagram', meta: { postCount: 3 }, overview: igPostsWithLikes.overview, posts: igPostsWithLikes.posts }, null, { audience: 'students' });
    assert.strictEqual(env.success, true);
    assert.ok(env.data.diagnosis, 'the envelope must carry data.diagnosis');
    assert.strictEqual(env.data.diagnosis.platform, 'instagram');
    assert.strictEqual(env.data.diagnosis.audience, 'students');
    assert.strictEqual(env.data.diagnosis.funnel.length, 5);
    assert.ok(env.data.overview && Array.isArray(env.data.posts), 'the rest of the payload is untouched');
    // No audience supplied → the education default.
    const dflt = platformEnvelope('linkedin', { overview: { impressions: { total: 12 } } });
    assert.strictEqual(dflt.data.diagnosis.audience, 'institutions');
    // A payload with nothing in it still gets a usable diagnosis.
    // A payload with nothing in it: the post count is unknown, so this is a
    // distribution question ("did you publish?") rather than a claim of idleness.
    const empty = platformEnvelope('pinterest', null);
    assert.strictEqual(empty.data.diagnosis.stage, 'no-distribution', empty.data.diagnosis.stage);
    assert.ok(/did not report a post count/.test(empty.data.diagnosis.headline), empty.data.diagnosis.headline);
    assert.strictEqual(empty.data.diagnosis.funnel.length, 5);
  });

  await mock.close();

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log('');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nself-test crashed:', e);
  process.exit(1);
});
