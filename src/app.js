/**
 * Meta Social & SEO Analytics API — v4.3.5
 *
 * Serves the JSON API for 6 platforms and (if it has been built) the Pulse
 * dashboard from the same origin, so the frontend can call `/api/...` with no
 * CORS or env plumbing in production.
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const app = express();
app.set('json spaces', 2);
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(express.json());

const VERSION = config.VERSION;

app.get('/api', (_req, res) => {
  res.json({
    name: 'Meta Social & SEO Analytics API',
    version: VERSION,
    platforms: ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole'],
    docs: '/docs.html',
    dashboard: '/app',
    endpoints: {
      facebook: 'GET /api/facebook?date_preset=last_30d&compact=true',
      instagram: 'GET /api/instagram?date_preset=last_30d&compact=true',
      youtube: 'GET /api/youtube?date_preset=last_30d&compact=true',
      linkedin: 'GET /api/linkedin?date_preset=last_30d&compact=true',
      pinterest: 'GET /api/pinterest?date_preset=last_30d&compact=true',
      searchConsole: 'GET /api/gsc?date_preset=last_30d&compact=true',
      combined: 'GET /api/combined?date_preset=last_30d&compact=true',
      health: 'GET /api/health',
      zernioDebug: 'GET /api/zernio/debug',
      zernioAccounts: 'GET /api/zernio/accounts',
      ytDebug: 'GET /api/youtube/debug',
      report: 'GET /api/report — EVERY diagnostic in one call (payloads + diagnosis + verbatim upstream bodies, redacted). ?format=text for a paste-able digest',
    },
    queryParams: {
      date_preset: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_365d'],
      customRange: '?since=YYYY-MM-DD&until=YYYY-MM-DD',
      compact: '?compact=true — drops all-zero days from timeseries (Meta/YouTube/GSC)',
      gscDimensions: '?dimensions=query|page|country|device (default: date)',
      gscCompare: '?compare=false — skip the previous-period trend window',
      zernioSync: '?sync=false — skip the external-post sync trigger',
      audience: '?audience=institutions|students — who the content targets (growth diagnosis + ranking)',
      report: '/api/report?days=30&raw=true|false&format=json|text&sections=config,health,platforms,diagnosis,combined,raw,probes',
    },
    responseShape: {
      envelope: '{ success, platform, meta, data, notice? }',
      overviewEntry:
        '{ key, label, kind, unit, group, total, previous, trend|null, trendBasis|null, average?, hasData }',
      trendRule:
        'trend is null unless a real baseline exists (>=10 for counts/sums/levels/averages); trendBasis names what is compared',
      kinds: {
        sum: 'additive counter — total is the sum of the range',
        gauge: 'point-in-time level — total is the LAST value (followers, pins, boards)',
        rate: 'percentage — total is a mean, never a sum (ctr, engagementRate)',
        avg: 'mean of daily averages (avg view duration, GSC position)',
        duration: 'time quantity with a unit (watch time in minutes)',
        count: 'number of things (posts published)',
      },
    },
  });
});

app.use('/api/facebook', require('./routes/facebook'));
app.use('/api/instagram', require('./routes/instagram'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/linkedin', require('./routes/linkedin'));
app.use('/api/pinterest', require('./routes/pinterest'));
app.use('/api/gsc', require('./routes/gsc'));
app.use('/api/combined', require('./routes/combined'));
app.use('/api/health', require('./routes/health'));
app.use('/api/zernio', require('./routes/zernio'));
app.use('/api/report', require('./routes/report'));

// ── Static: API docs + the built dashboard ───────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

const DIST = path.join(__dirname, '..', 'Pulse', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use('/app', express.static(DIST));
  // SPA fallback so deep links like /app/pinterest work.
  app.get(['/app', '/app/*'], (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'See GET /api for the endpoint list' } });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'See /api for endpoints' } });
});

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`\n  Meta Social & SEO Analytics API v${VERSION}`);
  console.log('  6 platforms: facebook | instagram | youtube | linkedin | pinterest | searchConsole');
  console.log(`  Docs:      http://localhost:${config.PORT}/docs.html`);
  console.log(`  Dashboard: http://localhost:${config.PORT}/app ${fs.existsSync(path.join(DIST, 'index.html')) ? '' : '(run: cd Pulse && npm run build)'}`);
  console.log(`  Health:    http://localhost:${config.PORT}/api/health`);

  // Free-tier hosts (Render, Railway, Fly) sleep after ~15 idle minutes. The
  // first request after that is a cold start which routinely outlasts the
  // browser/proxy timeout and surfaces as "Service not available" — the exact
  // symptom that made this dashboard look broken "over time". Pinging our own
  // health endpoint keeps the process warm. Render injects RENDER_EXTERNAL_URL;
  // without it we ping localhost, which still keeps a local proxy warm.
  if (typeof fetch === 'function') {
    const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || `http://127.0.0.1:${config.PORT}`;
    const ping = () => {
      fetch(`${publicUrl}/api/health`, { signal: AbortSignal.timeout(20000) }).catch(() => {});
    };
    // Warm the last-good cache once at boot: the first visitor gets numbers
    // immediately, and there is a fallback ready if an upstream flakes later.
    const warm = setTimeout(() => {
      fetch(`${publicUrl}/api/combined?date_preset=last_30d&compact=true`, { signal: AbortSignal.timeout(120000) }).catch(() => {});
    }, 2500);
    if (typeof warm.unref === 'function') warm.unref();

    const timer = setInterval(ping, 10 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    console.log(`  Keep-alive: GET ${publicUrl}/api/health every 10 min (keeps free-tier hosts awake)`);
  }
  console.log('');
});
