const { Router } = require('express');
const { fetchInsights } = require('../services/youtubeService');
const { success, errorResponse } = require('../utils/response');
const config = require('../config');
const axios = require('axios');
const r = Router();
r.get('/', async (req, res) => {
  try { const d = await fetchInsights(req.query); res.json(success({ platform: 'youtube', meta: d.meta, data: { overview: d.overview, timeseries: d.timeseries, metrics: d.metrics }, notice: d.notice || undefined })); }
  catch (e) { const er = errorResponse(e); res.status(er.httpStatus).json(er.body); }
});
r.get('/debug', async (req, res) => {
  const rep = { step1: {}, step2: {}, step3: {}, summary: '' };
  if (!config.YOUTUBE_REFRESH_TOKEN || !config.GOOGLE_CLIENT_ID) { rep.summary = 'FAILED — credentials missing'; return res.json({ success: true, data: rep }); }
  let at = null;
  try {
    const p = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: config.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' });
    const tr = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true });
    rep.step1 = { tokenOk: tr.status < 400, scope: tr.data?.scope };
    if (tr.status >= 400) { rep.summary = 'FAILED — token refresh'; return res.json({ success: true, data: rep }); }
    at = tr.data.access_token;
  } catch (e) { rep.step1 = { error: e.message }; rep.summary = 'FAILED'; return res.json({ success: true, data: rep }); }
  try {
    const cr = await axios.get(config.YOUTUBE_DATA_API_URL + '/channels', { params: { part: 'snippet,statistics', mine: true }, headers: { Authorization: 'Bearer ' + at }, validateStatus: () => true });
    rep.step2 = cr.status < 400 ? { channel: cr.data.items?.[0]?.snippet?.title } : { error: cr.data?.error?.message };
  } catch (e) { rep.step2 = { error: e.message }; }
  try {
    const d = new Date(); d.setDate(d.getDate() - 3);
    const today = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 7);
    const ago = d.toISOString().slice(0, 10);
    const ar = await axios.get(config.YOUTUBE_ANALYTICS_URL, { params: { ids: 'channel==MINE', startDate: ago, endDate: today, metrics: 'views', dimensions: 'day', sort: 'day' }, headers: { Authorization: 'Bearer ' + at }, validateStatus: () => true });
    rep.step3 = ar.status < 400 ? { rows: (ar.data.rows || []).length } : { error: ar.data?.error?.message };
    rep.summary = rep.summary || 'ALL OK';
  } catch (e) { rep.step3 = { error: e.message }; }
  res.json({ success: true, platform: 'youtube/debug', data: rep });
});
module.exports = r;