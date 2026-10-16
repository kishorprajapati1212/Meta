# context.md — Project Context (living document)

> **Rule for every future change:** update this file in the same commit. It is the
> single source of truth for what this project is, how the data flows, which
> decisions were made and why, and what is known to be broken. `memory.md` is a
> short summary; this file is the detail.
>
> **Last updated:** 2026-10-16 · **API version:** 4.2.1 · **Dashboard version:** 2.1.0

---

## 1. What this project is

A two-part system for reading social + SEO analytics from six platforms through
one API and one dashboard.

| Part | Path | Stack | Runs on |
|---|---|---|---|
| **Analytics API** | `/src` | Node 18+, Express 4, axios, dotenv | `PORT` (default 5000); deployed at `https://meta-ptze.onrender.com` |
| **Pulse dashboard** | `/Pulse` | React 18, Vite 6, Tailwind 3, Recharts 2, lucide-react, axios | dev 5173, or served by the API at `/app` |

### Platforms and where their data comes from

| # | Platform | Upstream | Credentials | Endpoint |
|---|---|---|---|---|
| 1 | Facebook Page | Meta Graph API | `ACCESS_TOKEN`, `FACEBOOK_PAGE_ID` | `/api/facebook` |
| 2 | Instagram Business | Meta Graph API | `ACCESS_TOKEN`, `INSTAGRAM_ID` | `/api/instagram` |
| 3 | YouTube | YouTube Analytics + Data API | Google set #1 (`GOOGLE_CLIENT_ID/SECRET`, `YOUTUBE_REFRESH_TOKEN`) | `/api/youtube` |
| 4 | LinkedIn | Zernio | `ZERNIO_API_KEY` | `/api/linkedin` |
| 5 | Pinterest | Zernio | `ZERNIO_API_KEY` | `/api/pinterest` |
| 6 | Google Search Console | Webmasters v3 REST | Google set #2 (`GSC_CLIENT_ID/SECRET`, `GSC_REFRESH_TOKEN`, `GSC_SITE_URL`) | `/api/gsc` |

There are **three separate credential sets** (Meta, Google #1 for YouTube,
Google #2 for GSC) plus Zernio. They are deliberately not shared.

---

## 2. Repository map

```
/                         API root
├── src/
│   ├── app.js            Express bootstrap, route mounting, serves /app + /docs.html
│   ├── config/index.js   The exact .env set (14 names), cleaned on read
│   ├── routes/           facebook, instagram, youtube, linkedin, pinterest, gsc,
│   │                     combined, health, zernio (debug)
│   ├── services/         facebookService, instagramService, youtubeService,
│   │                     gscService, zernioService, tokenService
│   └── utils/            metrics.js (kind system), transform.js, dateUtils.js, response.js
├── scripts/
│   ├── mockZernio.js     Local Zernio stand-in with switchable failure modes
│   ├── mockServer.js     Runs that mock as a container entry (compose mock profile)
│   ├── selftest.js       41 backend assertions      → npm test
│   ├── make-fixtures.js  Records real API output    → npm run fixtures
│   └── build-worldmap.mjs Generates Pulse/src/assets/worldMap.js (Natural Earth → SVG)
├── public/docs.html      Human-readable API docs
├── memory.md             Short project summary
└── Pulse/                Dashboard
    ├── src/
    │   ├── App.jsx       Shell: sidebar + topbar + page switch
    │   ├── lib/          api, platforms, format, normalize, sample, countries, csv, prefs, cls
    │   ├── assets/       worldMap.js (GENERATED country paths, ISO alpha-2 keyed)
    │   ├── hooks/        useAnalytics, usePlatformDetail
    │   └── components/   layout/ ui/ charts/ metrics/ platform/ panels/
    └── scripts/
        ├── smoke.jsx     43 render assertions       → npm run smoke
        └── fixtures/     Recorded API payloads used by the smoke test
```

---

## 3. The response contract (v4.1)

Every endpoint returns the same envelope:

```jsonc
{
  "success": true,
  "platform": "pinterest",
  "meta": { "dateRange": {"from":"2026-09-15","to":"2026-10-15"}, "source": "Zernio",
            "postCount": 3, "account": {…}, "boards": […], "sync": {…}, "diagnostics": {…} },
  "data": { "overview": {…}, "timeseries": […], "posts": […], "totals": {…}, … },
  "notice": "3 pins found, but Zernio returned zero impressions…"   // optional, human text
}
```

`GET /api/combined` returns `data.{facebook,instagram,youtube,linkedin,pinterest,searchConsole}`
each shaped like the inner `data` block **plus its own `meta`**, and adds
`data.summary` — a cross-platform roll-up the Overview page renders directly.

### 3.1 The metric KIND system (the most important convention in the repo)

`src/utils/metrics.js` classifies every metric id. The kind decides **how it is
aggregated** and **how it is formatted**. Getting this wrong is what produces
"improper numbers".

| kind | meaning | total = | examples |
|---|---|---|---|
| `sum` | additive counter | Σ over the range | impressions, likes, clicks |
| `gauge` | point-in-time level | **last** value | followers, pins, boards, monthlyViews |
| `rate` | percentage | **mean**, never Σ | ctr, engagementRate, avgViewPercentage |
| `avg` | mean of daily averages | mean | averageViewDuration, GSC position |
| `duration` | time quantity | Σ, unit-aware | estimatedMinutesWatched (min) |
| `count` | number of things | Σ | posts published |

Every `overview` entry therefore carries:

```jsonc
{ "key":"pins", "label":"Total pins", "kind":"gauge", "unit":"", "group":"Audience",
  "total":342, "previous":null, "trend":0, "hasData":true }
```

`hasData:false` means "genuinely zero" — the UI still renders the card, muted,
with the reason. **Zeros are never dropped from the payload.**

### 3.2 Trends

`trend` = % change of the **second half of the range vs the first half**
(`summarize()` in `metrics.js`). For GSC the comparison is a real previous
window of equal length (a second API call, disable with `?compare=false`).
For `position`, a *falling* number is flagged favourable (`invertTrend`).

### 3.3 Query parameters

| Param | Applies to | Effect |
|---|---|---|
| `date_preset` | all | `today, yesterday, last_7d, last_14d, last_30d, last_90d, last_365d` |
| `since` / `until` | all | explicit `YYYY-MM-DD` window (overrides preset) |
| `compact=true` | Meta/YouTube/GSC | drops all-zero days from `timeseries` (Zernio ignores it — its timeline is always dense) |
| `dimensions` | GSC | `date` (default) or `query`, `page`, `country`, `device` → returns `topItems[]` |
| `compare=false` | GSC | skip the previous-period window |
| `rowLimit` | GSC | default 1000 for date, 250 for groupings |
| `sync=false` | LinkedIn/Pinterest | skip the external-post sync trigger |

### 3.4 The demographics contract (v4.2)

`data.demographics` describes **who** the audience is, and is explicit about
what a platform cannot supply:

```jsonc
{ "available": true,
  "source": "YouTube Analytics API · viewerPercentage",
  "unit": "share",              // 'share' = % of viewers · 'count' = followers/clicks
  "asOf": "2026-10-15",
  "note": null,                 // why a dimension may be missing
  "gender": { "male": 61.4, "female": 36.2, "unknown": 2.4 },
  "age": [ { "bucket": "25-34", "male": 24.4, "female": 13.9, "total": 38.3 } ],
  "countries": [ { "code": "IN", "name": "India", "value": 41.2, "share": 41.2 } ],
  "cities": [ { "name": "Ahmedabad", "value": 214, "share": 16.7 } ],
  "devices": [ { "label": "Mobile phone", "value": 68.4, "share": 68.4 } ],
  "missing": ["cities"]         // dimensions this platform cannot report
}
```

Per platform: **YouTube** → viewer shares by age×gender, country, device
(hidden below its ~100-viewer privacy threshold; falls back to lifetime).
**Instagram** → follower counts by country, city, gender×age (`period=lifetime`).
**Facebook** → Page-fan counts by country and gender×age (partially retired by
Meta; every call optional). **Search Console** → clicks by country and device;
age/gender do not exist in that dataset. **LinkedIn / Pinterest** → Zernio
exposes nothing, so `available:false` with an honest note. `share` is always a
percentage even when the upstream gave counts, so one set of charts serves all.

### 3.5 Date presets (v4.2)

`today · yesterday · last_7d · last_14d · last_30d · last_60d · last_90d ·
last_120d · last_180d · last_365d · all_time`. `all_time` starts at
`ACCOUNT_CREATED`; upstreams still cap the window themselves (Zernio 366 days,
GSC ~16 months). Added because a young channel has too little signal in 30 days.

---

## 4. The Pinterest bug — root cause and fix

**Reported symptom:** "the backend sends Pinterest data through Zernio but the
dashboard shows only *Posts*."

**What the deployed v4.0 API actually returned** for `GET /api/pinterest?date_preset=last_90d`:

```jsonc
{ "meta": { "postCount": 3, "account": null, "hasAnalyticsAccess": false },
  "data": { "overview": {},                      // ← empty
            "totals": { "impressions":0, "clicks":0, … },
            "posts": [ …3 real pins… ],
            "platformBreakdown": { "pinterest": { "posts": 3 } } },
  "notice": null }
```

Three separate defects combined:

1. **`buildOverview()` dropped every metric whose value was `0`**
   (`const add = (k,v) => { if (v > 0) o[k] = … }`). All Pinterest analytics were
   zero, so `overview` came back `{}`.
2. **`getAccounts()` swallowed its own failure.** It called
   `/v1/accounts?limit=50` inside a `try/catch` that returned `{accounts: []}`,
   so `meta.account` became `null` — taking pins, boards, monthly views and
   followers with it. `/api/health` (which calls the same endpoint *without*
   params) reported `pinterest: "ok"`, which is why the failure looked
   impossible.
3. **The frontend had a fallback that hid the problem.** With `overview` empty,
   `primaryMetricLabel()` returned `{key:'posts', label:'Posts', total:3}` and
   `/api/combined` stripped `meta`, `totals`, `platformBreakdown` and all but 3
   posts anyway. So the only renderable fact was "Posts: 3".

**The fix (all in v4.1):**

| Layer | Change |
|---|---|
| `services/zernioService.js` | Per-platform metric **catalogue** always emitted (13 Pinterest keys, 13 LinkedIn keys) + any extra non-zero key Zernio sends. `getAccounts()` retries three param shapes and records the failure in `meta.diagnostics.steps.accounts.error` and in `notice`. Pinterest boards read from `/v1/accounts/{id}/pinterest-boards` with fallback to `accountStats.boardCount`. Account stats (`pinCount`, `boardCount`, `monthlyViews`, `externalPostCount`) exposed as gauge metrics. Dense daily timeline (one row per day, zeros filled) with follower history merged in. Real trends. External posts synced via `POST /v1/posts/sync-external` (was a stale endpoint), 10-min cache, capped at 5, reported in `meta.sync`. |
| `routes/combined.js` | Full pass-through: `meta` (incl. account/boards/sync/diagnostics), `totals`, `platformBreakdown`, `followerTimeseries`, `topPosts`, **all** `posts` — plus the new cross-platform `summary` block. |
| `utils/metrics.js` (new) | The kind system above, shared by every service. |
| `utils/transform.js` | Kind-aware summaries, half-over-half trends, zeros kept, correct `followers` source (`follower_count` gauge, not summed `page_follows`). |
| `Pulse` frontend | Rebuilt from scratch. `lib/normalize.js` is the guarantee: it unions `overview` ∪ `metrics[]` ∪ `totals` ∪ `meta.account` gauges, orders them, and **never filters on zero**. There is no priority whitelist and no "Posts" fallback any more. |

**Verified:** `npm test` (33 backend assertions, including the exact
zero-analytics Pinterest case) and `cd Pulse && npm run smoke` (43 render
assertions, including "renders Pins published / Total pins / Boards / Monthly
views / Pin clicks / 342 / 96.4K / 1,284 / the 3 pin bodies").

---

## 5. Other defects fixed in v4.1

| # | Defect | Fix |
|---|---|---|
| 1 | `follower_count` was **summed** across days → a 30-day "Followers" card showed ~36,000 for a 1,200-follower page | `kind:'gauge'` → last value wins |
| 2 | `overview.followers` was mapped from `page_follows` (daily new follows) instead of `follower_count` | Correct mapping; `page_follows` now surfaces as `newFollows` |
| 3 | `averageViewDuration` / `averageViewPercentage` were summed → "Avg view % = 1,840%" | `kind:'avg'` / `'rate'` → mean |
| 4 | Trends were `latest day vs previous day` → constant ±100% noise | Half-over-half comparison, plus `previous`, `min`, `max`, `points` |
| 5 | GSC trends were hard-coded `0` | Real previous-window query (`?compare=false` to skip) |
| 6 | GSC `position` averaged with `Math.round(avgPos)` (integer) | 2-dp average, `invertTrend` so improvement reads green |
| 7 | Errors surfaced as `"Request failed with status code 400"` | Every service attaches `code` + `hint`; `/api/health` returns `{status, message, hint, configured, source}` per platform |
| 8 | Meta page token cached forever; a revoked token kept being reused | TTL cache (45 min) + invalidation on failure |
| 9 | Zernio external-post sync POSTed to a stale path and failed silently | `POST /v1/posts/sync-external` with legacy fallback, result reported in `meta.sync` |
| 10 | Pinterest boards never fetched | New call + `meta.boards` + Boards panel |
| 11 | Chart timelines had holes on zero days | Dense daily rows for Zernio; `compact` still honoured for Meta/YouTube/GSC |
| 12 | Frontend hard-coded a metric whitelist and hid anything unknown | `normalize.js` unions every field the API returns |

---

## 6. Dashboard (Pulse 2.0) architecture

**Design language:** clean light SaaS — white cards on `#F5F7FA`, hairline
borders `#E7EAF0`, brand blue `#2F6BFF`, positive `#12924F`, negative `#DC4849`,
warning `#C8871B`. Inter for text, Plus Jakarta Sans for headings, tabular
numerals everywhere. Tokens live in `Pulse/tailwind.config.js`; component classes
(`.card`, `.btn`, `.th`, `.eyebrow`, `.skeleton`) in `src/index.css`.

**Pages**

| View | Contents |
|---|---|
| **Overview** | 6 cross-channel KPI tiles with per-channel breakdown bars · channel comparison table · cross-channel trend (Reach / Engagement / Views / Clicks / Audience) · engagement donut · Search Console panel with top queries · recent content feed · "Needs attention" list |
| **Facebook / Instagram / YouTube / LinkedIn / Pinterest** | Channel header (identity, source, range, last sync, account stats) → notices → KPI grid (click a card to chart it) → main chart + secondary chart → daily drill-down table with range totals and CSV export → **All metrics** table → platform extras (posts/pins grid, Pinterest boards, follower history) → collapsible API diagnostics |
| **Search Console** | 4 KPI cards with compare-window deltas · clicks-vs-impressions combo chart · device donut · dimension switcher (Timeline / Keywords / Pages / Countries / Devices) with ranked bar list + exportable table · "Quick wins" (high impressions, below-average CTR) · verified properties |
| **Connections** | Per-channel credential state with the exact upstream message and the fix · Zernio and YouTube diagnostic runners · API base URL override + test · backend runtime facts |
| **Audience** (v4.2) | Real choropleth world map (generated Natural Earth paths), age×gender pyramid, gender bar, device donut, top cities, per-channel tabs plus an all-channel presence map. Channels whose upstream has no demographics show a locked card with the reason. |

**Key modules**

- `lib/normalize.js` — payload → view model. `metricsOf()`, `seriesOf()`,
  `timelineOf()`, `channelDaily()`, `topContent()`, `accountOf()`,
  `platformState()`, `diagnosticsOf()`, `healthDetailsOf()`.
  **If a metric is missing from the screen, the bug is here.**
- `lib/format.js` — `formatValue(value, {kind, unit})` is the single formatting
  entry point; also `minutes()`, `seconds()`, `percent()`, `trendTone()`.
- `lib/platforms.js` — registry: labels, brand colours, `METRIC_ORDER`,
  `ID_TO_KEY`, `SERIES_KEY`, `KEY_LABELS`.
- `lib/sample.js` — complete payload generator in the exact v4.1 shape.
- `lib/api.js` — base URL resolution: localStorage override → `VITE_API_BASE_URL`
  → `''` (same origin; the Vite dev server proxies `/api`).

**Overview stage layer** (v4.2): a young channel legitimately has zero
engagement, so leading with six empty KPI cards read as broken. The Overview now
opens with a *growth-stage hero* (Awareness → Consideration → Conversion, from
audience size + publishing consistency + whether engagement has started), a
*publishing calendar* heatmap (120 days, GitHub-style), *streaks*, a *next
audience milestone* progress bar, a rule-based *"what to do next"* panel whose
advice cites the account's own numbers, and a geography teaser. Zero-valued KPI
tiles are kept — never hidden — but styled dormant with a "not earned yet" tag.
Crucially the Overview's roll-up no longer trusts `data.summary` alone:
`effectiveSummary()` rebuilds it client-side from the platform payloads whenever
the server summary is missing or all-zero (the v4.0 shape), which fixed
"platform pages show numbers, Overview shows 0 0".

**Sample data mode** (flask icon, top right): renders the whole dashboard from
`lib/sample.js` so the design can be reviewed while the live credentials are
broken. Always labelled "Sample data" in the topbar, sidebar and Connections
page. Off by default; nothing is written anywhere.

**Backwards compatibility:** the dashboard runs against a v4.0 backend too.
`healthDetailsOf()` derives rich detail from the legacy string map, and
`inferKind()` / `KEY_LABELS` label untyped overview entries. Covered by smoke
tests using payloads recorded from the live v4.0 deployment
(`fixtures/*-legacy-v4.json`).

---

## 7. Running it

```bash
# API
cp .env.example .env        # fill in credentials
npm install && npm start    # http://localhost:5000/api  ·  /docs.html
npm test                    # 41 backend assertions (mock Zernio, no network)
npm run fixtures            # re-record Pulse/scripts/fixtures/*.json

# Docker
docker compose up --build                                   # real credentials
docker compose -f docker-compose.yml \
               -f docker-compose.mock.yml up --build        # no credentials at all
node scripts/build-worldmap.mjs                             # regenerate the map asset

# Dashboard
cd Pulse && npm install
npm run dev                 # http://localhost:5173  (proxies /api → Render)
npm run dev:local           # proxies /api → http://localhost:5000
npm run build               # → Pulse/dist, served by the API at /app
npm run smoke               # 43 render assertions against real payloads
```

Deploy: push the repo; Render runs `npm start`. Add
`cd Pulse && npm install && npm run build` to the build command (or commit
`Pulse/dist`) and the dashboard is served from the same origin at `/app`.

---

## 8. Known limitations / open items

| Item | Status |
|---|---|
| Facebook + Instagram return HTTP 400 on the deployed backend | `ACCESS_TOKEN` expired. The API now says so with step-by-step fix text (`/api/health` → `details.facebook.hint`). Needs a new long-lived token in Render env vars. |
| Pinterest/LinkedIn post metrics are all zero upstream | Zernio reports `hasAnalyticsAccess:false` for this key, and Pinterest metrics lag 24–48h. The dashboard shows the real zeros plus the reason. Analytics access must be enabled on the Zernio plan. |
| YouTube channel identity is a fallback ("YouTube Channel", 0 subs) | The refresh token lacks `youtube.readonly`. Analytics still work; add the scope for name/avatar/lifetime stats. |
| `page_impressions` group is marked optional | Meta deprecates these per Graph version; failures land in `partialErrors` with `optional:true` and are hidden from the warnings UI. |
| No auth on the API | Anyone with the URL can read the analytics. Add a bearer/IP allowlist before exposing it publicly. |
| No pagination UI for >1,000 GSC rows | `rowLimit` caps at 25,000 server-side; the table scrolls and exports. |

---

## 9. Changelog

### 2026-10-16 — API v4.2.1 (env hardening, docs-only otherwise)
- **`.env.example` restored byte-for-byte to the project's original 14 variable
  names.** No variable was renamed, added to the example, or made required. A
  self-test now fails the build if `config` ever stops reading those exact names
  or if `.env.example` stops documenting them.
- **`src/config/index.js` cleans every value on read**: CRLF line endings,
  one layer of wrapping quotes and stray whitespace are stripped, and empty
  strings become `undefined`. A `.env` copied from Windows or pasted with quotes
  used to corrupt tokens and surface as `Request failed with status code 400`.
- The internal `*_BASE_URL` / `*_TOKEN_URL` test hooks (used only by
  `scripts/selftest.js`) are documented as internal and always default to the
  real production endpoints; README/docs no longer list them as user config.

### 2026-10-16 — API v4.2.0 + Pulse 2.1.0
- **Fixed** "platform pages show metrics but Overview shows 0 0": the Overview
  roll-up is now rebuilt client-side (`effectiveSummary`) whenever the server's
  `data.summary` is missing or all-zero (exactly the deployed v4.0 shape).
- **Added** the demographics contract (§3.4) to YouTube, Instagram, Facebook and
  Search Console services, passed through by `/api/combined`, and rendered on a
  new **Audience** page plus a per-platform strip. Nothing is invented: Zernio
  platforms report `available:false` with the reason.
- **Added** a generated world-map asset (`scripts/build-worldmap.mjs` →
  `Pulse/src/assets/worldMap.js`): Natural Earth 110m boundaries, Miller
  projection, Douglas–Peucker simplification, antimeridian splitting (Fiji and
  Russia previously drew as full-width bands), ISO alpha-2 keyed, 86 KB, zero
  runtime dependencies.
- **Added** longer ranges: `last_60d / last_120d / last_180d / all_time`, with
  30/90/120/All as the quick buttons and the full list in the range popover.
- **Redesigned** the Overview for the awareness/consideration stage: growth-stage
  hero, publishing-calendar heatmap, streaks, milestone progress, rule-based
  insights that quote the account's own numbers, geography teaser, and dormant
  styling for genuinely-zero KPIs (values still shown).
- **Added** Docker: multi-stage `Dockerfile` (builds the dashboard, runs as
  `node` user, healthcheck), `docker-compose.yml`, and a
  `docker-compose.mock.yml` overlay that runs the whole stack credential-free
  against `scripts/mockServer.js`.
- **Tests**: backend 33 → 41 (demographics helpers + presets), frontend 43 → 52
  (derived summary, stage layer, audience page, map geometry).

### 2026-10-15 — API v4.1.0 + Pulse 2.0.0
- **Fixed** the Pinterest "shows only Posts" bug (see §4) across service, route and UI.
- **Added** `src/utils/metrics.js` kind system; rewrote `transform.js` around it.
- **Rewrote** `zernioService.js`: resilient account lookup, metric catalogue, dense timelines, real trends, Pinterest boards, external-post sync, per-step diagnostics.
- **Rewrote** `combined.js` to pass full payloads through and add `data.summary`.
- **Rewrote** `health.js` to return actionable `{status, message, hint, configured}` per platform (legacy string map kept).
- **Improved** `gscService.js` (previous-window trends, dense timeline, labelled top items with share %, country/device names), `youtubeService.js` (channel identity, watch-time hours, net subscribers, engagement rate), `facebookService.js` / `instagramService.js` (account identity, optional metric groups, token hints), `tokenService.js` (TTL + invalidation + hints).
- **Added** `GET /api/zernio/debug`, `GET /api/zernio/accounts`; API now serves the built dashboard at `/app`.
- **Rebuilt** the entire dashboard from scratch (light SaaS design system, 4 page types, 27 components, CSV export, sample-data mode, connections/diagnostics page).
- **Added** test tooling: `scripts/mockZernio.js`, `scripts/selftest.js` (33), `scripts/make-fixtures.js`, `Pulse/scripts/smoke.jsx` (43).
- **Added** this file.

### Earlier (from git history)
- `aec670b` Frontend (Pulse 1.0 — dark "signal desk" UI, 3 platforms)
- `b961631` frontend with backend
- `d47fbc5` new platform added (LinkedIn, Pinterest, GSC)
- `92a72fb` Meta api (Facebook + Instagram + YouTube)
