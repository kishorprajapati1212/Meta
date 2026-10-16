/**
 * Meta Social & SEO Analytics API — v4.2.2
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
    },
    queryParams: {
      date_preset: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_365d'],
      customRange: '?since=YYYY-MM-DD&until=YYYY-MM-DD',
      compact: '?compact=true — drops all-zero days from timeseries (Meta/YouTube/GSC)',
      gscDimensions: '?dimensions=query|page|country|device (default: date)',
      gscCompare: '?compare=false — skip the previous-period trend window',
      zernioSync: '?sync=false — skip the external-post sync trigger',
    },
    responseShape: {
      envelope: '{ success, platform, meta, data, notice? }',
      overviewEntry: '{ key, label, kind, unit, group, total, previous, trend, average?, hasData }',
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
  console.log(`  Health:    http://localhost:${config.PORT}/api/health\n`);
});
