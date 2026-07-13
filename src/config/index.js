require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,

  // ── Meta (Facebook + Instagram) ──
  FACEBOOK_PAGE_ID:  process.env.FACEBOOK_PAGE_ID,
  INSTAGRAM_ID:      process.env.INSTAGRAM_ID,
  USER_ACCESS_TOKEN: process.env.ACCESS_TOKEN,
  FB_API_VERSION:    process.env.FB_API_VERSION || 'v19.0',
  FB_API_BASE:       'https://graph.facebook.com',

  // ── YouTube ──
  YOUTUBE_REFRESH_TOKEN:   process.env.YOUTUBE_REFRESH_TOKEN,
  GOOGLE_CLIENT_ID:        process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET:    process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_TOKEN_URL:        'https://oauth2.googleapis.com/token',
  YOUTUBE_ANALYTICS_URL:   'https://youtubeanalytics.googleapis.com/v2/reports',
  YOUTUBE_DATA_API_URL:    'https://www.googleapis.com/youtube/v3',

  // ── Shared ──
  ACCOUNT_CREATED:   process.env.ACCOUNT_CREATED || '2026-07-05',
  MAX_HISTORY_YEARS: 2,
};
