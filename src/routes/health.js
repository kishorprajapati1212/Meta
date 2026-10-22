/**
 * GET /api/health — connectivity + credential check for all 6 platforms.
 *
 * v4.1: previously returned bare strings like "Request failed with status
 * code 400", which is useless to a human. Now every platform returns
 * { status, message, hint, configured, source } so the dashboard can show an
 * actionable "your Facebook token expired — regenerate it" card instead of a
 * mystery error. `data.platforms` is kept as a string map for compatibility.
 */
const { Router } = require('express');
const { success } = require('../utils/response');
const axios = require('axios');
const config = require('../config');
const { cacheStats } = require('../utils/resilience');

const r = Router();

function describe(e) {
  const status = e.response?.status;
  const body = e.response?.data;
  const msg =
    body?.error?.message ||
    body?.error?.error_message ||
    (typeof body?.error === 'string' ? body.error : null) ||
    body?.error_description ||
    body?.message ||
    e.message ||
    'Unknown error';
  return { status: status || null, message: String(msg) };
}

/** Map a raw failure onto something a human can act on. */
function diagnose(platform, e) {
  const { status, message } = describe(e);
  const lower = message.toLowerCase();
  let hint = null;

  if (platform === 'facebook' || platform === 'instagram') {
    if (status === 400 || lower.includes('expired') || lower.includes('oauthexception') || lower.includes('session')) {
      hint = 'Meta access token expired or was revoked. Generate a new long-lived user token (Graph API Explorer → /me/accounts → page token) and set ACCESS_TOKEN, then restart the API.';
    } else if (status === 403 || lower.includes('permission') || lower.includes('pages_show_list')) {
      hint = 'Token is missing permissions. It needs pages_show_list, pages_read_engagement, instagram_basic and instagram_manage_insights.';
    } else if (lower.includes('not found') || status === 404) {
      hint = 'Check FACEBOOK_PAGE_ID / INSTAGRAM_ID — the id must belong to the account that owns ACCESS_TOKEN.';
    } else if (!config.USER_ACCESS_TOKEN) {
      hint = 'ACCESS_TOKEN is not set in .env.';
    }
  }
  if (platform === 'youtube') {
    if (lower.includes('invalid_grant') || lower.includes('token')) {
      hint = 'Re-authorise in the OAuth Playground with the youtube.readonly + yt-analytics.readonly scopes and replace YOUTUBE_REFRESH_TOKEN.';
    } else if (status === 403) {
      hint = 'Enable the YouTube Analytics API and YouTube Data API v3 for GOOGLE_CLIENT_ID’s project.';
    }
  }
  if (platform === 'searchConsole') {
    if (lower.includes('invalid_grant') || lower.includes('token')) {
      hint = 'Re-authorise with the webmasters.readonly scope and replace GSC_REFRESH_TOKEN.';
    } else if (status === 403 || lower.includes('permission')) {
      hint = 'The Google account behind GSC_REFRESH_TOKEN must be a verified user of GSC_SITE_URL in Search Console.';
    }
  }
  if (platform === 'linkedin' || platform === 'pinterest') {
    if (status === 401) hint = 'ZERNIO_API_KEY was rejected — regenerate it in the Zernio dashboard.';
    else if (status === 402) hint = 'Zernio analytics requires a paid plan on this key.';
    else hint = 'Run GET /api/zernio/debug for the exact failing Zernio call.';
  }
  return { status: 'error', message, hint, httpStatus: status };
}

function notConfigured(platform) {
  const map = {
    facebook: 'ACCESS_TOKEN + FACEBOOK_PAGE_ID',
    instagram: 'ACCESS_TOKEN + INSTAGRAM_ID',
    youtube: 'YOUTUBE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET',
    searchConsole: 'GSC_REFRESH_TOKEN + GSC_CLIENT_ID + GSC_CLIENT_SECRET + GSC_SITE_URL',
    linkedin: 'ZERNIO_API_KEY',
    pinterest: 'ZERNIO_API_KEY',
  };
  return {
    status: 'not_configured',
    message: `${map[platform]} not set`,
    hint: `Add ${map[platform]} to .env and restart the API.`,
  };
}

async function refreshGoogle(clientId, clientSecret, refreshToken) {
  const p = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const { data } = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return data;
}

/**
 * buildHealth — the whole connectivity probe as a plain function.
 *
 * Extracted from the route so `GET /api/report` can include it in the single
 * diagnostic bundle without an internal HTTP hop. The response shape is
 * byte-identical to what the route has always returned.
 */
async function buildHealth() {
  const details = {};
  const started = Date.now();

  const set = (platform, source, value) => {
    details[platform] = { platform, source, configured: true, checkedAt: new Date().toISOString(), ...value };
  };

  // ── Meta (Facebook + Instagram share one token) ───────────────
  const metaConfigured = Boolean(config.USER_ACCESS_TOKEN && config.FACEBOOK_PAGE_ID);
  if (!metaConfigured) {
    details.facebook = { platform: 'facebook', source: 'graph', configured: false, ...notConfigured('facebook') };
    details.instagram = { platform: 'instagram', source: 'graph', configured: false, ...notConfigured('instagram') };
  } else {
    try {
      await require('../services/tokenService').getPageAccessToken();
      set('facebook', 'graph', { status: 'ok', message: 'Page token acquired' });
      set('instagram', 'graph', {
        status: config.INSTAGRAM_ID ? 'ok' : 'not_configured',
        message: config.INSTAGRAM_ID ? 'Instagram business account reachable' : 'INSTAGRAM_ID not set',
        hint: config.INSTAGRAM_ID ? null : 'Set INSTAGRAM_ID in .env.',
      });
    } catch (e) {
      const d = diagnose('facebook', e);
      set('facebook', 'graph', d);
      set('instagram', 'graph', { ...diagnose('instagram', e), configured: Boolean(config.INSTAGRAM_ID) });
    }
  }

  // ── YouTube ───────────────────────────────────────────────────
  if (config.YOUTUBE_REFRESH_TOKEN && config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    try {
      await refreshGoogle(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.YOUTUBE_REFRESH_TOKEN);
      set('youtube', 'google-oauth', { status: 'ok', message: 'Refresh token valid' });
    } catch (e) {
      set('youtube', 'google-oauth', diagnose('youtube', e));
    }
  } else {
    details.youtube = { platform: 'youtube', source: 'google-oauth', configured: false, ...notConfigured('youtube') };
  }

  // ── Google Search Console ─────────────────────────────────────
  if (config.GSC_REFRESH_TOKEN && config.GSC_CLIENT_ID && config.GSC_CLIENT_SECRET) {
    try {
      await refreshGoogle(config.GSC_CLIENT_ID, config.GSC_CLIENT_SECRET, config.GSC_REFRESH_TOKEN);
      const sites = await require('../services/gscService').getSites().catch(() => []);
      set('searchConsole', 'google-oauth', {
        status: 'ok',
        message: sites.length ? `${sites.length} verified site(s)` : 'Token valid, no verified sites',
        sites: sites.map((s) => s.siteUrl),
        hint: sites.length ? null : 'Verify a property in Search Console or set GSC_SITE_URL.',
      });
    } catch (e) {
      set('searchConsole', 'google-oauth', diagnose('searchConsole', e));
    }
  } else {
    details.searchConsole = {
      platform: 'searchConsole',
      source: 'google-oauth',
      configured: false,
      ...notConfigured('searchConsole'),
    };
  }

  // ── Zernio (LinkedIn + Pinterest) ─────────────────────────────
  if (config.ZERNIO_API_KEY) {
    try {
      const resp = await axios.get(config.ZERNIO_BASE_URL + '/v1/accounts', {
        headers: { Authorization: 'Bearer ' + config.ZERNIO_API_KEY },
        timeout: 20000,
        validateStatus: () => true,
      });
      if (resp.status === 200) {
        const accounts = resp.data.accounts || [];
        for (const platform of ['linkedin', 'pinterest']) {
          const acct = accounts.find((a) => String(a.platform || '').toLowerCase() === platform);
          if (acct) {
            set(platform, 'zernio', {
              status: 'ok',
              message: `@${acct.username || acct.displayName || 'connected'}`,
              accountId: acct._id || acct.id || null,
              followers: acct.currentFollowers ?? acct.followersCount ?? null,
              hasAnalyticsAccess: resp.data.hasAnalyticsAccess ?? null,
              hint: resp.data.hasAnalyticsAccess === false ? 'Zernio says analytics access is disabled for this key — enable it on your plan to get post metrics.' : null,
            });
          } else {
            set(platform, 'zernio', {
              status: 'no_account',
              message: `No ${platform} account connected in Zernio (${accounts.length} account(s) total)`,
              hint: `Connect a ${platform} account in Zernio, then retry.`,
            });
          }
        }
      } else {
        const fake = Object.assign(new Error(resp.data?.error || resp.data?.message || 'Zernio request failed'), {
          response: resp,
        });
        for (const platform of ['linkedin', 'pinterest']) set(platform, 'zernio', diagnose(platform, fake));
      }
    } catch (e) {
      for (const platform of ['linkedin', 'pinterest']) set(platform, 'zernio', diagnose(platform, e));
    }
  } else {
    for (const platform of ['linkedin', 'pinterest']) {
      details[platform] = { platform, source: 'zernio', configured: false, ...notConfigured(platform) };
    }
  }

  const platforms = {};
  let healthy = true;
  for (const [k, v] of Object.entries(details)) {
    platforms[k] = v.status === 'ok' ? 'ok' : v.message;
    if (v.status !== 'ok' && v.configured) healthy = false;
  }

  return success({
      platform: 'system',
      meta: {
        uptime: Math.round(process.uptime()),
        checkedInMs: Date.now() - started,
        version: config.VERSION,
      },
      data: {
        healthy,
        platforms, // legacy string map
        details, // rich, actionable
        configured: Object.values(details).filter((d) => d.configured).length,
        ok: Object.values(details).filter((d) => d.status === 'ok').length,
        total: Object.keys(details).length,
        serverTime: new Date().toISOString(),
        cache: cacheStats(),
      },
    });
}

r.get('/', async (_req, res) => {
  res.json(await buildHealth());
});

module.exports = r;
module.exports.buildHealth = buildHealth;
