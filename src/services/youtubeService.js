const axios = require('axios');
const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');

let cachedAccessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry) return cachedAccessToken;

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    refresh_token: config.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  try {
    const { data } = await axios.post(config.GOOGLE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    cachedAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return cachedAccessToken;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    throw Object.assign(new Error(`YouTube token refresh failed: ${msg}`), {
      code: 'YOUTUBE_TOKEN_REFRESH_FAILED', details: err.response?.data || null, httpStatus: 401,
    });
  }
}

// ── Channel Info — tries Data API, falls back gracefully ───────

async function getChannelInfo() {
  const token = await getAccessToken();

  try {
    const res = await axios.get(`${config.YOUTUBE_DATA_API_URL}/channels`, {
      params: { part: 'snippet,statistics', mine: true },
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = res.data;
    if (data.items && data.items.length > 0) {
      const ch = data.items[0];
      return {
        id: ch.id, title: ch.snippet.title, customUrl: ch.snippet.customUrl || '',
        publishedAt: ch.snippet.publishedAt, thumbnail: ch.snippet.thumbnails?.high?.url || ch.snippet.thumbnails?.default?.url || '',
        subscriberCount: parseInt(ch.statistics.subscriberCount || '0'),
        videoCount: parseInt(ch.statistics.videoCount || '0'),
        viewCount: parseInt(ch.statistics.viewCount || '0'),
        source: 'data_api',
      };
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 403) {
      console.log('[YT] Data API unavailable (missing youtube.readonly scope). Channel info limited.');
    } else {
      console.error('[YT] Channel fetch error:', err.response?.data?.error?.message || err.message);
    }
  }

  return {
    id: 'unknown', title: 'YouTube Channel', customUrl: '', publishedAt: null, thumbnail: '',
    subscriberCount: 0, videoCount: 0, viewCount: 0, source: 'fallback',
    note: 'Channel info unavailable. Add youtube.readonly scope for full details.',
  };
}

// ── Analytics ──────────────────────────────────────────────────

async function fetchAnalytics(query) {
  const token = await getAccessToken();
  const { since, until } = parseDateRange(query);
  const startDate = toDateStr(since);
  const endDate = toDateStr(until);

  const makeReport = (metrics) =>
    axios.get(config.YOUTUBE_ANALYTICS_URL, {
      params: { ids: 'channel==MINE', startDate, endDate, metrics, dimensions: 'day', sort: 'day' },
      headers: { Authorization: `Bearer ${token}` },
    });

  const [basicRes, engagementRes] = await Promise.allSettled([
    makeReport('views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost'),
    makeReport('likes,dislikes,comments,shares'),
  ]);

  const raw = [];
  const errors = [];

  [basicRes, engagementRes].forEach((r, i) => {
    if (r.status === 'fulfilled') {
      raw.push(...convertReportToMetrics(r.value.data));
    } else {
      const apiErr = r.reason.response?.data?.error;
      errors.push({ group: `metric_group_${i + 1}`, message: apiErr ? `${apiErr.message} (${apiErr.code || ''})` : r.reason.message });
    }
  });

  if (raw.length === 0 && errors.length > 0) {
    console.log('[YT] No analytics data. Errors:', JSON.stringify(errors));
  }

  const { metrics, timeseries } = transformMetrics(raw);
  const overview = buildOverview(metrics);
  return { metrics, timeseries, overview, isEmpty: raw.length === 0, ...(errors.length > 0 && { partialErrors: errors }) };
}

function convertReportToMetrics(reportData) {
  if (!reportData.columnHeaders || !reportData.rows) return [];
  const headers = reportData.columnHeaders.map(h => h.name);
  const metrics = [];
  for (let col = 1; col < headers.length; col++) {
    const name = headers[col];
    const values = reportData.rows.map(row => ({
      value: parseFloat(row[col]) || 0,
      end_time: `${row[0]}T00:00:00+0000`,
    }));
    if (values.length > 0) {
      metrics.push({ name, period: 'day', title: label(name), description: desc(name), values });
    }
  }
  return metrics;
}

function label(n) {
  const m = { views: 'Views', estimatedMinutesWatched: 'Watch Time (min)', averageViewDuration: 'Avg View Duration (sec)', averageViewPercentage: 'Avg View %', subscribersGained: 'Subscribers Gained', subscribersLost: 'Subscribers Lost', likes: 'Likes', dislikes: 'Dislikes', comments: 'Comments', shares: 'Shares' };
  return m[n] || n;
}
function desc(n) {
  const m = { views: 'Total views', estimatedMinutesWatched: 'Total watch time (minutes)', averageViewDuration: 'Avg seconds per view', averageViewPercentage: 'Avg % of video watched', subscribersGained: 'New subscribers', subscribersLost: 'Subscribers lost', likes: 'Total likes', dislikes: 'Total dislikes', comments: 'Total comments', shares: 'Total shares' };
  return m[n] || '';
}

// ── Public ─────────────────────────────────────────────────────

async function fetchInsights(query) {
  const [channel, analytics] = await Promise.all([
    getChannelInfo(),
    fetchAnalytics(query).catch(err => {
      console.error('[YT Analytics] Failed:', err.message);
      return { metrics: [], timeseries: [], overview: {}, isEmpty: true, partialErrors: [{ message: err.message }] };
    }),
  ]);

  const { since, until } = parseDateRange(query);

  const overview = {
    ...analytics.overview,
    channel: {
      name: channel.title, handle: channel.customUrl || '', thumbnail: channel.thumbnail || '',
      publishedAt: channel.publishedAt,
      lifetime: { subscribers: channel.subscriberCount, totalViews: channel.viewCount, totalVideos: channel.videoCount },
    },
  };

  return {
    platform: 'youtube',
    meta: { dateRange: dateRangeMeta(since, until), channelId: channel.id, metricCount: analytics.metrics.length, dataPoints: analytics.metrics.reduce((s, m) => s + m.values.length, 0) },
    overview, timeseries: analytics.timeseries, metrics: analytics.metrics,
    ...(channel.note && { notice: channel.note }),
    ...(analytics.isEmpty && !channel.note && { notice: 'No analytics data yet. Normal for new channels.' }),
    ...(analytics.partialErrors && { partialErrors: analytics.partialErrors }),
  };
}

module.exports = { fetchInsights, getAccessToken };
