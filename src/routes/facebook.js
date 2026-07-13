const { Router } = require('express');
const { fetchInsights } = require('../services/facebookService');
const { success, errorResponse } = require('../utils/response');
const router = Router();

router.get('/', async (req, res) => {
  try {
    const data = await fetchInsights(req.query);
    res.json(success({ platform: 'facebook', meta: data.meta, data }));
  } catch (err) { const e = errorResponse(err); res.status(e.httpStatus).json(e.body); }
});

module.exports = router;
