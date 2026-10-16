/**
 * GET /api/combined — every platform in one call.
 *
 * v4.1: the previous version stripped LinkedIn/Pinterest down to
 * `{overview, timeseries, postCount, latestPosts(3)}` and threw away `meta`,
 * so the dashboard never saw the Pinterest account (pins / boards / monthly
 * views) or the full post list. It now passes the complete payload through and
 * adds a cross-platform `summary` block for the Overview page.
 */
const { Router } = require('express');
const { success, errorResponse } = require('../utils/response');
const { round } = require('../utils/metrics');

const r = Router();

const KEYS_META = ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole'];

/** Everything a single-platform service returns, minus the wrapper. */
function passthrough(v) {
  if (!v || v._err) return null;
  const out = {
    meta: v.meta || {},
    overview: v.overview || {},
    timeseries: v.timeseries || [],
  };
  if (v.metrics) out.metrics = v.metrics;
  if (v.topItems) out.topItems = v.topItems;
  // Zernio (LinkedIn / Pinterest) extras
  if (v.posts) out.posts = v.posts;
  if (v.topPosts) out.topPosts = v.topPosts;
  if (v.totals) out.totals = v.totals;
  if (v.avgEngagementRate !== undefined) out.avgEngagementRate = v.avgEngagementRate;
  if (v.platformBreakdown) out.platformBreakdown = v.platformBreakdown;
  if (v.followerTimeseries) out.followerTimeseries = v.followerTimeseries;
  if (v.demographics) out.demographics = v.demographics;
  if (v.notice) out.notice = v.notice;
  if (v.partialErrors) out.partialErrors = v.partialErrors;
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function total(overview, key) {
  return num(overview?.[key]?.total);
}

/** Cross-platform headline numbers for the Overview page. */
function buildSummary(data) {
  const rows = KEYS_META.map((k) => {
    const p = data[k] || {};
    const o = p.overview || {};
    const audience =
      total(o, 'followers') ||
      num(o?.channel?.lifetime?.subscribers) ||
      0;
    return {
      platform: k,
      ok: !p.error,
      error: p.error || null,
      audience,
      impressions: total(o, 'impressions'),
      reach: total(o, 'reach'),
      views: total(o, 'views') || total(o, 'contentViews') || total(o, 'pageViews'),
      engagement:
        total(o, 'engagement') || total(o, 'interactions') ||
        total(o, 'likes') + total(o, 'comments') + total(o, 'shares') + total(o, 'saves'),
      clicks: total(o, 'clicks'),
      posts: num(p.meta?.postCount) || total(o, 'posts') || 0,
      engagementRate: total(o, 'engagementRate'),
      trend: total(o, 'followers') ? num(o.followers.trend) : 0,
      lifetime: o?.channel?.lifetime || null,
      account: p.meta?.account || null,
      dateRange: p.meta?.dateRange || null,
      hasData: Boolean(Object.values(o).some((v) => v && v.hasData)),
    };
  });

  const live = rows.filter((x) => x.ok);
  const agg = (fn) => live.reduce((s, x) => s + fn(x), 0);

  const totalAudience = agg((x) => x.audience);
  const totalImpressions = agg((x) => Math.max(x.impressions, x.reach));
  const totalEngagement = agg((x) => x.engagement);
  const totalClicks = agg((x) => x.clicks) + total((data.searchConsole || {}).overview, 'clicks');
  const totalPosts = agg((x) => x.posts);

  const byReach = [...live].sort(
    (a, b) => Math.max(b.impressions, b.reach, b.views) - Math.max(a.impressions, a.reach, a.views)
  );

  return {
    generatedAt: new Date().toISOString(),
    platforms: rows,
    totals: {
      audience: totalAudience,
      impressions: totalImpressions,
      engagement: totalEngagement,
      clicks: totalClicks,
      posts: totalPosts,
      engagementRate: totalImpressions > 0 ? round((totalEngagement / totalImpressions) * 100, 2) : 0,
      searchClicks: total((data.searchConsole || {}).overview, 'clicks'),
      searchImpressions: total((data.searchConsole || {}).overview, 'impressions'),
      searchCtr: total((data.searchConsole || {}).overview, 'ctr'),
      searchPosition: total((data.searchConsole || {}).overview, 'position'),
    },
    connected: live.length,
    failed: rows.filter((x) => !x.ok).map((x) => x.platform),
    topReachPlatform: byReach[0]?.platform || null,
  };
}

r.get('/', async (req, res) => {
  try {
    const q = req.query;
    const jobs = {
      facebook: require('../services/facebookService').fetchInsights(q).catch((e) => ({ _err: e })),
      instagram: require('../services/instagramService').fetchInsights(q).catch((e) => ({ _err: e })),
      youtube: require('../services/youtubeService').fetchInsights(q).catch((e) => ({ _err: e })),
      linkedin: require('../services/zernioService').fetchLinkedIn(q).catch((e) => ({ _err: e })),
      pinterest: require('../services/zernioService').fetchPinterest(q).catch((e) => ({ _err: e })),
      searchConsole: require('../services/gscService').fetchInsights(q).catch((e) => ({ _err: e })),
    };
    const settled = await Promise.all(Object.values(jobs));
    const keys = Object.keys(jobs);
    const data = {};
    keys.forEach((k, i) => {
      const v = settled[i];
      if (v && v._err) {
        const e = v._err;
        data[k] = {
          error: e.hint ? `${e.message} — ${e.hint}` : e.message,
          errorCode: e.code || (e.response?.status ? 'HTTP_' + e.response.status : 'UNKNOWN'),
          httpStatus: e.httpStatus || e.response?.status || null,
          hint: e.hint || null,
          overview: {},
          timeseries: [],
        };
      } else {
        data[k] = passthrough(v) || { error: 'No data returned', overview: {}, timeseries: [] };
      }
    });

    res.json(
      success({
        platform: 'combined',
        meta: {
          generatedAt: new Date().toISOString(),
          dateRange: data.facebook?.meta?.dateRange || data.youtube?.meta?.dateRange || data.searchConsole?.meta?.dateRange || null,
          query: q,
        },
        data: { ...data, summary: buildSummary(data) },
      })
    );
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
