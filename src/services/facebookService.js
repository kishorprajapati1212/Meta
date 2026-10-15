/**
 * facebookService.js — Facebook Page Insights (Graph API).
 *
 * v4.1: adds page identity (name / followers / picture) so the dashboard can
 * render a proper channel header, adds an optional gauge group (page_fans,
 * page_impressions) and turns raw axios failures into messages with hints.
 */
const axios = require('axios');
const config = require('../config');
const { getPageAccessToken, getAccountDetails } = require('./tokenService');
const { parseDateRange, dateRangeMeta } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');
const { round } = require('../utils/metrics');

const GROUPS = [
  { id: 'g1', metric: 'page_views_total,page_follows,page_post_engagements', period: 'day' },
  { id: 'g2', metric: 'page_media_view,page_total_media_view_unique', period: 'day' },
  { id: 'g3', metric: 'page_daily_follows,page_daily_follows_unique,page_daily_unfollows_unique', period: 'day' },
  // Gauges + reach. Meta periodically deprecates these — they are optional so a
  // failure here never blanks the whole platform.
  { id: 'g4', metric: 'page_fans,page_impressions,page_impressions_unique,page_video_views', period: 'day', optional: true },
];

async function fetchInsights(query) {
  const pt = await getPageAccessToken();
  const { since, until } = parseDateRange(query);
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.FACEBOOK_PAGE_ID}/insights`;

  const [accountInfo, ...results] = await Promise.all([
    getAccountDetails().then((d) => d.facebook).catch((e) => ({ error: e.message })),
    ...GROUPS.map((g) =>
      axios
        .get(url, {
          params: { metric: g.metric, period: g.period, since, until, access_token: pt },
          timeout: 30000,
        })
        .then((r) => ({ ok: true, group: g, raw: r.data.data || [] }))
        .catch((e) => ({
          ok: false,
          group: g,
          message: e.response?.data?.error?.message || e.message,
          hint: e.response?.data?.error?.code === 190 ? 'Token expired — regenerate ACCESS_TOKEN.' : null,
          status: e.response?.status || null,
        }))
    ),
  ]);

  const raw = [];
  const errors = [];
  results.forEach((r) => {
    if (r.ok) raw.push(...r.raw);
    else errors.push({ group: r.group.id, metrics: r.group.metric, optional: Boolean(r.group.optional), message: r.message, hint: r.hint, status: r.status });
  });

  const hardFailures = errors.filter((e) => !e.optional);
  if (!raw.length) {
    const first = errors[0];
    throw Object.assign(
      new Error(first?.message || 'All Facebook metric groups failed'),
      { code: 'FB_ALL_FAILED', httpStatus: first?.status || 400, hint: first?.hint || 'Check ACCESS_TOKEN, FACEBOOK_PAGE_ID and the pages_read_engagement permission.', details: errors }
    );
  }

  const compact = query.compact === 'true' || query.compact === '1';
  const { metrics, timeseries } = transformMetrics(raw, compact);
  const overview = buildOverview(metrics);

  // Merge page identity — gives a real audience gauge even when page_fans is
  // unavailable on the current Graph API version.
  const page = accountInfo && !accountInfo.error ? accountInfo : null;
  if (page) {
    overview.account = {
      name: page.name,
      username: page.username,
      picture: page.picture,
      link: page.link,
      category: page.category,
      followers: page.followers ?? null,
      likes: page.likes ?? null,
    };
    const gauge = page.followers ?? page.likes ?? null;
    if (gauge !== null && !overview.followers) {
      overview.followers = {
        key: 'followers', id: 'page_fans', label: 'Page followers', kind: 'gauge', unit: '',
        group: 'Audience', total: gauge, previous: null, trend: 0, hasData: gauge > 0,
        source: 'page_profile',
      };
    }
  } else if (accountInfo?.error) {
    errors.push({ group: 'page_profile', optional: true, message: accountInfo.error, hint: accountInfo.hint || null });
  }

  // Derived engagement rate for the card grid.
  const eng = overview.engagement?.total || 0;
  const reach = overview.reach?.total || overview.impressions?.total || 0;
  if (reach > 0) {
    overview.engagementRate = {
      key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement',
      total: round((eng / reach) * 100, 2), previous: null, trend: 0, hasData: eng > 0, derived: true,
      formula: 'Post engagements ÷ reach',
    };
  }

  return {
    platform: 'facebook',
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'Meta Graph API',
      metricCount: metrics.length,
      dataPoints: metrics.reduce((s, m) => s + m.values.length, 0),
      account: overview.account || null,
      requestedGroups: GROUPS.map((g) => g.metric),
    },
    overview,
    timeseries,
    metrics,
    ...(errors.length ? { partialErrors: errors } : {}),
    ...(hardFailures.length ? { notice: `${hardFailures.length} metric group(s) unavailable: ${hardFailures.map((e) => e.metrics).join(' · ')}` } : {}),
  };
}

module.exports = { fetchInsights, GROUPS };
