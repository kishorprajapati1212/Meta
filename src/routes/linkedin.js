const { Router } = require('express');
const { fetchLinkedIn } = require('../services/zernioService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const { fetchWithFallback } = require('../utils/resilience');
const r = Router();

r.get('/', async (req, res) => {
  try {
    const { value: d } = await fetchWithFallback('linkedin', () => fetchLinkedIn(req.query), req.query);
    res.json(platformEnvelope('linkedin', d));
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
