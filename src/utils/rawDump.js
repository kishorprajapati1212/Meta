/**
 * rawDump.js — verbatim upstream reads for `GET /api/report`.
 *
 * The transformed payloads answer "what are my numbers". They cannot answer
 * "why is this number missing", because by then the upstream response has been
 * through the metric catalogue, the kind system and the overview builder. When
 * something looks wrong the only trustworthy evidence is the body Meta, Google
 * or Zernio actually sent — with its status code and its own error message.
 *
 * Every function here:
 *   • never throws (each call is captured with status, timing and error)
 *   • records the request it made, minus credentials
 *   • returns bodies that `utils/redact.js` scrubs before they leave the process
 */
const axios = require('axios');
const config = require('../config');
const tokens = require('../services/tokenService');
const gsc = require('../services/gscService');
const zernio = require('../services/zernioService');
const youtube = require('../services/youtubeService');

const TIMEOUT = 25000;

/** Graph node/edge read that records exactly what Meta said. */
async function graphCall(out, name, path, params, token) {
  const t = Date.now();
  const url = `${config.FB_API_BASE}/${config.FB_API_VERSION}/${path}`;
  try {
    const r = await axios.get(url, {
      params: { ...params, access_token: token },
      timeout: TIMEOUT,
      validateStatus: () => true,
    });
    const ok = r.status < 400;
    out.calls[name] = {
      ok,
      status: r.status,
      ms: Date.now() - t,
      request: { path, params },
      // Meta's own message is the evidence — "(#100) ... does not exist" tells
      // us a metric is retired, "(#10) ... requires permission" tells us a scope
      // is missing. Both are actionable; a bare 400 is not.
      ...(ok ? { data: r.data } : { error: r.data?.error?.message || 'unknown error', code: r.data?.error?.code || null, type: r.data?.error?.type || null }),
    };
    return ok ? r.data : null;
  } catch (e) {
    out.calls[name] = { ok: false, ms: Date.now() - t, request: { path, params }, error: e.message };
    return null;
  }
}

/**
 * Meta Graph: the page node, its posts, its insights, the Instagram business
 * account, its media and one media item's insights.
 */
async function graphRaw(query = {}) {
  const out = {
    configured: Boolean(config.USER_ACCESS_TOKEN),
    baseUrl: `${config.FB_API_BASE}/${config.FB_API_VERSION}`,
    ids: { page: config.FACEBOOK_PAGE_ID || null, instagram: config.INSTAGRAM_ID || null },
    calls: {},
    summary: '',
  };
  if (!out.configured) {
    out.summary = 'ACCESS_TOKEN is not set — Facebook and Instagram cannot be read at all';
    return out;
  }

  let token = null;
  try {
    token = await tokens.getPageAccessToken();
    out.calls['page token exchange'] = { ok: true, note: 'ACCESS_TOKEN was exchanged for a Page token' };
  } catch (e) {
    out.calls['page token exchange'] = { ok: false, error: e.message, code: e.code || null, hint: e.hint || null };
    out.summary = 'FAILED — no Page token, so nothing below could be requested';
    return out;
  }

  const days = Number(query.days) > 0 ? Math.min(Number(query.days), 90) : 30;

  if (config.FACEBOOK_PAGE_ID) {
    await graphCall(out, 'page profile', config.FACEBOOK_PAGE_ID, {
      fields: 'id,name,username,link,category,about,website,followers_count,fan_count,new_like_count,picture.width(180)',
    }, token);
    await graphCall(out, 'page posts', `${config.FACEBOOK_PAGE_ID}/posts`, {
      fields: 'id,message,created_time,permalink_url,status_type,likes.limit(0).summary(true),comments.limit(0).summary(true),shares',
      limit: 5,
    }, token);
    await graphCall(out, 'page insights (daily)', `${config.FACEBOOK_PAGE_ID}/insights`, {
      metric: 'page_views_total,page_post_engagements,page_fans,page_impressions,page_impressions_unique',
      period: 'day',
      date_preset: days >= 90 ? 'last_90d' : `last_${days}d`,
    }, token);
  } else {
    out.calls['page profile'] = { ok: false, error: 'FACEBOOK_PAGE_ID is not set' };
  }

  if (config.INSTAGRAM_ID) {
    const preset = days >= 90 ? 'last_90d' : `last_${days}d`;
    const profile = await graphCall(out, 'instagram profile', config.INSTAGRAM_ID, {
      fields: 'id,username,name,biography,media_count,followers_count,follows_count,profile_picture_url,website',
    }, token);
    const igUsername = profile?.username || null;
    const media = await graphCall(out, 'instagram media (5 newest)', `${config.INSTAGRAM_ID}/media`, {
      fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,view_count',
      limit: 5,
    }, token);
    // Per-media insights are what fills Likes/Comments when the account-level
    // insight is empty — so capture one verbatim, including its error.
    const firstId = media?.data?.[0]?.id || null;
    if (firstId) {
      const mediaType = String(media?.data?.[0]?.media_type || '').toUpperCase();
      const metrics = ['REELS', 'VIDEO'].includes(mediaType)
        ? 'plays,likes,comments,shares,saved'
        : 'likes,comments,shares,saved,impressions,reach';
      await graphCall(out, `instagram media insights (${firstId})`, `${firstId}/insights`, { metric: metrics }, token);
    } else {
      out.calls['instagram media insights'] = { ok: false, error: 'no media returned, so per-media insights could not be probed' };
    }
    // Meta's (#36104) on /media says the field is available "outside of the
    // Business Discovery API" — so probe that route too. This is the difference
    // between "the token can never read the posts" and "it can, via discovery".
    if (!firstId && igUsername) {
      await graphCall(out, `instagram media via business_discovery (${igUsername})`, config.INSTAGRAM_ID, {
        fields: `business_discovery.username(${igUsername}){media.limit(5){id,caption,media_type,timestamp,permalink,like_count,comments_count,view_count}}`,
      }, token);
    }

    // Account-level insights. The interaction metrics are `total_value` metrics
    // and Meta answers a form it does not accept with an EMPTY 200 — no error, no
    // rows — which is exactly how likes/comments disappeared behind a 0 card.
    // One request earlier asked for all of them with `period=day` and no
    // metric_type, and only proved that Meta rejects that form; it could not say
    // which form this account DOES accept. So each form is probed separately.
    const dailyMetrics = 'reach,follower_count,views,content_views,online_followers';
    const totalMetrics = 'likes,comments,shares,saves,total_interactions,profile_views,website_clicks,accounts_engaged';
    const forms = [
      { name: 'period=day', params: { metric: dailyMetrics, period: 'day', date_preset: preset } },
      { name: 'total_value+day', params: { metric: totalMetrics, metric_type: 'total_value', period: 'day', date_preset: preset } },
      { name: 'total_value (no period)', params: { metric: totalMetrics, metric_type: 'total_value', date_preset: preset } },
      { name: 'total_value+day, since/until', params: { metric: totalMetrics, metric_type: 'total_value', period: 'day', since: Math.floor((Date.now() - days * 86400000) / 1000), until: Math.floor(Date.now() / 1000) } },
    ];
    out.instagramInsightForms = {};
    for (const form of forms) {
      const key = `instagram insight — ${form.name}`;
      const body = await graphCall(out, key, `${config.INSTAGRAM_ID}/insights`, form.params, token);
      const names = Array.isArray(body?.data) ? body.data.map((m) => m && m.name).filter(Boolean) : [];
      out.instagramInsightForms[form.name] = {
        requested: form.params.metric,
        ok: Boolean(body),
        metricsReturned: names,
        rows: Array.isArray(body?.data) ? body.data.reduce((n, m) => n + ((m?.values || []).length), 0) : 0,
        error: body ? null : out.calls[key]?.error || null,
      };
    }
  } else {
    out.calls['instagram profile'] = { ok: false, error: 'INSTAGRAM_ID is not set — this is why Instagram returns nothing' };
  }

  const failed = Object.entries(out.calls).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  out.summary = failed.length ? `ISSUES — ${failed.join(', ')}` : 'ALL OK';
  return out;
}

/** Google Search Console: token scopes, verified sites, one raw query. */
async function gscRaw(query = {}) {
  const out = {
    configured: Boolean(config.GSC_REFRESH_TOKEN && config.GSC_CLIENT_ID),
    baseUrl: config.GSC_API_BASE,
    siteFromEnv: config.GSC_SITE_URL || null,
    calls: {},
    summary: '',
  };
  if (!out.configured) {
    out.summary = 'GSC_REFRESH_TOKEN / GSC_CLIENT_ID are not set';
    return out;
  }
  const days = Number(query.days) > 0 ? Math.min(Number(query.days), 90) : 28;
  const end = new Date();
  end.setDate(end.getDate() - 3); // GSC data lags 2–3 days
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  try {
    await gsc.getGSCAccessToken();
    out.calls['token refresh'] = { ok: true, note: 'GSC credentials refreshed successfully' };
  } catch (e) {
    out.calls['token refresh'] = { ok: false, error: e.message, code: e.code || null, hint: e.hint || null };
    out.summary = 'FAILED — token refresh';
    return out;
  }

  let sites = [];
  try {
    const t = Date.now();
    sites = await gsc.getSites();
    out.calls['verified sites'] = { ok: true, ms: Date.now() - t, count: Array.isArray(sites) ? sites.length : 0, data: sites };
  } catch (e) {
    out.calls['verified sites'] = { ok: false, error: e.message };
  }

  const siteUrl = config.GSC_SITE_URL || (Array.isArray(sites) ? sites[0]?.siteUrl || sites[0]?.id : null);
  if (!siteUrl) {
    out.calls['search analytics query'] = { ok: false, error: 'no site to query — set GSC_SITE_URL' };
  } else {
    const t = Date.now();
    try {
      const rows = await gsc.querySearchAnalytics(siteUrl, {
        dimensions: ['date'],
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        rowLimit: 10,
      });
      out.calls['search analytics query'] = {
        ok: true,
        ms: Date.now() - t,
        siteUrl,
        window: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
        // querySearchAnalytics returns the whole body ({ rows: [...] }), so
        // counting only an array reported 0 rows over 10 real ones.
        rows: Array.isArray(rows) ? rows.length : Array.isArray(rows?.rows) ? rows.rows.length : 0,
        data: rows,
      };
    } catch (e) {
      out.calls['search analytics query'] = { ok: false, ms: Date.now() - t, siteUrl, error: e.message, hint: e.hint || null };
    }
  }

  const failed = Object.entries(out.calls).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  out.summary = failed.length ? `ISSUES — ${failed.join(', ')}` : 'ALL OK';
  return out;
}

/** YouTube: the credential/scope probe (Analytics works, Data API usually does not). */
async function youtubeRaw() {
  const { rep } = await youtube.debugYouTube();
  return {
    configured: Boolean(config.YOUTUBE_REFRESH_TOKEN && config.GOOGLE_CLIENT_ID),
    endpoints: { token: config.GOOGLE_TOKEN_URL, analytics: config.YOUTUBE_ANALYTICS_URL, data: config.YOUTUBE_DATA_API_URL },
    ...rep,
  };
}

/** Zernio (LinkedIn + Pinterest), verbatim. */
async function zernioRaw(query = {}) {
  return zernio.rawDump(query);
}

module.exports = { graphRaw, gscRaw, youtubeRaw, zernioRaw };
