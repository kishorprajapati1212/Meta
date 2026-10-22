#!/usr/bin/env node
/**
 * makeDiagnosisFixtures.js — records what the SERVER diagnosis engine says
 * about the recorded API payloads.
 *
 * The frontend smoke test cannot import `src/utils/diagnosis.js` (CommonJS in a
 * Vite/Rollup ESM build), and hand-writing diagnoses in the test would only
 * prove the panel renders *something*. Instead the real engine runs over the
 * real recorded payloads here, once, and the result is committed as a fixture.
 * If the engine's contract changes, `npm run fixtures:diagnosis` regenerates it
 * and the smoke test fails until the panel is updated — which is the point.
 *
 * Run: cd Pulse && npm run fixtures:diagnosis
 */
const fs = require('fs');
const path = require('path');
const { diagnose, focusOrder } = require('../../src/utils/diagnosis');

const FIX = path.join(__dirname, 'fixtures');
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

/** A single-platform response nests its payload under `data`. */
const unwrap = (res) => (res && res.data ? { ...res.data, meta: res.meta || {} } : res || {});

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole'];
const AUDIENCES = ['institutions', 'students'];

const combinedZero = read('combined-zero.json');
const zeroData = combinedZero.data || combinedZero;

const out = {
  generatedAt: new Date().toISOString(),
  engine: require('../../package.json').version,
  source: {
    zero: 'fixtures/combined-zero.json (recorded from the live API, all channels at zero)',
    pinterestRich: 'fixtures/pinterest-rich.json',
    linkedinRich: 'fixtures/linkedin-rich.json',
  },
  // combined-zero, diagnosed for both audience targets.
  zero: {},
  focus: {},
  // Payloads that DO have numbers — proves engagement is summed from posts.
  rich: {},
};

for (const audience of AUDIENCES) {
  out.zero[audience] = {};
  for (const p of PLATFORMS) {
    out.zero[audience][p] = diagnose(p, zeroData[p] || {}, { audience });
  }
  out.focus[audience] = focusOrder(
    PLATFORMS.map((p) => out.zero[audience][p]).filter(Boolean),
    audience
  );
}

out.rich.pinterest = diagnose('pinterest', unwrap(read('pinterest-rich.json')), { audience: 'institutions' });
out.rich.linkedin = diagnose('linkedin', unwrap(read('linkedin-rich.json')), { audience: 'institutions' });

const dest = path.join(FIX, 'diagnosis.json');

function write() {
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), dest)}`);
  for (const audience of AUDIENCES) {
    const stages = PLATFORMS.map((p) => `${p}=${out.zero[audience][p].stage}`).join(' ');
    console.log(`  ${audience}: ${stages}`);
    console.log(`  ${audience} focus: ${out.focus[audience].map((r) => `${r.platform}(${r.score})`).join(' > ')}`);
  }
  console.log(`  rich pinterest stage=${out.rich.pinterest.stage} engagedSource=${out.rich.pinterest.evidence.engagedSource}`);
  console.log(`  rich linkedin stage=${out.rich.linkedin.stage} engagedSource=${out.rich.linkedin.evidence.engagedSource}`);
}

// ── the real capture, replayed through the actual service ────────────────
// Not hand-written. scripts/fixtures/zernio-real-capture.json holds the upstream
// documents captured from the live account on 2026-10-21: 6 Pinterest pins that
// Zernio has fully synced (real pin id + URL) and that still report 0 metrics,
// next to 8 LinkedIn posts published the same way that DO report impressions.
// mockZernio serves them and the real zernioService transforms them, so this
// fixture exercises the same code path the deployment runs — which is what makes
// the "not measured" vs "no distribution" distinction testable in the panel.
(async () => {
  const { createMock } = require('../../scripts/mockZernio.js');
  const mock = createMock({ port: 0, mode: 'real-capture' });
  await mock.ready();
  process.env.ZERNIO_API_KEY = 'fixture-key-not-a-secret';
  process.env.ZERNIO_BASE_URL = mock.url;
  const zernio = require('../../src/services/zernioService');

  out.source.realCapture =
    'scripts/fixtures/zernio-real-capture.json — upstream documents captured from the live account on 2026-10-21, replayed through the real zernioService';
  out.realCapture = {
    note: 'pinterest = synced pins with zero metrics and empty account gauges ("not measured"); linkedin = the same publishing pattern WITH metrics (the control).',
  };

  for (const [key, fn] of [
    ['pinterest', zernio.fetchPinterest],
    ['linkedin', zernio.fetchLinkedIn],
  ]) {
    const payload = await fn({ days: 90 });
    out.realCapture[key] = {
      payload: {
        notice: payload.notice || payload.notices || null,
        overview: payload.overview || {},
        posts: payload.posts || [],
        totals: payload.totals || {},
        meta: {
          account: payload.meta?.account || null,
          boards: payload.meta?.boards || null,
          sync: payload.meta?.sync || null,
          metricAvailability: payload.meta?.diagnostics?.metricAvailability || null,
        },
      },
      diagnosis: {},
    };
    for (const audience of AUDIENCES) {
      out.realCapture[key].diagnosis[audience] = diagnose(key, payload, { audience });
    }
  }

  await mock.close();
  write();
  for (const key of ['pinterest', 'linkedin']) {
    const d = out.realCapture[key].diagnosis.institutions;
    console.log(
      `  real-capture ${key}: stage=${d.stage} posts=${d.evidence.postsRead} synced=${d.evidence.syncedPosts} ` +
        `oldest=${d.evidence.oldestPostDays}d seenPerPost=${d.evidence.seenPerPost} lowReach=${d.evidence.lowReach} notReported=${d.evidence.notReported}`
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error('real-capture replay failed:', e);
  process.exit(1);
});
