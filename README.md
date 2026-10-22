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
| `GET /api/zernio/accounts` | Connected Zernio accounts: type, scopes, platform status, pin/board/monthly-view gauges |
| `GET /api/report` | **v4.3.1 — everything in one call**: config, health, all six payloads, both audience diagnoses, the focus ranking, the verbatim upstream bodies and a written verdict per Zernio channel. Redacted |

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
| `audience` | `institutions` (default) or `students` — retargets `data.diagnosis` and re-ranks `data.focus`. Unknown values fall back to the default |
| `days` | `/api/report` only: 1–365 (default 30; nonsense falls back to 30) |
| `raw` | `/api/report` only: `false` drops the verbatim upstream bodies |
| `format` | `/api/report` only: `text` returns a paste-able digest (~15 KB) instead of JSON |
| `sections` | `/api/report` only: any of `config,health,platforms,diagnosis,combined,raw,probes` |

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
  "total": 23700, "previous": 21100, "trend": 12.3,
  "trendBasis": "second-half-vs-first-half", "hasData": true }
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

**`trend` is `number | null`, and `null` means "there is no comparison worth
making"** — never `0`, which used to render as a real, measured "flat". A
percentage is published only when a baseline exists, is not zero, and is at least
**10** for counts/sums/levels/averages (rates keep their own scale). Before this
rule, `pctChange(x, 0)` returned `100` for any non-zero `x`, so a beginner
account's first ever like printed "+100%" and reach going 33 → 346 printed
"+953%".

`trendBasis` says what is actually being compared — `second-half-vs-first-half`
(the same selected range, split in two), `last-day-vs-first-day` (gauges),
`window-edges` (YouTube subscribers), or `previous-window` (**GSC only**, a real
equal-length period before this one). `trendWindows` carries the exact dates.
**It was never "vs yesterday" or "vs last week"**, which is why the dashboard no
longer prints a percentage on the top metric cards: a card shows a number and its
sparkline, and comparisons live in the metric table, labelled with their basis.

`hasData:false` means a real zero, and **zeros are never dropped** — the UI
renders them with the reason (e.g. no analytics access, metric deprecated, no
posts in range).

---

## Growth diagnosis (v4.3.0, API only since v4.3.5)

> **v4.3.5:** the dashboard no longer renders a diagnosis panel — it was removed
> as clutter. The engine and this payload are unchanged, `/api/report` still
> returns the diagnosis for both audiences, and the Overview still ranks channels
> with it ("Where to focus this week").

A `0` is four different facts, and each needs a different action. Every platform
payload therefore carries a diagnosis, computed server-side
(`src/utils/diagnosis.js`) so the API and the dashboard can never disagree:

```jsonc
{ "data": {
    "diagnosis": {
      "platform": "linkedin",
      "audience": "institutions",
      "audienceFit": { "fit": "high", "why": "Heads of department, placement cells, …" },
      "stage": "no-distribution",
      "headline": "You published 1 item(s) and the algorithm served them to nobody — 0 impressions. …",
      "funnel": [ { "key": "published", "label": "Published", "value": 1, "display": "1", "verdict": "ok" }, … ],
      "zeros":  [ { "key": "impressions", "label": "Impressions", "reason": "no-distribution",
                    "explanation": "Zero because the platform recorded 0 impressions — …" } ],
      "benchmark": { "metric": "engagement rate", "yours": null,
                     "typical": "3.9% average · 3.0–4.0% for education (highest of any industry)",
                     "reference": "Published 2026 industry benchmarks … — a reference range, not your data." },
      "actions": [ { "priority": 1, "title": "Fix distribution before creative", "detail": "…" } ],
      "mechanics": "Dwell time and early comments drive distribution. …",
      "evidence": { "published": 1, "seen": 0, "engaged": 0, "lagging": false, "postsRead": 1 }
    } } }
```

`GET /api/combined` adds `data.<platform>.diagnosis` for all six channels plus a
ranked **`data.focus[]`** — `score = how blocked the channel is × how well it
reaches your target audience`, so an undistributed channel that talks to
universities outranks a healthy channel that does not.

| `stage` | means |
|---|---|
| `unreachable` | the channel answered with an error — fix the connection before judging the content |
| `no-content` | a *known* zero posts in range — cadence is the problem |
| `pending-lag` | Pinterest/LinkedIn items younger than 48 h — reporting has not caught up |
| `no-distribution` | published, but the algorithm served it to (almost) nobody |
| `seen-not-engaged` | reach exists, nobody acted — hook/format/CTA |
| `engaged-not-followed` | people act but do not stay — no series to follow |
| `no-conversion` | attention but no click-through to a destination |
| `healthy` | the whole funnel moves — scale what works |

**`?audience=institutions|students`** (default `institutions`) retargets the fit,
the ranking and the advice: education content aimed at a university is judged on
different channels than content aimed at a student. The dashboard persists the
choice (`pulse.audienceTarget`) and sends it with every request — it is a query
param, never a new env var.

What counts as engagement is platform-specific: Pinterest has no like button (a
pin click *is* the engagement), a Search Console click is both the engagement and
the conversion, and when an account-level card is empty the funnel sums the
individual posts (`evidence.engagedSource: "summed from posts"`) instead of
telling you nobody engaged.

Benchmarks are published 2026 education-niche references (Hootsuite,
Socialinsider, Quid/Rival IQ, SociaVault, Sprout Social Index). Every surface
that prints them says so — they are never presented as your data.

---

## Dashboard

Light SaaS design system: white cards, hairline borders, tabular numerals,
brand-accurate platform colours.

- **Overview** — cross-channel KPIs with per-channel breakdown bars, channel
  comparison table, trend switcher, engagement donut, GSC panel, recent content,
  "needs attention" list.
- **Per-platform pages** — every metric grouped (Audience · Traffic ·
  Consumption · Engagement · Activity · Quality), each KPI card clickable to
  chart that series (a metric the platform publishes only as a single level says
  so in one line instead of drawing an empty chart), daily drill-down table,
  all-metrics table with CSV export,
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
npm test               # 78 backend assertions + 61 upstream/HTTP assertions, against local mocks — no network
npm run fixtures       # record real API payloads into Pulse/scripts/fixtures/
cd Pulse && npm run fixtures:diagnosis   # record the diagnosis engine's output over those payloads
cd Pulse && npm run smoke                # 116 render assertions (SSR) against those fixtures
npm run report -- --api https://your-api.onrender.com --days 90   # one-call diagnostic bundle from any deployment
cd Pulse && npm run smoke:live -- --api https://meta-ptze.onrender.com   # 30 checks against a LIVE deployment
```

`smoke:live` is the fastest way to answer "is my deployment actually serving
what I think it is": it prints the deployed version, then checks (or skips, with
a redeploy instruction) everything that version should have.

`scripts/mockUpstream.js` can also reproduce Meta's worst behaviours, because
they are the ones that hide: `MOCK_IG_INSIGHT_FORM=empty-total-value-day` (an
empty 200 for one insights form), `MOCK_IG_MEDIA=denied-36104` (the media list
refused, pointing at Business Discovery) and `MOCK_IG_DISCOVERY=denied`.

`scripts/mockZernio.js` reproduces every Zernio failure mode we hit in
production: all-zero Pinterest analytics (the original bug), rich analytics,
`/v1/accounts` returning 500, boards 404, `hasAnalyticsAccess:false` — and, under
`MOCK_MODE=real-capture`, the **actual upstream documents captured from the live
account on 2026-10-21** (`scripts/fixtures/zernio-real-capture.json`): six
Pinterest pins that Zernio has fully synced and that still report 0, next to
eight LinkedIn posts published the same way that do report impressions. That
fixture is what makes the "not measured" vs "no distribution" distinction
testable instead of theoretical.

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

### YouTube shows 0 subscribers / an empty channel header

`/api/youtube/debug` prints the scopes your `YOUTUBE_REFRESH_TOKEN` actually has.
If `youtube.readonly` is missing, Google refuses `channels?part=statistics`, which
is the only source of the channel name, avatar and exact subscriber count.

The dashboard does not go empty in that case: lifetime views, watch time and the
top-videos grid come from the Analytics API, and subscribers are **estimated** as
lifetime `subscribersGained − subscribersLost` and shown with a `≈`.

For the exact number and the channel identity, re-generate the refresh token with
the extra scope (OAuth Playground → `https://www.googleapis.com/auth/youtube.readonly`
plus `https://www.googleapis.com/auth/yt-analytics.readonly`), put it in
`YOUTUBE_REFRESH_TOKEN`, and redeploy. If the debug output says
`accessNotConfigured` instead, enable the **YouTube Data API v3** for that Google
Cloud project.

### Instagram shows 0 likes and comments (but the posts have them)

Three separate causes, all handled — and all visible in the payload so you can
tell which one you have:

1. **Meta answered with an empty 200.** Instagram's interaction metrics
   (`likes`, `comments`, `shares`, `saves`, `total_interactions`,
   `profile_views`, `website_clicks`) are `total_value` metrics, and Meta answers
   a parameter combination it does not accept with *no error and no rows*. The API
   therefore asks each form in turn — `total_value` + `period=day`, then
   `total_value` alone, then `period=day` — and re-asks only the metrics that came
   back empty. `meta.insightVariants` records which form answered; a metric that
   is empty in every form is listed in `partialErrors` and in the `notice` instead
   of hiding behind a 0.
2. **The media list is refused** with `(#36104) … outside of the Business
   Discovery API`. That message names the route that works, so the API uses it:
   `business_discovery.username(<handle>){media{…,like_count,comments_count,
   view_count}}`. `meta.postsSource` says which route fed the posts, and the
   original refusal stays visible as a recovered partial error.
3. **The post count was reported as 0** when the media list could not be read,
   which made the diagnosis claim "nothing was published". It is now `null`
   (unknown), with `meta.mediaCountLifetime` from the profile node alongside.

### Pinterest shows zeros everywhere

Since v4.3.1 the API distinguishes three different zeros, and says which one you
have. `data.diagnosis.stage` on the channel payload names it, and
`GET /api/report?sections=probes` prints the verdict with the upstream evidence.

- **`not-reported` — the platform is not measuring this account.** This is what a
  live capture on 2026-10-21 showed: 6 pins, each with a real pin id and pin URL
  and `syncStatus: "synced"` (so Zernio definitely knows them), every metric 0 —
  including pins 9 to 32 days old, far beyond Pinterest's 24–48 h lag — while
  `pinCount`, `boardCount`, `monthlyViews` and `accountType` all came back empty.
  Pinterest serves organic analytics (impressions, saves, pin clicks, outbound
  clicks) to **Business accounts only**. Fix: convert the account (Pinterest →
  Settings → Account management → Convert to business — free, nothing about the
  pins changes), then reconnect it in Zernio so the new entitlement is picked up.
  Until then 0 means *not measured*, and the dashboard says so instead of blaming
  the content.
- **`pending-lag` — pins younger than 48 h.** Pinterest has not produced metrics
  yet. The API triggers a sync on every refresh; the numbers appear on their own.
- **`no-distribution` — the pins are measured and genuinely reached nobody.**
  Then it is a keyword/board/format question, and the panel says what to change.

Two more normal situations that look like a bug:

- **Followers.** Pinterest's API publishes no follower count, and LinkedIn
  publishes none for personal profiles (only Company Pages). Those cards are
  removed rather than shown as 0.
- **Cross-posted content.** One post published to several platforms is one Zernio
  document with a `platforms[]` array; the API reads the copy for the platform
  you asked about — including its `syncStatus`, which is why a pin Zernio has
  already synced is no longer reported as "external".

### LinkedIn numbers are real but tiny

A live 90-day capture: 8 posts, 93 impressions, 2 likes, 0 clicks, 0 followers
published. Nothing is broken — that is 11.6 impressions per post, so the
diagnosis flags `lowReach` and puts "fix reach before anything else" above the
click-through advice. Personal profiles publish no follower count at all, so that
card reads *not published* rather than 0.

### Facebook page name / avatar / followers missing

Meta 400s the entire node request when ONE field is refused, so the profile is
fetched in layers (identity → `followers_count` → `fan_count` → about). Whatever
the token allows is shown, and each refusal is listed in the payload's
`partialErrors` (visible in the dashboard's collapsed "API diagnostics" panel)
with Meta's own message.

## One-call diagnostic report (v4.3.1)

```bash
curl "https://your-api.onrender.com/api/report?days=90&format=text"
npm run report -- --api https://your-api.onrender.com --days 90 --out report.json
```

One URL returns every output the API can produce **plus the evidence behind it**:
config and versions, health, all six transformed payloads with per-channel read
timings, the growth diagnosis for both audience targets, the focus ranking, the
verbatim upstream bodies (Meta Graph, Search Console, YouTube token → Data API →
Analytics, and Zernio's accounts document, `/v1/analytics`, follower stats and
both board paths), and a written verdict per Zernio channel.

Sections are collected in parallel; one failing section never fails the report —
it lands in `errors[]` with its own message. `meta` reports `tookMs`, per-section
`timings`, `bytes`, and every list that was capped for size.

**Nothing secret leaves the process.** Credential values are masked as
`[redacted N chars XX…]`, a credentials object is masked whole, URLs keep their
readable part with any `access_token=` parameter replaced, and expiry *dates*
survive because they are facts rather than credentials. Env vars appear as
`{set, length, preview}` so "is this even configured?" stays answerable.

The collector script works against **any** deployment, including one older than
4.3.1: it reads `/api/health`, and if the deployed API has no `/api/report` it
collects the endpoints one by one and writes the same shape.

The dashboard has the same thing under **Connections → Full diagnostic report**
(build, preview the verdicts, download the JSON), next to **Connected accounts
(Zernio)**, which shows account type, granted scopes, platform status and the
account-level gauges — the fields that explain a connected-but-silent channel.

## Version

API **v4.3.5** · Dashboard **2.3.4** · Node **18+** · Docker `docker compose up` · Project IDX ready
