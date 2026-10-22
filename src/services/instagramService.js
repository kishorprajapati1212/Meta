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
const { fetchMetricGroup, insightWindows } = require('../utils/graphInsights');
const { fetchIgMedia, backfillFromPosts } = require('../utils/metaPosts');
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
  // the platform when they 400. The retired contact-button metrics
  // (email_clicks, get_direction_clicks, calls_clicks, text_message_clicks) were
  // removed from the request: Meta lists the metrics an account supports in its
  // own (#100) error, and these are not among them for business accounts, so
  // asking for them only wasted a call per window and produced noise.
  { id: 'g3', metric: 'website_clicks,profile_links_taps,content_views,views', metric_type: 'total_value', period: 'day', optional: true },
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
/**
 * Meta serves Instagram interaction metrics (likes, comments, shares, saves,
 * total_interactions, profile_views, website_clicks …) as `total_value` metrics,
 * and which parameter combination an account accepts depends on the Graph
 * version and the account type. The dangerous part: Meta answers a combination
 * it does not like with an EMPTY 200 — no error, no rows — so the cards silently
 * read 0.
 *
 * Evidence, live capture 2026-10-21 (`/api/report`): `reach` came back with 30
 * daily values while every metric in g2/g3 came back with zero rows and nothing
 * was recorded as an error. Meta's own (#100) on the same account says those
 * metrics "should be specified with parameter metric_type=total_value".
 *
 * So every form is tried in turn, and only the metrics that came back empty are
 * re-asked in the next form. The happy path still costs exactly one call.
 */
const INSIGHT_VARIANTS = [
  { name: 'total_value+day', metric_type: 'total_value', period: 'day' },
  { name: 'total_value', metric_type: 'total_value', period: null },
  { name: 'day', metric_type: null, period: 'day' },
];

/** Query parameters for one metric group in one request form. */
function variantParams(g, variant, since, until, metricOverride) {
  const p = {
    metric: metricOverride || g.metric,
    since,
    until,
    access_token: config.USER_ACCESS_TOKEN,
  };
  const period = variant && 'period' in variant ? variant.period : g.period;
  const metricType = variant && 'metric_type' in variant ? variant.metric_type : g.metric_type;
  if (period) p.period = period;
  if (metricType) p.metric_type = metricType;
  return p;
}

/**
 * Fetch one group, trying each request form until every metric has answered.
 * Returns the same shape `fetchMetricGroup` does, plus `attempts` (what was
 * tried and what each form returned) and `unresolved` (metrics that came back
 * empty in every form) — both are reported, never swallowed.
 */
async function fetchGroupWithVariants({ group, since, until, url, platformLabel }) {
  const wanted = String(group.metric).split(',').map((m) => m.trim()).filter(Boolean);
  const variants = group.metric_type
    ? INSIGHT_VARIANTS
    : [{ name: `declared(${group.metric_type || 'no-type'}+${group.period || 'no-period'})`, metric_type: group.metric_type || null, period: group.period || null }];

  const collected = [];
  const attempts = [];
  let remaining = [...wanted];
  let windows = 1;
  let clamped = false;
  let clampedSince = null;
  let lastFailure = null;
  let recovered = false;

  for (const variant of variants) {
    if (!remaining.length) break;
    const res = await fetchMetricGroup({
      metric: remaining.join(','),
      since,
      until,
      platformLabel,
      requestOne: (metric, winSince, winUntil) =>
        axios
          .get(url, { params: variantParams(group, variant, winSince, winUntil, metric), timeout: 30000 })
          .then((r) => r.data.data || []),
    });
    const got = new Set((res.raw || []).map((r) => r && r.name).filter(Boolean));
    windows = Math.max(windows, res.windows || 1);
    clamped = clamped || Boolean(res.clamped);
    clampedSince = clampedSince || res.clampedSince || null;
    attempts.push({
      variant: variant.name,
      ok: Boolean(res.ok),
      requested: remaining.slice(),
      returned: got.size ? [...got] : [],
      ...(res.ok ? {} : { message: res.message || null, code: res.code ?? null, status: res.status ?? null }),
      ...(res.dropped && res.dropped.length ? { dropped: res.dropped } : {}),
    });
    if (res.ok) {
      collected.push(...(res.raw || []));
      // A metric Meta answered with zero rows is re-asked in the next form; that
      // is the whole point of this loop.
      if (got.size < remaining.length) recovered = true;
      remaining = remaining.filter((m) => !got.has(m));
      if (res.recovered) recovered = true;
    } else {
      lastFailure = res;
    }
  }

  return {
    ok: collected.length > 0 || (!lastFailure && remaining.length === 0),
    raw: collected,
    dropped: attempts.flatMap((a) => a.dropped || []),
    attempts,
    unresolved: remaining,
    recovered,
    windows,
    clamped,
    clampedSince,
    ...(lastFailure && !collected.length
      ? { message: lastFailure.message, code: lastFailure.code, hint: lastFailure.hint, status: lastFailure.status }
      : {}),
  };
}

function groupParams(g, since, until, metricOverride) {
  const p = {
    metric: metricOverride || g.metric,
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

  const [accountInfo, demographics, igMedia, ...results] = await Promise.all([
    getAccountDetails().then((d) => d.instagram).catch((e) => ({ error: e.message })),
    fetchDemographics().catch((e) => ({ ...demo.empty('Instagram Graph API · audience insights', 'Demographics unavailable: ' + (e.message || e), ['age', 'gender', 'countries', 'cities', 'devices']), unit: 'count' })),
    // Media list: fills the Content grid and supplies likes/comments/shares/saves
    // per post, which the account-level insights often leave empty. Optional.
    fetchIgMedia({ since, until }).catch((e) => ({ ok: false, posts: [], totals: null, errors: [{ endpoint: 'media', message: e.message }] })),
    // Meta rejects any Instagram insights window longer than 30 days
    // ("(#100) There cannot be more than 30 days (2592000 s) between since and
    // until"), so each group is fetched in ≤30-day windows and merged. If Meta
    // rejects the parameter set, the group is retried metric by metric and only
    // the retired metrics are dropped.
    ...GROUPS.map((g) =>
      fetchGroupWithVariants({
        group: g,
        since,
        until,
        url,
        platformLabel: 'this Instagram Business account',
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
      raw.push(...(r.raw || []).map(normalise));
      if (r.recovered) recovered += 1;
      for (const m of r.unresolved || []) {
        errors.push({
          group: r.group.id,
          metrics: m,
          optional: true,
          recovered: false,
          message: `Meta returned no rows for "${m}" in any request form (${(r.attempts || []).map((a) => a.variant).join(', ')}), so this card has no value.`,
          detail:
            (r.attempts || [])
              .filter((a) => !a.ok)
              .map((a) => `${a.variant}: ${a.message || 'no rows'}`)
              .join(' | ') || null,
          code: null,
          hint: null,
          status: null,
        });
      }
      for (const d of r.dropped || []) {
        errors.push({
          group: r.group.id,
          metrics: d.metric,
          optional: true,
          recovered: true,
          message: `Meta no longer serves "${d.metric}" for this account — skipped.`,
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
  const igProfile = accountInfo && !accountInfo.error ? accountInfo : null;
  const haveAnything =
    raw.length > 0 || Boolean(igProfile) || demographics?.available === true || (igMedia?.posts?.length || 0) > 0;

  // Degrade, don't fail: with a profile or demographics in hand the client still
  // gets a useful payload plus a notice, instead of an error card.
  if (!haveAnything) {
    const first = errors[0];
    throw Object.assign(new Error(first?.message || 'All Instagram metric groups failed'), {
      code: 'IG_ALL_FAILED',
      httpStatus: first?.status || 400,
      hint: first?.hint || 'Check ACCESS_TOKEN and INSTAGRAM_ID in .env.',
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
        group: 'Audience', total: ig.followers, previous: null, trend: null, trendBasis: null, hasData: ig.followers > 0,
        source: 'ig_profile',
      };
    }
    for (const fe of ig.fieldErrors || []) {
      errors.push({ group: 'ig_profile', fields: fe.fields, optional: true, message: fe.message, code: fe.code, hint: fe.hint || null });
    }
  } else if (accountInfo?.error) {
    errors.push({ group: 'ig_profile', optional: true, message: accountInfo.error, hint: accountInfo.hint || null });
  }

  // Media → Content grid + real engagement numbers. `likes`, `comments`,
  // `shares` and `saves` come back empty from account-level insights on many
  // accounts, but every post carries its own counts, so those are summed
  // (labelled source:'posts') instead of leaving the cards at zero.
  const posts = igMedia?.posts || [];
  const filledFromPosts = backfillFromPosts(overview, igMedia?.totals, {
    label: 'Instagram posts',
    platform: 'instagram',
    note: igMedia?.insightsOk ? 'per-post insight totals' : 'post counts (shares/saves need instagram_manage_insights)',
  });
  if (igMedia?.ok && igMedia.errors?.length) {
    errors.push({
      group: 'ig_media',
      optional: true,
      recovered: true,
      message: `Instagram's direct media list was refused (${igMedia.errors.map((e) => e.message).join(' | ')}) — the posts were read through Business Discovery instead.`,
      hint: 'To read the media list directly the app needs instagram_business_basic (or instagram_basic) for this account. Nothing is missing right now: like_count, comments_count and view_count come through Business Discovery.',
    });
  }
  if (!igMedia?.ok && igMedia?.errors?.length) {
    errors.push({
      group: 'ig_media', optional: true,
      message: `Instagram media could not be read (${igMedia.errors.map((e) => e.message).join(' | ')})`,
      hint: 'Reading media needs the instagram_basic permission.',
    });
  }

  const interactions = overview.interactions?.total || 0;
  const reach = overview.reach?.total || 0;
  if (reach > 0) {
    overview.engagementRate = {
      key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement',
      total: round((interactions / reach) * 100, 2), previous: null, trend: null, trendBasis: null, hasData: interactions > 0,
      derived: true, formula: 'Total interactions ÷ reach',
    };
  }

  const noticeParts = [];
  if (hardFailures.length) {
    noticeParts.push(
      raw.length
        ? `${hardFailures.length} metric group(s) unavailable for this range: ${hardFailures.map((e) => e.metrics).join(' · ')}`
        : `No Instagram insights for this range (${hardFailures.map((e) => e.message).join(' · ')})`
    );
  }
  if (filledFromPosts.length) {
    noticeParts.push(
      `${igMedia?.totals?.posts ?? posts.length} Instagram post(s) in this range; ${filledFromPosts.join(', ')} are summed from those posts because the account-level insights returned nothing for them.`
    );
  }
  if (recovered) noticeParts.push(`${recovered} group(s) were retried metric by metric; retired metrics were skipped.`);

  // A metric Meta answers with an empty 200 is the failure mode that used to
  // hide silently behind a 0 card. Name it, and name every form that was tried.
  const unresolved = [...new Set(results.flatMap((r) => r.unresolved || []))];
  if (unresolved.length) {
    noticeParts.push(
      `Meta returned no rows for ${unresolved.join(', ')} in any request form (${INSIGHT_VARIANTS.map((v) => v.name).join(', ')}), so those cards have no value rather than a real 0. ` +
        `This is an account/app entitlement, not a range problem — everything else above was measured.`
    );
  }
  if (igMedia && igMedia.ok === false) {
    const why = (igMedia.errors || [])[0]?.message || 'the media list could not be read';
    noticeParts.push(
      `Instagram's media list is not readable with this token (${why}), so per-post likes/comments could not be summed. ` +
        (ig?.mediaCount != null
          ? `Your profile does report ${ig.mediaCount} media item(s) lifetime, so posts exist — reading them needs the Business Discovery route or the instagram_business_basic / instagram_basic permission on the app.`
          : 'Reading them needs the Business Discovery route or the instagram_business_basic / instagram_basic permission on the app.')
    );
  } else if (igMedia && igMedia.source === 'business_discovery') {
    noticeParts.push(
      `Per-post numbers were read through Instagram's Business Discovery route (${igMedia.fetched || 0} post(s)) because the direct media list is not permitted for this token.`
    );
  }
  if (clamped) {
    const days = Math.round((until - (insightWindows(since, until).clampedSince || since)) / 86400);
    noticeParts.push(`Meta serves Instagram insights 30 days at a time, so the most recent ${days} days of this range are shown.`);
  } else if (windowsUsed > 1) {
    noticeParts.push(`Range was fetched in ${windowsUsed} × ≤30-day windows (Meta's per-request limit).`);
  }
  const notice = noticeParts.join(' ');

  return {
    platform: 'instagram',
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
      // A denied media list means the post count is UNKNOWN, not zero. Reporting
      // 0 here made the diagnosis claim "nothing was published" for an account
      // whose profile says media_count 9.
      postCount: igMedia && igMedia.ok === false ? null : igMedia?.totals?.posts ?? 0,
      mediaCountLifetime: ig?.mediaCount ?? null,
      postsError: igMedia && igMedia.ok === false ? (igMedia.errors || [])[0] || null : null,
      postsSource: igMedia?.source || (igMedia && igMedia.ok === false ? 'unavailable' : 'media'),
      mediaInsights: Boolean(igMedia?.insightsOk),
      insightVariants: results.map((r) => ({
        group: r.group.id,
        metrics: r.group.metric,
        attempts: r.attempts || [],
        unresolved: r.unresolved || [],
      })),
      filledFromPosts,
    },
    overview,
    timeseries,
    metrics,
    demographics,
    ...(posts.length ? { posts, topPosts: posts } : {}),
    ...(errors.length ? { partialErrors: errors } : {}),
    ...(notice ? { notice } : {}),
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
