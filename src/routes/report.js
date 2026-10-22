/**
 * GET /api/report — every diagnostic this API can produce, in ONE call.
 *
 * Built because "Pinterest shows 0" cannot be answered from the transformed
 * payload alone: by then the upstream body has been through the metric catalogue
 * and the overview builder, and the three possible causes (channel not connected
 * upstream, analytics not on the plan, pins published but not yet reported) all
 * look identical. This endpoint returns the transformed payloads AND the
 * verbatim upstream bodies AND a per-channel verdict, so one file is enough to
 * diagnose anything.
 *
 *   GET /api/report                     everything, 30-day window, raw bodies on
 *   GET /api/report?days=90             wider window for the platform payloads
 *   GET /api/report?raw=false           skip the verbatim upstream bodies
 *   GET /api/report?format=text         paste-able digest instead of JSON
 *   GET /api/report?sections=config,health,platforms
 *
 * Safety: the report is meant to be handed to another human, so the whole tree
 * passes through utils/redact.js — every credential-shaped key and every
 * token-shaped string is replaced, and credentials in query strings are stripped.
 * Secrets are reported as { set, length, preview } so a wrong token is still
 * recognisable without being revealed.
 *
 * The report bypasses the last-good cache on purpose: it must show what the
 * upstreams say right now, not the numbers the dashboard is serving.
 */
const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { redactDeep } = require('../utils/redact');
const { diagnose, focusOrder } = require('../utils/diagnosis');
const { buildHealth } = require('./health');
const { graphRaw, gscRaw, youtubeRaw, zernioRaw } = require('../utils/rawDump');
const facebook = require('../services/facebookService');
const instagram = require('../services/instagramService');
const youtube = require('../services/youtubeService');
const gsc = require('../services/gscService');
const zernio = require('../services/zernioService');

const r = Router();

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook Page', fetch: (q) => facebook.fetchInsights(q) },
  { key: 'instagram', label: 'Instagram Business', fetch: (q) => instagram.fetchInsights(q) },
  { key: 'youtube', label: 'YouTube', fetch: (q) => youtube.fetchInsights(q) },
  { key: 'searchConsole', label: 'Google Search Console', fetch: (q) => gsc.fetchInsights(q) },
  { key: 'linkedin', label: 'LinkedIn', fetch: (q) => zernio.fetchLinkedIn(q) },
  { key: 'pinterest', label: 'Pinterest', fetch: (q) => zernio.fetchPinterest(q) },
];

const ALL_SECTIONS = ['config', 'health', 'platforms', 'diagnosis', 'combined', 'raw', 'probes'];
const AUDIENCES = ['institutions', 'students'];

/** The 14 documented names — anything else that looks related is worth flagging. */
const KNOWN_ENV = new Set([
  'ACCESS_TOKEN', 'INSTAGRAM_ID', 'FACEBOOK_PAGE_ID', 'YOUTUBE_REFRESH_TOKEN',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GSC_REFRESH_TOKEN', 'GSC_CLIENT_ID',
  'GSC_SECRET', 'GSC_CLIENT_SECRET', 'GSC_SITE_URL', 'ZERNIO_API_KEY', 'PORT',
  'FB_API_VERSION', 'ACCOUNT_CREATED',
  // internal overrides the self-test uses; never required from the user
  'FB_API_BASE', 'GOOGLE_TOKEN_URL', 'YOUTUBE_ANALYTICS_URL', 'YOUTUBE_DATA_API_URL',
  'GSC_API_BASE', 'ZERNIO_BASE_URL', 'PLATFORM_TIMEOUT_MS', 'PUBLIC_URL', 'RENDER_EXTERNAL_URL',
  'NODE_ENV', 'MOCK_MODE', 'MOCK_PORT', 'MOCK_ZERNIO_PORT', 'MOCK_UPSTREAM_PORT',
]);
const LOOKS_RELATED = /(META|FACEBOOK|INSTAGRAM|YOUTUBE|GOOGLE|GSC|SEARCH_CONSOLE|ZERNIO|LINKEDIN|PINTEREST|ANALYTICS|ACCESS_TOKEN|API_KEY|REFRESH)/i;

function secret(v) {
  if (v === undefined || v === null || v === '') return { set: false };
  const s = String(v);
  return { set: true, length: s.length, preview: `${s.slice(0, 2)}…` };
}

function readPulseVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'Pulse', 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function bundleExists() {
  try {
    const p = path.join(__dirname, '..', '..', 'Pulse', 'dist', 'index.html');
    if (!fs.existsSync(p)) return { built: false };
    const html = fs.readFileSync(p, 'utf8');
    const m = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html);
    return { built: true, bundle: m ? m[1] : null, builtAt: fs.statSync(p).mtime.toISOString() };
  } catch (e) {
    return { built: false, error: e.message };
  }
}

/** Which env vars are set, without ever echoing a credential. */
function configSnapshot() {
  const unexpected = Object.keys(process.env)
    .filter((k) => !KNOWN_ENV.has(k) && LOOKS_RELATED.test(k) && !/^(_|MOCK_|MOCK$)/.test(k))
    .sort();
  const defaults = {
    FB_API_BASE: 'https://graph.facebook.com',
    GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
    YOUTUBE_ANALYTICS_URL: 'https://youtubeanalytics.googleapis.com/v2/reports',
    YOUTUBE_DATA_API_URL: 'https://www.googleapis.com/youtube/v3',
    GSC_API_BASE: 'https://www.googleapis.com/webmasters/v3',
    ZERNIO_BASE_URL: 'https://zernio.com/api',
  };
  const overridden = Object.entries(defaults)
    .filter(([k, v]) => config[k] && config[k] !== v)
    .map(([k, v]) => ({ key: k, value: config[k], default: v }));

  return {
    version: config.VERSION,
    dashboardVersion: readPulseVersion(),
    dashboardBundle: bundleExists(),
    node: process.version,
    port: config.PORT,
    uptimeSeconds: Math.round(process.uptime()),
    accountCreated: config.ACCOUNT_CREATED,
    fbApiVersion: config.FB_API_VERSION,
    env: {
      ACCESS_TOKEN: secret(config.USER_ACCESS_TOKEN),
      FACEBOOK_PAGE_ID: config.FACEBOOK_PAGE_ID || null,
      INSTAGRAM_ID: config.INSTAGRAM_ID || null,
      YOUTUBE_REFRESH_TOKEN: secret(config.YOUTUBE_REFRESH_TOKEN),
      GOOGLE_CLIENT_ID: secret(config.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: secret(config.GOOGLE_CLIENT_SECRET),
      GSC_REFRESH_TOKEN: secret(config.GSC_REFRESH_TOKEN),
      GSC_CLIENT_ID: secret(config.GSC_CLIENT_ID),
      GSC_CLIENT_SECRET: secret(config.GSC_CLIENT_SECRET || process.env.GSC_SECRET),
      GSC_SITE_URL: config.GSC_SITE_URL || null,
      ZERNIO_API_KEY: secret(config.ZERNIO_API_KEY),
    },
    endpoints: {
      FB_API_BASE: config.FB_API_BASE,
      GOOGLE_TOKEN_URL: config.GOOGLE_TOKEN_URL,
      YOUTUBE_ANALYTICS_URL: config.YOUTUBE_ANALYTICS_URL,
      YOUTUBE_DATA_API_URL: config.YOUTUBE_DATA_API_URL,
      GSC_API_BASE: config.GSC_API_BASE,
      ZERNIO_BASE_URL: config.ZERNIO_BASE_URL,
    },
    // A *_BASE_URL left over from a local mock run silently points production at
    // nothing — worth surfacing explicitly.
    endpointOverrides: overridden,
    // e.g. FACEBOOK_TOKEN instead of ACCESS_TOKEN: set, related, and ignored.
    unexpectedEnvVars: unexpected,
  };
}

function windowFor(days) {
  const until = new Date();
  const since = new Date(Date.now() - days * 86400000);
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
}

/** Run one section, capturing its error instead of failing the whole report. */
async function section(out, name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    out.timings[name] = Date.now() - t;
    return value;
  } catch (e) {
    out.timings[name] = Date.now() - t;
    out.errors.push({ section: name, error: e.message, hint: e.hint || null, code: e.code || null });
    return { __sectionFailed: true, error: e.message, hint: e.hint || null };
  }
}

/** One channel's totals, lifted out of its overview for the text digest. */
function headlineNumbers(payload) {
  const ov = payload?.overview || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const c = ov[k];
      if (!c || typeof c !== 'object') continue;
      if (c.unavailable === true) return { key: k, unavailable: true };
      const v = Number(c.total ?? c.value);
      if (Number.isFinite(v)) return { key: k, value: v, source: c.source || null, hasData: c.hasData !== false };
    }
    return null;
  };
  return {
    seen: pick('impressions', 'reach', 'views', 'contentViews', 'pageViews'),
    engaged: pick('engagement', 'interactions', 'total_interactions', 'likes'),
    followers: pick('followers', 'fans'),
    clicks: pick('clicks', 'outboundClicks', 'websiteClicks', 'profileViews'),
    posts: pick('posts', 'pins'),
    metricsWithdata: Object.values(ov).filter((c) => c && typeof c === 'object' && c.hasData === true).length,
    metricsTotal: Object.keys(ov).length,
    postsInPayload: Array.isArray(payload?.posts) ? payload.posts.length : 0,
  };
}

/** Read a post's analytics for one platform, the way the service does. */
function platformCopy(post, platform) {
  const copies = Array.isArray(post?.platforms) ? post.platforms : [];
  return copies.find((c) => String(c?.platform || '').toLowerCase() === platform) || null;
}

function analyticsFor(post, platform) {
  return platformCopy(post, platform)?.analytics || post?.analytics || {};
}

/**
 * The Pinterest question, answered from the raw upstream body.
 *
 * "0 is okay but still problematic" — this says which problem it is: not
 * connected, no analytics on the plan, published but unreported (lag), or
 * genuinely served to nobody.
 */
function channelProbe(rawZernio, platform) {
  const out = {
    platform,
    accountConnected: false,
    accountId: null,
    username: null,
    accountType: null,
    hasAnalyticsAccess: null,
    scopes: null,
    permissions: null,
    platformStatus: null,
    platformStatusReason: null,
    needsReconnection: false,
    pinCount: null,
    boardCount: null,
    monthlyViews: null,
    followersCount: null,
    lastSuccessfulPublishAt: null,
    zernioSummary: rawZernio?.summary || null,
    postsUpstream: 0,
    postsWithAnyMetric: 0,
    impressionsUpstream: 0,
    engagementUpstream: 0,
    newestPostAgeHours: null,
    oldestPostAgeDays: null,
    identifiedPosts: 0,
    syncedPosts: 0,
    postsSample: [],
    boards: null,
    followers: null,
    entitlementGap: false,
    accountsCallOk: null,
    accountsCallError: null,
    verdictKind: null,
    verdict: null,
  };
  if (!rawZernio || rawZernio.configured === false) {
    out.verdict = 'ZERNIO_API_KEY is not set, so this channel cannot be read at all.';
    return out;
  }
  const calls = rawZernio.calls || {};
  const accountsCall = calls['GET /v1/accounts'] || null;
  const acct = calls[`account:${platform}`];
  out.accountsCallOk = accountsCall ? Boolean(accountsCall.ok) : null;
  out.accountsCallError = accountsCall && !accountsCall.ok ? accountsCall.error || null : null;
  if (acct) {
    out.accountConnected = Boolean(acct.ok);
    out.accountId = acct.accountId || null;
    out.username = acct.username || null;
    out.accountType = acct.accountType || null;
    out.hasAnalyticsAccess = acct.hasAnalyticsAccess ?? null;
    out.scopes = acct.scopes || null;
    out.permissions = acct.permissions || null;
    out.platformStatus = acct.platformStatus || null;
    out.platformStatusReason = acct.platformStatusReason || null;
    out.needsReconnection = acct.needsReconnection === true;
    out.pinCount = acct.pinCount ?? null;
    out.boardCount = acct.boardCount ?? null;
    out.monthlyViews = acct.monthlyViews ?? null;
    out.followersCount = acct.followersCount ?? null;
    out.lastSuccessfulPublishAt = acct.lastSuccessfulPublishAt || null;
  }
  const analyticsCall = calls[`GET /v1/analytics?platform=${platform}`];
  if (analyticsCall && !analyticsCall.ok) {
    out.analyticsError = { status: analyticsCall.status, error: analyticsCall.error };
  }
  const body = analyticsCall?.data || {};
  const posts = Array.isArray(body.posts) ? body.posts : Array.isArray(body.data) ? body.data : [];
  out.postsUpstream = posts.length;
  out.apiOverview = body.overview || body.stats || body.summary || null;
  out.pagination = body.pagination || null;

  let newest = 0;
  let oldest = Infinity;
  for (const p of posts.slice(0, 25)) {
    const copy = platformCopy(p, platform);
    const a = analyticsFor(p, platform);
    const impressions = Number(a.impressions ?? a.reach ?? a.views ?? 0) || 0;
    const engagement =
      (Number(a.likes ?? a.reactions ?? 0) || 0) +
      (Number(a.comments ?? 0) || 0) +
      (Number(a.shares ?? a.reposts ?? 0) || 0) +
      (Number(a.saves ?? 0) || 0) +
      (Number(a.clicks ?? 0) || 0);
    out.impressionsUpstream += impressions;
    out.engagementUpstream += engagement;
    if (impressions > 0 || engagement > 0) out.postsWithAnyMetric += 1;
    const t = new Date(p.publishedAt || p.date || 0).getTime();
    if (Number.isFinite(t)) {
      if (t > newest) newest = t;
      if (t < oldest) oldest = t;
    }
    out.postsSample.push({
      id: p._id || p.postId || null,
      platformPostId: copy?.platformPostId || p.platformPostId || null,
      platformPostUrl: copy?.platformPostUrl || p.platformPostUrl || null,
      publishedAt: p.publishedAt || null,
      ageDays: Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null,
      status: copy?.status || p.status || null,
      // The authoritative sync state lives on the per-platform copy. Reading the
      // document level reported "external" for pins Zernio had already synced.
      syncStatus: copy?.syncStatus || p.syncStatus || null,
      isExternal: Boolean(p.isExternal),
      copyError: copy?.errorMessage || null,
      mediaType: p.mediaType || null,
      platformCopies: Array.isArray(p.platforms) ? p.platforms.map((c) => String(c?.platform || '').toLowerCase()) : [],
      analytics: a,
      analyticsKeys: Object.keys(a || {}),
      errorMessage: p.errorMessage || null,
    });
  }
  if (newest) out.newestPostAgeHours = Math.round(((Date.now() - newest) / 3600000) * 10) / 10;
  if (Number.isFinite(oldest)) out.oldestPostAgeDays = Math.floor((Date.now() - oldest) / 86400000);
  out.identifiedPosts = out.postsSample.filter((x) => x.platformPostId || x.platformPostUrl).length;
  out.syncedPosts = out.postsSample.filter((x) => String(x.syncStatus || '').toLowerCase() === 'synced').length;

  if (platform === 'pinterest') {
    const boardsCall = calls['GET /v1/accounts/{id}/pinterest-boards'] || calls['GET /v1/accounts/{id}/boards'];
    if (boardsCall) {
      const list = Array.isArray(boardsCall.data) ? boardsCall.data : boardsCall.data?.boards || boardsCall.data?.data || null;
      out.boards = boardsCall.ok
        ? { ok: true, count: Array.isArray(list) ? list.length : null, sample: Array.isArray(list) ? list.slice(0, 10) : list }
        : { ok: false, status: boardsCall.status || null, error: boardsCall.error || null };
    }
  }
  const followersCall = calls[`GET /v1/accounts/follower-stats?platform=${platform}`];
  if (followersCall) {
    out.followers = followersCall.ok
      ? { ok: true, rows: Array.isArray(followersCall.data?.stats) ? followersCall.data.stats.length : Object.keys(followersCall.data?.stats || {}).length, sample: followersCall.data }
      : { ok: false, status: followersCall.status || null, error: followersCall.error || null };
  }

  // ── the verdict, in the order the causes must be ruled out ──
  if (!out.accountConnected && out.accountsCallOk === false) {
    // The lookup itself failed — typically a parameter or auth problem on
    // GET /v1/accounts. Claiming "not connected" here is how a working channel
    // gets told to reconnect itself.
    out.verdict = `The account lookup failed upstream (${out.accountsCallError || 'GET /v1/accounts error'}), so this probe cannot say whether ${platform} is connected. ` +
      `Read data.platforms.${platform} instead — if that payload has posts and an account block, the channel IS connected and only this raw probe is blind.`;
    out.verdictKind = 'lookup-failed';
  } else if (!out.accountConnected) {
    out.verdict = `Zernio returns no ${platform} account for this API key, so every metric is legitimately empty. Connect the ${platform} account in Zernio first — nothing in this codebase can produce numbers for a channel that is not connected upstream.`;
    out.verdictKind = 'not-connected';
  } else if (out.hasAnalyticsAccess === false) {
    out.verdict = `Zernio reports hasAnalyticsAccess:false for this key. The account is connected but the plan does not expose post analytics, so impressions/engagement come back empty. This must be enabled on the Zernio side.`;
  } else if (out.postsUpstream === 0) {
    out.verdict = `The ${platform} account is connected and analytics are enabled, but Zernio returned 0 posts for this window. Either nothing was published in the window, or the posts were published outside Zernio and never synced — widen the window (?days=90) or trigger a sync to tell those apart.`;
  } else if (
    platform === 'pinterest' &&
    out.postsWithAnyMetric === 0 &&
    out.pinCount === null &&
    out.boardCount === null &&
    out.monthlyViews === null
  ) {
    // Captured live 2026-10-21: 6 pins, each with a real pin id + URL and
    // syncStatus "synced", every metric 0 including pins a month old, and every
    // account-level gauge empty. Pinterest documents that organic analytics are
    // a BUSINESS-account feature — so this is an entitlement gap, not a
    // distribution problem, and the content should not be rewritten over it.
    out.verdict =
      `${out.postsUpstream} pin(s) upstream and every one reports 0 metrics, but Pinterest clearly knows them — ${out.identifiedPosts} of the ${out.postsSample.length} sampled pin(s) carry a real pin id or pin URL and ${out.syncedPosts} are marked syncStatus "synced" — and the oldest is ${out.oldestPostAgeDays ?? '?'} day(s) old, far beyond the 24–48 h lag. ` +
      `Every account-level gauge is empty too (pinCount ${out.pinCount}, boardCount ${out.boardCount}, monthlyViews ${out.monthlyViews}, accountType ${out.accountType ?? 'null'}). ` +
      'Pinterest only serves organic analytics (impressions, saves, pin clicks, outbound clicks) to BUSINESS accounts. ' +
      `Fix: convert ${out.username ? '@' + out.username : 'the Pinterest account'} to a free Business account (Pinterest → Settings → Account management → Convert to business), then reconnect it in Zernio so the new entitlement is picked up. ` +
      'Until then these zeros mean "not measured" — read the real numbers in Pinterest\'s own analytics.';
    out.entitlementGap = true;
    out.verdictKind = 'entitlement-gap';
  } else if (out.postsWithAnyMetric === 0 && out.newestPostAgeHours !== null && out.newestPostAgeHours < 48) {
    out.verdict = `${out.postsUpstream} post(s) upstream, all with zero metrics, and the newest is ${out.newestPostAgeHours} h old — inside this platform's 24–48 h reporting lag. The zeros are expected right now; re-check tomorrow before treating this as a problem.`;
  } else if (out.postsWithAnyMetric === 0) {
    out.verdict = `${out.postsUpstream} post(s) upstream and every one reports 0 impressions and 0 engagement, with the newest ${out.newestPostAgeHours ?? '?'} h old. That is real upstream data, not a bug in this API: the platform served the content to (almost) nobody. The fix is distribution — see data.diagnosis.${platform}.actions.`;
  } else {
    out.verdictKind = 'metrics-present';
    out.verdict = `${out.postsWithAnyMetric} of ${out.postsUpstream} post(s) have real metrics upstream (${out.impressionsUpstream} impressions, ${out.engagementUpstream} engagement). If the dashboard still shows 0, that IS a bug in this API — send this report.`;
  }
  return out;
}

/** Plain-text digest: paste-able into a chat, no JSON needed. */
function renderText(report) {
  const d = report.data;
  const L = [];
  const line = (s = '') => L.push(s);
  line(`Meta Analytics report — API ${d.config?.version || '?'} · dashboard ${d.config?.dashboardVersion || '?'} · node ${d.config?.node || '?'}`);
  line(`generated ${report.meta.generatedAt} in ${report.meta.tookMs} ms · window ${report.meta.window.since} → ${report.meta.window.until}`);
  line(`bundle: ${d.config?.dashboardBundle?.built ? d.config.dashboardBundle.bundle : 'NOT BUILT'} · endpoint overrides: ${d.config?.endpointOverrides?.length || 0} · unexpected env vars: ${d.config?.unexpectedEnvVars?.join(', ') || 'none'}`);
  line('');
  line('credentials');
  for (const [k, v] of Object.entries(d.config?.env || {})) {
    line(`  ${k.padEnd(24)} ${v && typeof v === 'object' ? (v.set ? `set (len ${v.length}, "${v.preview}")` : 'MISSING') : v === null ? 'MISSING' : v}`);
  }
  if (d.health?.data) {
    line('');
    line(`health: ${d.health.data.healthy ? 'healthy' : 'NOT healthy'} · ${d.health.data.ok}/${d.health.data.total} channels ok`);
    for (const [k, v] of Object.entries(d.health.data.details || {})) {
      line(`  ${k.padEnd(15)} ${String(v.status).padEnd(14)} ${String(v.message || '').slice(0, 90)}`);
      if (v.hint) line(`  ${''.padEnd(15)} hint: ${String(v.hint).slice(0, 110)}`);
    }
  }
  line('');
  line('channels');
  for (const p of PLATFORMS) {
    const e = d.platforms?.[p.key];
    line(`  ${p.label} (${p.key})`);
    if (!e) { line('    not requested'); continue; }
    if (!e.ok) { line(`    FAILED in ${e.ms} ms: ${String(e.error || '').slice(0, 140)}${e.hint ? ` | hint: ${String(e.hint).slice(0, 120)}` : ''}`); continue; }
    const n = e.numbers;
    const f = (x) => (x ? (x.unavailable ? `${x.key}: not published` : `${x.key}: ${x.value}${x.source ? ` (from ${x.source})` : ''}`) : '—');
    line(`    read in ${e.ms} ms · ${n.metricsWithdata}/${n.metricsTotal} metrics have data · ${n.postsInPayload} post(s) in payload`);
    line(`    ${f(n.posts)} | ${f(n.seen)} | ${f(n.engaged)} | ${f(n.followers)} | ${f(n.clicks)}`);
    if (e.partialErrors?.length) line(`    partialErrors: ${e.partialErrors.map((x) => `${x.fields || x.metric || x.code || 'group'}: ${String(x.message || '').slice(0, 70)}`).join(' ; ').slice(0, 300)}`);
    if (e.notice) line(`    notice: ${String(e.notice).slice(0, 160)}`);
    for (const aud of AUDIENCES) {
      const dg = d.diagnosis?.[aud]?.[p.key];
      if (!dg) continue;
      line(`    [${aud}] ${dg.stage} · fit ${dg.audienceFit?.fit}`);
      line(`      ${String(dg.headline || '').slice(0, 220)}`);
      line(`      funnel: ${dg.funnel.map((s) => `${s.label}=${s.display}`).join(' → ')}`);
      if (dg.zeros?.length) line(`      zeros (${dg.zeros.length}): ${dg.zeros.slice(0, 6).map((z) => `${z.label}[${z.reason}]`).join(', ')}`);
      if (dg.benchmark) line(`      benchmark: yours ${dg.benchmark.yours === null ? '—' : dg.benchmark.yours + '%'} · typical ${dg.benchmark.typical}`);
      if (dg.actions?.length) line(`      do next: ${dg.actions[0].title}`);
    }
  }
  if (d.combined?.focus?.length) {
    line('');
    line(`where to focus (${d.combined.audience || 'institutions'})`);
    d.combined.focus.forEach((row, i) => line(`  ${i + 1}. ${String(row.platform).padEnd(15)} ${String(row.stage).padEnd(20)} score ${row.score} · ${String(row.firstAction || '').slice(0, 60)}`));
  }
  for (const probe of Object.values(d.probes || {})) {
    line('');
    line(`${probe.platform} probe (from the raw upstream body)`);
    line(`  account connected: ${probe.accountConnected} · analytics access: ${probe.hasAnalyticsAccess} · posts upstream: ${probe.postsUpstream} · with metrics: ${postsWithAnyMetricOf(probe)} · impressions: ${probe.impressionsUpstream} · newest: ${probe.newestPostAgeHours ?? '?'} h old`);
    line(`  verdict: ${probe.verdict}`);
  }
  if (d.raw) {
    for (const [group, dump] of Object.entries(d.raw)) {
      if (!dump || typeof dump !== 'object') continue;
      const calls = dump.calls || {};
      const names = Object.keys(calls);
      if (!names.length && !dump.summary && !dump.step1) continue;
      line('');
      line(`raw ${group}: ${dump.summary || ''}`);
      if (dump.step1) line(`  youtube step1 token: ${dump.step1.tokenOk ? 'ok' : 'FAILED'} · scope: ${dump.step1.scope || dump.step1.error || '—'}`);
      if (dump.step2) line(`  youtube step2 data api: ${dump.step2.ok ? `ok (${dump.step2.channel || 'channel'}) subs=${dump.step2.statistics?.subscriberCount ?? '—'}` : `refused — ${String(dump.step2.error || '').slice(0, 120)}`}`);
      if (dump.step3) line(`  youtube step3 analytics: ${dump.step3.ok ? `ok, ${dump.step3.rows} rows` : `refused — ${String(dump.step3.error || '').slice(0, 120)}`}`);
      for (const n of names) {
        const c = calls[n];
        line(`  ${c.ok ? 'ok  ' : 'FAIL'} ${String(n).slice(0, 62).padEnd(62)} ${c.status ? `HTTP ${c.status} ` : ''}${c.ms ? `${c.ms}ms ` : ''}${c.ok ? '' : String(c.error || '').slice(0, 110)}`);
      }
    }
  }
  if (report.errors?.length) {
    line('');
    line('collector errors');
    for (const e of report.errors) line(`  ${e.section}: ${String(e.error).slice(0, 160)}${e.hint ? ` | ${String(e.hint).slice(0, 120)}` : ''}`);
  }
  if (report.meta.truncations?.length) {
    line('');
    line(`truncated for size (${report.meta.truncations.length}):`);
    for (const t of report.meta.truncations.slice(0, 20)) line(`  ${t}`);
  }
  line('');
  line('Everything above is redacted: credentials appear as set/length plus a 3-character prefix, never as values.');
  return L.join('\n');
}

function postsWithAnyMetricOf(probe) {
  return probe && Number.isFinite(probe.postsWithAnyMetric) ? probe.postsWithAnyMetric : 0;
}

r.get('/', async (req, res) => {
  const started = Date.now();
  // ?days= accepts 1–365. Anything absent, zero or nonsense falls back to the
  // 30-day default rather than to a 1-day window nobody asked for.
  const requestedDays = Number(req.query.days);
  const days = Math.min(Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 30, 365);
  const includeRaw = String(req.query.raw ?? 'true') !== 'false';
  const format = String(req.query.format || 'json').toLowerCase() === 'text' ? 'text' : 'json';
  const requested = String(req.query.sections || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sections = new Set(requested.length ? requested.filter((s) => ALL_SECTIONS.includes(s)) : ALL_SECTIONS);
  const win = windowFor(days);
  const query = { since: win.since, until: win.until };

  const out = { timings: {}, errors: [] };

  // Independent work runs in parallel: the report should cost roughly one
  // upstream round trip, not seven.
  const healthP = sections.has('health') ? section(out, 'health', () => buildHealth()) : null;
  const platformPs = sections.has('platforms')
    ? PLATFORMS.map(async (p) => {
        const t = Date.now();
        try {
          const payload = await p.fetch(query);
          return [p.key, { ok: true, ms: Date.now() - t, label: p.label, numbers: headlineNumbers(payload), partialErrors: payload?.partialErrors || [], notice: payload?.notice || null, payload }];
        } catch (e) {
          return [p.key, { ok: false, ms: Date.now() - t, label: p.label, error: e.message, hint: e.hint || null, code: e.code || null, status: e.response?.status || e.httpStatus || null }];
        }
      })
    : [];
  const rawPs = includeRaw
    ? {
        graph: sections.has('raw') ? section(out, 'raw.graph', () => graphRaw({ days })) : null,
        gsc: sections.has('raw') ? section(out, 'raw.gsc', () => gscRaw({ days })) : null,
        youtube: sections.has('raw') ? section(out, 'raw.youtube', () => youtubeRaw()) : null,
        // Pinterest pins can take weeks to report, so the raw window is wider.
        zernio: sections.has('raw') || sections.has('probes') ? section(out, 'raw.zernio', () => zernioRaw({ since: windowFor(Math.max(days, 90)).since, until: win.until })) : null,
      }
    : {};

  const [healthRes, platformRes, rawGraph, rawGsc, rawYoutube, rawZernio] = await Promise.all([
    healthP,
    Promise.all(platformPs),
    rawPs.graph,
    rawPs.gsc,
    rawPs.youtube,
    rawPs.zernio,
  ]);

  const platforms = {};
  for (const [key, entry] of platformRes || []) platforms[key] = entry;

  const data = {
    config: sections.has('config') ? configSnapshot() : null,
    health: healthRes || null,
    platforms,
    diagnosis: null,
    combined: null,
    probes: null,
    raw: includeRaw
      ? {
          graph: rawGraph || null,
          gsc: rawGsc || null,
          youtube: rawYoutube || null,
          zernio: rawZernio || null,
        }
      : null,
  };

  if (sections.has('diagnosis')) {
    data.diagnosis = {};
    for (const audience of AUDIENCES) {
      data.diagnosis[audience] = {};
      for (const p of PLATFORMS) {
        const entry = platforms[p.key];
        // A failed channel is still diagnosed: "unreachable" is the honest
        // answer, and it is the one that tells the user to fix the connection.
        const payload = entry?.ok ? entry.payload : { error: entry?.error || 'not requested', hint: entry?.hint || null, overview: {} };
        try {
          data.diagnosis[audience][p.key] = diagnose(p.key, payload, { audience });
        } catch (e) {
          out.errors.push({ section: `diagnosis.${audience}.${p.key}`, error: e.message });
        }
      }
    }
  }

  if (sections.has('combined')) {
    const diagnoses = PLATFORMS.map((p) => data.diagnosis?.institutions?.[p.key]).filter(Boolean);
    data.combined = {
      // /api/combined passes these same platform payloads through, so they are
      // not repeated here — only the cross-channel blocks are.
      note: 'The six payloads under data.platforms are exactly what /api/combined serves per channel; only the cross-channel blocks are added here.',
      audience: 'institutions',
      focus: diagnoses.length ? focusOrder(diagnoses, 'institutions') : [],
      focusForStudents: diagnoses.length
        ? focusOrder(PLATFORMS.map((p) => data.diagnosis?.students?.[p.key]).filter(Boolean), 'students')
        : [],
    };
  }

  if (sections.has('probes')) {
    data.probes = {
      pinterest: channelProbe(rawZernio, 'pinterest'),
      linkedin: channelProbe(rawZernio, 'linkedin'),
    };
  }

  // Nothing leaves this process unredacted.
  const { data: safe, truncations } = redactDeep(data, { maxItems: 60, maxString: 3000 });
  const json = JSON.stringify(safe);

  const meta = {
    generatedAt: new Date().toISOString(),
    version: config.VERSION,
    tookMs: Date.now() - started,
    window: win,
    days,
    sections: [...sections],
    raw: includeRaw,
    format,
    timings: out.timings,
    bytes: json.length,
    truncations,
    redacted: true,
    cacheBypassed: true,
  };

  if (format === 'text') {
    res.type('text/plain; charset=utf-8').send(renderText({ meta, data: safe, errors: out.errors }));
    return;
  }

  res.json({
    success: true,
    platform: 'report',
    meta,
    errors: out.errors,
    data: safe,
    notice:
      'Single-call diagnostic bundle: transformed payloads, the growth diagnosis for both audience targets, and (with ?raw=true) the verbatim upstream bodies. Credentials are redacted. Add ?format=text for a paste-able digest.',
  });
});

module.exports = r;
