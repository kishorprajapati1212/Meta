const { Router } = require('express');
const { fetchInsights } = require('../services/instagramService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const { fetchWithFallback } = require('../utils/resilience');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const { value: d } = await fetchWithFallback('instagram', () => fetchInsights(req.query), req.query);
    res.json(platformEnvelope('instagram', d));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;