const { Router } = require('express');
const { fetchInsights } = require('../services/facebookService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const d = await fetchInsights(req.query);
    res.json(platformEnvelope('facebook', d));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;