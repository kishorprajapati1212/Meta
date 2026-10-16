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
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const demo = require('../utils/demographics');
const { transformMetrics, buildOverview } = require('../utils/transform');
const { fetchMetricGroup, insightWindows } = require('../utils/graphInsights');
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

  const [accountInfo, demographics, ...results] = await Promise.all([
    getAccountDetails().then((d) => d.facebook).catch((e) => ({ error: e.message })),
    fetchDemographics().catch((e) => ({ ...demo.empty('Meta Graph API · page_fans demographics', 'Demographics unavailable: ' + (e.message || e), ['age', 'gender', 'countries', 'cities', 'devices']), unit: 'count' })),
    // Each group is requested in ≤30-day windows (Meta rejects longer ranges)
    // and, if Meta rejects the parameter set, metric by metric so one retired
    // metric cannot take the whole group down.
    ...GROUPS.map((g) =>
      fetchMetricGroup({
        metric: g.metric,
        since,
        until,
        platformLabel: 'this Facebook Page',
        requestOne: (metric, winSince, winUntil) =>
          axios
            .get(url, {
              params: { metric, period: g.period, since: winSince, until: winUntil, access_token: pt },
              timeout: 30000,
            })
            .then((r) => r.data.data || []),
      }).then((r) => ({ ...r, group: g }))
    ),
  ]);

  const raw = [];
  const errors = [];
  let windowsUsed = 1;
  let clamped = false;
  let recovered = 0;
  results.forEach((r) => {
    windowsUsed = Math.max(windowsUsed, r.windows || 1);
    clamped = clamped || Boolean(r.clamped);
    if (r.ok) {
      raw.push(...r.raw);
      if (r.recovered) recovered += 1;
      for (const d of r.dropped || []) {
        errors.push({
          group: r.group.id,
          metrics: d.metric,
          optional: true,
          recovered: true,
          message: `Meta no longer serves "${d.metric}" for this Page — skipped.`,
          detail: d.message,
          code: d.code,
          hint: null,
          status: null,
        });
      }
    } else {
      errors.push({
        group: r.group.id,
        metrics: r.group.metric,
        optional: Boolean(r.group.optional),
        message: r.message,
        code: r.code,
        hint: r.hint,
        status: r.status,
      });
    }
  });

  const hardFailures = errors.filter((e) => !e.optional);
  const pageProfile = accountInfo && !accountInfo.error ? accountInfo : null;
  const haveAnything = raw.length > 0 || Boolean(pageProfile) || demographics?.available === true;

  // Degrade, don't fail: as long as SOMETHING came back (metrics, the page
  // profile or demographics) the client gets a payload with a notice instead of
  // an error card that hides the numbers it does have.
  if (!haveAnything) {
    const first = errors[0];
    throw Object.assign(
      new Error(first?.message || 'All Facebook metric groups failed'),
      {
        code: 'FB_ALL_FAILED',
        httpStatus: first?.status || 400,
        hint: first?.hint || 'Check ACCESS_TOKEN and FACEBOOK_PAGE_ID in .env.',
        details: errors,
      }
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

  const noticeParts = [];
  if (hardFailures.length) {
    noticeParts.push(
      raw.length
        ? `${hardFailures.length} metric group(s) unavailable for this range: ${hardFailures.map((e) => e.metrics).join(' · ')}`
        : `No Page insights for this range (${hardFailures.map((e) => e.message).join(' · ')})`
    );
  }
  if (recovered) noticeParts.push(`${recovered} group(s) were retried metric by metric; retired metrics were skipped.`);
  if (clamped) {
    const days = Math.round((until - (insightWindows(since, until).clampedSince || since)) / 86400);
    noticeParts.push(`Meta serves Page insights 30 days at a time, so the most recent ${days} days of this range are shown.`);
  } else if (windowsUsed > 1) {
    noticeParts.push(`Range was fetched in ${windowsUsed} × ≤30-day windows (Meta's per-request limit).`);
  }
  const notice = noticeParts.join(' ');

  return {
    platform: 'facebook',
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'Meta Graph API',
      metricCount: metrics.length,
      dataPoints: metrics.reduce((s, m) => s + m.values.length, 0),
      account: overview.account || null,
      requestedGroups: GROUPS.map((g) => g.metric),
      windows: windowsUsed,
      clampedToRecent: clamped,
      recoveredGroups: recovered,
    },
    overview,
    timeseries,
    metrics,
    demographics,
    ...(errors.length ? { partialErrors: errors } : {}),
    ...(notice ? { notice } : {}),
  };
}

/**
 * fetchDemographics — Page fan composition (counts). Meta has deprecated much
 * of the fan-demographics surface across Graph versions, so every call here is
 * optional: whatever survives comes back, the rest is reported in `missing`.
 */
async function fetchDemographics() {
  const source = 'Meta Graph API · page_fans demographics';
  const missing = ['devices', 'cities'];
  const blank = (note, extra = []) => ({ ...demo.empty(source, note, [...missing, ...extra]), unit: 'count' });
  if (!config.FACEBOOK_PAGE_ID) return blank('FACEBOOK_PAGE_ID is not set.');
  let pt;
  try {
    pt = await getPageAccessToken();
  } catch (e) {
    return blank('Page token unavailable: ' + (e.message || e));
  }
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${config.FACEBOOK_PAGE_ID}/insights`;
  const get = (metric, dimensionKey) =>
    axios
      .get(url, { params: { metric, period: 'lifetime', access_token: pt }, timeout: 25000 })
      .then((r) => (r.data.data || []).flatMap((d) => demo.expandGraphValues(d.values, dimensionKey)))
      .catch(() => []);

  const [countryRows, gaRows] = await Promise.all([get('page_fans_country', 'country'), get('page_fans_gender_age', 'gender')]);
  const countries = demo.withShare(
    countryRows.map((r) => ({ code: String(r.key).toUpperCase(), value: r.value })).sort((a, b) => b.value - a.value).slice(0, 40)
  );
  const ga = demo.splitAgeGender(gaRows.map((r) => ({ segment: String(r.key), value: r.value })));
  const available = Boolean(countries.length || ga.age || ga.gender);
  const gaps = [...(ga.age || ga.gender ? [] : ['age', 'gender']), ...(countries.length ? [] : ['countries'])];
  return {
    available,
    source,
    unit: 'count',
    asOf: toDateStr(Math.floor(Date.now() / 1000)),
    note: available
      ? 'Facebook reports the composition of current Page fans. Meta has retired parts of this surface on newer Graph versions, so some dimensions may be absent.'
      : 'Meta no longer returns Page fan demographics for this Graph version or token scope.',
    gender: ga.gender,
    age: ga.age,
    countries: countries.length ? countries : null,
    cities: null,
    devices: null,
    missing: [...missing, ...gaps],
  };
}

module.exports = { fetchInsights, fetchDemographics, GROUPS };
