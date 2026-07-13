# Meta & YouTube Analytics API v2.1

Facebook Page + Instagram Business + YouTube Channel — unified, frontend‑ready JSON.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your credentials (see below)
npm install
npm start
```

## .env Setup

```env
# Meta (Facebook + Instagram)
ACCESS_TOKEN=your_facebook_user_access_token
INSTAGRAM_ID=your_ig_business_account_id
FACEBOOK_PAGE_ID=your_fb_page_id

# YouTube (only yt-analytics.readonly required; add youtube.readonly for channel info)
YOUTUBE_REFRESH_TOKEN=your_youtube_refresh_token
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Optional
PORT=5000
ACCOUNT_CREATED=2026-07-05
```

## Getting a YouTube Refresh Token

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → Create OAuth 2.0 Client ID (Web application)
2. Add `https://developers.google.com/oauthplayground` as redirect URI
3. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) → ⚙️ → Use your own credentials
4. Select scopes: `https://www.googleapis.com/auth/yt-analytics.readonly` (required) + `https://www.googleapis.com/auth/youtube.readonly` (optional, for channel thumbnails/names)
5. Authorize → Exchange authorization code → Copy **Refresh token**

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/facebook` | Facebook Page Insights |
| `GET /api/instagram` | Instagram Business Insights |
| `GET /api/youtube` | YouTube Channel Analytics |
| `GET /api/youtube/debug` | Step-by-step YouTube diagnostics |
| `GET /api/combined` | All 3 platforms in one call |
| `GET /api/health` | Token health check for all platforms |

All accept: `?date_preset=last_30d` or `?since=2026-07-01&until=2026-07-10`

## Response Shape

```json
{
  "success": true,
  "platform": "facebook",
  "meta": { "dateRange": { "from": "2026-06-10", "to": "2026-07-10" }, "metricCount": 8, "dataPoints": 240 },
  "data": {
    "overview": {
      "followers": { "total": 1250, "trend": 3.2 },
      "pageViews": { "total": 8400, "average": 280, "trend": -1.5 }
    },
    "timeseries": [
      { "date": "2026-07-05", "page_views_total": 310, "page_follows": 1240 }
    ],
    "metrics": [
      {
        "id": "page_views_total",
        "label": "Daily Total Views",
        "values": [ { "date": "2026-07-05", "value": 310 } ],
        "summary": { "total": 8400, "average": 280, "latest": 310, "previous": 285, "trend": 8.77 }
      }
    ]
  }
}
```

## Frontend Integration Map

| Field | Use for |
|---|---|
| `data.overview` | Dashboard summary cards (totals + % trends) |
| `data.overview.channel` | YouTube channel header (name, thumbnail, lifetime stats) |
| `data.timeseries` | Line/bar charts — one row per date |
| `data.metrics[].values` | Drill‑down tables |
| `data.metrics[].summary.trend` | Percentage arrow indicators |

## YouTube: analytics‑only mode

If you only have `yt-analytics.readonly` scope (without `youtube.readonly`):
- Analytics will still work perfectly
- Channel name/thumbnail will show as "YouTube Channel" / empty
- A notice will tell you to add the scope for full channel details

## Project Structure

```
src/
├── app.js                  # Entry point
├── config/index.js         # All environment config
├── routes/
│   ├── facebook.js         # GET /api/facebook
│   ├── instagram.js        # GET /api/instagram
│   ├── youtube.js          # GET /api/youtube + /debug
│   ├── combined.js         # GET /api/combined (all 3)
│   └── health.js           # GET /api/health
├── services/
│   ├── tokenService.js     # UserToken → PageToken
│   ├── facebookService.js  # FB fetch + transform
│   ├── instagramService.js # IG fetch + transform
│   └── youtubeService.js   # YT refresh + analytics
└── utils/
    ├── response.js         # Error handler (surfaces real API errors)
    ├── dateUtils.js        # Date parsing
    └── transform.js        # Raw → overview + timeseries + metrics
```
