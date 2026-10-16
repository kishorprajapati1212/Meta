/**
 * scripts/livecheck.jsx — render every dashboard page with REAL API responses.
 *
 * The offline smoke suite (scripts/smoke.jsx) proves the UI survives hostile
 * payloads. This proves the opposite direction: that a live backend actually
 * produces numbers the pages display. Point it at any deployment:
 *
 *   npm run smoke:live                                  # http://127.0.0.1:5000
 *   npm run smoke:live -- --api https://meta-ptze.onrender.com
 *   npm run smoke:live -- --api http://127.0.0.1:5000 --json
 *
 * It fetches /api/health, /api/combined and every platform endpoint, renders
 * Overview / each channel page / Audience / Connections server-side, and fails
 * if a page crashes, if a connected platform shows no numbers, or if the API
 * reports an error for a platform you expected to work.
 */
import { renderToStaticMarkup } from 'react-dom/server'

import OverviewPage from '../src/components/panels/OverviewPage.jsx'
import PlatformPage from '../src/components/panels/PlatformPage.jsx'
import GscPage from '../src/components/panels/GscPage.jsx'
import AudiencePage from '../src/components/panels/AudiencePage.jsx'
import ConnectionsPage from '../src/components/panels/ConnectionsPage.jsx'
import { metricsOf, healthDetailsOf } from '../src/lib/normalize.js'
import { PLATFORM_ORDER } from '../src/lib/platforms.js'

const argv = process.argv.slice(2)
const apiFlag = argv.indexOf('--api')
const API = (apiFlag >= 0 ? argv[apiFlag + 1] : process.env.LIVE_API || 'http://127.0.0.1:5000').replace(/\/$/, '')
const asJson = argv.includes('--json')
const range = { preset: 'last_30d' }

let passed = 0
let failed = 0
const failures = []
const rows = []
const ENRICHMENT = ['demographics', 'stage', 'account', 'partialErrors', 'totals', 'topItems', 'topPosts', 'boards', 'level']
const droppedFields = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    if (!asJson) console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed += 1
    failures.push(`${name}: ${e.message}`)
    if (!asJson) console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(120000) })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: res.status, body, text }
}

/** Single-platform endpoints nest differently from /api/combined. */
const unwrap = (res) =>
  res && res.data && !res.data.meta ? { ...res.data, meta: res.meta || {} } : res?.data || res

const digits = (html) => (html.match(/\b\d[\d,.]*\b/g) || []).filter((n) => Number(n.replace(/[,]/g, '')) > 0)

async function main() {
  if (!asJson) console.log(`\n\x1b[1mPulse live check\x1b[0m — rendering real responses from ${API}\n`)

  const health = await get('/api/health')
  const combined = await get('/api/combined?date_preset=last_30d&compact=true')

  check('GET /api/health answers 200 with JSON', () => {
    assert(health.status === 200, `HTTP ${health.status}: ${health.text.slice(0, 160)}`)
    assert(health.body && health.body.success !== false, `health failed: ${JSON.stringify(health.body).slice(0, 200)}`)
  })

  check('GET /api/combined answers 200 with every platform key', () => {
    assert(combined.status === 200, `HTTP ${combined.status}: ${combined.text.slice(0, 160)}`)
    const data = combined.body?.data?.data || combined.body?.data || {}
    const missing = PLATFORM_ORDER.filter((k) => !(k in data))
    assert(missing.length === 0, `missing platform keys: ${missing.join(', ')}`)
  })

  const details = healthDetailsOf(health.body)
  const combinedData = combined.body?.data?.data || combined.body?.data || {}

  if (!asJson) console.log('\nLive payload — per channel')

  for (const key of PLATFORM_ORDER) {
    const single = await get(`/api/${key === 'searchConsole' ? 'gsc' : key}?date_preset=last_30d`)
    const payload = unwrap(single.body) || combinedData[key] || null
    const detail = details[key] || {}
    const label = key === 'searchConsole' ? 'Search Console' : key[0].toUpperCase() + key.slice(1)

    check(`${label}: its own endpoint answers 200`, () => {
      assert(single.status === 200, `HTTP ${single.status}: ${single.text.slice(0, 160)}`)
    })

    let html = ''
    check(`${label}: the channel page renders without crashing`, () => {
      const Page = key === 'searchConsole' ? GscPage : PlatformPage
      html = renderToStaticMarkup(
        <Page
          platformKey={key}
          payload={payload}
          healthDetail={detail}
          range={range}
          sample={false}
          onRetry={() => {}}
        />
      )
      assert(html.length > 400, `page rendered almost nothing (${html.length} chars)`)
      assert(!/Cannot read|is not a function|undefined \(reading/.test(html), 'page leaked a JS error')
    })

    const metrics = metricsOf(key, payload) || []
    const withData = metrics.filter((m) => m.hasData || Number(m.total) > 0 || Number(m.average) > 0 || Number(m.last) > 0)
    const nums = digits(html)

    check(`${label}: shows real numbers (${withData.length}/${metrics.length} metrics with data)`, () => {
      if (payload && payload.error) {
        // an honest error state is acceptable — but it must be readable, not blank
        assert(nums.length > 0 || /not set|expired|unavailable|error/i.test(html), `error state rendered nothing useful: ${html.slice(0, 200)}`)
        return
      }
      assert(nums.length > 0, 'no numbers anywhere on the page')
      assert(withData.length > 0 || nums.length > 3, `no metric carries data — ${metrics.length} metrics, ${nums.length} numbers on the page`)
    })

    const combinedBlock = combinedData[key] || {}
    const dropped = ENRICHMENT.filter((f) => combinedBlock[f] !== undefined && (!payload || payload[f] === undefined))
    if (dropped.length) droppedFields.push(`${key}: ${dropped.join(', ')}`)

    rows.push({
      platform: key,
      health: detail.status || 'unknown',
      endpoint: single.status,
      metrics: metrics.length,
      metricsWithData: withData.length,
      numbersOnPage: nums.length,
      demographics: payload?.demographics?.available === true ? 'yes' : payload?.demographics ? 'no' : '—',
      error: payload?.error ? String(payload.error).slice(0, 90) : null,
    })
  }

  if (!asJson) console.log('\nCross-channel pages')

  check('Overview renders the live combined payload', () => {
    const html = renderToStaticMarkup(
      <OverviewPage
        platformData={combinedData}
        summary={combinedData.summary || null}
        healthDetails={details}
        range={range}
        sample={false}
        onNavigate={() => {}}
        loading={false}
      />
    )
    assert(html.length > 800, 'Overview rendered almost nothing')
    assert(digits(html).length > 3, `Overview shows no numbers: ${digits(html).length}`)
  })

  check('Audience renders the live demographics', () => {
    const html = renderToStaticMarkup(
      <AudiencePage platformData={combinedData} range={range} sample={false} onNavigate={() => {}} />
    )
    assert(html.length > 400, 'Audience rendered almost nothing')
  })

  check('Connections renders the live health payload', () => {
    const html = renderToStaticMarkup(
      <ConnectionsPage
        health={health.body}
        healthError={null}
        sampleMode={false}
        onToggleSample={() => {}}
        onRefresh={() => {}}
        refreshing={false}
        lastUpdated={new Date()}
      />
    )
    assert(html.length > 400, 'Connections rendered almost nothing')
    assert(!/undefined\/undefined/.test(html), 'Connections printed undefined/undefined counts')
  })

  check('single-platform endpoints return the same enrichment as /api/combined', () => {
    assert(
      droppedFields.length === 0,
      `these endpoints drop fields the combined payload has → ${droppedFields.join(' | ')}`
    )
  })

  check('every channel the API calls healthy really returns data', () => {
    const lying = rows.filter((r) => r.health === 'ok' && !r.error && r.metricsWithData === 0 && r.numbersOnPage < 4)
    assert(lying.length === 0, `healthy but empty: ${lying.map((r) => r.platform).join(', ')}`)
  })

  if (asJson) {
    console.log(JSON.stringify({ api: API, passed, failed, failures, rows }, null, 2))
  } else {
    console.log('\n  platform        health          metrics  with data  numbers  demographics')
    for (const r of rows) {
      console.log(
        `  ${r.platform.padEnd(15)} ${String(r.health).padEnd(15)} ${String(r.metrics).padStart(7)} ${String(r.metricsWithData).padStart(10)} ${String(r.numbersOnPage).padStart(8)}  ${r.demographics}` +
          (r.error ? `\n      └ ${r.error}` : '')
      )
    }
    console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`)
    if (failures.length) {
      console.log('Failures:')
      failures.forEach((f) => console.log(`  - ${f}`))
      console.log('')
    }
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('\nlive check crashed:', e)
  process.exit(1)
})
