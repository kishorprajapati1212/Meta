# Pulse — Social &amp; SEO Analytics Dashboard

React 18 + Vite 6 + Tailwind 3 + Recharts 2. The frontend half of the
`Meta Social & SEO Analytics` project; the API half lives in `../src`.

Rebuilt from scratch for **v2.0.0**: a clean light SaaS design, every metric the
API returns rendered with its correct number and aggregation, and graceful
degradation when a channel is broken or when an older API version is deployed.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — proxies /api to the deployed backend
npm run dev:local    # proxies /api to http://localhost:5000 instead
npm run build        # → dist/  (the API then serves it at /app)
npm run preview      # serve the production build locally
npm run smoke        # 43 SSR render assertions against recorded API payloads
```

Environment:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Absolute API origin. Leave unset to use the dev proxy / same origin. |
| `VITE_PROXY_TARGET` | Where `npm run dev` proxies `/api`. Defaults to the deployed Render URL. |

There is also a **runtime** base-URL override on the Connections page (saved to
`localStorage`) — handy for pointing one build at another backend without
rebuilding.

---

## Pages

| Page | What it shows |
|---|---|
| **Overview** | Six cross-channel KPI tiles with per-channel breakdown bars, channel comparison table, cross-channel trend with a metric switcher (Reach / Engagement / Views / Clicks / Audience), engagement donut, Search Console panel with top queries, recent content feed, and a "Needs attention" list of every failing or zero-data channel. |
| **Facebook · Instagram · YouTube · LinkedIn · Pinterest** | Channel header (identity, source, range, last sync, account stats) → notices → grouped KPI grid (click any card to chart that series) → main + secondary chart → daily drill-down table with range totals and CSV export → **All metrics** table → platform extras (post/pin grid, Pinterest boards, follower history) → collapsible API diagnostics. |
| **Search Console** | Clicks / impressions / CTR / position with compare-window deltas, clicks-vs-impressions combo chart, device donut, dimension switcher (Timeline · Keywords · Pages · Countries · Devices) with ranked bars and an exportable table, "Quick wins" (high impressions, below-average CTR), verified properties. |
| **Connections** | Per-channel credential state with the exact upstream message and the fix, Zernio + YouTube diagnostic runners, API base override and test, backend runtime facts, sample-data switch. |

---

## The Overview for a young channel

A channel in the awareness stage legitimately has zero engagement, so the
Overview leads with what *is* real: a growth-stage hero (Awareness →
Consideration → Conversion), publishing-day count against a sustainable
cadence, days since last post, audience/content/channel headline numbers and
the next audience milestone with a progress bar. Below that: the six KPI tiles
(zero ones styled dormant and tagged "not earned yet" — the number is still
shown), a 120-day publishing heatmap with streaks, a geography teaser, and a
rule-based "what to do next" list whose advice quotes the account's own numbers.

The Overview roll-up is also **self-healing**: `effectiveSummary()` rebuilds the
cross-channel totals from the platform payloads whenever the server's
`data.summary` is missing or all-zero, which is exactly what an older backend
returns — so the Overview can never show `0 0` while platform pages show data.

## Design system

Light SaaS: canvas `#F5F7FA`, white cards, hairline borders `#E7EAF0`,
`rounded-card: 14px`, soft `shadow-card` / hover `shadow-lift`. Ink `#0C1526`,
body `#3E4A5E`, muted `#6B7A90`. Brand `#2F6BFF`, positive `#12924F`,
negative `#DC4849`, warning `#C8871B`. Brand-accurate platform colours.
Plus Jakarta Sans for headings, Inter for text, IBM Plex Mono for eyebrow labels,
tabular numerals everywhere.

Tokens: `tailwind.config.js`. Component classes (`.card`, `.btn`, `.th`,
`.eyebrow`, `.skeleton`): `src/index.css`.

---

## Source map

```
src/
├── App.jsx                 Shell: sidebar + topbar + page switch
├── hooks/
│   ├── useAnalytics.js     /api/combined + /api/health, refresh, sample mode, errors
│   └── usePlatformDetail.js Per-platform drill-down fetch + range state
├── lib/
│   ├── normalize.js        ★ payload → view model. If a metric is missing on
│   │                         screen, the bug is here.
│   ├── format.js           formatValue(value,{kind,unit}), minutes, seconds,
│   │                         percent, trendTone, compact, decimal
│   ├── platforms.js        Registry: labels, colours, METRIC_ORDER, ID_TO_KEY,
│   │                         SERIES_KEY, KEY_LABELS
│   ├── api.js              Base-URL resolution, all fetchers, describeError
│   ├── sample.js           Complete payload generator in the exact v4.1 shape
│   ├── csv.js              Table → CSV download
│   ├── prefs.js            localStorage helpers (base URL, range, density)
│   └── cls.js              Tiny classnames helper
└── components/
    ├── layout/     Sidebar · Topbar · DateRangePicker
    ├── panels/     OverviewPage · PlatformPage · GscPage · ConnectionsPage
    ├── ui/         Card · Pill · States · Segmented · DataTable · BrandIcon
    ├── charts/     AreaTrend · MultiLine · ColumnChart · Sparkline · Donut ·
    │               BarList · ChartTooltip
    ├── metrics/    KpiCard · MetricTable
    └── platform/   PageHeader · PostGrid · BoardList
```

### `normalize.js` guarantees

1. **Union, never filter.** `metricsOf()` merges `overview` ∪ `metrics[]` ∪
   `totals` ∪ `meta.account` gauges. A metric with value `0` is kept.
2. **Ordering.** Registry `METRIC_ORDER` first, then remaining keys
   alphabetically; grouped by the `group` the API supplies (inferred when an
   older API omits it).
3. **Kind-aware formatting.** `gauge` → last value, `rate` → mean + %,
   `duration` → h/min/s, everything else compact integers.
4. **Version tolerance.** `inferKind()` / `KEY_LABELS` label untyped v4.0
   overview entries; `healthDetailsOf()` derives rich health detail from the
   legacy flat string map.
5. **Never a blank page.** Error payloads render an actionable card with the
   upstream message, the hint, and a Retry button.

---

## Sample data mode

The flask icon in the topbar renders the entire dashboard from `lib/sample.js` —
generated data in the exact API v4.1 shape (dense timelines, all metric kinds,
one deliberately failing channel). It exists so the design can be reviewed while
live credentials are broken. Always labelled "Sample data" in the topbar,
sidebar and Connections page. Off by default, writes nothing anywhere.

---

## Tests

`npm run smoke` server-renders the real panels against payloads recorded from the
actual API (`scripts/fixtures/`) and asserts on the HTML:

- Pinterest renders **every** metric label and value (Impressions, Pin clicks,
  Outbound clicks, Saves, Total pins `342`, Boards `3`, Monthly views `96.4K`,
  Followers `1,284`, Engagement rate) and all three pin bodies — this is the
  regression test for the "shows only Posts" bug.
- Rich-mode numbers format correctly (`23700` → `23.7K`).
- Degraded modes (`/v1/accounts` 500, boards 404, no analytics access) render the
  right message instead of crashing.
- Backwards compatibility with the **deployed v4.0** backend: empty overview,
  `meta.account: null`, a combined payload with no `summary`, and a health
  payload with strings only.

Regenerate the fixtures from a live backend with `npm run fixtures` in the repo
root, then re-run this suite.

---

## Version

**2.2.0** — see `../context.md` for the changelog and API contract.
