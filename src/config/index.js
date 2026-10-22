/**
 * config/index.js — every environment variable in one place.
 *
 * THE USER-FACING SET IS EXACTLY `.env.example`. Nothing else is required, and
 * nothing else is documented. The names below must never be renamed:
 *
 *   ACCESS_TOKEN, INSTAGRAM_ID, FACEBOOK_PAGE_ID,
 *   YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *   GSC_REFRESH_TOKEN, GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_SITE_URL,
 *   ZERNIO_API_KEY, PORT, FB_API_VERSION, ACCOUNT_CREATED
 *
 * A handful of *_BASE_URL / *_TOKEN_URL values exist purely so the offline
 * self-test can point services at a local mock server. They always fall back
 * to the real production endpoints, so a .env that contains only the
 * variables above works unchanged.
 *
 * Values are cleaned on read: a .env copied from Windows (CRLF), or pasted
 * with surrounding quotes or trailing spaces, used to silently corrupt tokens
 * and produce "Request failed with status code 400". Cleaning here means the
 * file format can no longer break authentication.
 */
require('dotenv').config();

/** Trim CRLF/whitespace and strip one layer of wrapping quotes; '' → undefined. */
function env(key) {
  const v = process.env[key];
  if (v === undefined || v === null) return undefined;
  let s = String(v).replace(/\r/g, '').trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) || (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
    s = s.slice(1, -1);
  }
  return s === '' ? undefined : s;
}

module.exports = {
  PORT: Number(env('PORT')) || 5000,

  // ── META (Facebook + Instagram) ────────────────────────────────
  FACEBOOK_PAGE_ID: env('FACEBOOK_PAGE_ID'),
  INSTAGRAM_ID: env('INSTAGRAM_ID'),
  USER_ACCESS_TOKEN: env('ACCESS_TOKEN'),
  FB_API_VERSION: env('FB_API_VERSION') || 'v19.0',
  // internal/test override only — never required
  FB_API_BASE: env('FB_API_BASE') || 'https://graph.facebook.com',

  // ── YOUTUBE (Google credential set #1) ─────────────────────────
  YOUTUBE_REFRESH_TOKEN: env('YOUTUBE_REFRESH_TOKEN'),
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
  // internal/test overrides only — never required
  GOOGLE_TOKEN_URL: env('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token',
  YOUTUBE_ANALYTICS_URL: env('YOUTUBE_ANALYTICS_URL') || 'https://youtubeanalytics.googleapis.com/v2/reports',
  YOUTUBE_DATA_API_URL: env('YOUTUBE_DATA_API_URL') || 'https://www.googleapis.com/youtube/v3',

  // ── GOOGLE SEARCH CONSOLE (Google credential set #2) ───────────
  GSC_REFRESH_TOKEN: env('GSC_REFRESH_TOKEN'),
  GSC_CLIENT_ID: env('GSC_CLIENT_ID'),
  GSC_CLIENT_SECRET: env('GSC_CLIENT_SECRET'),
  GSC_SITE_URL: env('GSC_SITE_URL'),
  // internal/test override only — never required
  GSC_API_BASE: env('GSC_API_BASE') || 'https://www.googleapis.com/webmasters/v3',

  // ── ZERNIO (LinkedIn + Pinterest) ──────────────────────────────
  ZERNIO_API_KEY: env('ZERNIO_API_KEY'),
  // internal/test override only — never required (the self-test points it at a mock)
  ZERNIO_BASE_URL: env('ZERNIO_BASE_URL') || 'https://zernio.com/api',

  // ── OPTIONAL ───────────────────────────────────────────────────
  ACCOUNT_CREATED: env('ACCOUNT_CREATED') || '2026-07-05',
  VERSION: '4.3.5',

  // Exposed only so the self-test can prove .env formatting cannot break auth.
  _clean: env,
};
