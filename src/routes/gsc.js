const { Router } = require('express');
const { fetchInsights } = require('../services/gscService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const { fetchWithFallback } = require('../utils/resilience');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const { value: d } = await fetchWithFallback('searchConsole', () => fetchInsights(req.query), req.query);
    res.json(platformEnvelope('gsc', d));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;