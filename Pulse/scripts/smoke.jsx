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
import OverviewPage from '../src/components/panels/OverviewPage.jsx'
import PlatformPage from '../src/components/panels/PlatformPage.jsx'
import GscPage from '../src/components/panels/GscPage.jsx'
import ConnectionsPage from '../src/components/panels/ConnectionsPage.jsx'
import MetricTable from '../src/components/metrics/MetricTable.jsx'
import { metricsOf, healthDetailsOf } from '../src/lib/normalize.js'
import { sampleCombined, sampleHealth } from '../src/lib/sample.js'
import { formatValue } from '../src/lib/format.js'

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
check('trends are computed instead of always 0', () => {
  const trends = Object.values(pinRichData.overview).map((v) => v.trend).filter((t) => typeof t === 'number')
  assert(trends.some((t) => t !== 0), 'every trend is still zero')
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

console.log('\nMetric table & app shell')
check('MetricTable lists every metric including zeros, with aggregation kinds', () => {
  const html = render(<MetricTable metrics={metricsOf('pinterest', pinData)} platformKey="pinterest" color="#E60023" />)
  includes(html, 'All metrics')
  includes(html, 'Total pins')
  includes(html, 'level')
  includes(html, 'Hide empty')
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
