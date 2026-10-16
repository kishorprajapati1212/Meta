const { Router } = require('express');
const { fetchPinterest } = require('../services/zernioService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const { fetchWithFallback } = require('../utils/resilience');
const r = Router();

/**
 * v4.1: `meta.boards`, `meta.account.pinCount/boardCount/monthlyViews` and the
 * full `posts` array are now part of the payload — the dashboard renders pins,
 * boards and monthly views as first-class metrics instead of one "Posts" card.
 */
r.get('/', async (req, res) => {
  try {
    const { value: d } = await fetchWithFallback('pinterest', () => fetchPinterest(req.query), req.query);
    res.json(platformEnvelope('pinterest', d, { boards: (d.meta && d.meta.boards) || [] }));
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
