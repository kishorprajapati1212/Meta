const { Router } = require('express');
const { success, errorResponse } = require('../utils/response');
const r = Router();
r.get('/', async (req, res) => {
  try {
    const fb = require('../services/facebookService').fetchInsights(req.query).catch(e => ({ _err: e.message }));
    const ig = require('../services/instagramService').fetchInsights(req.query).catch(e => ({ _err: e.message }));
    const yt = require('../services/youtubeService').fetchInsights(req.query).catch(e => ({ _err: e.message }));
    const li = require('../services/zernioService').fetchLinkedIn(req.query).catch(e => ({ _err: e.message }));
    const pi = require('../services/zernioService').fetchPinterest(req.query).catch(e => ({ _err: e.message }));
    const gsc = require('../services/gscService').fetchInsights(req.query).catch(e => ({ _err: e.message }));
    const [facebook, instagram, youtube, linkedin, pinterest, searchConsole] = await Promise.all([fb, ig, yt, li, pi, gsc]);
    const out = {};
    for (const [k, v] of Object.entries({ facebook, instagram, youtube, linkedin, pinterest, searchConsole })) {
      if (v._err) { out[k] = { error: v._err }; continue; }
      out[k] = { overview: v.overview || {}, timeseries: v.timeseries || [], ...(v.metrics && { metrics: v.metrics }), ...(v.topPosts && { topPosts: v.topPosts }), ...(v.topItems && { topItems: v.topItems }), ...(v.posts && { postCount: v.posts.length, latestPosts: v.posts.slice(0, 3) }), ...(v.notice && { notice: v.notice }) };
    }
    res.json(success({ platform: 'combined', meta: {}, data: out }));
  } catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
module.exports = r;