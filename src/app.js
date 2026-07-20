const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorResponse } = require('./utils/response');
const app = express();
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json());
app.use(express.static('public'));

app.get('/api', (_req, res) => {
  res.json({
    name: 'Meta Social & SEO Analytics API', version: '4.0.0',
    platforms: ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole'],
    docs: '/docs.html',
    endpoints: {
      facebook: 'GET /api/facebook?date_preset=last_30d&compact=true',
      instagram: 'GET /api/instagram?date_preset=last_30d&compact=true',
      youtube: 'GET /api/youtube?date_preset=last_30d&compact=true',
      linkedin: 'GET /api/linkedin?date_preset=last_30d&compact=true',
      pinterest: 'GET /api/pinterest?date_preset=last_30d&compact=true',
      searchConsole: 'GET /api/gsc?date_preset=last_30d&compact=true',
      combined: 'GET /api/combined?date_preset=last_7d&compact=true',
      health: 'GET /api/health',
      ytDebug: 'GET /api/youtube/debug',
    },
    queryParams: {
      date_preset: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_365d'],
      customRange: '?since=YYYY-MM-DD&until=YYYY-MM-DD',
      compact: '?compact=true — removes zero-value days from timeseries',
      gscDimensions: '?dimensions=query,page — group by query/page/country/device (default: date)',
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

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'See /api for endpoints' } });
});

app.listen(config.PORT, '0.0.0.0', () => {
  console.log('\n  Meta Social & SEO Analytics API v4.0');
  console.log('  6 platforms: facebook | instagram | youtube | linkedin | pinterest | searchConsole');
  console.log('  Docs: http://0.0.0.0:' + config.PORT + '/docs.html\n');
});
