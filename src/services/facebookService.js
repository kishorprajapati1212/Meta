const axios = require('axios'); const config = require('../config');
const { getPageAccessToken } = require('./tokenService');
const { parseDateRange, dateRangeMeta } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');

const GROUPS = ['page_views_total,page_follows,page_post_engagements', 'page_media_view,page_total_media_view_unique', 'page_daily_follows,page_daily_follows_unique,page_daily_unfollows_unique'];

async function fetchInsights(query) {
  const pt = await getPageAccessToken();
  const { since, until } = parseDateRange(query);
  const url = config.FB_API_BASE + '/' + config.FB_API_VERSION + '/' + config.FACEBOOK_PAGE_ID + '/insights';
  const results = await Promise.allSettled(GROUPS.map(m => axios.get(url, { params: { metric: m, period: 'day', since, until, access_token: pt } })));
  const raw = []; const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') raw.push(...(r.value.data.data || []));
    else errors.push({ group: 'g' + (i + 1), message: r.reason.response?.data?.error?.message || r.reason.message });
  });
  if (!raw.length) throw Object.assign(new Error('All Facebook groups failed'), { code: 'FB_ALL_FAILED', details: errors, httpStatus: 400 });
  const compact = query.compact === 'true' || query.compact === '1';
  const { metrics, timeseries } = transformMetrics(raw, compact);
  const overview = buildOverview(metrics);
  return { platform: 'facebook', meta: { dateRange: dateRangeMeta(since, until), metricCount: metrics.length, dataPoints: metrics.reduce((s, m) => s + m.values.length, 0) }, overview, timeseries, metrics, ...(errors.length ? { partialErrors: errors } : {}) };
}
module.exports = { fetchInsights };
