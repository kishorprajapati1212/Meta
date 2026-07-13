// ================================================================
//  Meta & YouTube Analytics API  v2.1
//  Facebook Page | Instagram Business | YouTube Channel
//
//  Response shape:
//    Success: { success: true, platform, meta, data: { overview, timeseries, metrics } }
//    Error:   { success: false, error: { code, message, details } }
// ================================================================

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorResponse } = require('./utils/response');

const app = express();
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: 'Meta & YouTube Analytics API',
    version: '2.1.0',
    platforms: ['facebook', 'instagram', 'youtube'],
    endpoints: {
      facebook:  'GET /api/facebook?date_preset=last_30d',
      instagram: 'GET /api/instagram?date_preset=last_30d',
      youtube:   'GET /api/youtube?date_preset=last_30d',
      combined:  'GET /api/combined?date_preset=last_30d',
      health:    'GET /api/health',
      ytDebug:   'GET /api/youtube/debug',
    },
    datePresets: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d'],
    customRange: '?since=YYYY-MM-DD&until=YYYY-MM-DD',
  });
});

app.use('/api/facebook',  require('./routes/facebook'));
app.use('/api/instagram', require('./routes/instagram'));
app.use('/api/youtube',   require('./routes/youtube'));
app.use('/api/combined',  require('./routes/combined'));
app.use('/api/health',    require('./routes/health'));

app.use((_req, res) => {
  const e = errorResponse(Object.assign(new Error('Endpoint not found'), { code: 'NOT_FOUND', httpStatus: 404 }));
  res.status(e.httpStatus).json(e.body);
});

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  Meta & YouTube Analytics API  v2.1     ║`);
  console.log(`  ║  http://0.0.0.0:${config.PORT}                    ║`);
  console.log(`  ╠══════════════════════════════════════════╣`);
  console.log(`  ║  GET /api/facebook   — Page Insights    ║`);
  console.log(`  ║  GET /api/instagram  — IG Business      ║`);
  console.log(`  ║  GET /api/youtube    — YT Analytics     ║`);
  console.log(`  ║  GET /api/youtube/debug — Diagnostics   ║`);
  console.log(`  ║  GET /api/combined   — All 3 platforms  ║`);
  console.log(`  ║  GET /api/health     — Token check      ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
