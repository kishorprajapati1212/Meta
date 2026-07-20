const axios = require('axios'); const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { transformMetrics, buildOverview } = require('../utils/transform');

let ytCache = null; let ytExpiry = 0;

async function getYouTubeAccessToken() {
  if (ytCache && Date.now() < ytExpiry) return ytCache;
  const p = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: config.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' });
  try {
    const { data } = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    ytCache = data.access_token; ytExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return ytCache;
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error || e.message;
    throw Object.assign(new Error('YT token refresh: ' + msg), { code: 'YT_TOKEN_FAILED', httpStatus: 401 });
  }
}

async function getChannelInfo() {
  const token = await getYouTubeAccessToken();
  try {
    const res = await axios.get(config.YOUTUBE_DATA_API_URL + '/channels', { params: { part: 'snippet,statistics', mine: true }, headers: { Authorization: 'Bearer ' + token } });
    const ch = res.data.items?.[0];
    if (ch) return { id: ch.id, title: ch.snippet.title, customUrl: ch.snippet.customUrl || '', publishedAt: ch.snippet.publishedAt, thumbnail: ch.snippet.thumbnails?.high?.url || ch.snippet.thumbnails?.default?.url || '', subscriberCount: parseInt(ch.statistics.subscriberCount || '0'), videoCount: parseInt(ch.statistics.videoCount || '0'), viewCount: parseInt(ch.statistics.viewCount || '0'), source: 'data_api' };
  } catch (e) {
    if (e.response?.status === 403) console.log('[YT] Data API unavailable (missing youtube.readonly)');
    else console.error('[YT] Channel error:', e.response?.data?.error?.message || e.message);
  }
  return { id: 'unknown', title: 'YouTube Channel', customUrl: '', publishedAt: null, thumbnail: '', subscriberCount: 0, videoCount: 0, viewCount: 0, source: 'fallback', note: 'Add youtube.readonly scope for channel details.' };
}

async function fetchAnalytics(query) {
  const token = await getYouTubeAccessToken();
  const { since, until } = parseDateRange(query, true);
  const sd = toDateStr(since); const ed = toDateStr(until);
  const mk = metrics => axios.get(config.YOUTUBE_ANALYTICS_URL, { params: { ids: 'channel==MINE', startDate: sd, endDate: ed, metrics, dimensions: 'day', sort: 'day' }, headers: { Authorization: 'Bearer ' + token } });
  const [br, er] = await Promise.allSettled([mk('views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost'), mk('likes,dislikes,comments,shares')]);
  const raw = []; const errors = [];
  [br, er].forEach((r, i) => {
    if (r.status === 'fulfilled') raw.push(...convertYT(r.value.data));
    else { const ae = r.reason.response?.data?.error; errors.push({ group: 'g' + (i + 1), message: ae ? ae.message + ' (' + ae.code + ')' : r.reason.message }); }
  });
  const compact = query.compact === 'true' || query.compact === '1';
  const { metrics, timeseries } = transformMetrics(raw, compact);
  const overview = buildOverview(metrics);
  return { metrics, timeseries, overview, isEmpty: !raw.length, ...(errors.length ? { partialErrors: errors } : {}) };
}

function convertYT(d) {
  if (!d.columnHeaders || !d.rows) return [];
  const h = d.columnHeaders.map(h => h.name); const m = [];
  for (let c = 1; c < h.length; c++) {
    const n = h[c]; const v = d.rows.map(r => ({ value: parseFloat(r[c]) || 0, end_time: r[0] + 'T00:00:00+0000' }));
    if (v.length) m.push({ name: n, period: 'day', title: ytLabel(n), description: ytDesc(n), values: v });
  }
  return m;
}
function ytLabel(n) { const m = { views: 'Views', estimatedMinutesWatched: 'Watch Time (min)', averageViewDuration: 'Avg View Duration (sec)', averageViewPercentage: 'Avg View %', subscribersGained: 'Subscribers Gained', subscribersLost: 'Subscribers Lost', likes: 'Likes', dislikes: 'Dislikes', comments: 'Comments', shares: 'Shares' }; return m[n] || n; }
function ytDesc(n) { const m = { views: 'Total views', estimatedMinutesWatched: 'Total watch time (min)', averageViewDuration: 'Avg seconds per view', averageViewPercentage: 'Avg % of video watched', subscribersGained: 'New subscribers', subscribersLost: 'Subscribers lost', likes: 'Total likes', dislikes: 'Total dislikes', comments: 'Total comments', shares: 'Total shares' }; return m[n] || ''; }

async function fetchInsights(query) {
  const [channel, analytics] = await Promise.all([getChannelInfo(), fetchAnalytics(query).catch(err => ({ metrics: [], timeseries: [], overview: {}, isEmpty: true, partialErrors: [{ message: err.message }] }))]);
  const { since, until } = parseDateRange(query, true);
  const overview = { ...analytics.overview, channel: { name: channel.title, handle: channel.customUrl || '', thumbnail: channel.thumbnail || '', publishedAt: channel.publishedAt, lifetime: { subscribers: channel.subscriberCount, totalViews: channel.viewCount, totalVideos: channel.videoCount } } };
  return { platform: 'youtube', meta: { dateRange: dateRangeMeta(since, until), channelId: channel.id, metricCount: analytics.metrics.length, dataPoints: analytics.metrics.reduce((s, m) => s + m.values.length, 0) }, overview, timeseries: analytics.timeseries, metrics: analytics.metrics, ...(channel.note && { notice: channel.note }), ...(analytics.isEmpty && !channel.note && { notice: 'No analytics data yet.' }), ...(analytics.partialErrors && { partialErrors: analytics.partialErrors }) };
}
module.exports = { fetchInsights, getYouTubeAccessToken };
