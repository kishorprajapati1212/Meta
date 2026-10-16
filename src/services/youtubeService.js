/**
 * youtubeService.js — YouTube Analytics + Data API.
 *
 * v4.1: channel identity is exposed as `overview.account` (same shape the other
 * platforms use) as well as the legacy `overview.channel`; averages (avg view
 * duration / avg view %) are no longer summed into nonsense totals — the shared
 * metrics layer classifies them; token failures carry actionable hints.
 */
const axios = require('axios');
const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');
const { isNetworkError, networkHint } = require('../utils/upstreamErrors');
const { round, summarize, pctChange } = require('../utils/metrics');
const demo = require('../utils/demographics');

let ytCache = null;
let ytExpiry = 0;

const GROUPS = [
  { id: 'g1', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost' },
  { id: 'g2', metrics: 'likes,dislikes,comments,shares' },
  // Optional: not available on every channel type / API version.
  { id: 'g3', metrics: 'cardsClickRate,annotationClickThroughRate', optional: true },
];

async function getYouTubeAccessToken() {
  if (ytCache && Date.now() < ytExpiry) return ytCache;
  if (!config.YOUTUBE_REFRESH_TOKEN || !config.GOOGLE_CLIENT_ID) {
    throw Object.assign(new Error('YouTube credentials are not configured'), {
      code: 'YT_NOT_CONFIGURED',
      httpStatus: 500,
      hint: 'Set YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.',
    });
  }
  const p = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    refresh_token: config.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  try {
    const { data } = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });
    ytCache = data.access_token;
    ytExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return ytCache;
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error || e.message;
    throw Object.assign(new Error('YT token refresh: ' + msg), {
      code: 'YT_TOKEN_FAILED',
      httpStatus: 401,
      hint: String(msg).includes('invalid_grant')
        ? 'Refresh token revoked/expired. Re-authorise in the OAuth Playground with youtube.readonly + yt-analytics.readonly and update YOUTUBE_REFRESH_TOKEN.'
        : 'Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belong to the same project as the refresh token.',
    });
  }
}

async function getChannelInfo() {
  const token = await getYouTubeAccessToken();
  try {
    const res = await axios.get(config.YOUTUBE_DATA_API_URL + '/channels', {
      params: { part: 'snippet,statistics,brandingSettings', mine: true },
      headers: { Authorization: 'Bearer ' + token },
      timeout: 20000,
    });
    const ch = res.data.items?.[0];
    if (ch) {
      return {
        id: ch.id,
        title: ch.snippet.title,
        handle: ch.snippet.customUrl || '',
        description: (ch.snippet.description || '').slice(0, 300),
        publishedAt: ch.snippet.publishedAt,
        thumbnail:
          ch.snippet.thumbnails?.high?.url ||
          ch.snippet.thumbnails?.medium?.url ||
          ch.snippet.thumbnails?.default?.url ||
          '',
        country: ch.snippet.country || null,
        subscriberCount: parseInt(ch.statistics.subscriberCount || '0', 10),
        videoCount: parseInt(ch.statistics.videoCount || '0', 10),
        viewCount: parseInt(ch.statistics.viewCount || '0', 10),
        hiddenSubscriberCount: ch.statistics.hiddenSubscriberCount === true,
        source: 'data_api',
      };
    }
  } catch (e) {
    if (e.response?.status === 403) {
      console.log('[YT] Data API unavailable (missing youtube.readonly scope)');
    } else {
      console.error('[YT] Channel error:', e.response?.data?.error?.message || e.message);
    }
  }
  return {
    id: 'unknown',
    title: 'YouTube Channel',
    handle: '',
    thumbnail: '',
    publishedAt: null,
    subscriberCount: 0,
    videoCount: 0,
    viewCount: 0,
    source: 'fallback',
    note: 'Add the youtube.readonly scope to see channel name, avatar and lifetime stats.',
  };
}

function convertYT(d) {
  if (!d.columnHeaders || !d.rows) return [];
  const names = d.columnHeaders.map((h) => h.name);
  const out = [];
  for (let c = 1; c < names.length; c++) {
    const n = names[c];
    const values = d.rows.map((r) => ({
      value: parseFloat(r[c]) || 0,
      end_time: r[0] + 'T00:00:00+0000',
    }));
    if (values.length) out.push({ name: n, period: 'day', title: ytLabel(n), description: ytDesc(n), values });
  }
  return out;
}
function ytLabel(n) {
  const m = {
    views: 'Views',
    estimatedMinutesWatched: 'Watch time (min)',
    averageViewDuration: 'Avg view duration (sec)',
    averageViewPercentage: 'Avg view %',
    subscribersGained: 'Subscribers gained',
    subscribersLost: 'Subscribers lost',
    likes: 'Likes',
    dislikes: 'Dislikes',
    comments: 'Comments',
    shares: 'Shares',
    cardsClickRate: 'Cards click rate',
    annotationClickThroughRate: 'Click-through rate',
  };
  return m[n] || n;
}
function ytDesc(n) {
  const m = {
    views: 'Total views',
    estimatedMinutesWatched: 'Total watch time in minutes',
    averageViewDuration: 'Average seconds watched per view',
    averageViewPercentage: 'Average percentage of a video watched',
    subscribersGained: 'New subscribers',
    subscribersLost: 'Subscribers lost',
    likes: 'Total likes',
    dislikes: 'Total dislikes',
    comments: 'Total comments',
    shares: 'Total shares',
  };
  return m[n] || '';
}

async function fetchAnalytics(query) {
  const token = await getYouTubeAccessToken();
  const { since, until } = parseDateRange(query, true);
  const sd = toDateStr(since);
  const ed = toDateStr(until);

  const call = (metrics) =>
    axios
      .get(config.YOUTUBE_ANALYTICS_URL, {
        params: { ids: 'channel==MINE', startDate: sd, endDate: ed, metrics, dimensions: 'day', sort: 'day' },
        headers: { Authorization: 'Bearer ' + token },
        timeout: 30000,
      })
      .then((r) => ({ ok: true, raw: convertYT(r.data) }))
      .catch((e) => {
        const ae = e.response?.data?.error;
        return {
          ok: false,
          message: ae ? `${ae.message} (${ae.status || ae.code})` : e.message,
          status: e.response?.status || null,
          network: isNetworkError(e),
          hint: isNetworkError(e)
            ? networkHint("Google's YouTube Analytics API")
            : ae?.status === 403
            ? 'Enable "YouTube Analytics API" for this Google Cloud project.'
            : null,
        };
      });

  const results = await Promise.all(GROUPS.map((g) => call(g.metrics).then((r) => ({ ...r, group: g }))));
  const raw = [];
  const errors = [];
  for (const r of results) {
    if (r.ok) raw.push(...r.raw);
    else errors.push({ group: r.group.id, metrics: r.group.metrics, optional: Boolean(r.group.optional), message: r.message, hint: r.hint, status: r.status, network: Boolean(r.network) });
  }

  const hardFailures = errors.filter((e) => !e.optional);
  if (!raw.length) {
    const first = errors[0];
    throw Object.assign(new Error(first?.message || 'No YouTube analytics returned'), {
      code: 'YT_ANALYTICS_FAILED',
      httpStatus: first?.status || 403,
      hint:
        first?.hint ||
        (first?.network
          ? networkHint("Google's YouTube Analytics API")
          : 'The channel must have at least one public video and analytics enabled.'),
      details: errors,
    });
  }

  const compact = query.compact === 'true' || query.compact === '1';
  const { metrics, timeseries } = transformMetrics(raw, compact);
  const overview = buildOverview(metrics);
  return {
    metrics,
    timeseries,
    overview,
    isEmpty: !raw.length,
    ...(errors.length ? { partialErrors: errors } : {}),
    ...(hardFailures.length ? { hardFailures } : {}),
  };
}

async function fetchInsights(query) {
  const [channel, analytics, demographics] = await Promise.all([
    getChannelInfo(),
    fetchAnalytics(query).catch((err) => ({
      metrics: [],
      timeseries: [],
      overview: {},
      isEmpty: true,
      partialErrors: [{ message: err.message, hint: err.hint || null }],
      fatal: err,
    })),
    // Demographics must never take the whole page down.
    fetchDemographics(query).catch((e) =>
      demo.empty('YouTube Analytics API · viewerPercentage', 'Demographics unavailable: ' + (e.message || e), ['age', 'gender', 'countries', 'cities', 'devices'])
    ),
  ]);

  if (analytics.fatal && (!channel || channel.source === 'fallback')) throw analytics.fatal;

  const { since, until } = parseDateRange(query, true);
  const overview = { ...analytics.overview };

  const account = {
    name: channel.title,
    username: channel.handle,
    handle: channel.handle,
    picture: channel.thumbnail,
    thumbnail: channel.thumbnail,
    link: channel.handle ? `https://youtube.com/${channel.handle.replace(/^@/, '@')}` : null,
    publishedAt: channel.publishedAt,
    country: channel.country || null,
    description: channel.description || null,
    followers: channel.subscriberCount || null,
    lifetime: {
      subscribers: channel.subscriberCount,
      totalViews: channel.viewCount,
      totalVideos: channel.videoCount,
    },
    source: channel.source,
    note: channel.note || null,
  };
  overview.account = account;
  // Legacy shape kept for backwards compatibility with existing consumers.
  overview.channel = {
    name: channel.title,
    handle: channel.handle,
    thumbnail: channel.thumbnail,
    publishedAt: channel.publishedAt,
    lifetime: account.lifetime,
  };

  // Subscriber gauge: lifetime count is the honest "followers" number.
  if (channel.subscriberCount > 0 && !overview.followers?.total) {
    const gained = overview.subsGained?.total || 0;
    overview.followers = {
      key: 'followers', id: 'subscriberCount', label: 'Subscribers', kind: 'gauge', unit: '', group: 'Audience',
      total: channel.subscriberCount, previous: gained ? channel.subscriberCount - gained : null,
      trend: gained && channel.subscriberCount > gained ? pctChange(channel.subscriberCount, channel.subscriberCount - gained) : 0,
      hasData: true, source: 'data_api',
    };
  }

  // Watch time in hours is what humans actually read.
  if (overview.watchTime) {
    overview.watchTimeHours = {
      key: 'watchTimeHours', label: 'Watch time (hours)', kind: 'duration', unit: 'h', group: 'Consumption',
      total: round(overview.watchTime.total / 60, 1),
      previous: overview.watchTime.previous != null ? round(overview.watchTime.previous / 60, 1) : null,
      trend: overview.watchTime.trend,
      hasData: overview.watchTime.total > 0,
      derived: true,
    };
  }
  // Net subscriber change for the period.
  const gained = overview.subsGained?.total || 0;
  const lost = overview.subsLost?.total || 0;
  overview.netSubscribers = {
    key: 'netSubscribers', label: 'Net subscribers', kind: 'sum', unit: '', group: 'Audience',
    total: gained - lost, previous: null, trend: 0, hasData: gained - lost !== 0, derived: true,
  };
  // Engagement rate = (likes+comments+shares) / views.
  const eng = (overview.likes?.total || 0) + (overview.comments?.total || 0) + (overview.shares?.total || 0);
  const views = overview.views?.total || 0;
  if (views > 0) {
    overview.engagementRate = {
      key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement',
      total: round((eng / views) * 100, 2), previous: null, trend: 0, hasData: eng > 0, derived: true,
      formula: '(likes + comments + shares) ÷ views',
    };
  }
  // Avg session length as mm:ss for display.
  if (overview.avgViewDuration?.total) {
    const secs = Math.round(overview.avgViewDuration.total);
    overview.avgViewDuration.formatted = `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  return {
    platform: 'youtube',
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'YouTube Analytics API',
      channelId: channel.id,
      metricCount: analytics.metrics.length,
      dataPoints: analytics.metrics.reduce((s, m) => s + m.values.length, 0),
      account,
    },
    overview,
    timeseries: analytics.timeseries,
    metrics: analytics.metrics,
    demographics,
    ...(channel.note && { notice: channel.note }),
    ...(!channel.note && analytics.isEmpty && { notice: 'No analytics rows in this range — the channel may have no views yet.' }),
    ...(analytics.partialErrors && { partialErrors: analytics.partialErrors }),
  };
}

/**
 * fetchDemographics — audience composition from the YouTube Analytics API.
 *
 * Uses the `viewerPercentage` metric, which is a *share of viewers* (not a
 * count). YouTube hides it below its privacy threshold (roughly 100 lifetime
 * viewers), so an empty result is normal for a new channel and is reported as
 * `available:false` with an explanation instead of a crash or fake zeros.
 * Cities do not exist as a YouTube dimension at all.
 */
async function fetchDemographics(query) {
  const source = 'YouTube Analytics API · viewerPercentage';
  const missing = ['cities'];
  const blank = (note) => demo.empty(source, note, [...missing, 'age', 'gender', 'countries', 'devices']);

  let token;
  try {
    token = await getYouTubeAccessToken();
  } catch (e) {
    return blank('YouTube credentials are not configured, so audience composition cannot be read.');
  }

  const { since, until } = parseDateRange(query, true);
  let sd = toDateStr(since);
  let ed = toDateStr(until);

  const get = (dimensions) =>
    axios
      .get(config.YOUTUBE_ANALYTICS_URL, {
        params: { ids: 'channel==MINE', startDate: sd, endDate: ed, metrics: 'viewerPercentage', dimensions },
        headers: { Authorization: 'Bearer ' + token },
        timeout: 20000,
      })
      .then((r) => r.data?.rows || [])
      .catch(() => []);

  let [ageRows, countryRows, deviceRows] = await Promise.all([
    get('ageGroup,gender'),
    get('country'),
    get('device'),
  ]);

  // Privacy threshold: if the window is empty, fall back to the channel's
  // whole history — composition over all time is still useful and honest.
  let fellBack = false;
  if (!ageRows.length && !countryRows.length && !deviceRows.length) {
    fellBack = true;
    sd = config.ACCOUNT_CREATED ? toDateStr(Math.floor(new Date(config.ACCOUNT_CREATED).getTime() / 1000)) : '2005-01-01';
    ed = toDateStr(Math.floor(Date.now() / 1000));
    [ageRows, countryRows, deviceRows] = await Promise.all([
      get('ageGroup,gender'),
      get('country'),
      get('device'),
    ]);
  }

  if (!ageRows.length && !countryRows.length && !deviceRows.length) {
    return blank(
      'YouTube only publishes audience composition once a channel passes its privacy threshold (roughly 100 lifetime viewers). Keep publishing — this fills in by itself.'
    );
  }

  // ageGroup × gender → buckets
  const buckets = new Map();
  const genderTotals = { male: 0, female: 0, unknown: 0 };
  for (const [ageCode, genderCode, pct] of ageRows) {
    const bucket = demo.ytAge(ageCode);
    const g = demo.ytGender(genderCode);
    const v = Number(pct) || 0;
    const cur = buckets.get(bucket) || { bucket, male: 0, female: 0, total: 0 };
    cur[g] += v;
    cur.total += v;
    buckets.set(bucket, cur);
    genderTotals[g] += v;
  }
  const gSum = genderTotals.male + genderTotals.female + genderTotals.unknown;
  const age = demo.AGE_ORDER.filter((b) => buckets.has(b)).map((b) => {
    const r = buckets.get(b);
    return { bucket: b, male: demo.round(r.male, 1), female: demo.round(r.female, 1), total: demo.round(r.total, 1) };
  });

  const countries = countryRows
    .map(([code, pct]) => ({ code: String(code).toUpperCase(), value: demo.round(Number(pct) || 0, 2) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 40)
    .map((c) => ({ ...c, share: demo.round(c.value, 2) }));

  const devices = deviceRows
    .map(([code, pct]) => ({ label: demo.deviceLabel(code), value: demo.round(Number(pct) || 0, 2) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((d) => ({ ...d, share: demo.round(d.value, 2) }));

  const available = Boolean(age.length || countries.length || devices.length);
  return {
    available,
    source,
    unit: 'share',
    asOf: ed,
    note: fellBack
      ? 'This window is below YouTube’s privacy threshold, so composition is shown for the channel’s whole history instead.'
      : available
      ? null
      : 'No audience composition in this window.',
    gender: gSum > 0
      ? {
          male: demo.round((genderTotals.male / gSum) * 100, 1),
          female: demo.round((genderTotals.female / gSum) * 100, 1),
          unknown: demo.round((genderTotals.unknown / gSum) * 100, 1),
        }
      : null,
    age: age.length ? age : null,
    countries: countries.length ? countries : null,
    cities: null,
    devices: devices.length ? devices : null,
    missing,
  };
}

module.exports = { fetchInsights, fetchDemographics, getYouTubeAccessToken, getChannelInfo };
