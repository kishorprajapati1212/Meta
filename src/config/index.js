require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,

  // ── Meta (Facebook + Instagram) ────────────────────────────────
  FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID,
  INSTAGRAM_ID: process.env.INSTAGRAM_ID,
  USER_ACCESS_TOKEN: process.env.ACCESS_TOKEN,
  FB_API_VERSION: process.env.FB_API_VERSION || 'v19.0',
  FB_API_BASE: process.env.FB_API_BASE || 'https://graph.facebook.com',

  // ── YouTube (Google credential set #1) ─────────────────────────
  YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_TOKEN_URL: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  YOUTUBE_ANALYTICS_URL:
    process.env.YOUTUBE_ANALYTICS_URL || 'https://youtubeanalytics.googleapis.com/v2/reports',
  YOUTUBE_DATA_API_URL: process.env.YOUTUBE_DATA_API_URL || 'https://www.googleapis.com/youtube/v3',

  // ── Google Search Console (Google credential set #2) ───────────
  GSC_REFRESH_TOKEN: process.env.GSC_REFRESH_TOKEN,
  GSC_CLIENT_ID: process.env.GSC_CLIENT_ID,
  GSC_CLIENT_SECRET: process.env.GSC_CLIENT_SECRET,
  GSC_SITE_URL: process.env.GSC_SITE_URL,
  GSC_API_BASE: process.env.GSC_API_BASE || 'https://www.googleapis.com/webmasters/v3',

  // ── Zernio (LinkedIn + Pinterest) ──────────────────────────────
  // Overridable so the self-test can point at a local mock server.
  ZERNIO_API_KEY: process.env.ZERNIO_API_KEY,
  ZERNIO_BASE_URL: process.env.ZERNIO_BASE_URL || 'https://zernio.com/api',

  // ── Shared ─────────────────────────────────────────────────────
  ACCOUNT_CREATED: process.env.ACCOUNT_CREATED || '2026-07-05',
  VERSION: '4.2.0',
};
