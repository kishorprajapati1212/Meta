# context.md — Project Context (living document)

> **Rule for every future change:** update this file in the same commit. It is the
> single source of truth for what this project is, how the data flows, which
> decisions were made and why, and what is known to be broken. `memory.md` is a
> short summary; this file is the detail.
>
> **Last updated:** 2026-10-22 · **API version:** 4.3.5 · **Dashboard version:** 2.3.4

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
│   └── utils/            metrics.js (kind system), transform.js, dateUtils.js,
│                         response.js, resilience.js (timeout/cache/last-good),
│                         upstreamErrors.js (hints), metaPosts.js (post backfill),
│                         demographics.js, diagnosis.js (v4.3.0 growth layer)
├── scripts/
│   ├── mockZernio.js     Local Zernio stand-in with switchable failure modes
│   ├── mockServer.js     Runs that mock as a container entry (compose mock profile)
│   ├── mockUpstream.js   Local Meta Graph + Google stand-in with failure switches
│   ├── mockUpstreamServer.js  Runs that mock standalone (:4988)
│   ├── selftest.js       64 backend assertions      → npm test
│   ├── upstreamtest.js   51 upstream-request + HTTP assertions → npm test
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
    │                     panels/FocusBoard.jsx (v4.3.0) + lib/audience.js
    └── scripts/
        ├── smoke.jsx     110 render assertions      → npm run smoke
        ├── livecheck.jsx 30 checks against a LIVE API → npm run smoke:live
        ├── makeDiagnosisFixtures.cjs  records the server diagnosis → npm run fixtures:diagnosis
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
  "total":342, "previous":null, "trend":null, "trendBasis":null, "hasData":true }
```

`hasData:false` means "genuinely zero" — the UI still renders the card, muted,
with the reason. **Zeros are never dropped from the payload.**

### 3.2 Trends — a percentage is published only when it is justified

**v4.3.4 changed this contract.** `trend` is `number | null`, and `null` means
*"there is no comparison worth making"* — which is **not** the same claim as `0`
("flat"). The user's complaint: *"in upper metrics show 50% increment or 50
decrement it not show frm last day last week becuse there is so much bug."* They
were right on both counts — the number was not a day-over-day or week-over-week
change, and much of it was invented.

`summarize()` in `utils/metrics.js` publishes a percentage only when

1. a baseline exists (`previous !== null`);
2. the baseline is not zero — `pctChange(c, 0)` used to return **100** for any
   non-zero `c`, which is how a beginner account's *first ever like* printed
   "+100%", and how reach going 33 → 346 printed the **+953%** seen in the live
   v4.3.1 report;
3. for counts/sums/levels/averages the baseline is at least
   `MIN_TREND_BASELINE = 10`. Rates keep their own scale (CTR 1% → 2% is a real
   statement; 3 → 9 views is not).

Every published trend carries its basis, so no UI can present it as something it
is not:

| `trendBasis` | compares | where |
|---|---|---|
| `second-half-vs-first-half` | days ⌈n/2⌉…n vs days 1…⌈n/2⌉ **of the same selected range** | every flow metric |
| `last-day-vs-first-day` | last day of the range vs its first day | gauges — followers, pins, boards |
| `window-edges` | end of the range vs its start | YouTube subscribers, when `subsGained` is real |
| `previous-window` | this range vs the **equal-length period immediately before it** | **GSC only** — the one true "vs last period" |

`trendWindows` carries the exact ISO dates behind the first two. `direction` is
`up | down | flat | null` (null when no trend is justified) and `favourable`
still inverts for `position` (`invertTrend`).

**Consequence for the UI (Pulse 2.3.3):** the top metric cards print **no
percentage at all** — a card shows its number and its sparkline, because a
half-vs-half ratio is not what a person reads "+50%" as. The absolute
`total − previous` delta on `KpiCard` went with it (it subtracted a *half-window
sum* from a *full-window total*). Comparisons survive only where they can be
labelled: the metric table's "1st half" and "Trend" columns (the duplicate,
unlabelled "Change" column was deleted), and the Overview channel table's
"Followers change" cell, which now renders an em dash instead of the word
"flat" when nothing is justified. `TrendPill` puts `BASIS_LABEL[trendBasis]` in
its tooltip.

Adding a genuine previous-window comparison for Meta/YouTube/Zernio would mean
doubling every upstream call for a number the user asked to have removed, so the
app does not do it; GSC keeps the one it already had (`?compare=false` to skip).

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
| `audience` | all (v4.3.0) | `institutions` (default) or `students` — retargets `data.diagnosis` and re-ranks `data.focus`. Unknown values fall back to the default. It is a query param, never an env var (§3.3 of the v4.2.1 env contract still holds: exactly 14 names) |

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

### 3.6 The growth diagnosis layer (v4.3.0)

> **v4.3.5:** this contract is unchanged, but the dashboard no longer renders a
> diagnosis panel — it was removed at the user's request. Everything below still
> ships in the API and still drives the Overview hero, the focus ranking and
> `/api/report`.

**Why it exists.** The report was not only "Instagram shows 0 likes". It was:
*"most of my metrics show 0 because the platform algorithm is not pushing it the
right way — my content is education, so I have to target the university, not the
student."* A bare `0` is four different facts (nothing published / published but
not distributed / seen and ignored / measured differently by this platform), and
each one needs a different action. So every payload now carries the diagnosis,
computed **server-side** so the API and the dashboard can never disagree.

`src/utils/diagnosis.js` — pure, no I/O, never throws (junk payloads produce a
complete diagnosis with `unavailable` stages).

| Entry point | Attached by | Lands at |
|---|---|---|
| `diagnose(platform, payload, {audience})` | `utils/response.js → platformEnvelope()` (all 6 single-platform routes) | `data.diagnosis` |
| `diagnose(key, payload, {audience})` | `routes/combined.js → passthrough()` | `data.<platform>.diagnosis` |
| `focusOrder(diagnoses, audience)` | `routes/combined.js` | `data.focus[]` + `data.audience` |

**`diagnosis` shape**

| Field | Contract |
|---|---|
| `platform` | canonical key — `gsc` is normalised to `searchConsole` (`PLATFORM_ALIAS`) so the fit/benchmark tables apply |
| `audience` | `institutions` (default) or `students` |
| `audienceFit` | `{fit: high\|medium\|low, why}` — institutions: LinkedIn/Search Console/YouTube high, Facebook medium, Instagram/Pinterest low. Students: Instagram/YouTube high, Pinterest/LinkedIn/Search Console medium, Facebook low |
| `stage` | `unreachable \| no-content \| no-distribution \| pending-lag \| seen-not-engaged \| engaged-not-followed \| no-conversion \| healthy` |
| `headline` | one sentence a beginner can act on. A distribution failure names the algorithm explicitly, because that is the user's own framing |
| `funnel[5]` | `published → seen → engaged → followed → converted`, each `{key,label,value,display,verdict,sourceKey?,note?}`; `verdict ∈ ok \| zero \| unavailable`; `value:null` ⇒ `display:"not published"` (or `"not read"` when the channel errored) |
| `zeros[]` | one entry per zero/unavailable card: `{key,label,reason,explanation,source?}` with `reason ∈ unreachable \| unpublished \| recovered-from-posts \| no-content \| lag \| no-distribution \| seen-not-engaged \| no-conversion \| no-activity` |
| `benchmark` | `{metric:'engagement rate', yours:<number in %>\|null, typical:<prose>, tier, reference, note}` or `null`. `yours` is `null` when there is no reach to divide by. **Always labelled as a published industry reference, never as this account's data** |
| `actions[]` | `{priority,title,detail,effort?}`, ordered; `actions[0]` is the one the ranking surfaces |
| `mechanics` | how that channel's algorithm actually distributes content |
| `evidence` | `{published, seen, seenKey, engaged, engagedSource, followers, followersPublished, converted, convertedKey, youngPosts, lagging, postsRead}` |

**Stage precedence** (first match wins): payload has `error` → `unreachable`;
`published === 0` (a *known* zero) → `no-content`; `seen === 0` → `pending-lag`
if Pinterest/LinkedIn has posts younger than 48 h (`LAG_MS`), else
`no-distribution`; `engaged === 0` → `seen-not-engaged`; `followers === 0` →
`engaged-not-followed`; `converted === 0` → `no-conversion`; else `healthy`.
An **unknown** post count (`published === null`, e.g. Search Console or a denied
posts endpoint) is never reported as idleness — it falls through to the reach
test and the headline says the count was not reported.

**Engagement is platform-specific** (the fix behind "Instagram has likes but the
card says 0"):

| Channel | `ENGAGED_KEYS` | `CONVERTED_KEYS` | post-level sum |
|---|---|---|---|
| Pinterest | `engagement, saves, clicks, closeups` (no like button — a pin click *is* the engagement) | `outboundClicks, websiteClicks` | `clicks, saves` |
| Search Console | `clicks` (a search click is the engagement *and* the conversion ⇒ `converted.value = null`, stage can be `healthy`) | — | `clicks` |
| LinkedIn | `engagement, interactions, likes, comments, shares, saves, reposts, sends` | `clicks, websiteClicks, profileVisits` | default |
| YouTube | `engagement, interactions, likes, comments, shares` | default list | default |
| Facebook / Instagram | `engagement, interactions, total_interactions, likes, comments, shares, saves` | `clicks, outboundClicks, websiteClicks, profileVisits, profileViews, searchClicks, pageViews` | `likes, comments, shares, saves` |

When the account-level card is empty but the posts have numbers, the funnel uses
`engagementFromPosts` and `evidence.engagedSource = 'summed from posts'`; the
matching zero card is then explained as `recovered-from-posts` ("the
account-level insight is empty but your posts record N interactions") instead of
"nobody engaged". A real account-level number is **never** overwritten.

**`focusOrder(diagnoses, audience)`** → `[{platform, stage, headline,
audienceFit, audienceWhy, score, firstAction, firstActionDetail}]`, sorted by
`score = STAGE_WEIGHT[stage] × FIT_WEIGHT[fit]`:

```
STAGE_WEIGHT  unreachable 3.2 · no-distribution 3 · no-content 2.6 ·
              seen-not-engaged 2.2 · no-conversion 1.8 ·
              engaged-not-followed 1.6 · healthy 1.2 · pending-lag 0.8
FIT_WEIGHT    high 1.5 · medium 1 · low 0.6
```

So an unreadable or undistributed channel that reaches universities outranks a
healthy channel that does not — the opposite of ranking by follower count.
`firstAction` is a **string** (the dashboard prints it directly).

**Dashboard side (Pulse 2.2.0)**

| Piece | What it does |
|---|---|
| ~~`components/panels/DiagnosisPanel.jsx`~~ | **Removed in v4.3.5** at the user's request (*"remove digital dignosis it just extra thing"*). The engine is untouched — `utils/diagnosis.js` still computes `data.diagnosis`, `/api/report` still ships both audiences, and the Overview hero + `FocusBoard` still consume it. `AUDIENCE_OPTIONS` now lives in `lib/audience.js` |
| `components/panels/FocusBoard.jsx` | "Where to focus this week": the ranked rows with a score bar, the highest-value move, and click-through to each channel page |
| placement | `PlatformPage` (between the notices and the KPI grid), `GscPage` (same spot), `OverviewPage` (between the KPI tiles and the consistency/geography grid) |
| `lib/prefs.js` | `PREF_KEYS.audience = 'audienceTarget'`, persisted; `App.jsx` owns the state and passes it to `useAnalytics`, which sends `?audience=` and refetches when it changes |
| `lib/sample.js` | `sampleDiagnosis()` / `sampleFocus()` reproduce the same contract from the sample numbers, so Sample Mode shows the layer with no API |
| `scripts/makeDiagnosisFixtures.cjs` | runs the **real** engine over the recorded payloads → `scripts/fixtures/diagnosis.json`; the smoke test renders that, so a contract change fails the UI suite |

**Benchmark provenance (must stay honest).** `BENCHMARKS` holds 2026 published
figures for the education niche: Instagram 1.8% average / 2.1% higher-ed (≈3.4%
median under 10K followers), LinkedIn 3.9% average / 3.0–4.0% education
(document posts ≈7%; personal profiles ≈4.7% vs 1–2% for company pages),
Facebook 2.9% / 5.2% education, Pinterest 1.9% (≈3.2% under 5K), YouTube 3–5% of
views with 2–10% impression CTR, GSC ≈27% CTR at position 1 / 15% at 2 / 11% at
3. Sources: Hootsuite 2026 industry benchmarks, Socialinsider, Quid/Rival IQ
higher-ed study, SociaVault Labs follower-tier medians, Sprout Social Index Q1
2026. The UI prints `reference` next to them and the panel footer says they are
not this account's data.

---

### 3.7 The one-call diagnostic report (v4.3.1)

The ask, verbatim: *"create one api call which if i do then get the all api output
at once and i give you that, according to it you have to made changes — like in
pinterest show 0 it is okky but it is still problematic too."*

**`GET /api/report`** (`src/routes/report.js`) answers it. One URL, every output,
plus the evidence behind each output:

| Section | Contents |
|---|---|
| `config` | API + dashboard version, node, port, dashboard bundle hash, env presence as `{set,length,preview}`, endpoint overrides, unexpected env vars |
| `health` | exactly what `/api/health` returns (`buildHealth()` was extracted from the route so both share one implementation) |
| `platforms` | all six payloads as their own endpoints return them, each with a read time |
| `diagnosis` | `data.diagnosis.{institutions,students}.{channel}` — both audience targets in one call |
| `combined` | the focus ranking for both audiences |
| `raw` | verbatim upstream bodies: Graph (page, posts, insights, IG profile, IG media, one media-insight call), GSC (token, sites, one query), YouTube (token → Data API → Analytics), Zernio (accounts doc, `/v1/analytics` per platform, follower-stats, both board paths) |
| `probes` | a written verdict per Zernio channel: connected? analytics enabled? how many posts upstream? how many carry metrics? how old is the oldest? entitlement gap? |

Query: `?days=1..365` (default 30, nonsense falls back to 30), `?raw=false`,
`?format=json|text`, `?sections=` (unrequested sections come back `null`, never
silently dropped). Sections are collected in parallel; a failing section lands in
`errors[]` and never fails the report. `meta` carries `tookMs`, per-section
`timings`, `bytes`, `truncations` (every capped list is listed), `redacted:true`,
`cacheBypassed:true`.

**`scripts/collect-report.js` (`npm run report -- --api <url>`)** is the client
side. It reads `/api/health` first: if the deployment is ≥ 4.3.1 it calls
`/api/report`; otherwise it collects the endpoints one by one and writes the same
shape. That matters because the user's deployment was still v4.2.4 — the first
real capture (859 kB, 21.9 s, 0 failed requests) was produced this way.

**`src/utils/redact.js`** is the gate. Nothing secret leaves the process, and the
report is meant to be pasted into a chat:

* credential keys → `[redacted N chars XX…]`; a credentials *object*
  (`byokCredentials`) is masked whole (STRONG tier);
* a key that merely *mentions* a token is WEAK tier: strings are masked, objects
  are walked — otherwise the call recorded as `"page token exchange"` lost its
  `{ok,note}` evidence, which is exactly what the report exists to carry;
* an ISO timestamp under a weak key survives (`tokenExpiresAt` is a fact);
* URLs keep their readable part with any `access_token=`-style parameter replaced;
* arrays are capped (60 in the report) and every cap is reported;
* cycles are detected through the **ancestor stack**, not a global visited set —
  the same Zernio account document appears under `GET /v1/accounts` *and* under
  `account:pinterest.doc`, and a global set turned the second copy into
  `[circular]`;
* it never throws (hostile input degrades to a placeholder).

**What the first real capture changed in the code** (this is the point of the
endpoint — the fixes below are evidence-driven, not guesses):

1. `buildPostList` now reads `syncStatus` from the **per-platform copy**
   (`pe.syncStatus`), not the document level. The document says
   `isExternal:true`; the Pinterest copy says `"synced"`. That distinction is the
   whole difference between "never measured" and "measured as zero". Posts also
   keep `latePostId` (the cross-post group) and `zernioDocId`.
2. New `metricAvailability(platform, list, account, totals)` in `zernioService`
   → `meta.diagnostics.metricAvailability` with verdict
   `reporting | lagging | not-reported | stale | no-posts`. "Beyond the lag" is
   decided by the posts that are **old enough to have been reported**
   (`agedPastLag`), not by the newest one — a pin published yesterday does not
   excuse five that are a month old.
3. The Pinterest `notice` is now evidence-based: it names the business-account
   requirement and the age that rules the lag out, instead of always saying
   "refresh tomorrow".
4. New diagnosis stage **`not-reported`** (weight 2.9, just under `unreachable`),
   with `evidence.{notReported,identifiedPosts,syncedPosts,agedPosts,
   oldestPostDays,accountGaugesEmpty}`, zero reason `not-reported`, and actions:
   convert to Business → reconnect in Zernio → read Pinterest's own analytics
   meanwhile → keep pinning. It fires for Pinterest only, and only when every
   post is identified, at least one is `synced`, at least one is past the lag,
   every metric is zero and the account gauges are empty.
5. New `evidence.lowReach` / `seenPerPost` (+ `LOW_REACH_PER_POST = 100`): when a
   feed channel's impressions-per-post is tiny, the headline says reach is the
   binding constraint and a priority-1 action outranks the stage's own advice.
   Gated to `facebook|instagram|linkedin|pinterest` **and** to a `seen` key of
   `impressions|reach`, so YouTube views-per-video and GSC search impressions
   never trigger it.
6. `syncExternalPosts` reports what it could and could not do
   (`externalPosts`, `withoutUrl`, `alreadySynced`, `accountSweep`, and the last
   real result on a cache skip) and falls back to the account-level sweep
   (`POST /v1/analytics/sync-external-posts`) for external posts that have no URL.
7. `buildAccount()` keeps the entitlement evidence: `permissions`,
   `platformStatus(+Reason)`, `scopes` (parsed from `metadata.scope`),
   `needsReconnection`, `enabled`, `followersCount`, `lastSuccessfulPublishAt`,
   `rateLimitedUntil`, `byokConfigured` (a boolean — never the credentials).
8. `zernio.rawDump()` captures the response-level `hasAnalyticsAccess` (Zernio
   reports it once per key, not per account) and marks the alternate boards path
   `optional`, so an expected 404 no longer turns the summary into "ISSUES".
9. Dashboard: `DiagnosisPanel` renders the `not-reported` stage ("Platform
   reports no metrics", warn tone) with a "not measured, not zero" pill and a
   `<n> impressions per post` pill; `ConnectionsPage` gained **Full diagnostic
   report** (build / 90 days / text digest / download JSON, with the probe
   verdicts rendered inline) and **Connected accounts (Zernio)** (type, scopes,
   platform status, gauges, and a "no analytics entitlement" pill for Pinterest).

**Test coverage added:** `MOCK_MODE=real-capture` serves the captured documents
(dates rebased from `capturedAgeDays` so the fixture never ages out of a window);
`Pulse/scripts/makeDiagnosisFixtures.cjs` replays them through the *real*
`zernioService` and commits the result; selftest 64 → **77**, upstreamtest
51 → **58** (a new §11 for `/api/report`, including "no credential survives
anywhere in the report"), smoke 110 → **114**.

---

### 3.8 v4.3.2 — what the first real `/api/report` proved, and the six fixes it forced

The user deployed 4.3.1, ran `/api/report?days=30` against production and pasted
the whole 251 KB body back. That is the endpoint doing exactly its job: five of
the six bugs below are things only the verbatim upstream body could reveal, and
two of them were in the report code itself.

**1. Instagram likes/comments — Meta answers a form it dislikes with an EMPTY 200.**
The report showed `reach` with 30 daily values while every metric in groups g2/g3
(`profile_views, likes, comments, shares, saves, total_interactions`,
`website_clicks, profile_links_taps, content_views, views`) came back with **zero
rows and no error at all** — `recoveredGroups: 0`, no `partialErrors`, cards
reading 0. Nothing threw, so nothing was reported. Meta's own (#100) on the same
account says those metrics "should be specified with parameter
metric_type=total_value"; the service already sent that, *together with
`period=day`*, which is the combination this account answers with an empty body.

Fix — `fetchGroupWithVariants()` in `instagramService.js`: each group is asked in
turn as `total_value+day` → `total_value` (no period) → `day`, and **only the
metrics that came back empty are re-asked** in the next form, so the happy path
still costs one call. Every attempt is recorded in `meta.insightVariants`
`[{group, metrics, attempts:[{variant, ok, requested, returned, message, code}],
unresolved}]`, a metric that is empty in all three forms becomes a `partialError`
*and* a notice line, and `/api/report`'s Graph probe now tests all four forms
separately instead of one wrong one. Verified against a mock that reproduces the
empty 200: likes 3382, comments 2962, shares 2932, saves 3022 all recovered.

**2. Instagram media refused → posts, and the "nothing published" verdict.**
`/{IG_ID}/media` answered **(#36104) "You do not have permission to access this
field outside of the Business Discovery API"** — Meta naming the route where the
field *is* available. So `fetchIgMedia()` now falls back to
`/{IG_ID}?fields=business_discovery.username(<handle>){media.limit(n){id,caption,
media_type,timestamp,permalink,like_count,comments_count,view_count}}`, reports
`meta.postsSource: 'business_discovery'`, and keeps the original refusal visible
as a `recovered: true` partial error. Per-media insights are skipped on that path
(they need the permission that was just refused) because `like_count` /
`comments_count` already carry what the cards need.
And `meta.postCount` is now **`null`, not 0**, when the media list could not be
read — reporting 0 made the diagnosis claim "nothing was published in this range"
for an account whose profile says `media_count: 9`. `meta.mediaCountLifetime`
carries that number so the notice can say posts exist.

**3. Facebook lost the Comments and Shares cards entirely.**
`backfillFromPosts()` skipped any metric whose summed value was 0, so a page with
1 like and 0 comments showed a Likes card and *no* Comments card — a metric
silently dropped, which is exactly what this repo's first rule forbids. Fix:
`sumPosts()` now records which keys the post source really exposed
(`analyticsProvided`, declared by each mapper: Facebook posts give
likes/comments/shares; Instagram media gives likes/comments/views, plus
shares/saves/impressions/reach only when the per-media insight call succeeded),
and the backfill creates a card for a **measured zero** while never inventing one
for a metric the source does not expose — so Facebook gets "Comments 0 · summed
from 9 posts" and does *not* get a fabricated "Impressions from posts".

**4. Facebook was told "the algorithm served them to nobody" over 36 real views.**
Meta retired `page_impressions` for this Page, so the `seen` stage found no
impressions card and read 0 → stage `no-distribution`. But the same payload
carried `contentViews: 36`, `uniqueViewers: 14`, `engagement: 1`. Fix: a
per-platform `SEEN_KEYS` list that falls back to Meta's surviving reach proxies
(`contentViews`, `uniqueViewers`, `pageViews` for Facebook; `contentViews` for
Instagram). Facebook now diagnoses `engaged-not-followed`, which is the truth:
people saw it, one engaged, nobody followed. `lowReach` accepts those proxies for
feed channels only — still never YouTube views-per-video or GSC search
impressions.

**5. The report's own Zernio probe claimed a connected channel was not connected.**
`rawDump()` called `GET /v1/accounts?limit=100` and Zernio answered
**400 "page and limit must be provided together"**, so the probe concluded
"Zernio returns no pinterest account … connect it first" inside the very response
that served 5 pins and 7 LinkedIn posts. Fix: `{page: 1, limit: 100}` (matching
`getAccounts()`), plus `reason: 'accounts-call-failed' | 'no-account'` on the
per-platform entry and a `verdictKind` so a failed lookup says *"this probe is
blind, read `data.platforms.*`"* instead of prescribing a reconnect.

**6. Pinterest — the scopes are fine, so stop telling them to re-authorise.**
The live account document (now captured verbatim, since 4.3.1 keeps it) shows
`permissions: [boards:read, boards:write, pins:read, pins:write,
user_accounts:read, ads:read, ads:write]`, `platformStatus: "active"`,
`needsReconnection: false`, `byokCredentials` present — and still `accountType:
null`, `pinCount/boardCount/monthlyViews: null`, 5 pins with real ids and URLs,
`syncStatus: "synced"`, oldest 9 days, every metric 0. So the entitlement gap is
the **account type**, not the token. The notice and the reconnect action now say
so explicitly: "the connection already grants pins:read, boards:read,
user_accounts:read — this is not a missing scope and re-authorising will not
change it; convert to a Business account first." `evidence.accountPermissions`
and `evidence.accountPlatformStatus` carry it to the dashboard.

**Also fixed:** a zero card used to quote the *grand total* of post engagement on
every empty metric — YouTube's Comments card claimed "your posts record 11
interaction(s)" when 11 was likes+shares and comments were genuinely 0.
`evidence.postSums` is now per key; a card quotes only its own sum, and a real
per-post zero is labelled `no-activity` ("a measured zero, not a missing
metric"). And the GSC probe counted `rows: 0` over 10 real rows because
`querySearchAnalytics` returns `{rows:[…]}`, not an array.

**Layout (dashboard 2.3.2).** The complaint: *"you ruin my layouts"* — and when
asked where, the answer was **everywhere: "too much text, too crowded"**, with the
insight layer to stay **expanded**. So the problem was never visibility, it was
density. Two changes:

1. *Order.* The diagnosis panel rendered **above** the headline metrics on every
   channel page, so the numbers were buried under advice. Now: header → notices →
   **Headline metrics KPI grid** → charts → diagnosis → posts.
2. *Density, without losing a word.* The panel is expanded by default (toggle
   persisted in `pulse.diagnosisOpen`); long prose is clamped with CSS
   (`line-clamp-1/2`) and the full sentence kept in a `title` attribute, so
   nothing is truncated out of the DOM; zero reasons and next actions share one row
   on `xl` screens; the mechanics paragraph became a single clamped line in the
   footer; the focus board is two columns; backend notices render 2 lines with a
   "Read the full note" expander (Pinterest's entitlement note runs to several
   sentences). Font sizes and paddings tightened one step throughout the panel.

**New mock switches** (so all of the above is tested, not hoped for):
`MOCK_IG_INSIGHT_FORM=empty-total-value-day` (the empty 200),
`MOCK_IG_MEDIA=denied-36104` (Meta's exact refusal), `MOCK_IG_DISCOVERY=denied`.

Suites: selftest **78**, upstreamtest **61** (new §11 for these three fixes),
smoke **116** (including one that asserts the diagnosis is expanded by default and
that a clamped headline keeps its full text in a `title` attribute).

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
| `services/zernioService.js` | Per-platform metric **catalogue** always emitted (13 Pinterest keys, 13 LinkedIn keys) + any extra non-zero key Zernio sends. `getAccounts()` retries three param shapes — `{page:1,limit:50}` first, because
Zernio rejects a bare `limit` with 400 "page and limit must be provided together"
— and records the failure in `meta.diagnostics.steps.accounts.error` and in `notice`. Pinterest boards read from `/v1/accounts/{id}/pinterest-boards` with fallback to `accountStats.boardCount`. Account stats (`pinCount`, `boardCount`, `monthlyViews`, `externalPostCount`) exposed as gauge metrics. Dense daily timeline (one row per day, zeros filled) with follower history merged in. Real trends. External posts synced via `POST /v1/posts/sync-external` (was a stale endpoint), 10-min cache, capped at 5, reported in `meta.sync`. |
| `routes/combined.js` | Full pass-through: `meta` (incl. account/boards/sync/diagnostics), `totals`, `platformBreakdown`, `followerTimeseries`, `topPosts`, **all** `posts` — plus the new cross-platform `summary` block. |
| `utils/metrics.js` (new) | The kind system above, shared by every service. |
| `utils/transform.js` | Kind-aware summaries, trends published only when justified (`trendBasis`), zeros kept, correct `followers` source (`follower_count` gauge, not summed `page_follows`). |
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
| **Facebook / Instagram / YouTube / LinkedIn / Pinterest** | Channel header (identity, source, range, last sync, account stats) → notices → KPI grid (click a card to chart it) → main chart + secondary chart → daily drill-down table with range totals and CSV export → **All metrics** table → platform extras (posts/pins grid, Pinterest boards, follower history) → collapsible API diagnostics. The side chart is omitted entirely when the platform publishes no daily series for it, and the main chart then takes the full width (v4.3.5) |
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
| Pinterest metrics are all zero upstream — **root cause confirmed 2026-10-21** | Not a code bug and not a lag: an **entitlement gap**. A 90-day capture from the live account (`scripts/fixtures/zernio-real-capture.json`) shows 6 pins, each with a real pin id + pin URL and `syncStatus:"synced"`, every metric 0 — the oldest 32 days, far past Pinterest's 24–48 h lag — while `pinCount`, `boardCount`, `monthlyViews` and `accountType` all come back empty and follower-stats is 0 for every day. Pinterest serves organic analytics to **Business** accounts only ([Pinterest organic reporting docs](https://developers.pinterest.com/docs/analytics-and-reports/organic-reporting/): "Some analytics are only available if the user has a business account"). The control: the LinkedIn copy of the *same* cross-post reports impressions normally. Fix is on the account, not in this repo — convert to Business (free) and reconnect in Zernio. v4.3.1 diagnoses this as `not-reported` and says "not measured" instead of blaming the content. |
| LinkedIn metrics are real but tiny | 90-day capture: 8 posts, 93 impressions, 2 likes, 0 clicks, followers not published (personal profile). That is 11.6 impressions per post, so v4.3.1 adds `evidence.lowReach` and ranks "fix reach before anything else" above the click-through advice. Nothing upstream is broken. |
| ~~The v4.2.4 deployment strips the fields that would prove the Pinterest cause~~ **Answered 2026-10-21** | v4.3.1 keeps `permissions`, `platformStatus`, `metadata.scope` and the gauges, and the user's live `/api/report` then showed them: the Pinterest connection holds `pins:read`, `boards:read`, `user_accounts:read` (+write, +ads) with `platformStatus:"active"` and `needsReconnection:false`, while `accountType` and every gauge stay null. **The scopes are not the problem — the account type is.** Only the user can fix it (convert to Business, free), and the API now says so instead of suggesting a re-authorise. |
| Instagram likes/comments were 0 while the posts have likes — **fixed in v4.3.2** | Two causes, both proven by the live report: Meta answered the `metric_type=total_value` + `period=day` combination with an **empty 200** (no error, no rows), and `/{IG_ID}/media` was refused with **(#36104)** so per-post counts were unavailable. Now every request form is tried in turn (`meta.insightVariants` records which one answered) and the media list falls back to **Business Discovery**. `meta.postCount` is `null` — not 0 — when the media list is unreadable, so the diagnosis no longer claims "nothing was published" for an account with `media_count: 9`. |
| The user's deployment still ran v4.2.4 on 2026-10-20 | The Instagram likes backfill (v4.2.5) and the whole diagnosis layer (v4.3.0) only appear after a Render **rebuild** and a Netlify publish of the new `Pulse/dist`. `npm run smoke:live -- --api https://meta-ptze.onrender.com` reports the deployed version and skips what is not there yet. |
| Benchmarks are references, not measurements | `BENCHMARKS` in `src/utils/diagnosis.js` holds published 2026 education-niche figures (Hootsuite, Socialinsider, Quid/Rival IQ, SociaVault, Sprout). Every surface that prints them says so. They must never be presented as this account's data. |
| YouTube channel identity is a fallback ("YouTube Channel", 0 subs) | The refresh token lacks `youtube.readonly`. Analytics still work; add the scope for name/avatar/lifetime stats. |
| `page_impressions` group is marked optional | Meta deprecates these per Graph version; failures land in `partialErrors` with `optional:true` and are hidden from the warnings UI. |
| No auth on the API | Anyone with the URL can read the analytics. Add a bearer/IP allowlist before exposing it publicly. |
| No pagination UI for >1,000 GSC rows | `rowLimit` caps at 25,000 server-side; the table scrolls and exports. |

---

## 9. Changelog

### 2026-10-22 — API v4.3.5 + Pulse 2.3.4 ("remove the diagnosis, and fix the empty Instagram chart")

Two requests, both about the dashboard carrying more than it should.

* **The growth-diagnosis panel is gone.** The user: *"remove digital dignosis it
  just extra thing."* `DiagnosisPanel.jsx` is deleted and no longer rendered on
  any channel page or on Search Console. `AUDIENCE_OPTIONS` moved to
  `lib/audience.js` because `FocusBoard` imported it from the panel, and the
  `pulse.diagnosisOpen` preference went with it. **The engine is untouched:**
  `src/utils/diagnosis.js` still computes `data.diagnosis`, `/api/report` still
  ships it for both audiences, and the Overview still renders the hero strip and
  "Where to focus this week" — so nothing consuming the API loses data, and the
  panel is one `git revert` away if it is ever wanted back.
* **Instagram's Followers card stopped saying the same emptiness three times.**
  `follower_count` arrives through the `total_value` insight form (v4.3.2), which
  is a single level with no per-day breakdown. The page used to render a card
  ("6 total · 0 daily values"), an empty main chart ("No daily values for this
  metric in the selected range.") and an empty side panel ("No follower series in
  the payload."). Now:
  - the default chart prefers a metric that actually has a daily series (Reach);
  - a metric with no series gets one honest line — *"Followers is published as a
    single value — 6. Instagram sends no daily breakdown for it, so there is
    nothing to plot."* — instead of a 300 px empty box;
  - the side panel is **omitted** when there is nothing to draw (no follower
    series, no subscriber movement, no publishing signal) and the main chart takes
    the full width;
  - the chart subtitle lost its `${kind} metric ·` jargon prefix and its
    "0 daily values" alarm.

Suites: selftest **82**, upstreamtest **61**, smoke **115** — eight panel-render
checks removed with the panel, four new ones covering the empty-series behaviour
and the absence of the panel. Every diagnosis *engine* check stays (stages,
headlines, zero reasons, focus ranking, the real Pinterest capture), because the
API still ships that data.

### 2026-10-22 — API v4.3.4 + Pulse 2.3.3 ("the increment numbers are not justified")

The user: *"some number are not justify like how much it will improve compare to
what … in upper metrics show 50% increment or 50 decrement it not show frm last
day last week becuse ther eis so much bug so fix it make it simple"* — while
liking the graphs. Six defects, all behind the same badge:

* **Wrong baseline.** The badge compared the *second half of the selected window*
  with the *first half* — on a 30-day view, days 16–30 vs days 1–15. It was never
  "vs last day" or "vs last week", and nothing on screen said so.
* **Invented percentages.** `pctChange(c, 0)` returned `100` for any non-zero `c`,
  and baselines of 1–9 produced numbers like the **+953%** reach trend in the live
  report. A percentage now needs a non-zero baseline of at least
  `MIN_TREND_BASELINE = 10` (rates exempt), else `trend: null`.
* **"Not measured" rendered as "flat".** ~15 places hard-coded `trend: 0`
  (YouTube net subscribers, every derived engagement rate, Facebook/Instagram
  followers, Zernio gauges, GSC dimension rows, post-summed cards), and
  `Pulse/src/lib/normalize.js` coerced a missing trend back to `0`. All are `null`
  now, and the normaliser preserves it.
* **Polarity.** Overview's `KpiTile` printed `Math.abs(trend)` and coloured by raw
  sign, ignoring `invertTrend` — a GSC *improving* average position rendered red.
  The badge is gone from the tiles.
* **Unjustified absolute delta.** `KpiCard` showed `total − previous`, i.e. a
  full-window total minus a *half-window* sum ("+313" next to "346"). Removed.
* **Basis is now part of the contract.** `trendBasis` + `trendWindows` ship with
  every justified trend; `TrendPill` states the basis in its tooltip; the metric
  table's unlabelled "Change" column was deleted and the remaining ones are headed
  "1st half" / "Trend".

Two supporting fixes found on the way:

* `scripts/make-fixtures.js` told the API to use `http://127.0.0.1:4988/api` while
  the mock bound an **ephemeral** port, so every regenerated fixture had no
  account, no posts and no boards ("Pinterest fixture has no posts — the bug is
  back"). It now sets `ZERNIO_BASE_URL = mock.url` after `mock.ready()`, like
  `selftest.js` already did. The committed fixtures dated from v4.1.0 and have
  been regenerated.
* `zernioService.getAccounts()` still tried `?limit=50` and `?limit=50&platform=`
  first, which real Zernio rejects with **400 "page and limit must be provided
  together"** — the same 400 that made the v4.3.1 report claim "no pinterest
  account". The attempt order is now `{page:1,limit:50}` → `{}` →
  `{page:1,limit:50,platform}`.

Suites: selftest **82** (was 78; four new trend-justification checks, and the two
old ones that asserted the fabricated `+100%` were rewritten), upstreamtest
**61**, smoke **118** (new: no fabricated percentage in a real payload, no
percentage badge on a KPI card, table headers labelled).

### 2026-10-21 — API v4.3.2 + Pulse 2.3.1 (the "here is my real report, now fix it" release)

The user deployed 4.3.1, ran `/api/report?days=30` against production and pasted
the full body back. Reported: *"you ruin my layouts fix it make it proper and yet
the liked and comment is not showing."* Both were real, and the report is what
proved it — see §3.8 for the evidence behind every line below.

**Fixed — likes and comments**

* Instagram: Meta answers `metric_type=total_value` + `period=day` with an EMPTY
  200 for this account, so likes/comments/shares/saves/interactions silently read
  0. Every request form is now tried in turn, only empty metrics are re-asked,
  each attempt is recorded in `meta.insightVariants`, and a metric that is empty
  in all forms is reported instead of hidden.
* Instagram: `/media` refused with (#36104) → fall back to **Business Discovery**
  (`meta.postsSource`), keep the refusal visible as recovered, and report
  `postCount: null` (unknown) instead of 0 so the diagnosis stops claiming
  "nothing was published" for an account with `media_count: 9`.
* Facebook: Comments and Shares cards disappeared whenever their real value was
  0, because the post backfill skipped zeros. A measured zero is now shown, with
  `analyticsProvided` per mapper so a metric the posts never expose (Facebook
  impressions, saves) is still never invented.
* Facebook: "the algorithm served them to nobody — 0 impressions" was false; Meta
  retired `page_impressions` for this Page while `contentViews: 36` was measured.
  Per-platform `SEEN_KEYS` now fall back to Meta's surviving reach proxies, and
  the channel correctly reads `engaged-not-followed`.
* A zero card no longer quotes another metric's total: `evidence.postSums` is per
  key, so YouTube's Comments card cannot claim "11 interactions" that were likes.

**Fixed — the report itself**

* `rawDump` called `GET /v1/accounts?limit=100` and Zernio answered 400 "page and
  limit must be provided together", so the probe declared a working channel
  "not connected" inside a response that served its posts. Now paginated
  correctly, with `reason: accounts-call-failed | no-account` and a `verdictKind`
  that says "this probe is blind" instead of prescribing a reconnect.
* `/api/report`'s Graph probe now tests all four Instagram insight forms
  separately (and Business Discovery) instead of one wrong combined request.
* GSC probe counted `rows: 0` over 10 real rows.

**Fixed — Pinterest wording**

* The connection holds `pins:read`, `boards:read`, `user_accounts:read` and is
  `platformStatus: "active"`, so the notice and the reconnect action now say
  "this is not a missing scope and re-authorising will not change it" — the gap is
  the account type (Business), which only the user can change.

**Fixed — layout (Pulse 2.3.1)**

* Channel pages put the diagnosis panel **above** the headline metrics. Order is
  now header → notices → KPI grid → charts → diagnosis → posts.

### 2026-10-21 — API v4.3.3 + Pulse 2.3.2 (density: "too much text, too crowded")

Asked where the layout was wrong, the answer was *everywhere* — and that the
insight layer should stay **expanded**. So the fix is density, not hiding:

* The diagnosis panel is expanded by default; the toggle (`pulse.diagnosisOpen`)
  now collapses it instead of revealing it.
* Every long string is clamped with CSS (`line-clamp-1/2`) and keeps its full text
  in a `title` attribute — a headline, a zero explanation, an action detail or a
  notice is never cut out of the DOM.
* Zero reasons and next actions share one row on `xl`; the focus board is two
  columns; the "how this channel distributes content" box became one clamped line
  in the footer; paddings and font sizes tightened one step.
* Backend notices (Pinterest's entitlement note runs to several sentences) render
  two lines with a "Read the full note" expander via `NoticeBar clamp={2}`.

No API behaviour changed in this release — only the dashboard. selftest 78,
upstreamtest 61, smoke 116.

**Testing**

* `MOCK_IG_INSIGHT_FORM=empty-total-value-day`, `MOCK_IG_MEDIA=denied-36104`,
  `MOCK_IG_DISCOVERY=denied` reproduce the live behaviours; the real-capture
  fixture gained the live `permissions` / `platformStatus` / `tokenExpiresAt`.
* selftest 77 → **78**, upstreamtest 58 → **61** (new §11), smoke 114 → **116**.

### 2026-10-21 — API v4.3.1 + Pulse 2.3.0 (the "one call, all the evidence" release)

The ask: *"create one api call which if i do then get the all api output at once
and i give you that, according to it you have to made changes — like in pinterest
show 0 it is okky but it is still problematic too."*

**Added**

* `GET /api/report` — every output in one call: config, health, all six
  payloads, both audience diagnoses, the focus ranking, the verbatim upstream
  bodies and a written verdict per Zernio channel. `?days=1..365`, `?raw=false`,
  `?format=text` (paste-able ~15 KB digest), `?sections=`. Parallel collection,
  per-section timings, caps reported, cache bypassed, credentials redacted.
* `src/utils/redact.js` (two-tier secret keys, URL query scrubbing, ISO-date
  exception, ancestor-stack cycle detection, list caps) and `src/utils/rawDump.js`
  (`graphRaw`, `gscRaw`, `youtubeRaw`, `zernioRaw`).
* `scripts/collect-report.js` + `npm run report -- --api <url>` — works against a
  deployment older than 4.3.1 by collecting endpoint by endpoint.
* Diagnosis stage **`not-reported`** and evidence `lowReach` / `seenPerPost`.
* `metricAvailability` in `meta.diagnostics`; entitlement fields on
  `/api/zernio/accounts`; `zernioService.rawDump()`; `youtubeService.debugYouTube()`;
  `buildHealth()` extracted so `/api/health` and the report share one code path.
* Dashboard: report builder + Zernio entitlement card on Connections; the
  not-measured stage and the per-post reach pill in the diagnosis panel.
* `MOCK_MODE=real-capture` + `scripts/fixtures/zernio-real-capture.json` — the
  actual upstream documents captured from the live account on 2026-10-21.

**Fixed (all found from that capture, not guessed)**

* Pinterest posts reported `syncStatus:"external"` and lost their pin id and pin
  URL — the per-platform copy carries the authoritative state (`"synced"`).
* The Pinterest notice always claimed a 24–48 h lag, even for pins a month old.
* A cached sync skip hid whether anything had actually been attempted; external
  posts with no URL were silently never synced.
* The alternate Zernio boards path 404-ing turned the whole raw summary into
  "ISSUES", sending the user after a benign fallback.
* `hasAnalyticsAccess` was read per account document; Zernio reports it once per
  API key on the response.
* Redaction masked the object recorded under the label "page token exchange" and
  reported a shared account document as `[circular]`.
* `?days=0` on the report fell through to 30 by accident rather than by design.

**Answered**

* Pinterest's zeros are an **entitlement gap**: Pinterest serves organic
  analytics to Business accounts only, and this account's every account-level
  gauge is empty while its pins are fully synced. Convert to Business (free) and
  reconnect in Zernio. The dashboard now says "not measured" instead of implying
  the content failed.
* LinkedIn's numbers are real: 93 impressions / 2 likes / 0 clicks over 90 days
  on 8 posts = 11.6 impressions per post, so reach — not the creative — is the
  binding constraint.

Tests: selftest **77/0**, upstreamtest **58/0**, smoke **114/0**.

### 2026-10-20 — API v4.3.0 + Pulse 2.2.0 (the "why is it 0, and who am I talking to" release)

Reported against the live deployment: *"in Instagram it shows 0 in like but in my
Instagram there is clearly show likes and comment … same as LinkedIn too, and
Pinterest is clearly show 0 … my content falls under education, it is hard to get
the audience because we have to target the university not the student … most of
my metrics show 0 because the platform algorithm is not pushing it the right way,
so create according to it."*

**Evidence gathered before writing code**
- `https://meta-ptze.onrender.com/api/health` → **version 4.2.4**: the v4.2.5
  post-backfill that fixes Instagram likes had been delivered but never
  redeployed (Netlify was still serving bundle `index-DZEGS8SY.js`). The fix is
  real, it just was not running. Redeploying is a prerequisite, not an option.
- `/api/instagram?date_preset=last_30d` → `posts: 0`, likes/comments/shares/
  saves/interactions all `hasData:false`, reach 330, followers 6.
- `/api/zernio/debug` → LinkedIn `urn:li:ugcPost:7517925769025699840` with
  `impressions:1, reach:1, likes:0, comments:0, lastUpdated 2026-10-20 12:27:39`,
  and no hidden reaction alias anywhere in `platforms[0].analytics`. **LinkedIn's
  zeros are fresh upstream truth**: one impression means the algorithm served the
  post to almost nobody. There is no code path that can turn that into likes —
  what the dashboard *can* do is say so and prescribe the fix. That is what this
  release builds.

**Added — the growth diagnosis layer (§3.6)**
- **New** `src/utils/diagnosis.js`: `diagnose()` + `focusOrder()`, plus
  `BENCHMARKS`, `AUDIENCE_FIT`, `CHANNEL_MECHANICS`, per-platform
  `ENGAGED_KEYS` / `POST_ENGAGED_KEYS` / `CONVERTED_KEYS`, `PLATFORM_ALIAS`
  (`gsc → searchConsole`) and a 48 h `LAG_MS` for the Zernio channels.
- **Wired** into `utils/response.js → platformEnvelope(platform, result, extra,
  {audience})` (all six routes pass `req.query.audience`) and into
  `routes/combined.js` (`data.<platform>.diagnosis`, `data.focus`,
  `data.audience`). A diagnosis failure can never blank a working channel: both
  call sites are wrapped and log instead of throwing.
- **New** `?audience=institutions|students` — the education niche targets a
  university, not a student, and the ranking, the fit and the advice all follow
  that choice. It is a query param + a persisted UI preference, never a new env
  var (the 14-name contract from v4.2.1 is unchanged).
- **New** Pulse `DiagnosisPanel.jsx` (funnel, blocked stage, "why these cards
  read 0", benchmark, numbered actions, channel mechanics, audience switch) and
  `FocusBoard.jsx` ("Where to focus this week"), mounted on every channel page,
  the GSC page and the Overview.
- **New** stage `unreachable`: a payload carrying `error` is told to fix the
  connection first. Before this, combined-zero's unconfigured Instagram was
  diagnosed as "nothing published, cadence is the whole problem" — advice that
  would have been actively wrong.
- **Correctness** fixes found while testing: an *unknown* post count is no longer
  reported as idleness (Search Console has no post count at all); Pinterest
  engagement is clicks/saves, not likes; a Search Console click is both the
  engagement and the conversion, so its funnel says `same as clicks` instead of
  double-counting; a channel with no reach gets `benchmark.yours = null` rather
  than a misleading `0%`; `posts` that is not an array can no longer take the
  diagnosis down (`posts.filter is not a function`).
- **Sample Mode** reproduces the diagnosis (`sampleDiagnosis()` / `sampleFocus()`)
  so the design can be reviewed with no credentials.

**Tests**
- backend `selftest` 52 → **64**: engagement recovered from posts (27 from three
  media items), a real number never overwritten, per-zero explanations, known-0
  vs unknown post counts, the 48 h lag vs a week-old pin, an unpublished gauge
  reading `not published` instead of a red zero, audience fit flipping,
  `focusOrder` ordering + string `firstAction`, 35 junk-payload combinations
  never throwing or leaking `NaN`, and `platformEnvelope` carrying the diagnosis.
- backend `upstreamtest` 47 → **51**: boots the real Express app on an ephemeral
  port and asserts `/api/instagram`, `/api/facebook`, `/api/youtube`, `/api/gsc`,
  `/api/linkedin`, `/api/pinterest` and `/api/combined` all carry a diagnosis,
  that `?audience=students` changes the fit and the advice while leaving
  `overview`/`posts` byte-identical, and that an unknown audience falls back.
- Pulse `smoke` 95 → **110**, rendering `scripts/fixtures/diagnosis.json` —
  recorded by the **real engine** over the recorded API payloads
  (`npm run fixtures:diagnosis`), so the UI can never drift from the contract.
- Pulse `smoke:live` 25 → **30** against a live API, and it now *skips* (with a
  redeploy instruction) instead of failing when the deployment predates 4.3.0.
  Verified both ways: against `meta-ptze.onrender.com` (v4.2.4) →
  `25 passed, 0 failed, 1 skipped`; against the local mock stack (v4.3.0) →
  `30 passed, 0 failed`.
- Local proof on the mock stack (Zernio in `zero-analytics`, the user's real
  situation): LinkedIn → `no-distribution` *"You published 1 item(s) and the
  algorithm served them to nobody — 0 impressions"*; Pinterest → `pending-lag`
  with 8 zeros each explained as reporting lag; Instagram → `healthy` with 37
  engagement summed from posts; Search Console → `healthy` with the click as the
  conversion.

**Deploy note (this is the part that was missed last time):** Render needs a
**rebuild**, not a restart, and Netlify needs the new `Pulse/dist`. Until
`/api/health` reports `4.3.0`, the dashboard cannot show any of this.

### 2026-10-16 — API v4.2.5 + Pulse 2.1.4 (the "numbers are missing" release)
Diagnosed against the user's LIVE deployment (Netlify dashboard
`digitalmarketing98.netlify.app` → API `meta-ptze.onrender.com`) by reading
`/api/health`, every `/api/<platform>` payload and both debug endpoints
(`/api/zernio/debug`, `/api/youtube/debug`). Complaints: "my channel has 4
subscribers, why does it show 0", "Pinterest shows everything 0", "so much
thing are missing".

**What the live probes proved (evidence, not guesses)**
- `/api/youtube/debug` → the token's granted scope is
  `youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly` and the
  Data API answers `Request had insufficient authentication scopes.` So
  `channels?part=statistics&mine=true` (the ONLY source of subscriberCount,
  channel name, avatar, video count) is unreachable → the header showed
  "YouTube Channel", 0 subscribers, 0 lifetime views.
- `/api/facebook` → `page_profile` failed with a bare "Request failed with status
  code 400" (Meta's real message thrown away) so `meta.account` was `{}`: no page
  name, no avatar, no follower gauge. Meta also rejects `page_fans`,
  `page_impressions`, `page_impressions_unique` with "(#100) The value must be a
  valid insights metric" → those cards simply vanished.
- `/api/instagram` → Meta's own (#100) error lists the metrics the account
  supports; `email_clicks`, `get_direction_clicks`, `calls_clicks`,
  `text_message_clicks` are not among them. Account-level
  `likes/comments/shares/saves` came back empty and `posts` was `[]`.
- `/api/zernio/debug` → Zernio really does return `analytics.impressions: 0` for
  every Pinterest pin (published the day before; Pinterest lags 24–48 h), and
  `followersCount: 0` for both accounts. LinkedIn's own `profileData` says
  `followersCount: 0` with `metadata.accountType: "personal"` — LinkedIn does not
  publish follower counts for personal profiles. Pinterest's API publishes no
  follower count and no monthly views at all. Boards come back with
  `pinCount: null`, so the "Total pins" card read 0 on an account with 5 pins.
- Cross-posted content: one Zernio document (shared `latePostId`) carries a
  `platforms[]` array with per-platform ids and analytics. Reading the
  document-level `analytics` block could show LinkedIn's 12 impressions on
  Pinterest. Dedupe also keyed on `latePostId`, which silently dropped every post
  after the first in a batch that shared a group id.

**Fixes**
- `youtubeService`: new `fetchLifetime()` reads whole-history Analytics rows
  (no dimensions) plus the "Top videos" report (`dimensions=video&sort=-views&
  maxResults=12`, both documented channel reports). Lifetime views/watch time are
  EXACT; `subscribers = subscribersGained − subscribersLost` is flagged
  `subscribersEstimated` and rendered with `≈`. Top videos become the Content grid
  (watch links + `i.ytimg.com` thumbnails). `getChannelInfo()` keeps Google's real
  `reason`, so `accessNotConfigured` says "enable the YouTube Data API v3" while
  `forbidden` names the scopes the token actually has. The retired/misspelled
  `cardsClickRate,annotationClickThroughRate` group is gone (Google's metric is
  `cardClickRate`, and YouTube retired cards/annotations in 2019).
- `tokenService`: new `graphFields()` reads a Graph node in LAYERS (identity →
  followers_count → fan_count → about/verification_status) because one refused
  field 400s the whole request. Real Meta messages and codes are kept per layer.
- `utils/metaPosts.js` (new): Facebook Page posts (`posts` → `feed` →
  `published_posts`, first that the token allows) and Instagram media
  (`/{ig-id}/media` plus best-effort per-media insights for shares/saved, capped
  at 12 with concurrency 3). `backfillFromPosts()` fills ONLY cards the insights
  left empty and stamps them `source: 'posts'` + a description, so a measured
  insight is never overwritten.
- `facebookService`/`instagramService`: attach `posts`/`topPosts`, report
  `meta.postCount`, `meta.postsEndpoint`, `meta.mediaInsights`,
  `meta.filledFromPosts`; a follower gauge with no possible source is marked
  `unavailable` instead of 0. IG group 3 now asks only for metrics Meta lists as
  valid (`website_clicks,profile_links_taps,content_views,views`).
- `zernioService`: `platformEntry()`/`readAnalytics(p, platform)` read the
  matching `platforms[]` copy; dedupe keys on `_id`; post ids/urls/usernames come
  from that copy; `pins` falls back to board counts then to the published-pin
  count; `followers` (Pinterest, personal LinkedIn) and `monthlyViews` are marked
  `unavailable` with a reason; the Pinterest zero-analytics notice now explains
  what Pinterest publishes and when.
- Pulse: `metricsOf()` DROPS `unavailable` cards (the user's rule: if it is not
  set, remove it); `accountOf()` returns `followers: null` + `followersNote`,
  takes pins/boards from the overview when the account block has none, and labels
  estimates "Subscribers (est.)"; `KpiCard` prefixes `≈` and footnotes
  "Estimated" / "Summed from your posts in this range"; `PageHeader` prefixes `≈`.

**Tests** — selftest 52 (Zernio cross-posted + sparse-account modes),
upstream 47 (page posts and endpoint fallback, refused profile fields, IG media
backfill with and without `instagram_manage_insights`, YouTube lifetime fallback
in `denied` and `notConfigured` modes, no retired metrics on the wire),
dashboard smoke 95, live check 25. Mocks gained: `MOCK_FB_BAD_FIELDS`,
`MOCK_FB_POSTS_DENY`, `MOCK_IG_MEDIA`, `MOCK_IG_MEDIA_INSIGHTS`,
`MOCK_YT_DATA_API=ok|denied|notConfigured`, `MOCK_GOOGLE_SCOPE`, lifetime +
top-video Analytics rows, per-media insights, and Zernio modes `cross-posted` /
`sparse-accounts`.

**Still a user action (documented in README → Troubleshooting):** to get the
channel name, avatar and the EXACT subscriber count, add
`https://www.googleapis.com/auth/youtube.readonly` when generating
YOUTUBE_REFRESH_TOKEN. Everything else now works without it.

### 2026-10-16 — API v4.2.4 + Pulse 2.1.3 (the "works, then stops working" release)
Reported symptoms: `ReferenceError: sample is not defined` when clicking around,
"Service not available" appearing over time, a red dot on channels that were
clearly returning data, and Facebook/Instagram failing with `Invalid parameter`
and `There cannot be more than 30 days (2592000 s) between since and until` even
though Connections said every channel was Connected.

**Dashboard (Pulse 2.1.3)**
- `App.jsx` passed `sample={sample}` to the Audience branch; the variable is
  `isSample`. Clicking **Audience** threw `ReferenceError: sample is not defined`
  and the ErrorBoundary replaced the page. Fixed, and the smoke suite now renders
  `<App />` for EVERY view (overview, all six channels, audience, connections,
  searchConsole) in normal, sample and collapsed-sidebar modes — 15 new checks,
  73 → 88. Verified with a negative control that reproduces the exact error.
- **Status dots are data-first now.** `hasUsableData()` / `payloadHasWarnings()`
  decide: green when numbers arrived, **amber** when they arrived but part of the
  range/metric set was unavailable, red only when nothing came back, grey when
  unconfigured. Before, anything `/api/health` disliked painted the channel red
  even while its numbers were on screen.

**Meta Graph (the Facebook + Instagram failures)**
- New `src/utils/graphInsights.js`. Meta rejects any insights window longer than
  30 days, so the 90/120-day and all-time presets added in v4.2 failed the whole
  platform. Requests are now split into ≤29-day windows (max 8, keeping the MOST
  RECENT data when the range is longer) and merged back into one series, deduped
  by `end_time`. 120 days → 5 windows → 120 timeseries rows; all_time → 8 windows
  → 232 rows plus a notice explaining the clamp.
- `(#100) Invalid parameter` (a retired metric) used to kill the entire group.
  The group is now retried metric by metric: whatever Meta still serves is kept,
  retired metrics are dropped as an OPTIONAL note ("Meta no longer serves X —
  skipped"), never as a hard failure.
- **Degrade instead of failing.** If metrics are gone but the page/IG profile or
  demographics arrived, the service returns that payload with a notice instead of
  throwing — so the UI shows the numbers it has rather than an error card.
- Hints are chosen from Meta's own error code: 190 → expired token, 10/200/283 →
  permission, 100 → parameters/retired metric (explicitly NOT a permission
  problem), 4/17/613 → rate limit, 104/803 → wrong id.

**"Service not available" over time**
- New `src/utils/resilience.js`: every platform fetch (in `/api/combined` and in
  all six single-platform routes) runs behind a 50 s timeout and a last-good
  cache (fresh 5 min, servable 1 h). A failed refresh now returns the previous
  numbers with `stale: true`, an age and a one-line notice, and
  `meta.stalePlatforms` lists them. Verified live: with Meta and Google
  completely unreachable, Facebook/Instagram/YouTube/Search Console kept 120 days
  of data while LinkedIn/Pinterest stayed live.
- Nothing cached for that exact range → an honest error, never a stale guess.
- `src/utils/upstreamErrors.js` separates "the internet hiccuped" from "your .env
  is wrong": a connection failure no longer advises "The channel must have at
  least one public video" or "Check ACCESS_TOKEN scopes".
- Boot warms the cache once (`/api/combined?date_preset=last_30d`) and a
  keep-alive ping runs every 10 min against `RENDER_EXTERNAL_URL` when the host
  provides it, because free-tier hosts sleep and the first request after sleep is
  what users saw as "Service not available".
- `/api/health` and `/api/combined` now report cache stats; `/api/combined` passes
  platform payloads through without whitelisting (it was dropping fields too).
- Zernio follower parsing accepts more field spellings, so "0 followers" means
  zero rather than a missed key.

**Tests** — selftest 48 (resilience unit checks + free-port mocks), upstream 37
(mock now ENFORCES Meta's 30-day rule and rejects configured metrics, ephemeral
ports so it can run beside a live stack), dashboard smoke 88, live check 25. The
static undeclared-identifier audit was rewritten as a real scanner: chained regex
stripping mis-handled apostrophes in double-quoted strings and lost word
boundaries inside `${…}` templates, which produced false positives.

### 2026-10-16 — API v4.2.3 (data-loss bugs reported from the Docker stack)
Four real bugs, all of which made the rebuilt API return *less* data than the
original one. Reported as:
`[ERROR] IG_ALL_FAILED Invalid token: "17841432245164684". An ID has already been specified.`
and `[ERROR] UNKNOWN demo is not defined`.

1. **Instagram sent internal keys to Graph.** `GROUPS` entries carry `id: 'g1'`
   and `optional: true` for diagnostics, and the request spread the whole group
   into the query string: `/{IG_ID}/insights?id=g1&optional=true&…`. Graph
   refuses an `id` parameter next to an id in the path and answers
   `(#100) Invalid token: "<ig-id>". An ID has already been specified.` → every
   group failed → `IG_ALL_FAILED`, no Instagram data. The original implementation
   had no `id` key at all. Now `groupParams()` builds the request explicitly
   (`metric`, `period`, `since`, `until`, `access_token`, plus `metric_type` only
   for total_value groups) and the internal keys stay server-side.
2. **`gscService.js` used the shared demographics helper without requiring it** →
   `ReferenceError: demo is not defined`, surfaced to the client as
   `[ERROR] UNKNOWN demo is not defined`. Import added.
3. **`instagramService.js` used `toDateStr()` without importing it** → every
   Instagram demographics call died inside a `.catch()` and reported
   "Demographics unavailable: toDateStr is not defined". Import added.
4. **Meta's map-shaped values were parsed as scalars.** `audience_country`,
   `audience_city`, `audience_gender_age`, `page_fans_country` and
   `page_fans_gender_age` return ONE value object keyed by segment
   (`{"US":42,"IN":18}`, `{"male.18-24":3}`), and `metric_type=total_value`
   metrics return `{profile_views:64}`. The parsers expected a scalar plus a
   sibling `country`/`city`/`gender` field, so `Number({...})` → NaN → 0 and the
   rows were filtered out: **Facebook and Instagram demographics were always
   empty and every total_value metric (profile views, likes, comments, shares,
   saves, interactions, website clicks) always read 0.** Fixed with
   `demographics.expandGraphValues()` (handles map / row / array shapes) and
   `transform.scalarOf()` (handles `{metric:N}`, `{value:N}` and scalars).

5. **Single-platform routes stripped the payload.** `/api/facebook`,
   `/api/instagram`, `/api/youtube`, `/api/gsc`, `/api/linkedin` and
   `/api/pinterest` each hand-picked `overview/timeseries/metrics` (Zernio's two
   picked a longer but still fixed list), so `demographics`, `stage`, `account`,
   `partialErrors`, `totals`, `level` and `boards` only ever reached a client
   through `/api/combined`. Any per-channel refresh therefore returned *less*
   than the combined call — the Audience page went empty. All six routes now use
   `platformEnvelope(platform, result, extra?)` from `src/utils/response.js`,
   which hoists `platform`/`meta`/`notice` and passes everything else through.
6. **`errorResponse()` dropped the `hint`** every service attaches, so the
   dashboard could show `IG_ALL_FAILED` with no way to act on it. The hint is now
   in the error body (`error.hint`) and in the server log line — which is what
   `describeError()` on the client already prints.

**New test layer — `scripts/upstreamtest.js` (28 checks) + `scripts/mockUpstream.js`.**
An offline mock of Meta Graph, Google OAuth, YouTube Analytics/Data and Search
Console that RECORDS every outgoing request, so the suite asserts on the wire,
not just on parsed responses: no internal keys leave the process, `access_token`
is never an id, page insights use the exchanged page token, `metric_type` only
appears on total_value groups, and Facebook/Instagram/GSC/YouTube each return
non-zero data end to end. It also asserts the envelope keeps every field, that no route whitelists payload
keys, and that an error hint survives to the response body. It runs a **static
audit of every `src/` module**:
any identifier used but never declared (the general form of bugs 2 and 3,
covering both `x.y` member access and bare `x()` calls) fails the build. Verified
with a negative control. `npm test` now runs both suites.

### 2026-10-16 — API v4.2.2 + Pulse 2.1.2 (crash-proofing + flaky-network resilience)
- **Fixed the white-screen crash** `TypeError: Cannot read properties of undefined
  (reading 'hint')`. `platformState()` dereferenced the payload before checking it
  existed, so any platform block that arrived as `null`/missing (older or
  partially-failed `/api/combined`, a cold start) took the whole page down.
- **Fixed the same class everywhere**: `healthDetails` is now always an object
  (a `null` from an unreachable `/api/health` overrode prop defaults and crashed
  Overview); `partialErrors` entries that are `null`/`undefined`/strings or a
  non-array `partialErrors` are filtered instead of throwing; ConnectionsPage
  coerces a non-string health error to text; `effectiveBase()` no longer touches
  `window` unguarded.
- **Added `ErrorBoundary`** around the page switch: an unrecognised payload shape
  now replaces one panel with an honest retry card instead of unmounting the app.
- **Flaky-host resilience**: `useAnalytics` retries `/api/combined` and
  `/api/health` with 1.2s/3.5s backoff (free-tier hosts sleep after inactivity),
  keeps the last good payload on failure and labels it stale with a banner
  instead of blanking the dashboard.
- **Hostile-payload matrix in the smoke suite** (14 new assertions): null blocks,
  missing blocks, hint-less errors, null meta, garbage `partialErrors`,
  unreachable health — every page must render.
- **Project IDX**: added `.idx/dev.nix` (Node 20 + Docker, installs both roots,
  builds the UI on start, declares dashboard/api/docker-demo web previews; the
  dashboard preview pins `VITE_PROXY_TARGET=http://127.0.0.1:5000`).
- **Dev proxy rewritten (`Pulse/vite.config.js`)** — the old config proxied `/api`
  straight to the deployed Render URL, so a sleeping free-tier host showed up as
  "API not connected" / "Service not available". Now: local API first
  (`127.0.0.1:$PORT`), then transparent forward to `VITE_FALLBACK_API`, then a
  well-formed JSON 503 (`success:false`, message + hint) instead of Vite's bare
  HTML 500. Implemented as a middleware because Vite's own proxy error handler
  ends the response before `proxy.on('error')` can write anything.
- **`npm run dev:all`** (`scripts/devall.js`, no new dependencies) starts the API
  and the dashboard together with the proxy already pointed at the local API.
- **Legacy-payload compatibility** (the pre-rebuild backend in the public repo,
  commit `aec670b`): platform errors as bare strings, `meta: {}`, and
  `/api/health` without `ok`/`total`. New `healthCountsOf()` derives those counts
  from `details` — before this, Connections printed "undefined/undefined healthy"
  and "0 / 6 healthy", which reads as "Instagram not connected".
- **`describeError()` now appends the server's `hint`**, so a 503 from the dev
  proxy tells you to run `npm run dev:all` instead of just "HTTP 503".
- **`/api/health` reports `config.VERSION`** (it was pinned to a `4.1.0` literal).
- **Deployment-hygiene self-tests** (backend suite 43 → 47): health version is
  not hardcoded, `package.json` matches `config.VERSION`, `Pulse/dist/index.html`
  exists and every asset it references is on disk, and **dist is not older than
  the newest file in `Pulse/src`** — the guard that catches shipping a stale
  bundle (exactly what produced `index-BBnBtZfG.js` in the reported crash).

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
