# Project Memory — Meta Social & SEO Analytics

> **v4.1.0 API · v2.0.0 dashboard · last updated 2026-10-15**
> The detailed, living context document is **[`context.md`](./context.md)** —
> architecture, full response contract, every decision and why, known
> limitations, changelog. This file is the quick-recall summary. **Update both
> on every change.**

## Platforms (6)
| # | Platform | Auth | Source | Endpoint |
|---|---|---|---|---|
| 1 | Facebook Page | Page access token | Graph API | `/api/facebook` |
| 2 | Instagram Business | Same token | Graph API | `/api/instagram` |
| 3 | YouTube | Refresh token (Google set #1) | Analytics + Data API | `/api/youtube` |
| 4 | LinkedIn | Zernio API key | Zernio | `/api/linkedin` |
| 5 | Pinterest | Zernio API key | Zernio | `/api/pinterest` |
| 6 | Google Search Console | Refresh token (Google set #2) | Webmasters v3 REST | `/api/gsc` |

Plus: `/api/combined` (all six + `data.summary`), `/api/health` (actionable per
platform), `/api/zernio/debug`, `/api/zernio/accounts`, `/app` (dashboard).

## Two separate Google credential sets
- **YouTube:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` — `youtube.readonly` + `yt-analytics-monetary.readonly`
- **GSC:** `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN` — `webmasters.readonly`
- Separate Google Cloud projects recommended.

## The metric KIND system (`src/utils/metrics.js`) — core convention
Every overview entry carries `{key,label,kind,unit,group,total,previous,trend,hasData}`.

| kind | aggregate as | examples |
|---|---|---|
| `sum` | Σ | impressions, likes, clicks |
| `gauge` | last value | followers, pins, boards, monthlyViews |
| `rate` | mean | ctr, engagementRate |
| `avg` | mean | averageViewDuration, GSC position |
| `duration` | Σ + unit | estimatedMinutesWatched |
| `count` | Σ | posts |

`trend` = 2nd half vs 1st half of the range. Zeros are **never** dropped
(`hasData:false` = real zero). Deprecated Meta metrics live in `optional:true`
groups and fail into `partialErrors`, never breaking the payload.

## The Pinterest bug (fixed in v4.1)
Symptom: dashboard showed only "Posts". Root causes:
1. `buildOverview()` only added a key when `v > 0` → `overview:{}`.
2. `getAccounts()` swallowed its error → `meta.account:null` → no pins/boards/monthly views.
3. Frontend fallback `primaryMetricLabel()` returned `{key:'posts'}` when overview was empty; `/api/combined` also stripped meta/totals and truncated posts to 3.
Fix: metric catalogue always emitted, resilient account lookup + diagnostics,
dense timelines, real trends, boards fetched, external-post sync via
`POST /v1/posts/sync-external`, combined passes everything through, frontend
rebuilt with a `normalize.js` union (no whitelist, no zero filtering).

## Frontend (`/Pulse`, rebuilt from scratch)
React 18 + Vite 6 + Tailwind 3 + Recharts 2 + lucide-react. Light SaaS design
(white cards, `#F5F7FA` canvas, brand `#2F6BFF`, Inter + Plus Jakarta Sans,
tabular numerals). Pages: Overview, 5 platform pages, Search Console,
Connections. Key modules: `lib/normalize.js` (payload → view model; **if a
metric is missing on screen, the bug is here**), `lib/format.js`,
`lib/platforms.js`, `lib/sample.js`, `lib/api.js`. Sample-data mode is labelled
and off by default. Runs against a v4.0 backend too (legacy health + untyped
overview entries are normalised).

## Testing
- `npm test` — 33 backend assertions vs `scripts/mockZernio.js` (no network; modes: `zero-analytics`, `rich`, `accounts-500`, `boards-404`, `no-analytics-access`)
- `npm run fixtures` — records real API output into `Pulse/scripts/fixtures/`
- `cd Pulse && npm run smoke` — 43 SSR render assertions against those fixtures, incl. v4.0 legacy payloads

## Known state of the live deployment (2026-10-15)
- Facebook + Instagram → HTTP 400: expired `ACCESS_TOKEN`. Needs a new long-lived Page token in Render.
- Pinterest/LinkedIn → metrics zero upstream (`hasAnalyticsAccess:false`, 24–48h lag).
- YouTube → analytics work; channel identity is a fallback because the token lacks `youtube.readonly`.
- GSC → healthy (`https://kishor-prajapti.netlify.app/`, second verified site `https://attendex12345.netlify.app/`).
- The deployed backend is still v4.0 until redeployed; the new dashboard is backwards compatible with it.

## Standing rules
1. Update `context.md` (and this file) with every change.
2. Never drop a metric because its value is zero.
3. Never aggregate without consulting the metric's `kind`.
4. Keep hooks above early returns in every React component.
5. All hooks/`useMemo` in `GscPage`, `PlatformPage`, `OverviewPage` must survive the error→data transition.
6. Don't reintroduce `key` as a data field in objects spread into JSX (use `id`).
