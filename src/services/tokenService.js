/**
 * tokenService.js — exchanges the Meta USER token for a PAGE access token.
 *
 * v4.1: the old version cached the page token forever and threw raw axios
 * errors ("Request failed with status code 400"). Now the cache has a TTL, is
 * invalidated on failure, and every error carries a `hint` that the /api/health
 * endpoint and the dashboard surface to the user.
 */
const axios = require('axios');
const config = require('../config');

let cache = null;
let cacheAt = 0;
const TTL_MS = 45 * 60 * 1000; // page tokens are long-lived; refresh hourly anyway

function metaError(e) {
  const status = e.response?.status;
  const body = e.response?.data;
  const fbErr = body?.error;
  const message = fbErr?.message || body?.message || e.message || 'Unknown Meta API error';
  const code = fbErr?.code || e.code || (status ? 'HTTP_' + status : 'UNKNOWN');
  const subcode = fbErr?.error_subcode || null;

  let hint = null;
  const m = String(message).toLowerCase();
  if (code === 190 || m.includes('expired') || m.includes('session') || m.includes('oauthexception') || status === 400) {
    hint =
      'ACCESS_TOKEN is expired or invalid. Open https://developers.facebook.com/tools/explorer/, select your app, ' +
      'grant pages_show_list + pages_read_engagement + pages_read_user_content, generate a token, exchange it for a ' +
      'long-lived one, then call /me/accounts to get the PAGE token and put it in .env as ACCESS_TOKEN.';
  } else if (m.includes('permission') || m.includes('pages_show_list') || status === 403) {
    hint = 'The token lacks permissions. Required: pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights.';
  } else if (status === 404 || m.includes('does not exist') || m.includes('not found')) {
    hint = 'FACEBOOK_PAGE_ID does not match any page visible to this token.';
  } else if (code === 4 || code === 17 || code === 32 || m.includes('rate limit')) {
    hint = 'Meta rate limit hit — wait a few minutes and retry.';
  }

  return Object.assign(new Error(message), {
    code: `META_${code}`.replace('META_HTTP_', 'HTTP_'),
    httpStatus: status || 400,
    hint,
    subcode,
    details: fbErr || null,
  });
}

async function getPageAccessToken() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;

  if (!config.USER_ACCESS_TOKEN) {
    throw Object.assign(new Error('ACCESS_TOKEN is not set in .env'), {
      code: 'META_NO_TOKEN',
      httpStatus: 500,
      hint: 'Add ACCESS_TOKEN (a page or long-lived user token) to .env and restart.',
    });
  }

  try {
    const { data } = await axios.get(
      `${config.FB_API_BASE}/${config.FB_API_VERSION}/me/accounts`,
      {
        params: { access_token: config.USER_ACCESS_TOKEN, limit: 25 },
        timeout: 20000,
      }
    );
    const pages = data.data || [];
    if (!pages.length) {
      throw Object.assign(new Error('No Pages found for this token'), {
        code: 'NO_PAGES_FOUND',
        httpStatus: 403,
        hint: 'The token needs the pages_show_list permission, and the user must admin at least one Page.',
      });
    }
    const page = config.FACEBOOK_PAGE_ID
      ? pages.find((p) => p.id === config.FACEBOOK_PAGE_ID)
      : pages[0];
    if (!page) {
      throw Object.assign(new Error(`Page ${config.FACEBOOK_PAGE_ID} not found`), {
        code: 'PAGE_NOT_FOUND',
        httpStatus: 404,
        hint: `Visible pages: ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}`,
      });
    }
    cache = page.access_token;
    cacheAt = Date.now();
    cache = page.access_token;
    getPageAccessToken.lastPage = { id: page.id, name: page.name };
    console.log(`[token] Page token acquired for "${page.name}" (${page.id})`);
    return cache;
  } catch (e) {
    cache = null;
    cacheAt = 0;
    if (e.code && String(e.code).startsWith('META_')) throw e;
    if (e.code === 'NO_PAGES_FOUND' || e.code === 'PAGE_NOT_FOUND') throw e;
    throw metaError(e);
  }
}

/**
 * graphFields — read a Graph node in tolerant layers.
 *
 * One rejected field 400s the WHOLE request, which is why the page header used
 * to come back empty ("Request failed with status code 400", Meta's real message
 * thrown away). Each layer is its own request: identity fields first (always
 * allowed for a page token), then counts and extras that some tokens/versions
 * refuse. Whatever Meta serves is kept, and every refusal is reported with the
 * upstream message so it can be explained instead of guessed at.
 */
async function graphFields(nodeId, token, layers) {
  const data = {};
  const errors = [];
  for (const layer of layers) {
    try {
      const r = await axios.get(`${config.FB_API_BASE}/${config.FB_API_VERSION}/${nodeId}`, {
        params: { fields: layer.join(','), access_token: token },
        timeout: 20000,
      });
      Object.assign(data, r.data || {});
    } catch (e) {
      const fbErr = e.response?.data?.error;
      const message = fbErr?.message || e.message || 'Unknown Meta API error';
      const code = fbErr?.code || null;
      const status = e.response?.status || null;
      const m = String(message).toLowerCase();
      errors.push({
        fields: layer.join(','),
        message,
        code,
        status,
        hint:
          code === 190 || m.includes('oauthexception') || m.includes('session has expired')
            ? 'The Page/user token is expired — generate a new ACCESS_TOKEN.'
            : m.includes('permission') || m.includes('pages_read_engagement')
            ? 'The token lacks the permission for these fields; the rest of the profile still loads.'
            : null,
      });
    }
  }
  return { data, errors };
}

/** Which page/account details are attached to the working token. */
async function getAccountDetails() {
  const out = { facebook: null, instagram: null };
  try {
    const pt = await getPageAccessToken();
    const { data, errors } = await graphFields(config.FACEBOOK_PAGE_ID, pt, [
      ['id', 'name', 'link', 'category', 'username', 'picture.width(200)'],
      ['followers_count'],
      ['fan_count'],
      ['about', 'verification_status'],
    ]);
    if (data.id || data.name) {
      out.facebook = {
        id: data.id,
        name: data.name,
        username: data.username || null,
        followers: data.followers_count?.follower_count ?? data.fan_count ?? null,
        followerSource: data.followers_count?.follower_count != null ? 'followers_count' : data.fan_count != null ? 'fan_count' : null,
        likes: data.fan_count ?? null,
        category: data.category || null,
        link: data.link || null,
        picture: data.picture?.data?.url || null,
        about: data.about || null,
        ...(errors.length ? { fieldErrors: errors } : {}),
      };
    } else {
      out.facebook = {
        error: errors[0]?.message || 'Page profile unavailable',
        hint: errors[0]?.hint || null,
        code: errors[0]?.code || null,
        fieldErrors: errors,
      };
    }
  } catch (e) {
    out.facebook = { error: e.message, hint: e.hint || null, code: e.code || null };
  }

  if (config.INSTAGRAM_ID && config.USER_ACCESS_TOKEN) {
    const { data, errors } = await graphFields(config.INSTAGRAM_ID, config.USER_ACCESS_TOKEN, [
      ['id', 'username', 'name', 'profile_picture_url', 'website'],
      ['followers_count', 'follows_count', 'media_count'],
    ]);
    if (data.id || data.username) {
      out.instagram = {
        id: data.id,
        username: data.username || null,
        name: data.name || null,
        followers: data.followers_count ?? null,
        following: data.follows_count ?? null,
        mediaCount: data.media_count ?? null,
        picture: data.profile_picture_url || null,
        website: data.website || null,
        ...(errors.length ? { fieldErrors: errors } : {}),
      };
    } else {
      out.instagram = { error: errors[0]?.message || 'Instagram profile unavailable', hint: errors[0]?.hint || null, fieldErrors: errors };
    }
  }
  return out;
}

module.exports = { getPageAccessToken, getAccountDetails, graphFields, metaError };
