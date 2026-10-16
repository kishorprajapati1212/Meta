/**
 * scripts/make-fixtures.js — end-to-end fixture generator.
 *
 * Boots the mock Zernio upstream AND the real Express API (routes, services,
 * transforms — the production code path), then records what each endpoint
 * actually returns into Pulse/scripts/fixtures/*.json.
 *
 * Meta/Google credentials are deliberately NOT set, so Facebook, Instagram,
 * YouTube and Search Console come back as realistic error payloads. That gives
 * the frontend smoke test both halves of the world:
 *   • LinkedIn/Pinterest with real service output (zero-analytics + rich)
 *   • the four unconfigured platforms in their failed state
 *
 * Run: npm run fixtures
 */
process.env.PORT = '5099';
process.env.ZERNIO_API_KEY = 'sk_fixture_key';
process.env.ZERNIO_BASE_URL = 'http://127.0.0.1:4988/api';
process.env.ACCOUNT_CREATED = '2020-01-01';
// intentionally unset: ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_ID,
// YOUTUBE_*, GOOGLE_*, GSC_*

const fs = require('fs');
const path = require('path');
const { createMock } = require('./mockZernio');

const API = 'http://127.0.0.1:5099';
const OUT = path.join(__dirname, '..', 'Pulse', 'scripts', 'fixtures');

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${API}/api`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('API did not start in time');
}

async function get(pathAndQuery) {
  const res = await fetch(`${API}${pathAndQuery}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  wrote ${name.padEnd(28)} ${String(kb).padStart(4)} kB`);
}

async function main() {
  console.log('\nGenerating frontend fixtures from the real API code path…\n');
  const mock = createMock({ port: Number(process.env.MOCK_ZERNIO_PORT || 0), mode: 'zero-analytics' });
  await mock.ready();
  require('../src/app');
  await waitForServer();

  // ── The reported bug: Pinterest where Zernio returns pins but no metrics ──
  const pinZero = await get('/api/pinterest?date_preset=last_30d&compact=true&sync=false');
  write('pinterest-zero.json', pinZero.body);

  const liZero = await get('/api/linkedin?date_preset=last_30d&compact=true&sync=false');
  write('linkedin-zero.json', liZero.body);

  const combinedZero = await get('/api/combined?date_preset=last_30d&compact=true&sync=false');
  write('combined-zero.json', combinedZero.body);

  const health = await get('/api/health');
  write('health.json', health.body);

  // ── Same endpoints with metrics present ──────────────────────────────────
  mock.setMode('rich');
  // The service caches account lookups per process, but not post analytics.
  const pinRich = await get('/api/pinterest?date_preset=last_30d&compact=true&sync=false');
  write('pinterest-rich.json', pinRich.body);

  const liRich = await get('/api/linkedin?date_preset=last_30d&compact=true&sync=false');
  write('linkedin-rich.json', liRich.body);

  const combinedRich = await get('/api/combined?date_preset=last_90d&compact=true&sync=false');
  write('combined-rich.json', combinedRich.body);

  // ── Degraded upstream: account list fails, boards 404 ────────────────────
  mock.setMode('accounts-500');
  const pinDegraded = await get('/api/pinterest?date_preset=last_30d&compact=true&sync=false');
  write('pinterest-degraded.json', pinDegraded.body);

  mock.setMode('boards-404');
  const pinNoBoards = await get('/api/pinterest?date_preset=last_30d&compact=true&sync=false');
  write('pinterest-no-boards.json', pinNoBoards.body);

  // ── Diagnostics endpoints ────────────────────────────────────────────────
  mock.setMode('zero-analytics');
  const zernioDebug = await get('/api/zernio/debug');
  write('zernio-debug.json', zernioDebug.body);

  // ── Sanity report ────────────────────────────────────────────────────────
  const d = combinedZero.body?.data || {};
  const pin = d.pinterest || {};
  console.log('\n  Fixture sanity check');
  console.log(`    pinterest posts in combined : ${pin.posts?.length ?? 0}`);
  console.log(`    pinterest overview keys     : ${Object.keys(pin.overview || {}).length}`);
  console.log(`    pinterest account in meta   : ${pin.meta?.account ? pin.meta.account.displayName : 'MISSING'}`);
  console.log(`    pinterest boards            : ${pin.meta?.boards?.length ?? 0}`);
  console.log(`    facebook state              : ${d.facebook?.error ? 'error (expected — no token)' : 'data'}`);
  console.log(`    summary block present       : ${Boolean(d.summary)}`);

  if (!pin.posts?.length) throw new Error('Pinterest fixture has no posts — the bug is back');
  if (!Object.keys(pin.overview || {}).length) throw new Error('Pinterest overview is empty — the bug is back');
  if (!pin.meta?.account) throw new Error('Pinterest account is missing from meta — the bug is back');

  await mock.close();
  console.log('\n  Fixtures OK\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nfixture generation failed:', e);
  process.exit(1);
});
