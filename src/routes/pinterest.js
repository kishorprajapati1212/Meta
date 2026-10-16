const { Router } = require('express');
const { fetchPinterest } = require('../services/zernioService');
const { success, errorResponse } = require('../utils/response');
const r = Router();

/**
 * v4.1: `meta.boards`, `meta.account.pinCount/boardCount/monthlyViews` and the
 * full `posts` array are now part of the payload — the dashboard renders pins,
 * boards and monthly views as first-class metrics instead of one "Posts" card.
 */
r.get('/', async (req, res) => {
  try {
    const d = await fetchPinterest(req.query);
    res.json(
      success({
        platform: 'pinterest',
        meta: d.meta,
        data: {
          overview: d.overview,
          timeseries: d.timeseries,
          topPosts: d.topPosts,
          posts: d.posts,
          totals: d.totals,
          avgEngagementRate: d.avgEngagementRate,
          platformBreakdown: d.platformBreakdown,
          followerTimeseries: d.followerTimeseries,
          boards: d.meta.boards || [],
          demographics: d.demographics,
        },
        notice: d.notice || undefined,
      })
    );
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
