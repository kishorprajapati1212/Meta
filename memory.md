# Project Memory — Meta Social & SEO Analytics API v4.0

## Platforms (6)
| # | Platform | Auth | Source | Endpoint |
|---|---|---|---|---|
| 1 | Facebook | UserToken→PageToken | Graph API | /api/facebook |
| 2 | Instagram | UserToken | Graph API | /api/instagram |
| 3 | YouTube | RefreshToken (set #1) | Analytics API | /api/youtube |
| 4 | LinkedIn | Zernio API Key | Zernio | /api/linkedin |
| 5 | Pinterest | Zernio API Key | Zernio | /api/pinterest |
| 6 | Google Search Console | RefreshToken (set #2) | Webmasters API | /api/gsc |

## Google Credentials: Two Separate Sets
- **YouTube**: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN — uses youtube + yt-analytics scopes
- **GSC**: GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN — uses webmasters.readonly scope
- They SHOULD be separate Google Cloud projects for security isolation

## GSC Implementation
- REST API at `https://www.googleapis.com/webmasters/v3`
- `GET /sites` — list verified sites
- `POST /sites/{siteUrl}/searchAnalytics/query` — search analytics
- Dimensions: date, query, page, country, device
- Metrics: clicks, impressions, ctr, position
- Data has 2-3 day delay — endpoint auto-clips to safe range
- When dimensions=date: returns metrics/timeseries
- When dimensions=query/page/country: returns topItems[]

## Key Decisions
1. Separate Google credentials for YouTube vs GSC
2. GSC uses direct axios REST calls (no googleapis package)
3. Token cache with 2min buffer per service
4. GSC dimensions parameter controls output shape
5. Compact mode across all platforms
6. Combined endpoint handles 6 platforms with graceful errors

## Date of Last Update
2026-07-18
