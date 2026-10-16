# Meta Social & SEO Analytics API

One Express API + one React dashboard for six channels: **Facebook Page,
Instagram Business, YouTube, LinkedIn, Pinterest and Google Search Console.**

- **API:** `/src` → `http://localhost:5000/api` (deployed: `https://meta-ptze.onrender.com`)
- **Dashboard:** `/Pulse` → dev server `5173`, or served by the API at `/app` once built
- **Docs:** `GET /docs.html`
- **Project context:** [`context.md`](./context.md) — architecture, data contract, decisions, changelog. *Update it with every change.*
- **Short summary:** [`memory.md`](./memory.md)

---

## Quick start

```bash
# 1. API
cp .env.example .env      # fill in your credentials (all optional individually)
npm install
npm start                 # http://localhost:5000/api

# 2. Dashboard (new terminal)
cd Pulse
npm install
npm run dev:local         # http://localhost:5173, proxying /api to localhost:5000
```

Serve the dashboard from the API itself:

```bash
cd Pulse && npm run build && cd ..
npm start                 # → http://localhost:5000/app
```

---

## Configuration

| Variable | Required for | Notes |
|---|---|---|
| `PORT` | — | default `5000` |
| `ACCESS_TOKEN` | Facebook + Instagram | Meta **Page** token (use a long-lived one) |
| `FACEBOOK_PAGE_ID` | Facebook | |
| `INSTAGRAM_ID` | Instagram | IG business account id |
| `YOUTUBE_REFRESH_TOKEN` | YouTube | Google OAuth set #1 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube | |
| `GSC_REFRESH_TOKEN` | Search Console | Google OAuth set #2 |
| `GSC_CLIENT_ID` / `GSC_CLIENT_SECRET` | Search Console | |
| `GSC_SITE_URL` | Search Console | e.g. `https://example.com/` |
| `ZERNIO_API_KEY` | LinkedIn + Pinterest | from [zernio.com](https://zernio.com) |
| `ACCOUNT_CREATED` | — | default `2020-01-01`; start date for lifetime queries |

That is the complete set — **no other variable is read or required**. A few
internal `*_BASE_URL` defaults exist in `src/config/index.js` solely so the
offline test-suite can point services at a local mock; they always fall back to
the real production endpoints, so never add them to your `.env`.
Values are cleaned on read (CRLF, surrounding quotes, stray spaces), so a
`.env` copied from Windows or pasted with quotes cannot corrupt a token.

---

## Endpoints

| Endpoint | What it returns |
|---|---|
| `GET /api` | Index: every route, its parameters and accepted values |
| `GET /api/facebook` | Page fans & growth, reach, impressions, views, engagement, interactions |
| `GET /api/instagram` | Followers, reach, impressions, profile visits, website clicks, engagement |
| `GET /api/youtube` | Views, watch time, average view %, subscribers, likes/comments/shares, channel lifetime stats |
| `GET /api/linkedin` | Followers, impressions, clicks, shares, comments, reactions, profile views, posts |
| `GET /api/pinterest` | Impressions, clicks, outbound clicks, saves, follows, pins, boards, monthly views, pin list |
| `GET /api/gsc` | Clicks, impressions, CTR, position; by date or by query/page/country/device |
| `GET /api/combined` | All six in one call **plus** `data.summary` — a cross-channel roll-up |
| `GET /api/health` | Per-platform `{status, message, hint, configured, source}` — says exactly what to fix |
| `GET /api/zernio/debug` | Zernio connectivity, scopes, account list, analytics access |

Every platform payload may also carry **`data.demographics`** — audience
composition (age, gender, countries, cities, devices) with an explicit
`missing` list and `available:false` when the upstream simply does not publish
it. YouTube reports viewer *shares*, Instagram/Facebook follower *counts*,
Search Console clicks by country/device, and Zernio (LinkedIn/Pinterest)
nothing at all — the API says so instead of inventing numbers.

### Parameters

| Param | Values |
|---|---|
| `date_preset` | `today`, `yesterday`, `last_7d`, `last_14d`, `last_30d`, `last_60d`, `last_90d`, `last_120d`, `last_180d`, `last_365d`, `all_time` |
| `since` / `until` | `YYYY-MM-DD` (overrides the preset) |
| `compact` | `true` → drop all-zero days from `timeseries` (Meta/YouTube/GSC) |
| `dimensions` | GSC only: `date`, `query`, `page`, `country`, `device` |
| `compare` | GSC only: `false` → skip the previous-period window |
| `sync` | LinkedIn/Pinterest: `false` → don't trigger external-post sync |

### Example

```bash
curl "http://localhost:5000/api/combined?date_preset=last_30d"
```

```jsonc
{
  "success": true,
  "platform": "combined",
  "data": {
    "facebook":  { "overview": {…}, "timeseries": […], "metrics": […] },
    "pinterest": { "overview": {…}, "timeseries": […], "posts": […], "meta": {…} },
    "gsc":       { "overview": {…}, "topItems": […] },
    "summary":   { "platforms": […], "totals": { "audience": 0, "impressions": 0, … },
                   "connected": ["youtube","searchConsole","linkedin","pinterest"],
                   "failed": [{ "platform": "facebook", "error": "…", "hint": "…" }] }
  },
  "meta": { "dateRange": {…}, "platforms": […], "params": {…} }
}
```

---

## The response contract

Every metric in `data.overview` is self-describing, so the UI never has to guess:

```jsonc
{ "label": "Impressions", "kind": "sum", "unit": "", "group": "Traffic",
  "total": 23700, "previous": 21100, "trend": 12.3, "hasData": true }
```

`kind` decides how values are aggregated — **this is what keeps the numbers
correct**:

| kind | aggregation | examples |
|---|---|---|
| `sum` | Σ over the range | impressions, likes, clicks |
| `gauge` | last value in the range | followers, pins, boards |
| `rate` | mean of daily rates | ctr, engagementRate |
| `avg` | mean of daily averages | averageViewDuration, position |
| `duration` | Σ with unit conversion | estimatedMinutesWatched |
| `count` | Σ of items | posts published |

`trend` = second half of the range vs first half. `hasData:false` means a real
zero, and **zeros are never dropped** — the UI renders them with the reason
(e.g. no analytics access, metric deprecated, no posts in range).

---

## Dashboard

Light SaaS design system: white cards, hairline borders, tabular numerals,
brand-accurate platform colours.

- **Overview** — cross-channel KPIs with per-channel breakdown bars, channel
  comparison table, trend switcher, engagement donut, GSC panel, recent content,
  "needs attention" list.
- **Per-platform pages** — every metric grouped (Audience · Traffic ·
  Consumption · Engagement · Activity · Quality), each KPI card clickable to
  chart that series, daily drill-down table, all-metrics table with CSV export,
  posts/pins grid, Pinterest boards, follower history, API diagnostics.
- **Search Console** — dimension switcher (timeline / keywords / pages /
  countries / devices), ranked bar lists, "quick wins" (high impressions, low
  CTR), verified properties.
- **Audience** — a real choropleth world map (generated from Natural Earth
  boundaries), age×gender pyramid, gender bar, device donut and top cities, per
  channel, plus an all-channel presence map. Channels whose upstream publishes
  no demographics show a locked card explaining why.
- **Overview stage layer** — growth-stage hero (awareness → consideration →
  conversion), 120-day publishing calendar heatmap, streaks, next-milestone
  progress and rule-based next actions, so a young channel with zero engagement
  still reads as a business instead of a wall of zeros.
- **Connections** — per-channel credential state with the exact upstream message
  and the fix, Zernio/YouTube diagnostic runners, API base URL override.
- **Sample data mode** (flask icon) — renders the full dashboard from generated
  data in the exact API shape, clearly labelled, so the design can be reviewed
  while live credentials are broken.

---

## Running it

| Command | What it does |
| --- | --- |
| `npm run dev:all` | API on `:5000` **and** dashboard on `:5173`, proxy already wired |
| `npm start` | API only (serves the built dashboard at `/app`) |
| `npm run build:ui` | Rebuild `Pulse/dist` — required before committing/deploying |
| `npm test` | 47 offline checks + 28 upstream wire checks (mock Graph/Google) |
| `npm run smoke` (in `Pulse/`) | 73 dashboard render checks |
| `npm run smoke:live` (in `Pulse/`) | renders every page against a **live** API and reports which metrics carry data |

In dev the dashboard proxies `/api` to the local API first, then to
`VITE_FALLBACK_API` (your deployed host), and finally answers with a JSON error
that names the fix — so a sleeping backend never becomes a blank page.

---

## Project IDX

Open the repo at https://idx.dev and `.idx/dev.nix` sets up Node 20 + Docker,
installs both dependency trees, builds the dashboard on start, and declares web
previews for the dashboard (`:5173`), the API (`:5000`, serves `/app`) and the
credential-free Docker demo.

---

## Is my deployment actually returning data?

```bash
cd Pulse
npm run smoke:live -- --api https://meta-ptze.onrender.com
```

It fetches `/api/health`, `/api/combined` and every channel endpoint, renders
Overview / each channel / Audience / Connections with those real payloads, prints
a per-channel table (metrics, how many carry data, demographics yes/no) and exits
non-zero if a page crashes or a "healthy" channel comes back empty.

---

## Docker

```bash
docker compose up --build                                # real credentials from .env
docker compose -f docker-compose.yml \
               -f docker-compose.mock.yml up --build     # zero credentials: mock Zernio
```

The image is multi-stage: it builds the dashboard, then serves the API **and**
the dashboard at `/app` from one container, as an unprivileged user, with a
healthcheck on `/api/health`.

---

## Testing

```bash
npm test               # 41 backend assertions against a local mock Zernio — no network
npm run fixtures       # record real API payloads into Pulse/scripts/fixtures/
cd Pulse && npm run smoke   # 52 render assertions (SSR) against those fixtures
```

`scripts/mockZernio.js` reproduces every Zernio failure mode we hit in
production: all-zero Pinterest analytics (the original bug), rich analytics,
`/v1/accounts` returning 500, boards 404, and `hasAnalyticsAccess:false`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `facebook` / `instagram` → HTTP 400 `Request failed with status code 400` | Expired or invalid `ACCESS_TOKEN`, wrong page/IG id, or missing `pages_read_engagement` / `instagram_manage_insights` scope | Generate a new long-lived Page token, put it in the env vars, restart. `GET /api/health` returns the exact steps. |
| Pinterest/LinkedIn metrics all zero | Zernio analytics not enabled for the key (`hasAnalyticsAccess:false`), or the posts are outside the date range, or metrics still lagging 24–48h | Enable analytics access on the Zernio plan; widen the range; wait for sync. The response `notice` says which. |
| YouTube card says "YouTube Channel" with 0 subscribers | Refresh token lacks `youtube.readonly` | Add the scope when generating the token. Analytics still work without it. |
| GSC `position` shows as `0.00` | Google returns position `0` when there are no impressions in the window | Expected; the card renders as muted with a note. |
| Dashboard shows "Could not read the Zernio account list" | `/v1/accounts` failing for that key | `GET /api/zernio/debug` shows the raw upstream response and scopes. |

---

## Version

API **v4.2.3** · Dashboard **2.1.2** · Node **18+** · Docker `docker compose up` · Project IDX ready
