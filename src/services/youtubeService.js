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
const { round, summarize, pctChange } = require('../utils/metrics');

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
          hint: ae?.status === 403 ? 'Enable "YouTube Analytics API" for this Google Cloud project.' : null,
        };
      });

  const results = await Promise.all(GROUPS.map((g) => call(g.metrics).then((r) => ({ ...r, group: g }))));
  const raw = [];
  const errors = [];
  for (const r of results) {
    if (r.ok) raw.push(...r.raw);
    else errors.push({ group: r.group.id, metrics: r.group.metrics, optional: Boolean(r.group.optional), message: r.message, hint: r.hint, status: r.status });
  }

  const hardFailures = errors.filter((e) => !e.optional);
  if (!raw.length) {
    const first = errors[0];
    throw Object.assign(new Error(first?.message || 'No YouTube analytics returned'), {
      code: 'YT_ANALYTICS_FAILED',
      httpStatus: first?.status || 403,
      hint: first?.hint || 'The channel must have at least one public video and analytics enabled.',
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
  const [channel, analytics] = await Promise.all([
    getChannelInfo(),
    fetchAnalytics(query).catch((err) => ({
      metrics: [],
      timeseries: [],
      overview: {},
      isEmpty: true,
      partialErrors: [{ message: err.message, hint: err.hint || null }],
      fatal: err,
    })),
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
    ...(channel.note && { notice: channel.note }),
    ...(!channel.note && analytics.isEmpty && { notice: 'No analytics rows in this range — the channel may have no views yet.' }),
    ...(analytics.partialErrors && { partialErrors: analytics.partialErrors }),
  };
}

module.exports = { fetchInsights, getYouTubeAccessToken, getChannelInfo };
