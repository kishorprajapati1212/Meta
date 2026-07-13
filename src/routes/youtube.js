const { Router } = require('express');
const { fetchInsights } = require('../services/youtubeService');
const { success, errorResponse } = require('../utils/response');
const axios = require('axios');
const config = require('../config');
const router = Router();

// GET /api/youtube
router.get('/', async (req, res) => {
  try {
    const data = await fetchInsights(req.query);
    res.json(success({ platform: 'youtube', meta: data.meta, data }));
  } catch (err) { const e = errorResponse(err); res.status(e.httpStatus).json(e.body); }
});

// GET /api/youtube/debug — step-by-step diagnostics
router.get('/debug', async (req, res) => {
  const report = { step1_config: {}, step2_tokenRefresh: {}, step3_channelInfo: {}, step4_analytics: {}, summary: '' };

  report.step1_config = {
    hasRefreshToken: !!config.YOUTUBE_REFRESH_TOKEN,
    tokenPreview: config.YOUTUBE_REFRESH_TOKEN ? config.YOUTUBE_REFRESH_TOKEN.slice(0, 10) + '...' : 'MISSING',
    hasClientId: !!config.GOOGLE_CLIENT_ID,
    hasClientSecret: !!config.GOOGLE_CLIENT_SECRET,
  };

  if (!config.YOUTUBE_REFRESH_TOKEN || !config.GOOGLE_CLIENT_ID) {
    report.summary = 'FAILED at Step 1 — YouTube credentials missing in .env';
    return res.json({ success: true, platform: 'youtube/debug', data: report });
  }

  // Step 2: Token refresh
  let accessToken = null;
  try {
    const params = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: config.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' });
    const tr = await axios.post(config.GOOGLE_TOKEN_URL, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true });
    report.step2_tokenRefresh = { httpStatus: tr.status, hasAccessToken: !!tr.data.access_token, expiresIn: tr.data.expires_in, scope: tr.data.scope, rawError: tr.status >= 400 ? tr.data : undefined };
    if (tr.status >= 400) throw new Error('Token refresh HTTP ' + tr.status);
    accessToken = tr.data.access_token;
  } catch (err) {
    report.step2_tokenRefresh.error = err.response?.data || err.message;
    report.summary = 'FAILED at Step 2 — Token refresh failed. Check YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.';
    return res.json({ success: true, platform: 'youtube/debug', data: report });
  }

  // Step 3: Channel
  try {
    const cr = await axios.get(`${config.YOUTUBE_DATA_API_URL}/channels`, { params: { part: 'snippet,statistics', mine: true }, headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true });
    if (cr.status >= 400) {
      report.step3_channelInfo = { httpStatus: cr.status, error: cr.data };
      const msg = cr.data?.error?.message || '';
      if (msg.includes('insufficient') || cr.status === 403) {
        report.step3_channelInfo.note = 'Missing youtube.readonly scope. Analytics-only mode — channel info will show defaults.';
        report.summary = 'Step 3: youtube.readonly scope missing (OK — analytics will still work).';
      } else {
        report.summary = 'FAILED at Step 3 — ' + msg;
      }
    } else {
      const items = cr.data.items || [];
      report.step3_channelInfo = items.length > 0
        ? { found: true, channelId: items[0].id, title: items[0].snippet.title, subscribers: items[0].statistics.subscriberCount, videos: items[0].statistics.videoCount, views: items[0].statistics.viewCount }
        : { found: false, message: 'No YouTube channel on this Google account' };
      if (items.length === 0) report.summary = 'FAILED at Step 3 — No YouTube channel.';
    }
  } catch (err) {
    report.step3_channelInfo.error = err.response?.data || err.message;
  }

  // Step 4: Analytics
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const ar = await axios.get(config.YOUTUBE_ANALYTICS_URL, { params: { ids: 'channel==MINE', startDate: weekAgo, endDate: today, metrics: 'views,estimatedMinutesWatched', dimensions: 'day', sort: 'day' }, headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true });
    if (ar.status >= 400) {
      report.step4_analytics = { httpStatus: ar.status, error: ar.data };
      const m = ar.data?.error?.message || '';
      if (m.includes('insufficient') || m.includes('scope')) report.summary = 'FAILED at Step 4 — Missing yt-analytics.readonly scope.';
      else if (m.includes('no data') || ar.status === 400) report.summary = 'Step 4 returned empty — NORMAL for new channels. Analytics will populate after views.';
      else report.summary = 'FAILED at Step 4 — ' + m;
    } else {
      const rows = ar.data.rows || [];
      report.step4_analytics = { httpStatus: ar.status, columnHeaders: ar.data.columnHeaders?.map(h => h.name), rowCount: rows.length, sampleRows: rows.slice(0, 3) };
      if (!report.summary) report.summary = rows.length > 0 ? 'ALL OK — YouTube Analytics working!' : 'ALL OK but no data yet — channel is new.';
    }
  } catch (err) {
    report.step4_analytics.error = err.response?.data || err.message;
    if (!report.summary) report.summary = 'FAILED at Step 4 — Unexpected error.';
  }

  res.json({ success: true, platform: 'youtube/debug', data: report });
});

module.exports = router;
