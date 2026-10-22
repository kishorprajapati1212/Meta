# Project Memory — Meta Social & SEO Analytics

> **v4.3.5 API · v2.3.4 dashboard · last updated 2026-10-22**
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
platform), `/api/zernio/debug`, `/api/zernio/accounts`, **`/api/report`** (one
call → every output + the verbatim upstream evidence, redacted), `/app`
(dashboard).

## Two separate Google credential sets
- **YouTube:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` — `youtube.readonly` + `yt-analytics-monetary.readonly`
- **GSC:** `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN` — `webmasters.readonly`
- Separate Google Cloud projects recommended.

## The metric KIND system (`src/utils/metrics.js`) — core convention
Every overview entry carries `{key,label,kind,unit,group,total,previous,trend|null,trendBasis|null,hasData}`.

| kind | aggregate as | examples |
|---|---|---|
| `sum` | Σ | impressions, likes, clicks |
| `gauge` | last value | followers, pins, boards, monthlyViews |
| `rate` | mean | ctr, engagementRate |
| `avg` | mean | averageViewDuration, GSC position |
| `duration` | Σ + unit | estimatedMinutesWatched |
| `count` | Σ | posts |

`trend` is **null unless justified**: a baseline must exist, be non-zero, and be
≥ `MIN_TREND_BASELINE` (10) for counts/sums/levels/averages — rates keep their own
scale. `trendBasis` names the comparison (`second-half-vs-first-half`,
`last-day-vs-first-day`, `window-edges`, or `previous-window` — GSC only). It was
never "vs yesterday/last week", so the dashboard prints **no percentage on the top
metric cards**: number + sparkline on the card, labelled comparisons in the table.
Zeros are **never** dropped (`hasData:false` = real zero). Deprecated Meta metrics live in `optional:true`
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

## v4.2 additions (2026-10-16)
- **Overview zeros fixed**: `effectiveSummary()` in `normalize.js` rebuilds the
  cross-channel roll-up client-side when the server `summary` is missing or
  all-zero (the deployed v4.0 shape). Platform pages and Overview now agree.
- **Stage layer for young channels**: growth-stage hero (awareness →
  consideration → conversion), 120-day publishing heatmap, streaks, next-milestone
  bar, rule-based insights citing the account's own numbers, dormant styling for
  genuinely-zero KPIs (values never hidden).
- **Demographics contract** `data.demographics` (see context.md §3.4): YouTube
  viewer shares, Instagram/Facebook follower counts, GSC clicks by country/device,
  Zernio honestly `available:false`. New **Audience** page with a generated
  Natural Earth choropleth (`scripts/build-worldmap.mjs`), age×gender pyramid,
  devices, cities; per-platform strip on each platform page.
- **Ranges**: `last_60d/120d/180d/all_time` added; quick buttons 30/90/120/All.
- **Docker**: `Dockerfile` (multi-stage, non-root, healthcheck),
  `docker-compose.yml`, `docker-compose.mock.yml` (credential-free demo via
  `scripts/mockServer.js`).

## Testing
- `npm test` — **64** backend assertions (`selftest.js`) + **51** upstream/HTTP assertions (`upstreamtest.js`) vs `scripts/mockZernio.js` and `scripts/mockUpstream.js` (no network; Zernio modes: `zero-analytics`, `rich`, `accounts-500`, `boards-404`, `no-analytics-access`, `sparse-accounts`, `cross-posted`)
- `npm run fixtures` — records real API output into `Pulse/scripts/fixtures/`
- `cd Pulse && npm run fixtures:diagnosis` — records the **server diagnosis engine's** output over those payloads (`fixtures/diagnosis.json`)
- `cd Pulse && npm run smoke` — **110** SSR render assertions against those fixtures, incl. v4.0 legacy payloads
- `cd Pulse && npm run smoke:live -- --api <url>` — **30** checks against a running API; it *skips* (with a redeploy instruction) whatever that deployment's version does not have yet

## Known state of the live deployment (checked 2026-10-20)
- `https://meta-ptze.onrender.com/api/health` reports **v4.2.4** — v4.2.5 (the
  Instagram/Facebook post backfill) and v4.3.0 (the diagnosis layer) are written,
  tested and delivered but **not deployed**. Render needs a *rebuild*, not a
  restart; Netlify needs the new `Pulse/dist`. Until then nothing new is visible.
- `/api/instagram?date_preset=last_30d` → `posts:0`, likes/comments/shares/saves
  all `hasData:false`, reach 330, followers 6 (`ig_profile`). v4.2.5's per-media
  backfill is what fills those; it needs the redeploy.
- `/api/zernio/debug` → LinkedIn `urn:li:ugcPost:7517925769025699840`:
  `impressions:1, reach:1, likes:0, comments:0, lastUpdated 2026-10-20 12:27:39`,
  no hidden reaction alias in `platforms[0].analytics`. **Upstream truth, freshly
  synced** — a distribution problem, not a code bug. Pinterest zeros are the same
  story plus a 24–48 h reporting lag.
- YouTube → analytics work; the Data API still answers `insufficient authentication
  scopes`, so channel identity/subscriber count come from the Analytics API
  (v4.2.5) and are labelled `≈ estimated`.
- GSC → healthy (`https://kishor-prajapti.netlify.app/`).

## v4.3.0 — growth diagnosis: why a metric is 0 (2026-10-20)
Full contract in `context.md` §3.6. Engine: `src/utils/diagnosis.js` (pure, never throws).
- `diagnose(platform, payload, {audience})` → `{platform, audience, audienceFit{fit,why}, stage, headline, funnel[5], zeros[], benchmark|null, actions[], mechanics, evidence}`; attached as `data.diagnosis` on every platform endpoint and inside `/api/combined`.
- `focusOrder(diagnoses, audience)` → `data.focus[]` = `STAGE_WEIGHT × FIT_WEIGHT`, descending; `firstAction` is a **string**.
- `stage`: `unreachable` (payload has `error` → fix the connection first) · `no-content` (a *known* 0 posts) · `pending-lag` (Pinterest/LinkedIn posts < 48 h old) · `no-distribution` (published, 0 reach — the headline names the algorithm) · `seen-not-engaged` · `engaged-not-followed` · `no-conversion` · `healthy`.
- funnel verdicts `ok | zero | unavailable`; `value:null` ⇒ `display:"not published"` (`"not read"` when the channel errored).
- Engagement is platform-specific: Pinterest = clicks/saves (no like button), Search Console = clicks (click is engagement *and* conversion ⇒ `converted:null`), LinkedIn = reactions/comments/reposts/sends. When the account card is empty the funnel sums the posts (`evidence.engagedSource:'summed from posts'`) and the zero card is explained as `recovered-from-posts` — never as "nobody engaged". A real number is never overwritten.
- `?audience=institutions|students` (default institutions; unknown → default). Query param + persisted UI pref `pulse.audienceTarget` — **never a new env var** (the 14-name contract holds).
- Benchmarks are published 2026 education-niche references (Hootsuite, Socialinsider, Quid/Rival IQ, SociaVault, Sprout) and every surface says so. `yours:null` when there is no reach to divide by.
- UI: `panels/FocusBoard.jsx` (Overview, "Where to focus this week") plus the Overview hero strip. **`panels/DiagnosisPanel.jsx` was deleted in v4.3.5** at the user's request ("remove digital dignosis it just extra thing") — the engine and `data.diagnosis` are unchanged, `AUDIENCE_OPTIONS` moved to `lib/audience.js`, and the `pulse.diagnosisOpen` pref went with it. FocusBoard renders nothing when the API is older than 4.3.0. Sample Mode reproduces the layer via `sampleDiagnosis()`/`sampleFocus()`.
- `gsc` is normalised to `searchConsole` (`PLATFORM_ALIAS`) so the fit/benchmark tables apply on `/api/gsc` too.

## v4.2.1 — env contract locked (2026-10-16)
- `.env.example` is byte-for-byte the original 14 names; nothing renamed or added.
- `config/index.js` cleans values on read (CRLF / quotes / spaces) so a copied
  `.env` cannot corrupt a token; a self-test enforces both rules.

## v4.2.5 — missing numbers: subscribers, pins, posts (2026-10-16)
- Diagnose against the LIVE deployment first: `/api/youtube/debug` prints the
  token's granted scopes, `/api/zernio/debug` prints raw Zernio account/post
  objects. Both told the truth; guessing did not.
- YouTube subscriber count needs the Data API (`youtube.readonly`). Without it,
  derive lifetime numbers from the Analytics API: `subscribersGained −
  subscribersLost` (flag as estimated, render `≈`), lifetime views exact, and
  `dimensions=video&sort=-views` for the top-videos grid.
- One refused Graph field 400s the WHOLE node request → fetch profile fields in
  layers and keep Meta's real error message per layer.
- Account-level insights are retired piecemeal (page_fans, page_impressions, IG
  click metrics). Backfill from per-post data (`source: 'posts'`), never
  overwrite a measured insight, and mark truly unpublished gauges `unavailable`
  so the UI removes the card instead of showing 0.
- Zernio: read `platforms[]` for the queried platform (cross-posts share a
  document), dedupe on `_id` not `latePostId`, and fall back to the published-pin
  count when `pinCount` is null.
- Pinterest zeros are usually the 24–48 h lag, not a bug; LinkedIn personal
  profiles publish no follower count at all.

## v4.2.4 — long ranges, red dots, and hosts that sleep (2026-10-16)
- Meta insights windows are ≤30 days: always fetch through
  `utils/graphInsights.js` (chunk → merge → dedupe by end_time), never with the
  raw preset range.
- A `(#100) Invalid parameter` means a retired metric: retry the group metric by
  metric, keep the survivors, drop the rest as OPTIONAL notes.
- Prefer degrading (payload + notice) over throwing when any data survived.
- Every upstream call goes through `fetchWithFallback` (timeout + last-good
  cache); `isNetworkError()` keeps network failures from being reported as
  credential problems.
- Status indicators ask the PAYLOAD first (`hasUsableData`), health second.
- Render `<App />` for every view in smoke tests — prop-name typos in one branch
  (e.g. `sample` vs `isSample`) are invisible otherwise.

## v4.2.3 — wire-level data bugs (2026-10-16)
- NEVER spread an internal group object into an outbound query. Graph answers
  `(#100) … An ID has already been specified.` if it sees `?id=…` next to an id
  in the path. Build params explicitly.
- Meta breakdown metrics (`audience_*`, `page_fans_*`) return ONE value object
  keyed by segment; total_value metrics return `{metricName: N}`. Parse with
  `demo.expandGraphValues()` / `transform.scalarOf()`, never `Number(v.value)`.
- A `.catch()` that swallows a ReferenceError looks like "no data available".
  `scripts/upstreamtest.js` audits every src module for undeclared identifiers.
- Routes must use `platformEnvelope()` — never hand-pick `overview/timeseries/
  metrics`, or new service fields silently vanish from single-platform calls.
- `errorResponse()` must keep `err.hint`; the client prints it.
- `npm test` = selftest (47) + upstreamtest (28). Mock Graph/Google lives in
  `scripts/mockUpstream.js` (records every request) and runs standalone via
  `scripts/mockUpstreamServer.js`.
- `Pulse npm run smoke:live [-- --api URL]` renders every page against a live API
  and reports which metrics actually carry data. Run it after any deploy.
- `ConnectionsPage` accepts `lastUpdated` as Date | ISO string | epoch | junk.

## v4.2.2 — crash-proofing (2026-10-16)
- Never dereference a platform payload before a null-check (`platformState`).
- `healthDetails` must always be an object; index it via `(x || {})[key]`.
- Filter `partialErrors` to real objects before mapping.
- `ErrorBoundary` wraps the page switch; `useAnalytics` retries with backoff and
  keeps last-good data (stale banner) instead of blanking.
- Smoke suite includes a hostile-payload matrix; keep it green.
- Project IDX config lives in `.idx/dev.nix`; `npm run dev:all` runs API + UI.
- Dev `/api` proxy: local API → `VITE_FALLBACK_API` → JSON 503 with a hint
  (a Vite middleware, not `server.proxy`).
- Legacy API payloads (bare-string errors, `meta:{}`, health without ok/total)
  must render; `healthCountsOf()` derives the counts.
- Never ship a stale `Pulse/dist` — the self-test fails the build if it is older
  than `Pulse/src`. Rebuild with `npm run build:ui` before committing.

## v4.3.1 — one call, all the evidence (2026-10-21)
- `GET /api/report?days=&raw=&format=json|text&sections=` returns config, health,
  all six payloads, both audience diagnoses, the focus ranking, the verbatim
  upstream bodies and a written verdict per Zernio channel. Parallel collection;
  a failing section lands in `errors[]`, never fails the report; `meta` reports
  `tookMs`, `timings`, `bytes`, `truncations`, `redacted`, `cacheBypassed`.
- `npm run report -- --api <url>` works against **older** deployments too: it
  reads `/api/health` and, if the API is < 4.3.1, collects endpoint by endpoint.
- Redaction (`src/utils/redact.js`) is two-tier: STRONG keys (`access_token`,
  `clientSecret`, `byokCredentials`) mask the whole subtree; WEAK keys (`token`,
  `secret`, `key`) mask strings but **walk objects** — otherwise the call logged
  as `"page token exchange"` loses its evidence. ISO dates survive
  (`tokenExpiresAt` is a fact). Cycles are found via the **ancestor stack**, not a
  global visited set (the same account doc legitimately appears twice).
- **Pinterest's zeros are an entitlement gap, proven from a live capture:** 6 pins
  with real pin ids + URLs and `syncStatus:"synced"`, every metric 0, oldest 32
  days (past the 24–48 h lag), and `pinCount`/`boardCount`/`monthlyViews`/
  `accountType` all empty. Pinterest serves organic analytics to **Business**
  accounts only. Control: the LinkedIn copy of the same cross-post reports
  impressions. Fix = convert to Business (free) + reconnect in Zernio.
- Read `syncStatus` from the **per-platform copy** (`pe.syncStatus`), never the
  document level — the doc says `isExternal:true` while the copy says `synced`.
- `metricAvailability` verdicts: `reporting | lagging | not-reported | stale |
  no-posts`. "Past the lag" counts the posts **old enough to have been reported**
  (`agedPastLag`), not the newest one.
- New diagnosis stage `not-reported` (weight 2.9) + zero reason `not-reported`;
  Pinterest-only, and only when every post is identified, ≥1 is `synced`, ≥1 is
  past the lag, all metrics are 0 and the account gauges are empty.
- `evidence.lowReach` / `seenPerPost` (`LOW_REACH_PER_POST = 100`): gated to
  facebook/instagram/linkedin/pinterest **and** to a `seen` key of
  `impressions|reach`, so YouTube views-per-video and GSC never trigger it. When
  it fires, a priority-1 "fix reach first" action outranks the stage's advice.
- `syncExternalPosts` reports `externalPosts`, `withoutUrl`, `alreadySynced`,
  `accountSweep` and the last real result on a cache skip; posts with no URL fall
  back to the account-level sweep.
- `buildAccount()` keeps `permissions`, `platformStatus(+Reason)`, `scopes`,
  `needsReconnection`, `enabled`, `followersCount`, `lastSuccessfulPublishAt`,
  `rateLimitedUntil`, `byokConfigured` (boolean, never the credentials).
- Mark expected fallbacks `optional` in `rawDump` — the alternate Zernio boards
  path 404s on this plan and must not turn the summary into "ISSUES".
- `hasAnalyticsAccess` is per **API key** on the response, not per account doc.
- Regression fixture from real data: `scripts/fixtures/zernio-real-capture.json` +
  `MOCK_MODE=real-capture`; `makeDiagnosisFixtures.cjs` replays it through the
  real service. One doc per platform is verbatim, the rest are reconstructed from
  the captured payloads — `_provenance` in the fixture says exactly which.
- Suites: selftest **77**, upstreamtest **58** (§11 = `/api/report` over HTTP,
  incl. "no credential survives anywhere"), smoke **114**.

## v4.3.2 — what the first real /api/report proved (2026-10-21)
- **Meta answers a `total_value` form it dislikes with an EMPTY 200** — no error,
  no rows. That is how Instagram likes/comments hid behind silent 0 cards while
  `reach` worked. Never trust "no error" as "no data": check the rows.
  `fetchGroupWithVariants()` tries `total_value+day` → `total_value` (no period) →
  `day`, re-asking only the metrics that came back empty, and records every
  attempt in `meta.insightVariants`.
- `/{IG_ID}/media` refused with **(#36104) "…outside of the Business Discovery
  API"** → Meta is naming the route that works:
  `?fields=business_discovery.username(<handle>){media.limit(n){…,like_count,
  comments_count,view_count}}`. `meta.postsSource` says which route fed the posts;
  per-media insights are skipped on that path (same permission was just refused).
- A denied post list means the post count is **unknown (`null`), never 0** —
  reporting 0 made the diagnosis say "nothing was published" for an account whose
  profile says `media_count: 9`.
- **A measured zero must still produce a card.** `backfillFromPosts` skipped zero
  values, so Facebook lost Comments/Shares entirely. `sumPosts` now records
  `analyticsProvided` per mapper (FB posts: likes/comments/shares; IG media:
  likes/comments/views + shares/saves/impressions/reach only when the per-media
  insight worked) — a real 0 is shown, a metric the source never exposes is not
  invented.
- `SEEN_KEYS` per platform: Meta retired `page_impressions` for this Page, so
  Facebook's "seen" must fall back to `contentViews`/`uniqueViewers`/`pageViews`.
  Without it a page with 36 measured views was told "the algorithm served them to
  nobody".
- Zernio: **`page` and `limit` must be sent together** (`GET /v1/accounts?page=1
  &limit=100`) or it 400s — and a failed lookup must never be reported as "channel
  not connected" (`reason: accounts-call-failed`, `verdictKind`).
- Pinterest scopes were never the problem: the live doc holds `pins:read`,
  `boards:read`, `user_accounts:read` (+write/+ads), `platformStatus:"active"`,
  `needsReconnection:false`, while `accountType` and every gauge are null. Say
  "not a missing scope, re-authorising changes nothing" — the gap is the Business
  account type.
- A zero card may only quote **its own** post sum (`evidence.postSums`), never the
  grand total: YouTube's Comments card was claiming 11 interactions that were
  likes+shares.
- Layout rule learned the hard way: **metrics first, advice second — and dense**.
  Channel pages are header → notices → KPI grid → charts → posts (the diagnosis
  panel was removed in v4.3.5; the side chart is omitted when the platform
  publishes no daily series for it). The
  user's verdict on the crowded dashboard was "everywhere, too much text" *and*
  "keep it expanded", so the answer is density, not hiding: clamp long prose with
  CSS (`line-clamp-*`) while keeping the full text in a `title` attribute (never
  truncate the string out of the DOM), put zero reasons and actions side by side on
  `xl`, and clamp backend notices to two lines with an expander.
- Mock switches that reproduce the above: `MOCK_IG_INSIGHT_FORM=empty-total-value-day`,
  `MOCK_IG_MEDIA=denied-36104`, `MOCK_IG_DISCOVERY=denied`.
- Suites: selftest **78**, upstreamtest **61**, smoke **116**.

## Standing rules
1. Update `context.md` (and this file) with every change.
2. Never drop a metric because its value is zero.
3. Never aggregate without consulting the metric's `kind`.
4. Keep hooks above early returns in every React component.
5. All hooks/`useMemo` in `GscPage`, `PlatformPage`, `OverviewPage` must survive the error→data transition.
6. Don't reintroduce `key` as a data field in objects spread into JSX (use `id`).
7. Never explain a zero without the upstream body that produced it — if the
   evidence is not in hand, add it to `/api/report` and ask for a capture.
8. A zero caused by a missing entitlement must never be reported as a content or
   distribution failure (`not-reported` ≠ `no-distribution`).
9. "No error from the upstream" is not "no data" — count the rows. Meta answers
   some parameter forms with an empty 200.
10. Metrics before advice on every page: the numbers are the product, the
    explanation of a zero is one click away.
