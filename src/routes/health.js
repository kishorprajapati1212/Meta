const { Router } = require('express');
const { getPageAccessToken } = require('../services/tokenService');
const { success } = require('../utils/response');
const axios = require('axios');
const config = require('../config');
const router = Router();

router.get('/', async (req, res) => {
  const st = { facebook: 'untested', instagram: 'untested', youtube: 'untested' };
  let ok = true;

  try { await getPageAccessToken(); st.facebook = 'ok'; st.instagram = 'ok'; }
  catch (err) { st.facebook = err.message; st.instagram = err.message; ok = false; }

  if (config.YOUTUBE_REFRESH_TOKEN && config.GOOGLE_CLIENT_ID) {
    try {
      const p = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: config.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' });
      await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      st.youtube = 'ok';
    } catch (err) { st.youtube = err.response?.data?.error_description || err.message; ok = false; }
  } else { st.youtube = 'not_configured'; }

  res.json(success({ platform: 'system', meta: { uptime: process.uptime() }, data: { healthy: ok, platforms: st } }));
});

module.exports = router;
