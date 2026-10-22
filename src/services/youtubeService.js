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
const { round, summarize, pctChange, justifiedTrend } = require('../utils/metrics');
const demo = require('../utils/demographics');

let ytCache = null;
let ytExpiry = 0;
let ytScopes = [];
let channelError = null;

const GROUPS = [
  { id: 'g1', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost' },
  { id: 'g2', metrics: 'likes,dislikes,comments,shares' },
  // NOTE: the old optional g3 asked for "cardsClickRate" — a metric name that
  // never existed (Google's is "cardClickRate") — and cards/annotations were
  // retired by YouTube in 2019, so the group only produced a permanent
  // "Unknown identifier" error. Removed: unavailable metrics are dropped
  // quietly instead of being reported as problems.
];

/**
 * Lifetime (whole-history) metrics the Analytics API can give us WITHOUT the
 * youtube.readonly scope. `subscribersGained - subscribersLost` over all time is
 * an honest estimate of the current subscriber count, and lifetime views are
 * exact — so a channel with 4 subscribers shows 4 instead of 0.
 */
const LIFETIME_METRICS = 'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost';
// YouTube Analytics has no data before 2012, and ACCOUNT_CREATED (when set) is
// always later than that for any real channel.
const ANALYTICS_EPOCH = '2012-01-01';

function lifetimeStart() {
  // Deliberately NOT ACCOUNT_CREATED: that variable describes when the *page or
  // business account* was created (it drives the all-time preset), and starting
  // there could cut off subscribers gained before it — the whole point of this
  // query is the channel's complete history. YouTube Analytics has no data
  // before 2012 and clamps to the channel's own first day anyway.
  return ANALYTICS_EPOCH;
}

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
    // Google echoes the granted scopes here — used to tell the user exactly what
    // is missing instead of guessing ("insufficient authentication scopes").
    ytScopes = String(data.scope || '').split(/\s+/).filter(Boolean).map((u) => u.replace('https://www.googleapis.com/auth/', ''));
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
    const ge = e.response?.data?.error;
    const reason = ge?.errors?.[0]?.reason || ge?.status || (isNetworkError(e) ? 'network' : null);
    const message = ge?.message || e.message;
    channelError = { status: e.response?.status || null, reason, message, network: isNetworkError(e) };
    console.log(`[YT] Data API unavailable (${reason || e.response?.status || 'error'}): ${message}`);
  }
  const scopes = ytScopes.length ? ytScopes.join(' + ') : 'unknown';
  const notEnabled = channelError?.reason === 'accessNotConfigured' || /has not been used in project|accessNotConfigured/i.test(channelError?.message || '');
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
    error: channelError,
    scopes,
    note: notEnabled
      ? 'Enable the YouTube Data API v3 for this Google Cloud project to see the channel name, avatar and exact subscriber count. Lifetime numbers below come from the Analytics API instead.'
      : `The Google token grants ${scopes} — the YouTube Data API also needs youtube.readonly. Lifetime numbers below come from the Analytics API instead, so subscribers are estimated from lifetime gains and losses.`,
  };
}

/**
 * fetchLifetime — whole-history numbers from the Analytics API.
 *
 * Works with the yt-analytics.readonly scope alone (no youtube.readonly), so a
 * channel whose Data API access is missing still gets real lifetime views and an
 * estimated subscriber count instead of zeros. Both calls are optional: whatever
 * Google refuses is simply absent.
 */
async function fetchLifetime(token) {
  const end = toDateStr(Math.floor(Date.now() / 1000));
  const start = lifetimeStart();
  const q = (params) =>
    axios
      .get(config.YOUTUBE_ANALYTICS_URL, {
        params: { ids: 'channel==MINE', startDate: start, endDate: end, ...params },
        headers: { Authorization: 'Bearer ' + token },
        timeout: 25000,
      })
      .then((r) => r.data)
      .catch((e) => ({ _error: e.response?.data?.error?.message || e.message, network: isNetworkError(e) }));

  const [totalsRes, videosRes] = await Promise.all([
    q({ metrics: LIFETIME_METRICS }),
    // "Top videos" report: dimensions=video requires sort + maxResults.
    q({ metrics: 'views,estimatedMinutesWatched,likes,comments,shares', dimensions: 'video', sort: '-views', maxResults: 12 }),
  ]);

  const out = { ok: false, range: { start, end }, totals: null, videos: [], errors: [] };
  const read = (res) => {
    if (!res || res._error || !res.columnHeaders || !res.rows) return null;
    const names = res.columnHeaders.map((h) => h.name);
    const map = {};
    for (const row of res.rows) names.forEach((n, i) => { map[n] = row[i]; });
    return { names, rows: res.rows, map };
  };

  const t = read(totalsRes);
  if (t) {
    const n = (k) => Number(t.map[k]) || 0;
    out.totals = {
      views: n('views'),
      watchTimeMinutes: n('estimatedMinutesWatched'),
      likes: n('likes'),
      comments: n('comments'),
      shares: n('shares'),
      subscribersGained: n('subscribersGained'),
      subscribersLost: n('subscribersLost'),
      subscribers: Math.max(0, n('subscribersGained') - n('subscribersLost')),
    };
    out.ok = true;
  } else if (totalsRes?._error) {
    out.errors.push({ call: 'lifetimeTotals', message: totalsRes._error });
  }

  const v = read(videosRes);
  if (v) {
    const idx = {};
    v.names.forEach((name, i) => { idx[name] = i; });
    out.videos = v.rows
      .map((row) => ({
        videoId: row[idx.video],
        views: Number(row[idx.views]) || 0,
        watchTimeMinutes: Number(row[idx.estimatedMinutesWatched]) || 0,
        likes: Number(row[idx.likes]) || 0,
        comments: Number(row[idx.comments]) || 0,
        shares: Number(row[idx.shares]) || 0,
      }))
      .filter((x) => x.videoId);
  } else if (videosRes?._error) {
    out.errors.push({ call: 'topVideos', message: videosRes._error });
  }
  return out;
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
  const token = await getYouTubeAccessToken();
  const [channel, lifetime, analytics, demographics] = await Promise.all([
    getChannelInfo(),
    // Lifetime numbers come from the Analytics API, which works with the
    // yt-analytics.readonly scope the token already has.
    fetchLifetime(token).catch((e) => ({ ok: false, totals: null, videos: [], errors: [{ call: 'lifetime', message: e.message }] })),
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

  // Lifetime stats: exact from the Data API when it is reachable, otherwise
  // derived from whole-history Analytics rows (views exact, subscribers =
  // lifetime gains minus losses — clearly flagged as an estimate).
  const lt = lifetime.totals;
  const fromDataApi = channel.source === 'data_api';
  const subscribers = fromDataApi ? channel.subscriberCount : lt ? lt.subscribers : 0;
  const subscribersEstimated = !fromDataApi && Boolean(lt);
  const lifetimeViews = fromDataApi ? channel.viewCount : lt ? lt.views : 0;
  const lifetimeVideos = fromDataApi ? channel.videoCount : lifetime.videos.length || null;

  const account = {
    name: channel.title,
    username: channel.handle,
    handle: channel.handle,
    picture: channel.thumbnail,
    thumbnail: channel.thumbnail,
    link: channel.handle
      ? `https://youtube.com/${channel.handle.replace(/^@/, '@')}`
      : channel.id && channel.id !== 'unknown'
      ? `https://youtube.com/channel/${channel.id}`
      : null,
    publishedAt: channel.publishedAt,
    country: channel.country || null,
    description: channel.description || null,
    followers: subscribers || null,
    followersEstimated: subscribersEstimated || undefined,
    lifetime: {
      subscribers,
      subscribersEstimated,
      totalViews: lifetimeViews,
      totalVideos: lifetimeVideos,
      watchTimeHours: lt ? round(lt.watchTimeMinutes / 60, 1) : null,
      likes: lt ? lt.likes : null,
      comments: lt ? lt.comments : null,
      shares: lt ? lt.shares : null,
      range: lifetime.range || null,
      source: fromDataApi ? 'data_api' : lt ? 'analytics_api' : 'unavailable',
    },
    source: channel.source,
    scopes: channel.scopes || null,
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
  if (subscribers > 0 && !overview.followers?.total) {
    const gained = overview.subsGained?.total || 0;
    overview.followers = {
      key: 'followers', id: 'subscriberCount', label: 'Subscribers', kind: 'gauge', unit: '', group: 'Audience',
      total: subscribers, previous: gained && !subscribersEstimated ? subscribers - gained : null,
      trend:
        gained && !subscribersEstimated && subscribers > gained
          ? justifiedTrend(subscribers, subscribers - gained, 'gauge')
          : null,
      trendBasis: 'window-edges',
      hasData: true,
      source: subscribersEstimated ? 'analytics_estimate' : 'data_api',
      estimated: subscribersEstimated || undefined,
      description: subscribersEstimated
        ? 'Estimated from lifetime subscribersGained − subscribersLost (the Data API scope is missing).'
        : 'Current subscriber count from the YouTube Data API.',
    };
  }

  // Top videos (whole history) — real per-video numbers with watch links, even
  // without the Data API. Thumbnails come from YouTube's public image CDN.
  const posts = (lifetime.videos || []).map((v) => {
    const eng = (v.likes || 0) + (v.comments || 0) + (v.shares || 0);
    return {
      postId: v.videoId,
      title: null,
      content: `Video ${v.videoId}`,
      publishedAt: null,
      date: null,
      platformUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
      mediaType: 'video',
      mediaItems: [],
      thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      status: 'published',
      platform: 'youtube',
      boardName: null,
      isExternal: false,
      syncStatus: 'native',
      analytics: {
        impressions: 0, reach: 0, likes: v.likes || 0, comments: v.comments || 0,
        shares: v.shares || 0, saves: 0, sends: 0, clicks: 0, outboundClicks: 0,
        views: v.views || 0, follows: 0, engagement: eng,
        engagementRate: v.views ? round((eng / v.views) * 100, 2) : 0,
        watchTimeMinutes: v.watchTimeMinutes || 0,
      },
      lifetime: true,
    };
  });

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
    total: gained - lost, previous: null, trend: null, trendBasis: null, hasData: gained - lost !== 0, derived: true,
  };
  // Engagement rate = (likes+comments+shares) / views.
  const eng = (overview.likes?.total || 0) + (overview.comments?.total || 0) + (overview.shares?.total || 0);
  const views = overview.views?.total || 0;
  if (views > 0) {
    overview.engagementRate = {
      key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement',
      total: round((eng / views) * 100, 2), previous: null, trend: null, trendBasis: null, hasData: eng > 0, derived: true,
      formula: '(likes + comments + shares) ÷ views',
    };
  }
  // Avg session length as mm:ss for display.
  if (overview.avgViewDuration?.total) {
    const secs = Math.round(overview.avgViewDuration.total);
    overview.avgViewDuration.formatted = `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  const noticeText = buildNotice(channel, lifetime, subscribersEstimated, analytics);

  return {
    platform: 'youtube',
    meta: {
      dateRange: dateRangeMeta(since, until),
      source: 'YouTube Analytics API',
      channelId: channel.id,
      metricCount: analytics.metrics.length,
      dataPoints: analytics.metrics.reduce((s, m) => s + m.values.length, 0),
      account,
      lifetime: account.lifetime,
      dataApi: fromDataApi ? 'ok' : channel.error?.reason || channel.error?.status || 'unavailable',
      scopes: channel.scopes || null,
    },
    overview,
    timeseries: analytics.timeseries,
    metrics: analytics.metrics,
    demographics,
    ...(posts.length ? { posts, topPosts: posts } : {}),
    ...(noticeText && { notice: noticeText }),
    ...(!channel.note && analytics.isEmpty && { notice: 'No analytics rows in this range — the channel may have no views yet.' }),
    ...(analytics.partialErrors && { partialErrors: analytics.partialErrors }),
  };
}

/** Compose the one-line notice: scope guidance first, then data availability. */
function buildNotice(channel, lifetime, subscribersEstimated, analytics) {
  const parts = [];
  if (channel.note) parts.push(channel.note);
  if (subscribersEstimated) {
    parts.push('Subscribers are estimated from lifetime gains and losses, so the number can be a little behind YouTube Studio.');
  } else if (!lifetime.ok && channel.source !== 'data_api') {
    parts.push('Lifetime totals could not be read from the Analytics API, so the channel header stays empty.');
  }
  if (!channel.note && analytics.isEmpty) {
    parts.push('No analytics rows in this range — the channel may have no views yet.');
  }
  return parts.join(' ');
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

/**
 * debugYouTube — the three-step credential probe behind GET /api/youtube/debug.
 *
 * Step 1 refreshes the token and reports the scopes Google actually granted,
 * step 2 tries the Data API (channel identity + statistics), step 3 tries the
 * Analytics API. The split matters: this account's token has
 * `yt-analytics.readonly` but not `youtube.readonly`, so step 2 fails while
 * step 3 works — which is why subscriber counts are derived, not read.
 *
 * @returns {Promise<{rep: object, complete: boolean}>} `complete` is false when
 *   the probe stopped early (missing credentials / failed refresh), which is how
 *   the route keeps its historical response shape.
 */
async function debugYouTube() {
  const rep = { step1: {}, step2: {}, step3: {}, summary: '' };
  if (!config.YOUTUBE_REFRESH_TOKEN || !config.GOOGLE_CLIENT_ID) {
    rep.summary = 'FAILED — credentials missing';
    return { rep, complete: false };
  }
  let at = null;
  try {
    const p = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: config.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    const tr = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    // The granted scope list is the single most useful line in this report.
    rep.step1 = { tokenOk: tr.status < 400, status: tr.status, scope: tr.data?.scope || null, error: tr.status < 400 ? null : tr.data?.error_description || tr.data?.error || null };
    if (tr.status >= 400) {
      rep.summary = 'FAILED — token refresh';
      return { rep, complete: false };
    }
    at = tr.data.access_token;
  } catch (e) {
    rep.step1 = { error: e.message };
    rep.summary = 'FAILED';
    return { rep, complete: false };
  }
  try {
    const cr = await axios.get(config.YOUTUBE_DATA_API_URL + '/channels', {
      params: { part: 'snippet,statistics', mine: true },
      headers: { Authorization: 'Bearer ' + at },
      validateStatus: () => true,
    });
    rep.step2 =
      cr.status < 400
        ? { ok: true, status: cr.status, channel: cr.data?.items?.[0]?.snippet?.title || null, statistics: cr.data?.items?.[0]?.statistics || null }
        : { ok: false, status: cr.status, error: cr.data?.error?.message || 'unknown error' };
  } catch (e) {
    rep.step2 = { ok: false, error: e.message };
  }
  try {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const today = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 7);
    const ago = d.toISOString().slice(0, 10);
    const ar = await axios.get(config.YOUTUBE_ANALYTICS_URL, {
      params: { ids: 'channel==MINE', startDate: ago, endDate: today, metrics: 'views', dimensions: 'day', sort: 'day' },
      headers: { Authorization: 'Bearer ' + at },
      validateStatus: () => true,
    });
    rep.step3 =
      ar.status < 400
        ? { ok: true, status: ar.status, rows: (ar.data?.rows || []).length, window: { startDate: ago, endDate: today } }
        : { ok: false, status: ar.status, rows: 0, error: ar.data?.error?.message || 'unknown error' };
    rep.summary = rep.summary || (rep.step2?.ok ? 'ALL OK' : 'PARTIAL — Analytics works, Data API refused');
  } catch (e) {
    rep.step3 = { ok: false, error: e.message };
  }
  return { rep, complete: true };
}

module.exports = { fetchInsights, fetchDemographics, getYouTubeAccessToken, getChannelInfo, debugYouTube };
