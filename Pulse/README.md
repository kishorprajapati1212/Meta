# Social Pulse — Cross-Platform Analytics Dashboard

A React + Tailwind dashboard for the **Meta & YouTube Analytics API**. Unifies Facebook Page, Instagram Business, and YouTube Channel analytics into one live-updating command center.

## Stack

- **React 18** + **Vite** — app shell and dev server
- **Tailwind CSS** — styling, with a custom design token set (see `tailwind.config.js`)
- **Recharts** — sparklines and trend charts
- **lucide-react** — icons
- **axios** — API calls

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` if your backend URL is different from the default:

```env
VITE_API_BASE_URL=https://meta-ptze.onrender.com
```

Then run:

```bash
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
```

Output goes to `dist/`. Deploy `dist/` to any static host (Vercel, Netlify, Render static site, Cloudflare Pages, GitHub Pages, etc). Remember to set `VITE_API_BASE_URL` as an environment variable on whatever host you deploy to — Vite bakes `VITE_*` vars in at build time.

## What it does

- **Signal strip** (top bar) — live health dot for each platform, pulled from `GET /api/health`, plus a manual refresh.
- **Pulse Ring** — a single radial dial fusing the three platforms' headline trend into one glance.
- **Platform cards** — Facebook / Instagram / YouTube summary with primary metric + trend + sparkline. Click a card (or a tab) to drill in.
- **Overview tab** — side-by-side trend charts for all three platforms.
- **Platform tabs** — full metrics grid, a large trend chart for whichever metric you select, and a sortable drill-down table of raw daily values. YouTube also shows a channel header (avatar, subscriber count, lifetime stats).
- **Date range control** — 7D / 14D / 30D / 90D presets or a custom `since`/`until` range, wired straight to the API's own query params.
- Handles partial failures gracefully — if one platform's token is bad or a metric group fails, that platform shows an inline error instead of breaking the page.

## Notes on the API contract

This UI was built directly against the actual backend code (not just the README), so field names match exactly:

- `GET /api/combined` → `data.{facebook,instagram,youtube}`, each shaped like `{ platform, meta, overview, timeseries, metrics, notice?, partialErrors? }` (no extra `data` wrapper inside — that's only on the single-platform endpoints).
- `overview` keys are one of: `followers`, `pageViews`, `contentViews`, `uniqueViewers`, `engagement`, `newFollows`, `reach`, `profileVisits`, `interactions`, `views`, `watchTime`, `subsGained`, `likes`, `comments`, `shares`, plus `channel` (YouTube only).
- Failed platforms come back as `{ success: false, error: { code, message, details } }` inside the combined response — the UI checks for this and renders an inline error card instead of crashing.

If the backend's response shape changes, the places to update are `src/utils/format.js` (the `primaryTrend`/`primaryMetricLabel` field-priority lists) and the `idGuess` maps in `PlatformCard.jsx` / `OverviewTrends.jsx`.
