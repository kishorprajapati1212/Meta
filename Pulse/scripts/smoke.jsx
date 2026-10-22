/**
 * Pulse frontend smoke test.
 *
 * Renders every page and panel with REAL API payloads (recorded by
 * `npm run fixtures` in the repo root) plus the locally generated sample data,
 * and asserts the things that were broken before:
 *
 *   • Pinterest renders pins, boards, monthly views, followers and pin clicks —
 *     not a single "Posts" fallback card
 *   • zero values are shown as 0 with an explanation, never hidden
 *   • failed platforms render an actionable error instead of a blank page
 *   • every page mounts without throwing (hook order, undefined imports, etc.)
 *
 * Run: cd Pulse && npm run smoke
 */
import { renderToStaticMarkup } from 'react-dom/server'

// ── Browser globals the components touch during render ──────────
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:5173' },
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
}
globalThis.navigator = globalThis.navigator || { clipboard: { writeText: async () => {} } }
globalThis.document = globalThis.document || {
  addEventListener() {},
  removeEventListener() {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
  body: { appendChild() {}, removeChild() {} },
}

import App from '../src/App.jsx'
import Sidebar from '../src/components/layout/Sidebar.jsx'
import OverviewPage from '../src/components/panels/OverviewPage.jsx'
import PlatformPage from '../src/components/panels/PlatformPage.jsx'
import GscPage from '../src/components/panels/GscPage.jsx'
import ConnectionsPage from '../src/components/panels/ConnectionsPage.jsx'
import AudiencePage from '../src/components/panels/AudiencePage.jsx'
import MetricTable from '../src/components/metrics/MetricTable.jsx'
import KpiCard from '../src/components/metrics/KpiCard.jsx'
import PageHeader from '../src/components/platform/PageHeader.jsx'
import { metricsOf, accountOf, healthDetailsOf, healthCountsOf, deriveSummary, effectiveSummary, activityCalendarOf } from '../src/lib/normalize.js'
import { PLATFORM_ORDER } from '../src/lib/platforms.js'
import { sampleCombined, sampleHealth, sampleDiagnosis, sampleFocus } from '../src/lib/sample.js'
import { AUDIENCE_OPTIONS } from '../src/lib/audience.js'
import FocusBoard from '../src/components/panels/FocusBoard.jsx'
// Diagnoses produced by the REAL server engine (src/utils/diagnosis.js) over the
// recorded API payloads — see scripts/makeDiagnosisFixtures.cjs. The panel must
// render exactly what the API sends, so nothing here is hand-written.
import diagnosisFx from './fixtures/diagnosis.json'
import { formatValue } from '../src/lib/format.js'
import { describeError } from '../src/lib/api.js'

import pinterestZero from './fixtures/pinterest-zero.json'
import pinterestRich from './fixtures/pinterest-rich.json'
import pinterestDegraded from './fixtures/pinterest-degraded.json'
import pinterestNoBoards from './fixtures/pinterest-no-boards.json'
import linkedinZero from './fixtures/linkedin-zero.json'
import linkedinRich from './fixtures/linkedin-rich.json'
import combinedZero from './fixtures/combined-zero.json'
import combinedRich from './fixtures/combined-rich.json'
import healthFixture from './fixtures/health.json'
// Recorded from the CURRENTLY DEPLOYED v4.0 backend, before the fix is
// redeployed. The new UI must degrade gracefully against the old response
// shape (overview {}, meta.account null, combined without a summary block).
import pinterestLegacy from './fixtures/pinterest-legacy-v4.json'
import combinedLegacy from './fixtures/combined-legacy-v4.json'

let passed = 0
let failed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed += 1
    failures.push(`${name}: ${e.message}`)
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}
function includes(hay, needle, msg) {
  assert(hay.includes(needle), msg || `expected output to contain "${needle}"`)
}
function notIncludes(hay, needle, msg) {
  assert(!hay.includes(needle), msg || `expected output NOT to contain "${needle}"`)
}

/**
 * Unwrap the API envelope the way the app does. Single-platform endpoints put
 * `meta` and `notice` OUTSIDE `data`, while /api/combined nests them per
 * platform — the dashboard consumes both shapes, so normalise here.
 */
const unwrap = (res) =>
  res && res.data && !res.data.meta
    ? { ...res.data, meta: res.meta || {}, notice: res.notice || undefined }
    : res?.data || res
const range = { preset: 'last_30d' }

function render(el) {
  return renderToStaticMarkup(el)
}

// ────────────────────────────────────────────────────────────────
console.log('\n\x1b[1mPulse dashboard — render smoke test\x1b[0m\n')

console.log('Pinterest — the reported bug (real API payload, zero analytics)')
const pinData = unwrap(pinterestZero)
const pinHtml = render(
  <PlatformPage platformKey="pinterest" payload={pinData} healthDetail={{ status: 'ok', configured: true }} range={range} sample={false} />
)

check('page renders without throwing', () => assert(pinHtml.length > 5000, `only ${pinHtml.length} bytes of markup`))
check('account header shows the Pinterest profile, not a generic label', () => {
  includes(pinHtml, 'Kishor Pins')
  includes(pinHtml, 'kishor.pins')
})
check('ALL Pinterest metrics are rendered (not just Posts)', () => {
  for (const label of [
    'Impressions', 'Pin clicks', 'Outbound clicks', 'Saves', 'Video views',
    'Total engagement', 'Engagement rate', 'Pins published', 'Followers',
    'Total pins', 'Boards', 'Monthly views',
  ]) {
    includes(pinHtml, label, `missing metric card "${label}"`)
  }
})
check('account gauge values are the real numbers from Zernio', () => {
  includes(pinHtml, '342', 'total pins (342) missing')
  includes(pinHtml, '96.4K', 'monthly views (96,400 → 96.4K) missing')
  includes(pinHtml, '1,284', 'followers (1,284) missing')
})
check('the three real pins are listed with their content', () => {
  includes(pinHtml, 'Pin 1')
  includes(pinHtml, 'Pin 3')
  includes(pinHtml, '3 pins returned by the API in this range')
})
check('boards from Zernio are listed by name', () => {
  includes(pinHtml, 'UI Design')
  includes(pinHtml, 'Inspiration')
  includes(pinHtml, '3 boards')
})
check('zeros are explained, not hidden', () => {
  includes(pinHtml, 'No activity recorded in this range')
  includes(pinHtml, 'zero impressions')
})
check('the daily table has one row per day of the range', () => {
  const days = (pinData.timeseries || []).length
  assert(days >= 29 && days <= 32, `expected ~30 dense rows, got ${days}`)
})
check('metricsOf() exposes every catalogue key to the UI layer', () => {
  const keys = metricsOf('pinterest', pinData).map((m) => m.key)
  for (const k of ['impressions', 'clicks', 'outboundClicks', 'saves', 'views', 'engagement', 'engagementRate', 'posts', 'followers', 'pins', 'boards', 'monthlyViews']) {
    assert(keys.includes(k), `metricsOf dropped "${k}" (has: ${keys.join(', ')})`)
  }
})

console.log('\nPinterest — rich data (real API payload)')
const pinRichData = unwrap(pinterestRich)
const pinRichHtml = render(
  <PlatformPage platformKey="pinterest" payload={pinRichData} healthDetail={{ status: 'ok' }} range={range} sample={false} />
)
check('impressions total is summed and compacted correctly', () => {
  const total = pinRichData.overview.impressions.total
  assert(total === 23700, `expected 23700 got ${total}`)
  includes(pinRichHtml, formatValue(total, pinRichData.overview.impressions), 'formatted total missing')
})
check('engagement rate is a percentage, not a sum', () => {
  const er = pinRichData.overview.engagementRate.total
  assert(er > 0 && er < 10, `engagement rate looks wrong: ${er}`)
  includes(pinRichHtml, '%')
})
check('outbound clicks are surfaced separately from pin clicks', () => {
  assert(pinRichData.overview.outboundClicks.total === 92, `expected 92 got ${pinRichData.overview.outboundClicks.total}`)
  includes(pinRichHtml, 'Outbound clicks')
})
check('no trend is fabricated — a percentage needs a real, large-enough baseline', () => {
  const entries = Object.entries(pinRichData.overview)
  assert(entries.length > 0, 'no overview entries to check')
  for (const [k, v] of entries) {
    if (v.trend === null || v.trend === undefined) continue
    assert(typeof v.trend === 'number' && Number.isFinite(v.trend), `${k} trend is not a number`)
    assert(v.previous !== null && v.previous !== undefined, `${k} publishes ${v.trend}% with no baseline`)
    if (v.kind !== 'rate') assert(Math.abs(v.previous) >= 10, `${k} publishes ${v.trend}% off a baseline of ${v.previous}`)
  }
  const fabricated = entries.filter(([, v]) => (v.previous === 0 || v.previous === null) && v.trend != null)
  assert(fabricated.length === 0, `fabricated percentages: ${fabricated.map(([k]) => k).join(', ')}`)
})

check('a KPI card shows the number and the graph — never a percentage badge', () => {
  const metric = {
    key: 'reach', label: 'Reach', kind: 'sum', unit: '', total: 346, previous: 33,
    trend: 948.5, trendBasis: 'second-half-vs-first-half', hasData: true,
    series: [{ date: '2026-09-01', value: 10 }, { date: '2026-09-02', value: 20 }, { date: '2026-09-03', value: 30 }],
  }
  const html = render(<KpiCard metric={metric} />)
  includes(html, '346')
  assert(!/948/.test(html), 'the card printed a percentage change it cannot justify')
  assert(!/Previous: 33/.test(html), 'the card printed an absolute delta against a half-window')
  // Recharts' ResponsiveContainer needs a layout pass, so static markup carries
  // the sparkline slot rather than an <svg>; the slot is what must survive.
  assert(/height:34px|recharts-responsive-container/.test(html), 'the sparkline slot must stay — that is the honest trend')
})

check('the metric table labels what its comparison actually is', () => {
  const html = render(<MetricTable metrics={metricsOf('pinterest', pinRichData)} platformKey="pinterest" color="#E60023" />)
  includes(html, '1st half')
  assert(!/>Change</.test(html), 'the unlabelled duplicate Change column must be gone')
  includes(html, 'Trend')
})

console.log('\nPinterest — degraded upstream')
const degradedHtml = render(
  <PlatformPage platformKey="pinterest" payload={unwrap(pinterestDegraded)} healthDetail={{ status: 'ok' }} range={range} sample={false} />
)
check('a failing account lookup still renders posts and metrics', () => {
  includes(degradedHtml, 'Pin 1')
  includes(degradedHtml, 'Pins published')
})
check('the upstream failure is reported to the user', () => {
  includes(degradedHtml, 'Could not read the Zernio account list')
})
const noBoardsHtml = render(
  <PlatformPage platformKey="pinterest" payload={unwrap(pinterestNoBoards)} healthDetail={{ status: 'ok' }} range={range} sample={false} />
)
check('missing board list falls back to the account board count', () => {
  includes(noBoardsHtml, 'Board list unavailable')
  includes(noBoardsHtml, '18 boards on the account')
})

console.log('\nLinkedIn')
const liHtml = render(
  <PlatformPage platformKey="linkedin" payload={unwrap(linkedinRich)} healthDetail={{ status: 'ok' }} range={range} sample={false} />
)
check('LinkedIn uses its own metric vocabulary', () => {
  includes(liHtml, 'Reactions')
  includes(liHtml, 'Reposts')
  includes(liHtml, 'Posts published')
  includes(liHtml, 'Kishor Prajapati')
})
check('LinkedIn zero-analytics payload still renders a full grid', () => {
  const html = render(
    <PlatformPage platformKey="linkedin" payload={unwrap(linkedinZero)} healthDetail={{ status: 'ok' }} range={range} sample={false} />
  )
  includes(html, 'Impressions')
  includes(html, 'Engagement rate')
  includes(html, 'No activity recorded in this range')
})

console.log('\nOverview page')
const overviewHtml = render(
  <OverviewPage
    platformData={combinedZero.data}
    summary={combinedZero.data.summary}
    healthDetails={healthFixture.data.details}
    range={range}
    sample={false}
    onNavigate={() => {}}
    loading={false}
  />
)
check('all six channels appear in the comparison table', () => {
  for (const label of ['Facebook', 'Instagram', 'YouTube', 'LinkedIn', 'Pinterest', 'Search Console']) {
    includes(overviewHtml, label)
  }
})
check('failing platforms are called out with their real error', () => {
  includes(overviewHtml, 'Needs attention')
  includes(overviewHtml, 'ACCESS_TOKEN is not set in .env')
})
check('Pinterest contributes its pins/boards to the overview, not just a post count', () => {
  includes(overviewHtml, 'Content published')
  includes(overviewHtml, 'kishor.pins')
})
check('the Search Console card degrades to an actionable message', () => {
  includes(overviewHtml, 'Search Console unavailable')
})
check('sample data renders a fully populated overview', () => {
  const sample = sampleCombined(range)
  const html = render(
    <OverviewPage
      platformData={sample.data}
      summary={sample.data.summary}
      healthDetails={sampleHealth().data.details}
      range={range}
      sample
      onNavigate={() => {}}
      loading={false}
    />
  )
  includes(html, 'Total audience')
  includes(html, 'Engagement split')
  includes(html, 'Top search queries')
  includes(html, 'Recent content')
})

console.log('\nPlatform pages with sample data')
const sample = sampleCombined(range)
for (const pk of ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest']) {
  check(`${pk} page renders every metric it is given`, () => {
    const html = render(
      <PlatformPage platformKey={pk} payload={sample.data[pk]} healthDetail={{ status: 'ok' }} range={range} sample onRetry={() => {}} />
    )
    const metrics = metricsOf(pk, sample.data[pk])
    assert(metrics.length >= 8, `only ${metrics.length} metrics normalised for ${pk}`)
    includes(html, 'All metrics')
    includes(html, 'Headline metrics')
    for (const m of metrics.slice(0, 8)) includes(html, m.label, `KPI "${m.label}" not rendered for ${pk}`)
  })
}

check('YouTube shows lifetime channel stats and watch time in hours', () => {
  const html = render(
    <PlatformPage platformKey="youtube" payload={sample.data.youtube} healthDetail={{ status: 'ok' }} range={range} sample />
  )
  includes(html, 'Subscribers')
  includes(html, 'Lifetime views')
  includes(html, 'Watch time')
  includes(html, 'Net subscribers')
})

check('error payloads render an actionable error card, never a blank page', () => {
  const html = render(
    <PlatformPage
      platformKey="facebook"
      payload={{ error: 'Request failed with status code 400', errorCode: 'HTTP_400', hint: 'Meta access token expired.', overview: {}, timeseries: [] }}
      healthDetail={{ status: 'error', configured: true, hint: 'Regenerate ACCESS_TOKEN.' }}
      range={range}
      sample={false}
      onRetry={() => {}}
    />
  )
  includes(html, 'Facebook data could not be loaded')
  includes(html, 'Request failed with status code 400')
  includes(html, 'How to fix it')
})

console.log('\nSearch Console page')
const gscHtml = render(
  <GscPage payload={sample.data.searchConsole} range={range} sample healthDetail={{ status: 'ok' }} onRetry={() => {}} />
)
check('GSC renders the four search metrics with compare-period deltas', () => {
  includes(gscHtml, 'Clicks')
  includes(gscHtml, 'Impressions')
  includes(gscHtml, 'CTR')
  includes(gscHtml, 'Avg position')
  includes(gscHtml, 'Lower is better')
})
check('GSC shows the property, lag note and dimension switcher', () => {
  includes(gscHtml, 'kishor-prajapti.netlify.app')
  includes(gscHtml, 'Keywords')
  includes(gscHtml, 'Countries')
  includes(gscHtml, 'Devices')
})
check('GSC error state is actionable', () => {
  const html = render(
    <GscPage
      payload={{ error: 'GSC credentials are not configured', hint: 'Set GSC_REFRESH_TOKEN…', overview: {}, timeseries: [] }}
      range={range}
      sample={false}
      healthDetail={{ status: 'error', configured: false }}
      onRetry={() => {}}
    />
  )
  includes(html, 'Search Console data could not be loaded')
  includes(html, 'GSC credentials are not configured')
})

console.log('\nConnections page')
const connHtml = render(
  <ConnectionsPage health={healthFixture} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={new Date()} />
)
check('every channel shows its credential state and the fix', () => {
  includes(connHtml, 'Channel connections')
  includes(connHtml, 'Zernio diagnostics')
  includes(connHtml, 'YouTube diagnostics')
  includes(connHtml, 'Not set')
  includes(connHtml, 'ACCESS_TOKEN + FACEBOOK_PAGE_ID')
})
check('sample mode is clearly labelled', () => {
  const html = render(
    <ConnectionsPage health={sampleHealth()} healthError={null} sampleMode onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={new Date()} />
  )
  includes(html, 'Sample data mode is on')
})

console.log('\nBackwards compatibility — old v4.0 backend still deployed')
const legacyPin = unwrap(pinterestLegacy)
const legacyHtml = render(
  <PlatformPage platformKey="pinterest" payload={legacyPin} healthDetail={{ status: 'ok' }} range={range} sample={false} onRetry={() => {}} />
)
check('v4.0 payload renders the pins the API did send', () => {
  const posts = legacyPin.posts || []
  assert(posts.length > 0, 'expected the legacy fixture to carry posts')
  includes(legacyHtml, `${posts.length} pins returned by the API in this range`)
})
check('v4.0 payload still renders every metric key present in totals', () => {
  const keys = metricsOf('pinterest', legacyPin).map((m) => m.key)
  for (const k of Object.keys(legacyPin.totals || {})) {
    assert(keys.includes(k), `metric "${k}" from totals was dropped`)
  }
  includes(legacyHtml, 'All metrics')
})
check('v4.0 empty overview + null account does not crash the page', () => {
  assert(Object.keys(legacyPin.overview || {}).length === 0, 'fixture should have an empty overview')
  assert(legacyPin.meta?.account === null || legacyPin.meta?.account === undefined, 'fixture should have no account')
  includes(legacyHtml, 'Pinterest')
})
check('Overview survives a v4.0 combined payload with no summary block', () => {
  assert(!combinedLegacy.data.summary, 'legacy combined has no summary — that is the point of the test')
  const html = render(
    <OverviewPage platformData={combinedLegacy.data} summary={combinedLegacy.data.summary} healthDetails={{}} range={range} sample={false} onNavigate={() => {}} loading={false} />
  )
  for (const label of ['Facebook', 'Instagram', 'YouTube', 'LinkedIn', 'Pinterest', 'Search Console']) {
    includes(html, label, `channel row for ${label} missing`)
  }
  includes(html, 'Total audience')
})
check('v4.0 health payload (strings only) is normalised into rich details', () => {
  const legacyHealth = {
    success: true,
    data: {
      healthy: false,
      platforms: {
        facebook: 'Request failed with status code 400',
        instagram: 'Request failed with status code 400',
        youtube: 'ok',
        searchConsole: 'ok',
        linkedin: 'ok',
        pinterest: 'ok',
      },
    },
  }
  const details = healthDetailsOf(legacyHealth)
  assert(details.facebook.status === 'error', 'facebook should be an error')
  assert(details.facebook.message.includes('400'), 'the upstream message must survive')
  assert(/expired|credential/i.test(details.facebook.hint || ''), 'a legacy 400 must still produce a hint')
  assert(details.youtube.status === 'ok', 'youtube should be ok')
  const html = render(
    <ConnectionsPage health={legacyHealth} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={new Date()} />
  )
  includes(html, 'Request failed with status code 400')
  includes(html, 'Connected')
})
check('v4.0 overview entries without labels get proper words and kinds', () => {
  // The deployed v4.0 YouTube payload returns {views:{total,average,trend}, …}
  const legacyYt = combinedLegacy.data.youtube
  assert(legacyYt && !legacyYt.error, 'fixture should carry a youtube payload')
  const ms = metricsOf('youtube', legacyYt)
  const views = ms.find((m) => m.key === 'views')
  const watch = ms.find((m) => m.key === 'watchTime')
  assert(views, 'views metric missing')
  assert(views.label === 'Views', `views label was "${views.label}"`)
  if (watch) {
    assert(watch.label === 'Watch time', `watchTime label was "${watch.label}"`)
    assert(watch.unit === 'min', `watchTime unit was "${watch.unit}"`)
  }
  assert(!ms.some((m) => m.key === 'channel'), 'the channel object must not become a metric card')
})

console.log('\nOverview v4.2 — the zero-summary fix and the stage layer')
check('Overview no longer shows all-zero when the server summary is missing (v4.0 shape)', () => {
  const derived = deriveSummary(combinedLegacy.data)
  assert(derived.totals.impressions > 0, `expected the legacy youtube payload to yield impressions, got ${derived.totals.impressions}`)
  const html = render(
    <OverviewPage platformData={combinedLegacy.data} summary={undefined} healthDetails={{}} range={range} sample={false} onNavigate={() => {}} loading={false} />
  )
  // The impressions tile must carry the derived number, not 0.
  includes(html, formatValue(derived.totals.impressions, { kind: 'sum' }), 'derived impressions missing from the Overview')
  // Zero-valued KPIs are labelled as dormant rather than shown as bare zeros.
  includes(html, 'not earned yet')
})
check('an all-zero server summary is replaced by the client roll-up', () => {
  const zeroSummary = { totals: { audience: 0, impressions: 0, engagement: 0, posts: 0, searchClicks: 0 }, platforms: [] }
  const eff = effectiveSummary(combinedLegacy.data, zeroSummary)
  assert(eff.derived === true, 'expected the derived roll-up to win over an all-zero server summary')
  assert(eff.totals.impressions > 0, 'derived impressions should be non-zero')
})
check('a healthy server summary is kept untouched', () => {
  const good = { totals: { audience: 1284, impressions: 23700, engagement: 612, posts: 3, searchClicks: 1 }, platforms: [{ platform: 'pinterest', ok: true }] }
  const eff = effectiveSummary(combinedRich.data, good)
  assert(eff.totals.impressions === 23700, 'server summary must win when it has real numbers')
})
check('the stage hero, publishing calendar and insights render for a young channel', () => {
  const html = render(
    <OverviewPage platformData={combinedLegacy.data} summary={undefined} healthDetails={{}} range={range} sample={false} onNavigate={() => {}} loading={false} />
  )
  includes(html, 'Growth stage')
  includes(html, 'Awareness')
  includes(html, 'Publishing calendar')
  includes(html, 'Showing up')
  includes(html, 'What you have built')
})
check('the publishing calendar counts real publish days', () => {
  const cal = activityCalendarOf({ youtube: { posts: [{ publishedAt: '2026-10-10T09:00:00Z' }, { publishedAt: '2026-10-10T12:00:00Z' }] } }, 30)
  assert(cal.length === 30, 'calendar must cover the whole window')
  assert(cal.find((d) => d.date === '2026-10-10')?.count === 2, 'two posts on one day must count as two')
})

console.log('\nAudience page — demographics, map and honest gaps')
const sampleData = sampleCombined(range).data
check('Audience renders the world map from real country geometry', () => {
  const html = render(<AudiencePage platformData={sampleData} range={range} sample onNavigate={() => {}} />)
  const pathCount = (html.match(/<path/g) || []).length
  assert(pathCount > 100, `expected a full country map, got ${pathCount} paths`)
  includes(html, 'Where your audience lives')
})
check('Audience shows age, gender, countries, cities and devices from sample data', () => {
  const all = render(<AudiencePage platformData={sampleData} range={range} sample onNavigate={() => {}} />)
  includes(all, 'India')
  includes(all, 'Strongest age group')
  const yt = render(<AudiencePage platformData={sampleData} range={range} sample onNavigate={() => {}} initialChannel="youtube" />)
  includes(yt, 'where the audience is')
  includes(yt, 'Top countries')
  includes(yt, 'Mobile phone')
  const ig = render(<AudiencePage platformData={sampleData} range={range} sample onNavigate={() => {}} initialChannel="instagram" />)
  includes(ig, 'Ahmedabad')
  includes(ig, 'Top cities')
})
check('channels without demographics are locked with a real reason, not blank', () => {
  const html = render(<AudiencePage platformData={sampleData} range={range} sample onNavigate={() => {}} />)
  includes(html, 'does not expose audience demographics')
})
check('a channel with no demographics at all renders an explainer, never a crash', () => {
  const html = render(<AudiencePage platformData={{}} range={range} sample={false} onNavigate={() => {}} />)
  includes(html, 'None of the connected channels returned audience composition')
})

console.log('\nHostile payload matrix — the dashboard must never white-screen')
const hostile = {
  'platform blocks are null': Object.fromEntries(PLATFORM_ORDER.map((k) => [k, null])),
  'platform blocks missing entirely': {},
  'error payloads without hint/meta': Object.fromEntries(PLATFORM_ORDER.map((k) => [k, { error: 'Request failed with status code 400' }])),
  'null meta/overview/timeseries': { youtube: { meta: null, overview: null, timeseries: null, metrics: null } },
  'partialErrors containing null/undefined/string': { youtube: { overview: {}, timeseries: [], metrics: [], partialErrors: [null, undefined, 'str', { optional: true, message: 'x' }, { message: 'real', hint: 'fix' }] } },
  'partialErrors as an object instead of array': { youtube: { overview: {}, timeseries: [], metrics: [], partialErrors: { a: 1 } } },
}
for (const [name, data] of Object.entries(hostile)) {
  check(`Overview survives: ${name}`, () => {
    render(<OverviewPage platformData={data} summary={null} healthDetails={{}} range={range} sample={false} onNavigate={() => {}} loading={false} />)
    render(<OverviewPage platformData={data} summary={null} healthDetails={null} range={range} sample={false} onNavigate={() => {}} loading={false} />)
  })
  check(`every platform page survives: ${name}`, () => {
    for (const k of PLATFORM_ORDER) {
      render(<PlatformPage platformKey={k} payload={data[k]} healthDetail={undefined} range={range} sample={false} onRetry={() => {}} />)
    }
    render(<GscPage payload={data.searchConsole} healthDetail={undefined} range={range} sample={false} onRetry={() => {}} />)
    render(<AudiencePage platformData={data} range={range} sample={false} onNavigate={() => {}} />)
  })
}
check('a null partialErrors entry still surfaces the real warning', () => {
  const html = render(
    <PlatformPage platformKey="youtube" payload={hostile['partialErrors containing null/undefined/string'].youtube} healthDetail={undefined} range={range} sample={false} onRetry={() => {}} />
  )
  includes(html, 'real')
  includes(html, 'fix')
})
check('Connections survives an unreachable health endpoint', () => {
  render(<ConnectionsPage health={null} healthError="Cannot reach the API" sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={null} />)
  render(<ConnectionsPage health={{ success: false, error: 'boom' }} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={null} />)
  render(<ConnectionsPage health={{ success: true, data: { details: { facebook: null, youtube: undefined }, platforms: {} } }} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={null} />)
})

console.log('\nLegacy API payload — the pre-rebuild backend still deployed on some hosts')
// Shape taken from the original repository (commit aec670b): meta is {},
// platform failures are bare STRINGS, /api/health carries data.platforms
// strings instead of data.details, and there is no stage/demographics/
// effectiveSummary enrichment.
const legacyCombined = {
  platform: 'combined',
  meta: {},
  data: {
    facebook: { overview: { impressions: 120, reach: 90 }, timeseries: [{ date: '2026-10-14', impressions: 60 }, { date: '2026-10-15', impressions: 60 }] },
    instagram: { overview: { impressions: 10, reach: 8 }, timeseries: [] },
    youtube: { error: 'Invalid grant' },
    linkedin: { error: 'Invalid, revoked or expired API key.' },
    pinterest: { error: 'Invalid, revoked or expired API key.' },
    searchConsole: { overview: { clicks: 4, impressions: 300 }, timeseries: [] },
  },
}
const legacyHealth = { success: true, data: { healthy: false, platforms: { facebook: 'ok', instagram: 'ok', youtube: 'Invalid grant', searchConsole: 'not_configured', linkedin: 'no_account', pinterest: 'HTTP 401' } }, meta: { uptime: 12 } }

check('legacy combined — every page renders without crashing', () => {
  const details = healthDetailsOf(legacyHealth)
  render(<OverviewPage platformData={legacyCombined.data} summary={null} healthDetails={details} range={range} sample={false} onNavigate={() => {}} loading={false} />)
  for (const k of PLATFORM_ORDER) {
    render(<PlatformPage platformKey={k} payload={legacyCombined.data[k]} healthDetail={details[k]} range={range} sample={false} onRetry={() => {}} />)
  }
  render(<GscPage payload={legacyCombined.data.searchConsole} healthDetail={details.searchConsole} range={range} sample={false} onRetry={() => {}} />)
  render(<AudiencePage platformData={legacyCombined.data} range={range} sample={false} onNavigate={() => {}} />)
  render(<ConnectionsPage health={legacyHealth} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={null} />)
})

check('legacy combined — real numbers survive the missing enrichment', () => {
  const html = render(<OverviewPage platformData={legacyCombined.data} summary={null} healthDetails={healthDetailsOf(legacyHealth)} range={range} sample={false} onNavigate={() => {}} loading={false} />)
  for (const n of ['120', '90', '10']) includes(html, n, `Overview dropped legacy metric ${n}`)
  notIncludes(html, 'undefined', 'Overview leaked an undefined')
})

check('legacy combined — a bare string error is shown as readable text', () => {
  const html = render(<PlatformPage platformKey="youtube" payload={legacyCombined.data.youtube} healthDetail={undefined} range={range} sample={false} onRetry={() => {}} />)
  includes(html, 'Invalid grant')
  notIncludes(html, '[object Object]')
})

check('legacy health — counts are derived when ok/total are absent', () => {
  const counts = healthCountsOf(legacyHealth)
  assert(counts.total === 6, `expected total 6, got ${counts.total}`)
  assert(counts.ok === 2, `expected 2 healthy channels, got ${counts.ok}`)
  assert(counts.configured === 5, `expected 5 configured (searchConsole is not), got ${counts.configured}`)
  const html = render(<ConnectionsPage health={legacyHealth} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={null} />)
  notIncludes(html, 'undefined', 'Connections leaked an undefined from a legacy health payload')
  includes(html, '2', 'healthy count missing')
})

check('legacy health — modern payload counts still win', () => {
  const counts = healthCountsOf(healthFixture)
  assert(Number.isFinite(counts.ok) && Number.isFinite(counts.total) && counts.total > 0, `bad counts ${JSON.stringify(counts)}`)
})

check('the dev-proxy "API unreachable" envelope is described with its hint', () => {
  const envelope = {
    success: false,
    error: {
      message: 'The analytics API is not reachable from the dev server.',
      hint: 'Start the backend (`npm run dev:all` from the repo root, or `npm start` on port 5000), or set VITE_PROXY_TARGET to a running API.',
    },
  }
  const err = { response: { status: 503, data: envelope }, message: 'Request failed with status code 503' }
  const text = describeError(err)
  includes(text, 'HTTP 503')
  includes(text, 'not reachable from the dev server')
  includes(text, 'dev:all')
})

check('Connections survives lastUpdated as a Date, a string, a number or junk', () => {
  for (const stamp of [new Date(), '2026-10-16T05:00:00.000Z', Date.now(), 'not-a-date', null, undefined, {}]) {
    const html = render(
      <ConnectionsPage health={healthFixture} healthError={null} sampleMode={false} onToggleSample={() => {}} onRefresh={() => {}} refreshing={false} lastUpdated={stamp} />
    )
    assert(html.length > 400, `Connections rendered nothing for lastUpdated=${String(stamp)}`)
    notIncludes(html, 'Invalid Date')
  }
})

console.log('\nApp shell — every view must render (regression: "sample is not defined")')
const VIEWS = ['overview', ...PLATFORM_ORDER, 'audience', 'connections', 'searchConsole']
for (const view of VIEWS) {
  check(`App renders the "${view}" view without a ReferenceError`, () => {
    store.set('pulse.activeView', JSON.stringify(view))
    const html = render(<App />)
    assert(html.length > 500, `view "${view}" rendered only ${html.length} chars`)
    notIncludes(html, 'is not defined')
    notIncludes(html, 'Unexpected')
  })
}
check('App renders every view in sample mode too', () => {
  store.set('pulse.sampleMode', 'true')
  for (const view of VIEWS) {
    store.set('pulse.activeView', JSON.stringify(view))
    const html = render(<App />)
    assert(html.length > 500, `sample view "${view}" rendered only ${html.length} chars`)
    notIncludes(html, 'is not defined')
  }
  store.delete('pulse.sampleMode')
})
check('App renders every view with a collapsed sidebar and a mobile nav open', () => {
  store.set('pulse.sidebarCollapsed', 'true')
  for (const view of VIEWS) {
    store.set('pulse.activeView', JSON.stringify(view))
    render(<App />)
  }
  store.delete('pulse.sidebarCollapsed')
  store.delete('pulse.activeView')
})

check('the sidebar dot is green when data arrives even if health is unhappy', () => {
  const html = render(
    <Sidebar
      active="pinterest"
      onChange={() => {}}
      healthDetails={{ pinterest: { status: 'error', message: 'health probe failed', configured: true } }}
      platformData={{ pinterest: unwrap(pinterestRich) }}
    />
  )
  includes(html, 'bg-pos', 'a channel with data must not show a red dot')
  notIncludes(html, 'bg-neg')
})

check('the sidebar dot is amber when data arrived but part of it is missing', () => {
  const payload = unwrap(pinterestRich)
  const html = render(
    <Sidebar
      active="pinterest"
      onChange={() => {}}
      healthDetails={{ pinterest: { status: 'ok', configured: true } }}
      platformData={{ pinterest: { ...payload, partialErrors: [{ group: 'g3', optional: true, message: 'skipped' }] } }}
    />
  )
  includes(html, 'bg-warn')
  includes(html, 'some metrics unavailable')
})

check('the sidebar dot is red only when nothing came back', () => {
  const html = render(
    <Sidebar
      active="instagram"
      onChange={() => {}}
      healthDetails={{ instagram: { status: 'ok', configured: true } }}
      platformData={{ instagram: { error: { message: 'boom' } } }}
    />
  )
  includes(html, 'bg-neg')
  includes(html, 'No data')
})

console.log('\nMetric table & app shell')
check('MetricTable lists every metric including zeros, with aggregation kinds', () => {
  const html = render(<MetricTable metrics={metricsOf('pinterest', pinData)} platformKey="pinterest" color="#E60023" />)
  includes(html, 'All metrics')
  includes(html, 'Total pins')
  includes(html, 'level')
  includes(html, 'Hide empty')
})
// ── v4.2.5 — unpublished gauges are removed, estimates are labelled ──
console.log('\nv4.2.5 — cards the platform cannot publish, and estimated numbers')

// Mirrors the real Pinterest account: Zernio reports 0 followers and no
// pin/board/monthly-view stats, but 3 pins were published and are known.
const sparsePinterest = {
  overview: {
    impressions: { key: 'impressions', label: 'Impressions', kind: 'sum', total: 0, hasData: false },
    pins: { key: 'pins', label: 'Total pins', kind: 'gauge', total: 3, hasData: true, source: 'published pins' },
    boards: { key: 'boards', label: 'Boards', kind: 'gauge', total: 1, hasData: true },
    followers: {
      key: 'followers', label: 'Followers', kind: 'gauge', total: 0, hasData: false,
      unavailable: true,
      unavailableReason: "Pinterest's API does not publish a follower count for business accounts, so Zernio has nothing to report.",
    },
    monthlyViews: {
      key: 'monthlyViews', label: 'Monthly views', kind: 'gauge', total: 0, hasData: false,
      unavailable: true, unavailableReason: 'Pinterest does not expose monthly views.',
    },
    account: { name: 'kishorprajapati1040', username: 'kishorprajapati1040', followers: 0, pinCount: null, boardCount: null, monthlyViews: null },
  },
  metrics: [],
  timeseries: [],
  posts: [],
  meta: { account: { followers: 0, pinCount: null, boardCount: null, monthlyViews: null } },
}

check('cards the platform does not publish are removed, not rendered as 0', () => {
  const keys = metricsOf('pinterest', sparsePinterest).map((m) => m.key)
  assert(!keys.includes('followers'), `followers should be gone, got ${keys.join(', ')}`)
  assert(!keys.includes('monthlyViews'), `monthlyViews should be gone, got ${keys.join(', ')}`)
  assert(keys.includes('pins'), 'a real number must stay')
  assert(keys.includes('impressions'), 'a measured zero must stay (it is not the same as "unpublished")')
})

check('the account header drops an unpublished follower count and keeps the pins it knows', () => {
  const a = accountOf(sparsePinterest)
  assert(a.followers === null, `followers should be null, got ${a.followers}`)
  includes(a.followersNote || '', 'does not publish')
  assert(a.stats.some((x) => x.label === 'Total pins' && x.value === 3), JSON.stringify(a.stats))
  assert(a.stats.some((x) => x.label === 'Boards' && x.value === 1), JSON.stringify(a.stats))
  assert(!a.stats.some((x) => x.label === 'Monthly views'), 'an unpublished gauge must not appear as 0')
})

// What the YouTube fallback produces when the token has no youtube.readonly.
const ytEstimated = {
  overview: {
    views: { key: 'views', label: 'Views', kind: 'sum', total: 7, hasData: true },
    followers: {
      key: 'followers', label: 'Subscribers', kind: 'gauge', total: 132, hasData: true,
      estimated: true, source: 'analytics_estimate',
      description: 'Estimated from lifetime subscribersGained - subscribersLost (the Data API scope is missing).',
    },
    account: {
      name: 'YouTube Channel', followers: 132, followersEstimated: true,
      lifetime: { subscribers: 132, subscribersEstimated: true, totalViews: 4820, totalVideos: 3, watchTimeHours: 253.8, source: 'analytics_api' },
    },
  },
  metrics: [],
  timeseries: [],
  posts: [],
  meta: {},
}

check('an estimated subscriber count is labelled, and never renders as 0', () => {
  const a = accountOf(ytEstimated)
  assert(a.followers === 132, `expected 132, got ${a.followers}`)
  assert(a.followersEstimated === true)
  const sub = a.stats.find((x) => String(x.label).startsWith('Subscribers'))
  assert(sub && sub.approx === true, JSON.stringify(a.stats))
  assert(a.stats.some((x) => x.label === 'Lifetime views' && x.value === 4820), JSON.stringify(a.stats))
  assert(a.stats.some((x) => x.label === 'Lifetime watch time'), JSON.stringify(a.stats))
  const card = metricsOf('youtube', ytEstimated).find((m) => m.key === 'followers')
  assert(card && card.estimated === true && card.total === 132, JSON.stringify(card))
})

check('KpiCard marks an estimated value with a tilde and says so', () => {
  const card = metricsOf('youtube', ytEstimated).find((m) => m.key === 'followers')
  const html = render(<KpiCard metric={card} />)
  includes(html, '\u2248')
  includes(html, 'Estimated')
  includes(html, '132')
})

check('PageHeader shows the estimate marker next to the follower count', () => {
  const html = render(<PageHeader platformKey="youtube" account={accountOf(ytEstimated)} source="YouTube Analytics API" />)
  includes(html, '\u2248')
  includes(html, 'followers')
  includes(html, 'Subscribers (est.)')
})

check('a card summed from posts says where the number came from', () => {
  const fromPosts = {
    overview: {
      likes: {
        key: 'likes', label: 'Likes', kind: 'sum', total: 15, hasData: true, derived: true, source: 'posts',
        description: 'Summed from 2 Page posts in this range.',
      },
    },
    metrics: [], timeseries: [], posts: [], meta: {},
  }
  const html = render(<KpiCard metric={metricsOf('facebook', fromPosts)[0]} />)
  includes(html, 'Summed from your posts in this range')
  includes(html, '15')
})

check('the Pinterest page hides unpublished cards but keeps the real ones', () => {
  const html = render(
    <PlatformPage platformKey="pinterest" payload={sparsePinterest} healthDetail={{ status: 'ok', configured: true }} range={range} sample={false} />
  )
  notIncludes(html, 'Monthly views')
  includes(html, 'Total pins')
  includes(html, 'kishorprajapati1040')
})

// ────────────────────────────────────────────────────────────────
console.log('\n\x1b[1mv4.3.0 — growth diagnosis (server engine → panel)\x1b[0m')

const czData = unwrap(combinedZero)
const diagFor = (platform, audience = 'institutions') => diagnosisFx.zero[audience][platform]
const diagPin = diagFor('pinterest')
const diagLi = diagFor('linkedin')
const diagIg = diagFor('instagram')
const diagYt = diagFor('youtube')
const diagGsc = diagFor('searchConsole')
const diagFb = diagFor('facebook')
const allDiag = [diagFb, diagIg, diagYt, diagLi, diagPin, diagGsc]
const focusInst = diagnosisFx.focus.institutions
const focusStud = diagnosisFx.focus.students

check('the API diagnosis carries the full contract for every channel', () => {
  for (const d of allDiag) {
    assert(d && typeof d === 'object', 'diagnosis missing')
    assert(typeof d.stage === 'string' && d.stage.length > 0, `${d.platform}: no stage`)
    assert(typeof d.headline === 'string' && d.headline.length > 20, `${d.platform}: no headline`)
    assert(Array.isArray(d.funnel) && d.funnel.length === 5, `${d.platform}: funnel must have 5 stages`)
    for (const st of d.funnel) {
      assert(['ok', 'zero', 'unavailable'].includes(st.verdict), `${d.platform}/${st.key}: bad verdict ${st.verdict}`)
      assert(typeof st.display === 'string' && st.display.length > 0, `${d.platform}/${st.key}: no display value`)
    }
    assert(Array.isArray(d.zeros), `${d.platform}: zeros must be an array`)
    for (const z of d.zeros) {
      assert(z.key && z.label && z.reason && z.explanation, `${d.platform}: incomplete zero entry`)
    }
    assert(Array.isArray(d.actions) && d.actions.length > 0, `${d.platform}: no actions`)
    for (const a of d.actions) assert(a.title && a.detail, `${d.platform}: incomplete action`)
    assert(d.audienceFit && ['high', 'medium', 'low'].includes(d.audienceFit.fit), `${d.platform}: bad audience fit`)
    assert(typeof d.mechanics === 'string' && d.mechanics.length > 20, `${d.platform}: no channel mechanics`)
    assert(d.evidence && typeof d.evidence === 'object', `${d.platform}: no evidence`)
  }
})

check('zero-engagement channels are diagnosed, not just reported as 0', () => {
  // combined-zero is the user's real situation: LinkedIn/Pinterest published and
  // got nothing; the Meta channels had nothing in range at all.
  assert(diagLi.stage === 'no-distribution', `LinkedIn expected no-distribution, got ${diagLi.stage}`)
  assert(diagPin.stage === 'no-distribution', `Pinterest expected no-distribution, got ${diagPin.stage}`)
  // combined-zero records Instagram as an unconfigured error, which must read as
  // "could not be read" — never as "you published nothing".
  assert(diagIg.stage === 'unreachable', `Instagram expected unreachable, got ${diagIg.stage}`)
  assert(diagIg.zeros.length <= 1, `an errored channel gets one explanation, got ${diagIg.zeros.length}`)
  assert(diagIg.funnel.every((f) => f.verdict === 'unavailable'), 'an errored channel has no readable funnel')
  assert(/could not be read|error/i.test(diagIg.headline), diagIg.headline)
  assert(diagIg.actions[0].title.toLowerCase().includes('connection'), diagIg.actions[0].title)
  includes(diagLi.headline, 'algorithm')
  includes(diagPin.actions[0].detail.toLowerCase(), 'pin')
})

check('a channel with real numbers is diagnosed healthy and sums engagement', () => {
  const pin = diagnosisFx.rich.pinterest
  const li = diagnosisFx.rich.linkedin
  assert(pin.stage === 'healthy', `rich Pinterest expected healthy, got ${pin.stage}`)
  assert(li.stage === 'healthy', `rich LinkedIn expected healthy, got ${li.stage}`)
  const eng = pin.funnel.find((f) => f.key === 'engaged')
  assert(eng.value > 0, `expected engagement ${eng.value}`)
  assert(eng.verdict === 'ok', `an engaged channel must read ok, got ${eng.verdict}`)
  assert(typeof pin.evidence.engagedSource === 'string' && pin.evidence.engagedSource.length > 0, 'the engagement source must be stated')
  // The benchmark is prose on the API side: `yours` is a number in percent,
  // `typical` is a sentence, and the reference must say it is not their data.
  assert(pin.benchmark, 'a benchmark reference is attached')
  assert(pin.benchmark.metric === 'engagement rate', `metric is ${pin.benchmark.metric}`)
  assert(typeof pin.benchmark.yours === 'number' && Number.isFinite(pin.benchmark.yours), 'yours must be a number')
  assert(/%/.test(String(pin.benchmark.typical)), `typical must quote a percentage, got ${pin.benchmark.typical}`)
  includes(String(pin.benchmark.reference).toLowerCase(), 'not your data')
  assert(li.benchmark && typeof li.benchmark.yours === 'number', 'LinkedIn carries a benchmark too')
})

check('the audience target changes which channel fits', () => {
  assert(diagFor('linkedin', 'institutions').audienceFit.fit === 'high', 'LinkedIn is high fit for institutions')
  assert(diagFor('linkedin', 'students').audienceFit.fit === 'medium', 'LinkedIn drops to medium for students')
  assert(diagFor('instagram', 'institutions').audienceFit.fit === 'low', 'Instagram is low fit for institutions')
  assert(diagFor('instagram', 'students').audienceFit.fit === 'high', 'Instagram is high fit for students')
  assert(diagFor('youtube', 'institutions').audienceFit.fit === 'high', 'YouTube reaches institutions')
  assert(diagFor('facebook', 'students').audienceFit.fit === 'low', 'Facebook is low fit for students')
})

check('the ranking puts a blocked high-fit channel first, and flips with the audience', () => {
  assert(focusInst.length === 6, `expected 6 ranked channels, got ${focusInst.length}`)
  const scores = focusInst.map((r) => r.score)
  assert(scores.every((v, i) => i === 0 || scores[i - 1] >= v), 'scores must descend')
  // combined-zero was recorded with missing credentials, so four channels answer
  // with an error: those outrank everything, because a channel that cannot be
  // read is the first thing to fix. What must hold is the *shape* of the ranking.
  const topScore = Math.max(...scores)
  assert(focusInst[0].score === topScore, `the first row must be the highest score, got ${focusInst[0].score} of ${topScore}`)
  assert(focusInst[0].audienceFit === 'high', `institutions: the top channel must be a high-fit one, got ${focusInst[0].platform} (${focusInst[0].audienceFit})`)
  const rankInst = (k) => focusInst.findIndex((r) => r.platform === k)
  assert(rankInst('linkedin') < rankInst('instagram'), 'LinkedIn must outrank Instagram when targeting institutions')
  assert(rankInst('linkedin') < rankInst('pinterest'), 'LinkedIn must outrank Pinterest when targeting institutions')
  const rankStud = (k) => focusStud.findIndex((r) => r.platform === k)
  assert(rankStud('instagram') < rankStud('linkedin'), 'Instagram must outrank LinkedIn when targeting students')
  assert(rankStud('facebook') === focusStud.length - 1, `students: Facebook is a low-fit channel and must rank last, got #${rankStud('facebook') + 1}`)
  assert(focusStud[0].audienceFit === 'high', `students: the top channel must be a high-fit one, got ${focusStud[0].platform}`)
  for (const row of focusInst) {
    assert(row.headline && row.firstAction, `${row.platform}: ranking row needs a headline and a first action`)
    assert(['high', 'medium', 'low'].includes(row.audienceFit), `${row.platform}: ranking row needs an audience fit`)
  }
})

check('the focus board stays out of the way when there is nothing to focus on', () => {
  assert(render(<FocusBoard focus={[]} />) === '', 'an empty focus list must render nothing')
})

check('the focus board ranks channels and links each row to its page', () => {
  const html = render(<FocusBoard focus={focusInst} audience="institutions" onAudienceChange={() => {}} onNavigate={() => {}} />)
  includes(html, 'Where to focus this week')
  includes(html, 'Highest-value move')
  for (const row of focusInst.slice(0, 3)) includes(html, row.headline.slice(0, 24).replace(/&/g, '&amp;'))
  includes(html, 'Priority =')
})

// v4.3.5 — the user: "remove digital dignosis it just extra thing". The panel is
// gone from every page; the API still computes `data.diagnosis` (the focus board,
// the overview hero and /api/report all read it).
check('no page renders the diagnosis panel any more', () => {
  // LinkedIn, not Instagram: combined-zero records Instagram as an unconfigured
  // error payload, which PlatformPage answers with its error state instead.
  const payload = { ...czData.linkedin, diagnosis: diagLi }
  const html = render(<PlatformPage platformKey="linkedin" payload={payload} healthDetail={{ status: 'ok', configured: true }} range={range} sample={false} audience="institutions" onAudienceChange={() => {}} />)
  includes(html, 'Headline metrics')
  notIncludes(html, 'Growth diagnosis')
  notIncludes(html, 'Where the funnel stops')
  notIncludes(html, 'Collapse the diagnosis')

  // gscHtml is the Search Console page rendered from the sample payload above.
  notIncludes(gscHtml, 'Growth diagnosis')
  notIncludes(gscHtml, 'Where the funnel stops')
})

check('a metric published as a single level does not open an empty chart', () => {
  // Instagram's real shape: follower_count arrives as one total_value with no
  // per-day breakdown, while reach has a series.
  const ig = {
    overview: {
      followers: { key: 'followers', label: 'Followers', kind: 'gauge', unit: '', group: 'Audience', total: 6, previous: null, trend: null, hasData: true, points: 0 },
      reach: { key: 'reach', label: 'Reach', kind: 'sum', unit: '', group: 'Performance', total: 346, previous: null, trend: null, hasData: true, points: 2 },
    },
    metrics: [],
    timeseries: [{ date: '2026-09-01', reach: 100 }, { date: '2026-09-02', reach: 246 }],
    posts: [], meta: {},
  }
  const html = render(<PlatformPage platformKey="instagram" payload={ig} healthDetail={{ status: 'ok' }} range={range} sample={false} />)
  // The chart defaults to the metric that actually has daily values…
  includes(html, '2 daily values')
  // …and the page no longer says the same emptiness three different ways.
  notIncludes(html, 'No follower series in the payload.')
  notIncludes(html, 'Follower level per day')
  notIncludes(html, 'No daily values for this metric in the selected range.')
  notIncludes(html, '0 daily values')
  notIncludes(html, 'gauge metric')
})

check('when the only metric has no series, one line says so', () => {
  const only = {
    overview: {
      followers: { key: 'followers', label: 'Followers', kind: 'gauge', unit: '', group: 'Audience', total: 6, previous: null, trend: null, hasData: true, points: 0 },
    },
    metrics: [], timeseries: [], posts: [], meta: {},
  }
  const html = render(<PlatformPage platformKey="instagram" payload={only} healthDetail={{ status: 'ok' }} range={range} sample={false} />)
  includes(html, 'published as a single value')
  includes(html, 'nothing to plot')
  notIncludes(html, 'No daily values for this metric in the selected range.')
})

check('the overview page mounts the focus board above the channel table', () => {
  const html = render(
    <OverviewPage
      platformData={czData} summary={czData.summary} focus={focusInst}
      audience="institutions" onAudienceChange={() => {}} healthDetails={{}} range={range} sample={false} onNavigate={() => {}}
    />
  )
  includes(html, 'Where to focus this week')
  includes(html, 'Channel performance')
  assert(html.indexOf('Where to focus this week') < html.indexOf('Channel performance'), 'focus board must come first')
})

check('sample mode reproduces the diagnosis so the design can be reviewed offline', () => {
  const sc = sampleCombined(range, 'institutions')
  assert(Array.isArray(sc.data.focus) && sc.data.focus.length === 6, `expected 6 ranked channels, got ${sc.data.focus?.length}`)
  const scores = sc.data.focus.map((r) => r.score)
  assert(scores.every((v, i) => i === 0 || scores[i - 1] >= v), 'sample focus must be sorted descending')
  for (const k of PLATFORM_ORDER) {
    const d = sc.data[k].diagnosis
    assert(d && d.funnel.length === 5, `${k}: sample diagnosis incomplete`)
    assert(d.audience === 'institutions', `${k}: sample audience not applied`)
  }
  assert(sc.data.instagram.diagnosis.audienceFit.fit === 'low', 'for institutions the sample must call Instagram a low fit')
  assert(sc.data.linkedin.diagnosis.audienceFit.fit === 'high', 'for institutions the sample must call LinkedIn a high fit')
  const students = sampleCombined(range, 'students')
  assert(students.data.instagram.diagnosis.audienceFit.fit === 'high', 'students audience keeps Instagram high')
  assert(students.data.linkedin.diagnosis.audienceFit.fit === 'medium', 'students audience drops LinkedIn to medium')
  assert(sampleDiagnosis && sampleFocus, 'sample helpers exported')
})

check('sample mode mirrors the server benchmark contract', () => {
  const sc = sampleCombined(range, 'institutions')
  for (const k of PLATFORM_ORDER) {
    const b = sc.data[k].diagnosis.benchmark
    if (!b) continue
    assert(b.metric === 'engagement rate', `${k}: metric is ${b.metric}`)
    assert(typeof b.yours === 'number', `${k}: yours must be a number`)
    assert(/%/.test(String(b.typical)), `${k}: typical must quote a percentage`)
  }
  assert(diagnosisFx.rich.linkedin.benchmark, 'the engine still ships the benchmark the API publishes')
})

check('the audience options are exactly the two the user asked for', () => {
  assert(AUDIENCE_OPTIONS.length === 2, 'two audience targets')
  assert(AUDIENCE_OPTIONS.map((o) => o.value).join(',') === 'institutions,students', 'institutions first — it is the default')
})

console.log('\n\x1b[1mv4.3.1 — the real Pinterest capture (synced pins, zero metrics)\x1b[0m')

const realPin = diagnosisFx.realCapture.pinterest
const realLi = diagnosisFx.realCapture.linkedin

check('a synced pin with zero metrics is "not measured", never "no distribution"', () => {
  const d = realPin.diagnosis.institutions
  assert(d.stage === 'not-reported', `stage is ${d.stage}`)
  assert(d.evidence.notReported === true, 'evidence.notReported must be set')
  assert(d.evidence.syncedPosts === 6, `syncedPosts is ${d.evidence.syncedPosts}`)
  assert(d.evidence.identifiedPosts === 6, `identifiedPosts is ${d.evidence.identifiedPosts}`)
  assert(d.evidence.oldestPostDays >= 30, `oldestPostDays is ${d.evidence.oldestPostDays} — the lag cannot explain it`)
  assert(d.evidence.accountGaugesEmpty === true, 'the account gauges came back empty upstream')
  assert(/BUSINESS/.test(d.headline), 'the headline must name the real cause')
  assert(/not measured/.test(d.headline), 'it must say the zeros are not a verdict on the content')
  assert(/Business account/.test(d.actions[0].title), `first action is "${d.actions[0].title}"`)
  assert(d.actions.length >= 3, 'convert, reconnect, and how to read the truth meanwhile')
  const reasons = new Set(d.zeros.map((z) => z.reason))
  assert(reasons.has('not-reported'), `zero reasons are ${[...reasons].join(',')}`)
  assert(!reasons.has('no-distribution'), 'it must not blame the algorithm for a missing entitlement')
  assert(d.benchmark.yours === null, 'no rate can be computed from a channel that reports nothing')
})

check('LinkedIn, published the same way, is still judged on its real numbers', () => {
  const d = realLi.diagnosis.institutions
  assert(d.evidence.notReported === false, 'the control channel must not inherit the Pinterest verdict')
  assert(d.stage !== 'not-reported', `stage is ${d.stage}`)
  assert(d.evidence.seen === 93, `impressions are ${d.evidence.seen}, the capture says 93`)
  assert(d.evidence.engaged === 2, `engagement is ${d.evidence.engaged}, the capture says 2`)
  assert(d.evidence.lowReach === true && d.evidence.seenPerPost === 11.6, `seenPerPost is ${d.evidence.seenPerPost}`)
  assert(/Reach is the binding constraint/.test(d.headline), 'tiny reach must be said out loud')
  assert(d.actions[0].title === 'Fix reach before anything else', `first action is "${d.actions[0].title}"`)
  assert(d.benchmark.yours === 2.15, `benchmark.yours is ${d.benchmark.yours}`)
})

check('the Pinterest advice rules out the scopes the connection already has', () => {
  const d = realPin.diagnosis.institutions
  const reconnect = d.actions.find((a) => /Reconnect/i.test(a.title))
  assert(reconnect, 'the reconnect action must exist')
  includes(reconnect.detail, 'already grants')
  includes(reconnect.detail, 'pins:read')
  includes(reconnect.detail, 'no scope is missing')
  assert(Array.isArray(d.evidence.accountPermissions) && d.evidence.accountPermissions.includes('user_accounts:read'), 'the permissions must reach the panel')
  assert(d.evidence.accountPlatformStatus === 'active', `platformStatus is ${d.evidence.accountPlatformStatus}`)
})

check('the real pins keep their Pinterest id, URL and sync state through the transform', () => {
  const posts = realPin.payload.posts
  assert(posts.length === 6, `${posts.length} pins`)
  assert(posts[0].postId === '1127166613023434329', `postId is ${posts[0].postId} — the pin id must survive`)
  assert(String(posts[0].platformUrl).includes('pinterest.com/pin/1127166613023434329'), `platformUrl is ${posts[0].platformUrl}`)
  assert(posts.every((x) => x.syncStatus === 'synced'), 'the per-platform sync state must win over the document-level "external"')
  assert(posts.every((x) => x.isExternal === true), 'they really were published outside Zernio')
  const avail = realPin.payload.meta.metricAvailability
  assert(avail && avail.verdict === 'not-reported', `metricAvailability is ${JSON.stringify(avail)}`)
  assert(avail.agedPastLag === 5, `${avail.agedPastLag} pins are past the lag window`)
  assert(/BUSINESS/.test(String(realPin.payload.notice)), 'the notice must explain the zeros')
  assert(realLi.payload.posts[0].postId.startsWith('urn:li:ugcPost:'), `linkedin postId is ${realLi.payload.posts[0].postId}`)
})

check('App shell mounts (sidebar, topbar, loading state)', () => {
  const html = render(<App />)
  includes(html, 'Pulse')
  includes(html, 'Channels')
  includes(html, 'Overview')
})

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
if (failures.length) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f}`))
}
console.log('')
process.exit(failed ? 1 : 0)
