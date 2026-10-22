const { Router } = require('express');
const { fetchInsights, debugYouTube } = require('../services/youtubeService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const { fetchWithFallback } = require('../utils/resilience');
const r = Router();
r.get('/', async (req, res) => {
  try { const { value: d } = await fetchWithFallback('youtube', () => fetchInsights(req.query), req.query); res.json(platformEnvelope('youtube', d, null, { audience: req.query.audience })); }
  catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
r.get('/debug', async (_req, res) => {
  // The probe lives in the service so GET /api/report can reuse it verbatim.
  const { rep, complete } = await debugYouTube();
  res.json(complete ? { success: true, platform: 'youtube/debug', data: rep } : { success: true, data: rep });
});
module.exports = r;