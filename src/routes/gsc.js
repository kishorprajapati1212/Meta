const { Router } = require('express');
const { fetchInsights } = require('../services/gscService');
const { success, errorResponse } = require('../utils/response');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const d = await fetchInsights(req.query);
    res.json(success({ platform: 'gsc', meta: d.meta, data: { overview: d.overview, timeseries: d.timeseries, metrics: d.metrics, ...(d.topItems && { topItems: d.topItems }) }, notice: d.notice || undefined }));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;