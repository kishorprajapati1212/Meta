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
let skipped = 0
const failures = []
const skips = []
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

/** A check that cannot run against this deployment (usually: it is too old). */
function skip(name, reason) {
  skipped += 1
  skips.push(`${name}: ${reason}`)
  if (!asJson) console.log(`  \x1b[33m–\x1b[0m ${name}\n      \x1b[33mskipped\x1b[0m — ${reason}`)
}

/** Loose semver compare: -1 if a<b, 0 if equal, 1 if a>b. */
function versionCompare(a, b) {
  const pa = String(a || '0').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
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
          audience={combined.body?.data?.data?.audience || combined.body?.data?.audience || 'institutions'}
          onAudienceChange={() => {}}
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
        focus={combinedData.focus || []}
        audience={combinedData.audience || 'institutions'}
        onAudienceChange={() => {}}
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

  // ── v4.3.0 — the growth diagnosis layer ───────────────────────────
  const apiVersion = String(health.body?.meta?.version || health.body?.data?.version || '0').replace(/[^0-9.].*$/, '')
  const hasDiagnosis = versionCompare(apiVersion, '4.3.0') >= 0

  if (!asJson) console.log('\nv4.3.0 — growth diagnosis')

  if (!hasDiagnosis) {
    skip(
      'the diagnosis layer is deployed',
      `this API reports v${apiVersion || 'unknown'} — the growth diagnosis ships in v4.3.0. ` +
        'Rebuild the backend (Render: Deploy latest / manual deploy, not just a restart), then re-run this check.'
    )
  } else {
    const focus = combinedData.focus || []
    check('GET /api/combined ranks every channel for the chosen audience', () => {
      assert(Array.isArray(focus) && focus.length > 0, `no data.focus (got ${JSON.stringify(focus)})`)
      assert(['institutions', 'students'].includes(combinedData.audience), `data.audience is ${combinedData.audience}`)
      const scores = focus.map((r) => r.score)
      assert(scores.every((v, i) => i === 0 || scores[i - 1] >= v), `scores must descend: ${scores.join(',')}`)
      for (const r of focus) {
        assert(r.platform && r.stage && r.headline, `incomplete row ${JSON.stringify(r).slice(0, 120)}`)
        assert(typeof r.firstAction === 'string' && r.firstAction.length > 0, `${r.platform}: firstAction must be a string`)
      }
    })

    check('every channel payload explains its own zeros', () => {
      for (const key of PLATFORM_ORDER) {
        const d = combinedData[key]?.diagnosis
        assert(d, `${key}: no diagnosis in /api/combined`)
        assert(Array.isArray(d.funnel) && d.funnel.length === 5, `${key}: funnel must have 5 stages`)
        assert(Array.isArray(d.actions) && d.actions.length > 0, `${key}: no actions`)
        for (const z of d.zeros || []) assert(z.label && z.reason && z.explanation, `${key}: incomplete zero explanation`)
        assert(!JSON.stringify(d).includes('NaN'), `${key}: NaN leaked into the diagnosis`)
      }
    })

    const aud = await get('/api/instagram?date_preset=last_30d&audience=students')
    check('?audience=students re-targets the diagnosis', () => {
      assert(aud.status === 200, `HTTP ${aud.status}`)
      const d = unwrap(aud.body)?.diagnosis
      assert(d, 'no diagnosis on /api/instagram')
      assert(d.audience === 'students', `diagnosed for ${d.audience}`)
      assert(d.audienceFit.fit === 'high', `Instagram should be a high fit for students, got ${d.audienceFit.fit}`)
    })

    check('Instagram engagement is either a real number or honestly explained', () => {
      const data = unwrap(aud.body) || {}
      const likes = Number(data.overview?.likes?.total) || 0
      const comments = Number(data.overview?.comments?.total) || 0
      const posts = Array.isArray(data.posts) ? data.posts.length : 0
      const d = data.diagnosis || {}
      const engaged = (d.funnel || []).find((f) => f.key === 'engaged')?.value || 0
      const explained = (d.zeros || []).some((z) => z.key === 'likes' || z.key === 'comments')
      assert(
        likes + comments > 0 || engaged > 0 || explained || posts === 0,
        `Instagram shows 0 likes/comments with ${posts} post(s) in range and no explanation — ` +
          'that is the reported bug. Deploy v4.3.0 and re-run.'
      )
      rows.push({
        platform: 'instagram-engagement',
        health: likes + comments > 0 || engaged > 0 ? 'from posts' : explained ? 'explained' : 'zero',
        endpoint: aud.status,
        metrics: posts,
        metricsWithData: engaged,
        numbersOnPage: likes + comments,
        demographics: d.stage || '—',
        error: null,
      })
    })

    check('the built dashboard renders the diagnosis and the focus board', () => {
      const platformHtml = renderToStaticMarkup(
        <PlatformPage
          platformKey="instagram"
          payload={combinedData.instagram}
          healthDetail={details.instagram || {}}
          range={range}
          sample={false}
          onRetry={() => {}}
          audience={combinedData.audience || 'institutions'}
          onAudienceChange={() => {}}
        />
      )
      assert(platformHtml.includes('Growth diagnosis'), 'the channel page does not render the diagnosis panel')
      const overviewHtml = renderToStaticMarkup(
        <OverviewPage
          platformData={combinedData}
          summary={combinedData.summary || null}
          focus={focus}
          audience={combinedData.audience || 'institutions'}
          onAudienceChange={() => {}}
          healthDetails={details}
          range={range}
          sample={false}
          onNavigate={() => {}}
          loading={false}
        />
      )
      assert(overviewHtml.includes('Where to focus this week'), 'the Overview does not render the focus board')
      assert(!overviewHtml.includes('[object Object]'), 'an object reached the markup')
    })

    if (!asJson) {
      console.log('\n  channel          blocked at          first action')
      for (const r of focus) {
        console.log(`  ${String(r.platform).padEnd(16)} ${String(r.stage).padEnd(19)} ${String(r.firstAction || '—').slice(0, 62)}`)
      }
      console.log('')
      for (const key of PLATFORM_ORDER) {
        const d = combinedData[key]?.diagnosis
        if (!d) continue
        console.log(`  ${key}: ${d.headline}`)
        if (d.zeros?.length) console.log(`      zeros: ${d.zeros.map((z) => `${z.label} (${z.reason})`).join(', ')}`)
        if (d.benchmark) {
          const yours = d.benchmark.yours === null || d.benchmark.yours === undefined ? '— (no reach to measure against)' : `${d.benchmark.yours}%`
          console.log(`      benchmark: yours ${yours} · typical ${d.benchmark.typical}`)
        }
      }
      console.log('')
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ api: API, version: apiVersion, passed, failed, skipped, failures, skips, rows }, null, 2))
  } else {
    console.log('\n  platform        health          metrics  with data  numbers  demographics')
    for (const r of rows) {
      console.log(
        `  ${r.platform.padEnd(15)} ${String(r.health).padEnd(15)} ${String(r.metrics).padStart(7)} ${String(r.metricsWithData).padStart(10)} ${String(r.numbersOnPage).padStart(8)}  ${r.demographics}` +
          (r.error ? `\n      └ ${r.error}` : '')
      )
    }
    console.log(`\n\x1b[1m${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\x1b[0m\n`)
    if (skips.length) {
      console.log('Skipped:')
      skips.forEach((f) => console.log(`  - ${f}`))
      console.log('')
    }
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
