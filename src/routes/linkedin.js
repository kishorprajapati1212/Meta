const { Router } = require('express');
const { fetchLinkedIn } = require('../services/zernioService');
const { platformEnvelope, errorResponse } = require('../utils/response');
const r = Router();

r.get('/', async (req, res) => {
  try {
    const d = await fetchLinkedIn(req.query);
    res.json(platformEnvelope('linkedin', d));
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
