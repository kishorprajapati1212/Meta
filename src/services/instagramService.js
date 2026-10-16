/**
 * instagramService.js — Instagram Business account insights (Graph API).
 *
 * v4.1: adds the IG identity block (handle, followers, media count, avatar),
 * an optional group for reach-adjacent metrics, and actionable error hints.
 */
const axios = require('axios');
const config = require('../config');
const { getAccountDetails } = require('./tokenService');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { transformMetrics, buildOverview, scalarOf } = require('../utils/transform');
const demo = require('../utils/demographics');
const { round } = require('../utils/metrics');

const GROUPS = [
  { id: 'g1', metric: 'reach,follower_count', period: 'day' },
  {
    id: 'g2',
    metric: 'profile_views,likes,comments,shares,saves,total_interactions',
    metric_type: 'total_value',
    period: 'day',
  },
  // Meta deprecates some of these per version — optional so they never blank
  // the platform when they 400.
  { id: 'g3', metric: 'website_clicks,email_clicks,get_direction_clicks,calls_clicks,text_message_clicks', metric_type: 'total_value', period: 'day', optional: true },
];

/**
 * Wire parameters for one metric group.
 *
 * `id` and `optional` are internal bookkeeping for error reporting and must
 * NEVER be sent to Graph. An extra `id` query parameter on
 * `/{INSTAGRAM_ID}/insights` makes Graph answer:
 *
 *   (#100) Invalid token: "17841432245164684". An ID has already been specified.
 *
 * …which failed every group and surfaced as IG_ALL_FAILED. The original
 * (working) implementation had no `id` key in GROUPS at all; this keeps the
 * key for diagnostics while building the request explicitly.
 */
function groupParams(g, since, until) {
  const p = {
    metric: g.metric,
    period: g.period,
    since,
    until,
    access_token: config.USER_ACCESS_TOKEN,
  };
  if (g.metric_type) p.metric_type = g.metric_type;
  return p;
}

async function fetchInsights(query) {
  if (!config.INSTAGRAM_ID) {
    throw Object.assign(new Error('INSTAGRAM_ID is not set in .env'), {
      code: 'IG_NOT_CONFIGURED',
      httpStatus: 500,
      hint: 'Find the id via GET /{page-id}?fields=instagram_business_account using your page token, then set INSTAGRAM_ID.',
    });
  }

  const { since, until } = parseDateRange(query);
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.INSTAGRAM_ID}/insights`;

  const [accountInfo, demographics, ...results] = await Promise.all([
    getAccountDetails().then((d) => d.instagram).catch((e) => ({ error: e.message })),
    fetchDemographics().catch((e) => ({ ...demo.empty('Instagram Graph API · audience insights', 'Demographics unavailable: ' + (e.message || e), ['age', 'gender', 'countries', 'cities', 'devices']), unit: 'count' })),
    ...GROUPS.map((g) =>
      axios
        .get(url, {
          params: groupParams(g, since, until),
          timeout: 30000,
        })
        .then((r) => ({ ok: true, group: g, raw: (r.data.data || []).map(normalise) }))
        .catch((e) => {
          const fbErr = e.response?.data?.error;
          return {
            ok: false,
            group: g,
            message: fbErr?.message || e.message,
            code: fbErr?.code || null,
            status: e.response?.status || null,
            hint:
              fbErr?.code === 190 || String(fbErr?.message || '').toLowerCase().includes('expired')
                ? 'ACCESS_TOKEN expired — regenerate it and restart the API.'
                : fbErr?.code === 10 || String(fbErr?.message || '').toLowerCase().includes('permission')
                ? 'Token needs instagram_basic + instagram_manage_insights, and INSTAGRAM_ID must be a Business/Creator account linked to the Page.'
                : null,
          };
        })
    ),
  ]);

  const raw = [];
  const errors = [];
  results.forEach((r) => {
    if (r.ok) raw.push(...r.raw);
    else errors.push({ group: r.group.id, metrics: r.group.metric, optional: Boolean(r.group.optional), message: r.message, code: r.code, hint: r.hint, status: r.status });
  });

  const hardFailures = errors.filter((e) => !e.optional);
  if (!raw.length) {
    const first = errors[0];
    throw Object.assign(new Error(first?.message || 'All Instagram metric groups failed'), {
      code: 'IG_ALL_FAILED',
      httpStatus: first?.status || 400,
      hint: first?.hint || 'Check ACCESS_TOKEN scopes and that INSTAGRAM_ID is a Business account.',
      details: errors,
    });
  }

  const compact = query.compact === 'true' || query.compact === '1';
  const { metrics, timeseries } = transformMetrics(raw, compact);
  const overview = buildOverview(metrics);

  const ig = accountInfo && !accountInfo.error ? accountInfo : null;
  if (ig) {
    overview.account = {
      name: ig.name,
      username: ig.username,
      picture: ig.picture,
      website: ig.website,
      followers: ig.followers ?? null,
      following: ig.following ?? null,
      mediaCount: ig.mediaCount ?? null,
      link: ig.username ? `https://instagram.com/${ig.username}` : null,
    };
    if (ig.followers != null && (!overview.followers || !overview.followers.total)) {
      overview.followers = {
        key: 'followers', id: 'follower_count', label: 'Followers', kind: 'gauge', unit: '',
        group: 'Audience', total: ig.followers, previous: null, trend: 0, hasData: ig.followers > 0,
        source: 'ig_profile',
      };
    }
  } else if (accountInfo?.error) {
    errors.push({ group: 'ig_profile', optional: true, message: accountInfo.error, hint: accountInfo.hint || null });
  }

  const interactions = overview.interactions?.total || 0;
  const reach = overview.reach?.total || 0;
  if (reach > 0) {
    overview.engagementRate = {
      key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement',
      total: round((interactions / reach) * 100, 2), previous: null, trend: 0, hasData: interactions > 0,
      derived: true, formula: 'Total interactions ÷ reach',
    };
  }

  return {
    platform: 'instagram',
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
    demographics,
    ...(errors.length ? { partialErrors: errors } : {}),
    ...(hardFailures.length
      ? { notice: `${hardFailures.length} metric group(s) unavailable: ${hardFailures.map((e) => e.metrics).join(' · ')}` }
      : {}),
  };
}

/**
 * IG total_value metrics return values as [{value}] instead of a scalar.
 */
function normalise(m) {
  const values = (m.values || []).map((v) => ({ end_time: v.end_time, value: scalarOf(m.name, v) }));
  return { ...m, values };
}

/**
 * fetchDemographics — Instagram audience composition (follower counts).
 * Meta only serves audience_* insights for Business/Creator accounts and only
 * with period=lifetime, so this never uses the date range.
 */
async function fetchDemographics() {
  const source = 'Instagram Graph API · audience insights';
  const missing = ['devices'];
  const blank = (note) => ({ ...demo.empty(source, note, [...missing, 'age', 'gender', 'countries', 'cities']), unit: 'count' });
  if (!config.INSTAGRAM_ID || !config.USER_ACCESS_TOKEN) {
    return blank('Instagram credentials are not configured.');
  }
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.INSTAGRAM_ID}/insights`;
  const get = (metric, dimensionKey) =>
    axios
      .get(url, { params: { metric, period: 'lifetime', access_token: config.USER_ACCESS_TOKEN }, timeout: 25000 })
      .then((r) => (r.data.data || []).flatMap((d) => demo.expandGraphValues(d.values, dimensionKey)))
      .catch(() => []);

  const [countryRows, cityRows, gaRows] = await Promise.all([
    get('audience_country', 'country'),
    get('audience_city', 'city'),
    get('audience_gender_age', 'gender'),
  ]);

  const countries = demo.withShare(
    countryRows.map((r) => ({ code: String(r.key).toUpperCase(), value: r.value })).sort((a, b) => b.value - a.value).slice(0, 40)
  );
  const cities = demo.withShare(
    cityRows.map((r) => ({ name: String(r.key), value: r.value })).sort((a, b) => b.value - a.value).slice(0, 20)
  );
  const ga = demo.splitAgeGender(gaRows.map((r) => ({ segment: String(r.key), value: r.value })));

  const available = Boolean(countries.length || cities.length || ga.age || ga.gender);
  return {
    available,
    source,
    unit: 'count',
    asOf: toDateStr(Math.floor(Date.now() / 1000)),
    note: available
      ? 'Instagram reports the composition of your current followers, not of the people reached in the selected range.'
      : 'Instagram only serves audience insights to Business/Creator accounts with at least 100 followers.',
    gender: ga.gender,
    age: ga.age,
    countries: countries.length ? countries : null,
    cities: cities.length ? cities : null,
    devices: null,
    missing,
  };
}

module.exports = { fetchInsights, fetchDemographics, GROUPS };
