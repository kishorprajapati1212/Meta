#!/usr/bin/env node
/**
 * collect-report.js — ONE command that gathers every diagnostic into ONE file.
 *
 *   npm run report -- --api https://meta-ptze.onrender.com
 *   node scripts/collect-report.js --api http://localhost:5000 --days 90
 *   node scripts/collect-report.js --api https://meta-ptze.onrender.com --out ~/Desktop/report.json
 *
 * Why this exists: "Pinterest shows 0" and "Instagram likes are 0" cannot be
 * diagnosed from a screenshot. They need the actual payloads and, ideally, the
 * verbatim upstream bodies. This script fetches them all and writes a single
 * redacted JSON file that can be attached to a message.
 *
 * It works against ANY deployed version:
 *   • v4.3.1+ has GET /api/report, so the server builds the bundle (including
 *     the verbatim Zernio/Graph/Google bodies and the Pinterest verdict).
 *   • Older deployments (v4.2.4 and earlier) are collected endpoint by endpoint
 *     from what they already expose — /api/health, /api/combined, all six
 *     channels, /api/zernio/debug, /api/zernio/accounts, /api/youtube/debug.
 *
 * Credentials never reach the file: everything passes through utils/redact.js
 * here as well, so even an old deployment that echoes an account document with
 * a token inside it is scrubbed before it is written to disk.
 */
const fs = require('fs');
const path = require('path');
const { redactDeep } = require('../src/utils/redact');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const API = String(flag('api', process.env.REPORT_API || 'http://127.0.0.1:5000')).replace(/\/+$/, '');
const DAYS = Math.max(1, Math.min(Number(flag('days', 90)) || 90, 365));
const TIMEOUT_MS = Number(flag('timeout', 240000)) || 240000;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = path.resolve(flag('out', path.join(process.cwd(), `report-${stamp}.json`)));

const CHANNELS = [
  ['facebook', '/api/facebook'],
  ['instagram', '/api/instagram'],
  ['youtube', '/api/youtube'],
  ['linkedin', '/api/linkedin'],
  ['pinterest', '/api/pinterest'],
  ['searchConsole', '/api/gsc'],
];

const log = (...a) => console.log(...a);

async function get(pathAndQuery, { accept = 'application/json', retries = 1 } = {}) {
  const url = `${API}${pathAndQuery}`;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t = Date.now();
    try {
      const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      const ms = Date.now() - t;
      if (accept.includes('text')) return { ok: res.ok, status: res.status, ms, text, url };
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { ok: res.ok && body !== null, status: res.status, ms, body, text: body ? null : text.slice(0, 400), url };
    } catch (e) {
      lastError = e;
      // A free-tier host asleep can outlast one request; retry once.
      if (attempt < retries) {
        log(`    retrying after ${e.name === 'TimeoutError' ? 'timeout' : e.message}…`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }
  return { ok: false, status: null, ms: null, error: `${lastError.name}: ${lastError.message}`, url };
}

/** Compare two dotted version strings. */
function versionCompare(a, b) {
  const pa = String(a || '0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The numbers that matter, lifted out of one channel payload. */
function numbersOf(payload) {
  const ov = payload?.overview || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const c = ov[k];
      if (!c || typeof c !== 'object') continue;
      if (c.unavailable === true) return `${k}: not published`;
      const v = Number(c.total ?? c.value);
      if (Number.isFinite(v)) return `${k}: ${v}${c.source ? ` (from ${c.source})` : ''}`;
    }
    return null;
  };
  const withData = Object.values(ov).filter((c) => c && typeof c === 'object' && c.hasData === true).length;
  return {
    metricsWithData: withData,
    metricsTotal: Object.keys(ov).length,
    postsInPayload: Array.isArray(payload?.posts) ? payload.posts.length : 0,
    seen: pick('impressions', 'reach', 'views', 'contentViews', 'pageViews'),
    engaged: pick('engagement', 'interactions', 'total_interactions', 'likes'),
    followers: pick('followers', 'fans'),
    clicks: pick('clicks', 'outboundClicks', 'websiteClicks', 'profileViews'),
    posts: pick('posts', 'pins'),
  };
}

async function main() {
  log(`\n  Meta Analytics — diagnostic collector`);
  log(`  target: ${API}`);
  log(`  window: last ${DAYS} days\n`);

  const started = Date.now();
  const errors = [];
  const timings = {};

  log('  1/4  health + version');
  const health = await get('/api/health');
  timings.health = health.ms;
  if (!health.ok) errors.push({ section: 'health', error: health.error || `HTTP ${health.status}`, url: health.url });
  const version = String(health.body?.meta?.version || health.body?.data?.version || 'unknown').replace(/[^0-9.].*$/, '');
  log(`        deployed API version: ${version || 'unknown'}${health.ok ? '' : ' (health request failed)'}`);

  const bundle = {
    meta: {
      collector: 'scripts/collect-report.js',
      collectedAt: new Date().toISOString(),
      api: API,
      deployedVersion: version || null,
      days: DAYS,
      tookMs: null,
      redacted: true,
      mode: null,
    },
    errors,
    timings,
    data: { health: health.body || { error: health.error || `HTTP ${health.status}` }, platforms: {}, raw: {}, index: null, combined: null, report: null },
  };

  // ── Preferred path: the server builds the whole bundle (v4.3.1+) ──
  const serverReport = versionCompare(version, '4.3.1') >= 0;
  if (serverReport) {
    log('  2/4  GET /api/report (server-side bundle)');
    const full = await get(`/api/report?days=${DAYS}&raw=true`);
    timings.report = full.ms;
    if (full.ok && full.body?.data) {
      bundle.meta.mode = 'server';
      bundle.data.report = full.body;
      log(`        ok in ${full.ms} ms · ${Math.round((full.body.meta?.bytes || 0) / 1024)} kB · ${full.body.meta?.truncations?.length || 0} truncation(s)`);
    } else {
      errors.push({ section: 'report', error: full.error || `HTTP ${full.status}`, url: full.url });
      log(`        failed (${full.error || `HTTP ${full.status}`}) — falling back to endpoint-by-endpoint collection`);
      bundle.meta.mode = null;
    }
  } else {
    log(`  2/4  this deployment (${version || 'unknown'}) has no /api/report — collecting endpoint by endpoint`);
  }

  if (bundle.meta.mode !== 'server') {
    bundle.meta.mode = bundle.meta.mode || 'endpoints';
    log('  3/4  index + combined + six channels');
    const index = await get('/api');
    timings.index = index.ms;
    bundle.data.index = index.body || { error: index.error || `HTTP ${index.status}` };

    const combined = await get(`/api/combined?date_preset=last_${Math.min(DAYS, 365)}d`);
    timings.combined = combined.ms;
    bundle.data.combined = combined.body || { error: combined.error || `HTTP ${combined.status}` };
    if (!combined.ok) errors.push({ section: 'combined', error: combined.error || `HTTP ${combined.status}`, url: combined.url });
    log(`        /api/combined ${combined.ok ? `ok in ${combined.ms} ms` : `FAILED (${combined.error || combined.status})`}`);

    for (const [key, url] of CHANNELS) {
      const res = await get(`${url}?date_preset=last_${Math.min(DAYS, 365)}d`);
      timings[key] = res.ms;
      const payload = res.body?.data ? { ...res.body.data, meta: res.body.meta || {}, notice: res.body.notice || null } : res.body || { error: res.error || `HTTP ${res.status}` };
      bundle.data.platforms[key] = { ok: res.ok, status: res.status, ms: res.ms, url: res.url, numbers: res.ok ? numbersOf(payload) : null, payload };
      if (!res.ok) errors.push({ section: key, error: res.error || `HTTP ${res.status}`, url: res.url });
      const n = bundle.data.platforms[key].numbers;
      log(
        `        ${key.padEnd(14)} ${res.ok ? 'ok  ' : 'FAIL'} ${String(res.ms ?? '—').padStart(6)} ms  ` +
          (n ? `${n.metricsWithData}/${n.metricsTotal} metrics with data · ${n.postsInPayload} posts · ${n.seen || 'seen —'} · ${n.engaged || 'engaged —'}` : String(res.error || res.status).slice(0, 70))
      );
    }

    log('  4/4  upstream debug endpoints');
    for (const [key, url] of [
      ['zernioDebug', '/api/zernio/debug'],
      ['zernioAccounts', '/api/zernio/accounts'],
      ['youtubeDebug', '/api/youtube/debug'],
    ]) {
      const res = await get(url);
      timings[key] = res.ms;
      bundle.data.raw[key] = res.ok ? res.body : { error: res.error || `HTTP ${res.status}`, status: res.status, url: res.url };
      if (!res.ok) errors.push({ section: key, error: res.error || `HTTP ${res.status}`, url: res.url });
      log(`        ${key.padEnd(16)} ${res.ok ? 'ok  ' : 'FAIL'} ${String(res.ms ?? '—').padStart(6)} ms`);
    }
  } else {
    log('  3/4  skipped (the server bundle already includes every channel and the raw bodies)');
    log('  4/4  skipped');
  }

  bundle.meta.tookMs = Date.now() - started;

  // ── Redact before touching the disk ──
  const { data: safe, truncations } = redactDeep(bundle, { maxItems: 60, maxString: 3000 });
  safe.meta.truncations = truncations;
  const json = JSON.stringify(safe, null, 2);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);

  const kb = Math.round(json.length / 1024);
  log('');
  log('  ── digest ─────────────────────────────────────────────');
  log(`  deployed API: ${version || 'unknown'}  ·  collected in ${bundle.meta.tookMs} ms  ·  mode: ${safe.meta.mode}`);
  const details = safe.data?.health?.data?.details || safe.data?.report?.data?.health?.data?.details || {};
  for (const [k, v] of Object.entries(details)) {
    log(`  ${k.padEnd(15)} ${String(v.status || '?').padEnd(14)} ${String(v.message || '').slice(0, 78)}`);
    if (v.hint) log(`  ${''.padEnd(15)} hint: ${String(v.hint).slice(0, 100)}`);
  }
  // /api/report and the endpoint-by-endpoint fallback describe a channel in two
  // slightly different shapes ({key,value} objects vs pre-formatted strings, and
  // metricsWithdata vs metricsWithData). Both must print cleanly — this digest is
  // the first thing anyone reads.
  const fmtNum = (x) => {
    if (x === null || x === undefined) return null;
    if (typeof x === 'string') return x;
    if (typeof x === 'number') return String(x);
    if (typeof x === 'object') {
      const v = Number(x.value ?? x.total);
      if (!Number.isFinite(v)) return `${x.key || 'metric'}: not published`;
      return `${x.key || 'metric'}: ${v}${x.source ? ` (from ${x.source})` : ''}`;
    }
    return String(x);
  };
  const platforms = safe.data?.report?.data?.platforms || safe.data?.platforms || {};
  const diagnoses = safe.data?.report?.data?.diagnosis?.institutions || {};
  for (const [k, entry] of Object.entries(platforms)) {
    const n = entry?.numbers || (entry?.ok === false ? null : numbersOf(entry?.payload || entry));
    if (!n) {
      log(`  ${k.padEnd(15)} ${entry?.ok === false ? `FAILED — ${String(entry.error || '').slice(0, 70)}` : 'no numbers'}`);
      continue;
    }
    const stage = String(diagnoses[k]?.stage || entry?.payload?.diagnosis?.stage || '').padEnd(15);
    const withData = n.metricsWithData ?? n.metricsWithdata ?? 0;
    log(
      `  ${k.padEnd(15)} ${stage} ${withData}/${n.metricsTotal ?? 0} metrics · ${n.postsInPayload ?? 0} posts · ` +
        `${fmtNum(n.seen) || 'seen —'} · ${fmtNum(n.engaged) || 'engaged —'}`
    );
  }
  for (const [k, dg] of Object.entries(diagnoses)) {
    if (!dg || !dg.headline) continue;
    log(`  ${k.padEnd(15)} → ${String(dg.headline).slice(0, 150)}`);
  }
  const probe = safe.data?.report?.data?.probes?.pinterest;
  if (probe) log(`  pinterest probe: ${String(probe.verdict || '').slice(0, 220)}`);
  const probeLi = safe.data?.report?.data?.probes?.linkedin;
  if (probeLi) log(`  linkedin probe:  ${String(probeLi.verdict || '').slice(0, 220)}`);
  if (errors.length) {
    log('');
    log(`  ${errors.length} request(s) failed:`);
    for (const e of errors.slice(0, 10)) log(`    - ${e.section}: ${String(e.error).slice(0, 110)}`);
  }
  log('  ───────────────────────────────────────────────────────');
  log('');
  log(`  ✓ wrote ${OUT} (${kb} kB)`);
  log('');
  log('  Send that one file back — it contains every payload, the upstream debug');
  log('  bodies and (on v4.3.1+) the raw Zernio/Graph/Google responses, so the');
  log('  Pinterest and Instagram questions can be answered from evidence.');
  log('  Credentials are redacted: secrets appear as set/length plus a 3-character prefix.');
  log('');
  log(`  Want a paste-able version instead?  curl -s "${API}/api/report?format=text&days=${DAYS}"`);
  log('');
}

main().catch((e) => {
  console.error('\ncollector crashed:', e);
  process.exit(1);
});
