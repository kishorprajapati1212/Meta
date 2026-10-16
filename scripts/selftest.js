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
 *   4. trends are computed (2nd half vs 1st half), not hard-coded to 0
 *   5. timeseries is dense — one row per day in the requested range
 *   6. a failing /v1/accounts call degrades gracefully instead of blanking
 *      the platform, and is reported in meta.diagnostics + notice
 *
 * Run: node scripts/selftest.js
 */
process.env.ZERNIO_API_KEY = 'sk_selftest_key';
process.env.ZERNIO_BASE_URL = 'http://127.0.0.1:4987/api';
process.env.ACCOUNT_CREATED = '2020-01-01';

const assert = require('assert');

let passed = 0;
let failed = 0;
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
  const mock = createMock({ port: 4987, mode: 'zero-analytics' });
  await mock.ready();
  console.log('\n\x1b[1mMeta Analytics API — self-test\x1b[0m (mock Zernio on :4987)\n');

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
  check('trend handles a zero baseline without Infinity/NaN', () => {
    const s = summarize('views', series([0, 0, 5, 5]));
    assert.strictEqual(s.trend, 100);
    assert.ok(Number.isFinite(s.trend));
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
      assert.ok(typeof v.trend === 'number' && Number.isFinite(v.trend), `${k} trend is not a number`);
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
  check('posts metric shows the real pin count with a trend', () => {
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

  await mock.close();

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nself-test crashed:', e);
  process.exit(1);
});
