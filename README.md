# Meta Social & SEO Analytics API v4.0

**6 platforms:** Facebook · Instagram · YouTube · LinkedIn · Pinterest · Google Search Console

## Quick Start
```bash
cp .env.example .env  # fill all credentials
npm install && npm start
```

## .env (all credentials required — there are 3 separate Google credential sets)

```env
# Meta (Facebook + Instagram)
ACCESS_TOKEN=
INSTAGRAM_ID=
FACEBOOK_PAGE_ID=

# YouTube (set #1)
YOUTUBE_REFRESH_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Google Search Console (set #2 — different from YouTube!)
GSC_REFRESH_TOKEN=
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
GSC_SITE_URL=https://www.your-site.com/

# Zernio (LinkedIn + Pinterest)
ZERNIO_API_KEY=
```

## Getting GSC Refresh Token

1. Google Cloud Console → Create project → Enable "Google Search Console API"
2. Create OAuth 2.0 Client ID → add redirect URI: `https://developers.google.com/oauthplayground`
3. OAuth Playground → ⚙️ Use your own credentials → Select `webmasters.readonly` scope → Authorize → Exchange → Copy refresh token
4. Verify your website in Google Search Console
5. Set `GSC_SITE_URL` in .env

## Endpoints

| Endpoint | Platform |
|---|---|
| GET /api/facebook | Facebook Page |
| GET /api/instagram | Instagram Business |
| GET /api/youtube | YouTube Channel |
| GET /api/linkedin | LinkedIn (via Zernio) |
| GET /api/pinterest | Pinterest (via Zernio) |
| GET /api/gsc | Google Search Console |
| GET /api/combined | All 6 in one call |
| GET /api/health | Token check for all |

## GSC Special Features

**Time-based (default):** Returns overview, timeseries, metrics (clicks, impressions, CTR, position)

**Top keywords:** `GET /api/gsc?dimensions=query&rowLimit=20`
Returns `topItems[]` — top search queries ranked by clicks

**Top pages:** `GET /api/gsc?dimensions=page&rowLimit=20`
Returns `topItems[]` — top landing pages

**By country:** `GET /api/gsc?dimensions=country`

**By device:** `GET /api/gsc?dimensions=device`

### Data Latency
- Google Search Console: 2-3 day delay (API automatically clips to safe range)
- LinkedIn: near real-time
- Pinterest: 24-48h
- Facebook/Instagram: 1-2 days
- YouTube: 24-48h
