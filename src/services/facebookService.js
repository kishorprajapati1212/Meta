const axios = require('axios');
const config = require('../config');
const { getPageAccessToken } = require('./tokenService');
const { parseDateRange, dateRangeMeta } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');

const METRIC_GROUPS = [
  'page_views_total,page_follows,page_post_engagements',
  'page_media_view,page_total_media_view_unique',
  'page_daily_follows,page_daily_follows_unique,page_daily_unfollows_unique',
];

async function fetchInsights(query) {
  const pageToken = await getPageAccessToken();
  const { since, until } = parseDateRange(query);
  const baseUrl = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.FACEBOOK_PAGE_ID}/insights`;

  const results = await Promise.allSettled(
    METRIC_GROUPS.map(metric =>
      axios.get(baseUrl, { params: { metric, period: 'day', since, until, access_token: pageToken } })
    )
  );

  const raw = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      raw.push(...(r.value.data.data || []));
    } else {
      errors.push({ group: `metric_group_${i + 1}`, message: r.reason.response?.data?.error?.message || r.reason.message });
    }
  });

  if (raw.length === 0) {
    throw Object.assign(new Error('All Facebook metric groups failed'), { code: 'FACEBOOK_ALL_FAILED', details: errors, httpStatus: 400 });
  }

  const { metrics, timeseries } = transformMetrics(raw);
  const overview = buildOverview(metrics);

  return {
    platform: 'facebook',
    meta: { dateRange: dateRangeMeta(since, until), metricCount: metrics.length, dataPoints: metrics.reduce((s, m) => s + m.values.length, 0) },
    overview, timeseries, metrics,
    ...(errors.length > 0 && { partialErrors: errors }),
  };
}

module.exports = { fetchInsights };
