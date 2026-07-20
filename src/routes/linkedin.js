const { Router } = require('express');
const { fetchLinkedIn } = require('../services/zernioService');
const { success, errorResponse } = require('../utils/response');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const d = await fetchLinkedIn(req.query);
    res.json(success({ platform: 'linkedin', meta: d.meta, data: { overview: d.overview, timeseries: d.timeseries, topPosts: d.topPosts, posts: d.posts, totals: d.totals, avgEngagementRate: d.avgEngagementRate, platformBreakdown: d.platformBreakdown, followerTimeseries: d.followerTimeseries }, notice: d.notice || undefined }));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;