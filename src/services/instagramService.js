const axios = require('axios');
const config = require('../config');
const { parseDateRange, dateRangeMeta } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');

const METRIC_GROUPS = [
  { metric: 'reach,follower_count', period: 'day' },
  { metric: 'profile_views,likes,comments,shares,saves,total_interactions', metric_type: 'total_value', period: 'day' },
];

async function fetchInsights(query) {
  const { since, until } = parseDateRange(query);
  const baseUrl = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.INSTAGRAM_ID}/insights`;

  const results = await Promise.allSettled(
    METRIC_GROUPS.map(g => axios.get(baseUrl, { params: { ...g, since, until, access_token: config.USER_ACCESS_TOKEN } }))
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
    throw Object.assign(new Error('All Instagram metric groups failed'), { code: 'INSTAGRAM_ALL_FAILED', details: errors, httpStatus: 400 });
  }

  const { metrics, timeseries } = transformMetrics(raw);
  const overview = buildOverview(metrics);

  return {
    platform: 'instagram',
    meta: { dateRange: dateRangeMeta(since, until), metricCount: metrics.length, dataPoints: metrics.reduce((s, m) => s + m.values.length, 0) },
    overview, timeseries, metrics,
    ...(errors.length > 0 && { partialErrors: errors }),
  };
}

module.exports = { fetchInsights };
