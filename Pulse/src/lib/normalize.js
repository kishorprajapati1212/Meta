/**
 * normalize.js — turns raw API payloads into view models.
 *
 * This is the layer that guarantees "every metric the backend sends is
 * visible". The v4.0 dashboard hard-coded a priority list and silently dropped
 * anything it did not recognise, which is why Pinterest rendered as a single
 * "Posts" card while the API was returning pins, boards, monthly views,
 * follower history and three full post records.
 *
 * Rules:
 *   • overview entries are the primary source (they carry label/kind/unit)
 *   • metrics[] (Meta/YouTube/GSC) are merged in for anything not in overview
 *   • totals / account / boards (Zernio) are merged in the same way
 *   • nothing is ever filtered out for being zero — zero is a real number and
 *     is rendered as 0 with a "no data yet" affordance instead
 */
import { METRIC_ORDER, ID_TO_KEY, SERIES_KEY, PLATFORMS, KEY_LABELS, PLATFORM_ORDER } from './platforms'
import { isNum } from './format'

const NON_METRIC_KEYS = new Set(['account', 'channel', 'lifetime'])

export function isErrorPayload(p) {
  return !p || p.success === false || Boolean(p.error) || Boolean(p.errorCode)
}

export function errorText(p) {
  if (!p) return 'No data returned for this platform.'
  if (typeof p.error === 'string') return p.error
  if (p.error?.message) return p.error.message
  if (p.errorCode) return `${p.errorCode}: ${p.error?.message || 'request failed'}`
  return 'Unknown error'
}

/** ok | empty | error | unconfigured */
export function platformState(platformKey, p, healthDetail) {
  const detail = healthDetail || {}
  // A missing/null platform block (older or partially-failed /api/combined,
  // a cold start, a dropped key) is an error state, never a crash.
  if (!p || isErrorPayload(p)) {
    return {
      state: detail.configured === false ? 'unconfigured' : 'error',
      message: p ? errorText(p) : detail.message || 'This channel returned no payload for this range.',
      hint: p?.hint || detail.hint || null,
    }
  }
  const metrics = metricsOf(platformKey, p)
  const hasPoints = (p.timeseries || []).length > 0
  const hasPosts = (p.posts || []).length > 0 || (p.topItems || []).length > 0
  const hasAnyValue = metrics.some((m) => m.hasData)
  if (!hasPoints && !hasPosts) {
    return { state: 'empty', message: p.notice || 'No data in this date range.', hint: null }
  }
  if (!hasAnyValue && !hasPosts) {
    return { state: 'empty', message: p.notice || 'Every metric came back at zero for this range.', hint: null }
  }
  return { state: 'ok', message: p.notice || null, hint: null }
}

/** Channel identity block, normalised across all 6 platforms. */
export function accountOf(p) {
  if (!p) return null
  const o = p.overview || {}
  const acct = o.account || p.meta?.account || o.channel || null
  if (!acct) return null
  const lifetime = acct.lifetime || null
  return {
    name: acct.name || acct.displayName || acct.title || null,
    handle: acct.handle || acct.username || null,
    picture: acct.picture || acct.thumbnail || acct.profilePicture || null,
    link: acct.link || acct.profileUrl || (acct.handle ? `https://instagram.com/${acct.handle}` : null),
    followers: acct.followers ?? lifetime?.subscribers ?? null,
    category: acct.category || null,
    website: acct.website || null,
    publishedAt: acct.publishedAt || null,
    lastSyncedAt: acct.lastSyncedAt || p.meta?.sync?.at || null,
    stats: [
      lifetime?.subscribers != null && { label: 'Subscribers', value: lifetime.subscribers },
      lifetime?.totalViews != null && { label: 'Lifetime views', value: lifetime.totalViews },
      lifetime?.totalVideos != null && { label: 'Videos', value: lifetime.totalVideos },
      acct.mediaCount != null && { label: 'Posts', value: acct.mediaCount },
      acct.likes != null && { label: 'Page likes', value: acct.likes },
      acct.following != null && { label: 'Following', value: acct.following },
      acct.pinCount != null && { label: 'Total pins', value: acct.pinCount },
      acct.boardCount != null && { label: 'Boards', value: acct.boardCount },
      acct.monthlyViews != null && { label: 'Monthly views', value: acct.monthlyViews },
      acct.externalPostCount != null && { label: 'External posts', value: acct.externalPostCount },
    ].filter(Boolean),
  }
}

/** [{date, value}] for a metric key, from metrics[] first then timeseries. */
export function seriesOf(p, key) {
  if (!p) return []
  const metrics = p.metrics || []
  if (metrics.length) {
    const wanted = new Set(Object.keys(ID_TO_KEY).filter((id) => ID_TO_KEY[id] === key))
    wanted.add(key)
    const m = metrics.find((x) => wanted.has(x.id) || ID_TO_KEY[x.id] === key)
    if (m?.values?.length) {
      if (key === 'watchTimeHours') return m.values.map((v) => ({ date: v.date, value: v.value / 60 }))
      return m.values.map((v) => ({ date: v.date, value: Number(v.value) || 0 }))
    }
  }
  const rows = p.timeseries || []
  if (!rows.length) return []
  const candidates = SERIES_KEY[key] || [key]
  let col = candidates.find((c) => rows.some((r) => r[c] !== undefined && r[c] !== null))
  if (!col) return []
  const out = rows.map((r) => ({
    date: r.date,
    value: r[col] === null || r[col] === undefined ? 0 : Number(r[col]) || 0,
  }))
  if (key === 'watchTimeHours') return out.map((v) => ({ date: v.date, value: v.value / 60 }))
  return out
}

/**
 * Older API versions (v4.0) return overview entries as bare `{total, trend}`
 * with no label and no kind. Infer both so those payloads still render with
 * correct words and correct aggregation instead of "watchTime / sum".
 */
function inferKind(key, entry) {
  if (entry.kind) return entry.kind
  if (entry.unit === '%' || /rate$|^ctr$|percentage/i.test(key)) return 'rate'
  if (key === 'position') return 'avg'
  if (/^(followers|pins|boards|monthlyViews|fans|subscribers)$/.test(key)) return 'gauge'
  if (/watchTime|Minutes|Duration/i.test(key)) return 'duration'
  if (/^(posts|pins|boards|items|uniqueItems)$/.test(key) && entry.points === undefined) return 'count'
  return 'sum'
}

function inferUnit(key, entry, kind) {
  if (entry.unit !== undefined && entry.unit !== null) return entry.unit
  if (kind === 'rate') return '%'
  if (key === 'watchTime') return 'min'
  if (key === 'avgViewDuration') return 's'
  if (key === 'watchTimeHours') return 'h'
  return ''
}

function fromOverviewEntry(key, entry, p) {
  const kind = inferKind(key, entry)
  return {
    key,
    id: entry.id || key,
    label: entry.label || KEY_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    description: entry.description || '',
    kind,
    unit: inferUnit(key, entry, kind),
    group: entry.group || GROUP_FOR_KEY[key] || 'Performance',
    total: isNum(entry.total) ? entry.total : 0,
    previous: isNum(entry.previous) ? entry.previous : null,
    change: isNum(entry.change) ? entry.change : null,
    trend: isNum(entry.trend) ? entry.trend : 0,
    average: isNum(entry.average) ? entry.average : null,
    latest: isNum(entry.latest) ? entry.latest : null,
    points: entry.points ?? null,
    hasData: entry.hasData !== undefined ? Boolean(entry.hasData) : Boolean(entry.total),
    derived: Boolean(entry.derived),
    formula: entry.formula || null,
    source: entry.source || null,
    formatted: entry.formatted || null,
    series: seriesOf(p, key),
  }
}

function fromMetric(m, p) {
  const key = ID_TO_KEY[m.id] || m.id
  const s = m.summary || {}
  return {
    key,
    id: m.id,
    label: m.label || m.id,
    description: m.description || '',
    kind: m.kind || s.kind || 'sum',
    unit: m.unit ?? s.unit ?? '',
    group: 'Platform metrics',
    total: isNum(s.total) ? s.total : 0,
    previous: isNum(s.previous) ? s.previous : null,
    change: null,
    trend: isNum(s.trend) ? s.trend : 0,
    average: isNum(s.average) ? s.average : null,
    latest: isNum(s.latest) ? s.latest : null,
    points: s.points ?? (m.values || []).length,
    hasData: (s.activePoints ?? 0) > 0 || Boolean(s.total),
    derived: false,
    formula: null,
    source: 'metrics[]',
    series: (m.values || []).map((v) => ({ date: v.date, value: Number(v.value) || 0 })),
  }
}

function fromTotal(key, value, previous, p) {
  return {
    key,
    id: key,
    label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    description: '',
    kind: 'sum',
    unit: '',
    group: 'Post totals',
    total: Number(value) || 0,
    previous: isNum(previous) ? previous : null,
    change: null,
    trend: 0,
    average: null,
    latest: null,
    points: null,
    hasData: Boolean(value),
    derived: false,
    formula: null,
    source: 'totals',
    series: seriesOf(p, key),
  }
}

/**
 * The complete metric list for a platform payload — overview ∪ metrics[] ∪
 * totals ∪ account gauges, ordered by METRIC_ORDER then grouped extras.
 */
export function metricsOf(platformKey, p) {
  if (!p || isErrorPayload(p)) return []
  const map = new Map()

  for (const [k, v] of Object.entries(p.overview || {})) {
    if (NON_METRIC_KEYS.has(k)) continue
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    if (!('total' in v) && !('value' in v)) continue
    map.set(k, fromOverviewEntry(k, { ...v, total: v.total ?? v.value }, p))
  }

  for (const m of p.metrics || []) {
    const key = ID_TO_KEY[m.id] || m.id
    if (map.has(key)) {
      // Fill gaps: keep the overview label but make sure we have a series.
      const existing = map.get(key)
      if (!existing.series.length) existing.series = fromMetric(m, p).series
      if (!isNum(existing.average)) existing.average = m.summary?.average ?? null
      continue
    }
    map.set(key, fromMetric(m, p))
  }

  for (const [k, v] of Object.entries(p.totals || {})) {
    if (map.has(k) || !isNum(v)) continue
    map.set(k, fromTotal(k, v, null, p))
  }

  // Account-level gauges that the backend may only expose in meta.
  const acct = p.meta?.account
  if (acct) {
    const gauges = [
      ['pins', acct.pinCount, 'Total pins'],
      ['boards', acct.boardCount, 'Boards'],
      ['monthlyViews', acct.monthlyViews, 'Monthly views'],
      ['followers', acct.followers, 'Followers'],
    ]
    for (const [key, value, label] of gauges) {
      if (map.has(key) || !isNum(value)) continue
      map.set(key, { ...fromTotal(key, value, null, p), label, kind: 'gauge', group: 'Audience', hasData: value > 0 })
    }
  }

  const order = METRIC_ORDER[platformKey] || []
  const list = [...map.values()]
  const rank = (m) => {
    const i = order.indexOf(m.key)
    return i === -1 ? order.length + 1 : i
  }
  list.sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    // metrics with data first, then by size, then alphabetical
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1
    if (Math.abs(b.total) !== Math.abs(a.total)) return Math.abs(b.total) - Math.abs(a.total)
    return a.label.localeCompare(b.label)
  })
  return list
}

/** Dense daily rows for charts/tables, whatever the platform. */
export function timelineOf(p) {
  if (!p) return []
  const rows = p.timeseries || []
  if (rows.length) return rows
  const metrics = p.metrics || []
  if (!metrics.length) return []
  const byDate = new Map()
  for (const m of metrics) {
    for (const v of m.values || []) {
      if (!byDate.has(v.date)) byDate.set(v.date, { date: v.date })
      byDate.get(v.date)[m.id] = Number(v.value) || 0
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * channelDaily — builds [{date, facebook: n, instagram: n, …}] from arbitrary
 * per-platform accessor functions. Needed because the same business concept
 * lives under different column names on each platform (Facebook "reach" is
 * page_impressions_unique, Instagram's is `reach`, Pinterest's is
 * `impressions`, and YouTube has no reach metric at all — it reports `views`).
 *
 * accessors = { facebook: row => number, … }
 */
export function channelDaily(platformData, accessors, { skipEmpty = true } = {}) {
  const dates = new Set()
  const perPlatform = {}

  for (const [pk, fn] of Object.entries(accessors)) {
    const p = platformData?.[pk]
    if (!p || isErrorPayload(p) || typeof fn !== 'function') continue
    let rows = timelineOf(p)
    // Zernio platforms also carry a dedicated follower history.
    if (!rows.length && p.followerTimeseries?.length) {
      rows = p.followerTimeseries.map((r) => ({ date: r.date, followers: r.followers }))
    }
    if (!rows.length) continue
    rows.forEach((r) => dates.add(r.date))
    perPlatform[pk] = { rows, fn }
  }

  const sorted = [...dates].sort()
  const out = sorted.map((date) => {
    const row = { date }
    for (const [pk, { rows, fn }] of Object.entries(perPlatform)) {
      const r = rows.find((x) => x.date === date)
      const v = r ? Number(fn(r)) : 0
      row[pk] = Number.isFinite(v) ? v : 0
    }
    return row
  })

  if (!skipEmpty) return out
  return out.filter((r) => Object.keys(r).some((k) => k !== 'date' && Number(r[k]) !== 0))
}

/** Which platforms actually contributed daily rows to a channelDaily result. */
export function activeChannels(platformData, accessors) {
  return Object.keys(accessors).filter((pk) => {
    const p = platformData?.[pk]
    return p && !isErrorPayload(p) && (timelineOf(p).length > 0 || (p.followerTimeseries || []).length > 0)
  })
}

/** Cross-platform "top content" feed. */
export function topContent(platformData, limit = 12) {
  const items = []
  for (const pk of Object.keys(PLATFORMS)) {
    const p = platformData?.[pk]
    if (!p || isErrorPayload(p)) continue
    const posts = p.posts || p.topPosts || p.latestPosts || []
    for (const post of posts) {
      const a = post.analytics || {}
      items.push({
        platform: pk,
        id: post.postId || post.platformUrl || Math.random().toString(36).slice(2),
        content: post.content || post.title || '(no text)',
        title: post.title || null,
        url: post.platformUrl || post.url || null,
        thumbnail: post.thumbnailUrl || post.mediaItems?.[0]?.thumbnail || null,
        publishedAt: post.publishedAt || post.date || null,
        mediaType: post.mediaType || 'text',
        boardName: post.boardName || null,
        isExternal: post.isExternal || false,
        syncStatus: post.syncStatus || null,
        impressions: a.impressions || 0,
        clicks: a.clicks || 0,
        likes: a.likes || 0,
        comments: a.comments || 0,
        shares: a.shares || 0,
        saves: a.saves || 0,
        views: a.views || 0,
        engagement: a.engagement || a.likes + a.comments + a.shares + a.saves || 0,
        engagementRate: a.engagementRate || 0,
      })
    }
  }
  return items
    .sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions || String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, limit)
}

/** Diagnostics from meta, flattened into rows the Connections page can show. */
export function diagnosticsOf(p) {
  const d = p?.meta?.diagnostics
  if (!d) return []
  const rows = []
  for (const [name, step] of Object.entries(d.steps || {})) {
    rows.push({
      step: name,
      ok: step?.ok !== false && !step?.error && !step?.skipped,
      skipped: Boolean(step?.skipped),
      detail: step?.error || step?.reason || summariseStep(step),
    })
  }
  return rows
}

function summariseStep(step) {
  if (!step || typeof step !== 'object') return String(step ?? '')
  const bits = []
  for (const [k, v] of Object.entries(step)) {
    if (['ok', 'skipped', 'error', 'reason'].includes(k)) continue
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'object') continue
    bits.push(`${k}: ${v}`)
  }
  return bits.join(' · ')
}


/** Sensible section for keys that arrive without a group (older API builds). */
const GROUP_FOR_KEY = {
  followers: 'Audience', newFollows: 'Audience', unfollows: 'Audience', netFollows: 'Audience',
  subsGained: 'Audience', subsLost: 'Audience', netSubscribers: 'Audience',
  pins: 'Audience', boards: 'Audience', monthlyViews: 'Audience',
  reach: 'Traffic', impressions: 'Traffic', pageViews: 'Traffic', profileVisits: 'Traffic',
  clicks: 'Traffic', outboundClicks: 'Traffic', websiteClicks: 'Traffic',
  views: 'Consumption', contentViews: 'Consumption', uniqueViewers: 'Consumption',
  watchTime: 'Consumption', watchTimeHours: 'Consumption', avgViewDuration: 'Quality', avgViewPercentage: 'Quality',
  engagement: 'Engagement', engagementRate: 'Engagement', interactions: 'Engagement',
  likes: 'Engagement', comments: 'Engagement', shares: 'Engagement', saves: 'Engagement',
  sends: 'Engagement', follows: 'Engagement', dislikes: 'Engagement', closeups: 'Engagement',
  posts: 'Activity', activeDays: 'Activity',
  ctr: 'Quality', position: 'Quality', uniqueItems: 'Coverage',
}

/**
 * healthDetailsOf — normalises /api/health across API versions.
 * v4.1 returns data.details{status,message,hint}; v4.0 returned only
 * data.platforms{facebook:"ok"|"<error text>"}. Deriving the rich shape from
 * the legacy one keeps the Connections page useful before the API is redeployed.
 */
export function healthDetailsOf(health) {
  const data = health?.data
  if (!data) return {}
  if (data.details && Object.keys(data.details).length) return data.details

  const out = {}
  for (const [platform, value] of Object.entries(data.platforms || {})) {
    if (value === 'ok') {
      out[platform] = { platform, source: null, configured: true, status: 'ok', message: 'Connected', hint: null }
    } else if (value === 'not_configured') {
      out[platform] = { platform, source: null, configured: false, status: 'not_configured', message: 'Credentials not set on the server', hint: 'Add this platform\u2019s credentials to the backend .env and restart it.' }
    } else if (value === 'no_account') {
      out[platform] = { platform, source: null, configured: true, status: 'no_account', message: 'No account connected upstream', hint: 'Connect the account in the upstream provider, then re-check.' }
    } else if (value === 'untested') {
      out[platform] = { platform, source: null, configured: null, status: 'untested', message: 'Not tested by this API version', hint: null }
    } else {
      out[platform] = {
        platform, source: null, configured: true, status: 'error',
        message: String(value),
        hint: /400|expired|token/i.test(String(value))
          ? 'This usually means an expired or invalid credential. Redeploy the v4.1 backend for the exact fix instructions, or check the Connections diagnostics.'
          : null,
      }
    }
  }
  return out
}


/**
 * healthCountsOf — the Connections headline numbers. Modern payloads carry
 * ok/total/configured; the pre-rebuild API only sent data.healthy plus
 * data.platforms strings, so derive the counts from the details when the
 * server did not supply them (otherwise the UI printed "undefined/undefined").
 */
export function healthCountsOf(health) {
  const data = health?.data
  const details = healthDetailsOf(health)
  const keys = Object.keys(details)
  const total = Number.isFinite(data?.total) ? data.total : keys.length || PLATFORM_ORDER.length
  const ok = Number.isFinite(data?.ok) ? data.ok : keys.filter((k) => details[k]?.status === 'ok').length
  const configured = Number.isFinite(data?.configured)
    ? data.configured
    : keys.filter((k) => details[k]?.configured !== false).length
  const healthy = typeof data?.healthy === 'boolean' ? data.healthy : ok === total && total > 0
  return { ok, total, configured, healthy }
}

// ────────────────────────────────────────────────────────────────────────────
// Client-side roll-up — the fix for "platform pages show numbers, Overview
// shows 0 0". The Overview used to trust `data.summary` alone; older API
// versions (and any partially-failing combined call) omit or zero it while the
// per-platform payloads are perfectly good. So we rebuild the same roll-up
// here from whatever the platform payloads contain, and merge it with the
// server's summary when the server provides one.
// ────────────────────────────────────────────────────────────────────────────
const OVERVIEW_TOTAL = (p, key) => {
  const v = p?.overview?.[key]?.total
  return Number.isFinite(Number(v)) ? Number(v) : 0
}

/** Per-channel row, identical maths to the backend buildSummary(). */
export function channelRow(platformKey, p) {
  if (!p || isErrorPayload(p)) {
    return { platform: platformKey, ok: false, error: p?.error || 'No data', audience: 0, impressions: 0, reach: 0, views: 0, engagement: 0, clicks: 0, posts: 0, engagementRate: 0, trend: 0, lifetime: null, account: null, hasData: false }
  }
  const o = p.overview || {}
  const audience = OVERVIEW_TOTAL(p, 'followers') || Number(o?.channel?.lifetime?.subscribers) || 0
  const impressions = OVERVIEW_TOTAL(p, 'impressions')
  const reach = OVERVIEW_TOTAL(p, 'reach')
  const views = OVERVIEW_TOTAL(p, 'views') || OVERVIEW_TOTAL(p, 'contentViews') || OVERVIEW_TOTAL(p, 'pageViews')
  const engagement =
    OVERVIEW_TOTAL(p, 'engagement') || OVERVIEW_TOTAL(p, 'interactions') ||
    OVERVIEW_TOTAL(p, 'likes') + OVERVIEW_TOTAL(p, 'comments') + OVERVIEW_TOTAL(p, 'shares') + OVERVIEW_TOTAL(p, 'saves')
  return {
    platform: platformKey,
    ok: true,
    error: null,
    audience,
    impressions,
    reach,
    views,
    engagement,
    clicks: OVERVIEW_TOTAL(p, 'clicks'),
    posts: Number(p?.meta?.postCount) || OVERVIEW_TOTAL(p, 'posts') || 0,
    engagementRate: OVERVIEW_TOTAL(p, 'engagementRate'),
    trend: OVERVIEW_TOTAL(p, 'followers') ? Number(o.followers.trend) || 0 : 0,
    lifetime: o?.channel?.lifetime || null,
    account: p?.meta?.account || null,
    dateRange: p?.meta?.dateRange || null,
    hasData: Object.values(o).some((v) => v && v.hasData),
  }
}

/** Full summary object built purely from the platform payloads. */
export function deriveSummary(platformData, platformKeys = PLATFORM_ORDER) {
  const rows = platformKeys.map((k) => channelRow(k, platformData?.[k]))
  const live = rows.filter((r) => r.ok)
  const agg = (fn) => live.reduce((s, x) => s + fn(x), 0)
  const gsc = platformData?.searchConsole || {}
  const totalImpressions = agg((x) => Math.max(x.impressions, x.reach))
  const totalEngagement = agg((x) => x.engagement)
  return {
    generatedAt: new Date().toISOString(),
    derived: true,
    platforms: rows,
    totals: {
      audience: agg((x) => x.audience),
      impressions: totalImpressions,
      engagement: totalEngagement,
      clicks: agg((x) => x.clicks) + OVERVIEW_TOTAL(gsc, 'clicks'),
      posts: agg((x) => x.posts),
      engagementRate: totalImpressions > 0 ? Math.round((totalEngagement / totalImpressions) * 10000) / 100 : 0,
      searchClicks: OVERVIEW_TOTAL(gsc, 'clicks'),
      searchImpressions: OVERVIEW_TOTAL(gsc, 'impressions'),
      searchCtr: OVERVIEW_TOTAL(gsc, 'ctr'),
      searchPosition: OVERVIEW_TOTAL(gsc, 'position'),
    },
    connected: live.length,
    failed: rows.filter((r) => !r.ok).map((r) => r.platform),
    topReachPlatform: [...live].sort((a, b) => Math.max(b.impressions, b.reach, b.views) - Math.max(a.impressions, a.reach, a.views))[0]?.platform || null,
  }
}

/**
 * effectiveSummary — server summary first, client derivation as the safety
 * net. A server summary whose totals are all zero while the platform payloads
 * carry numbers is treated as absent, because that is exactly the v4.0 shape.
 */
export function effectiveSummary(platformData, serverSummary, platformKeys) {
  const derived = deriveSummary(platformData, platformKeys)
  if (!serverSummary?.totals) return derived
  const t = serverSummary.totals
  const serverHasNumbers = ['audience', 'impressions', 'engagement', 'posts', 'searchClicks'].some(
    (k) => Number(t[k]) > 0
  )
  const derivedHasNumbers = ['audience', 'impressions', 'engagement', 'posts', 'searchClicks'].some(
    (k) => Number(derived.totals[k]) > 0
  )
  if (!serverHasNumbers && derivedHasNumbers) return derived
  // Keep the server's row detail but never let a zeroed server total win.
  return {
    ...serverSummary,
    derived: false,
    totals: serverHasNumbers ? t : derived.totals,
    platforms: serverSummary.platforms?.length ? serverSummary.platforms : derived.platforms,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Growth, consistency and stage — the numbers that stay meaningful when a
// channel is young and engagement is genuinely zero.
// ────────────────────────────────────────────────────────────────────────────

/** [{date, followers, growth}] from whichever history the platform carries. */
export function growthSeriesOf(p) {
  if (!p || isErrorPayload(p)) return []
  if (Array.isArray(p.followerTimeseries) && p.followerTimeseries.length) {
    return p.followerTimeseries.map((r) => ({ date: r.date, followers: Number(r.followers) || 0, growth: Number(r.growth) || 0 }))
  }
  const series = seriesOf(p, 'followers')
  return series.map((r) => ({ date: r.date, followers: r.value, growth: 0 }))
}

/**
 * Publishing calendar: one entry per day with how many posts went out.
 * Used for the activity heatmap and the consistency score — the honest
 * "am I showing up?" signal for a channel that has no engagement yet.
 */
export function activityCalendarOf(platformData, days = 120, platformKeys = PLATFORM_ORDER) {
  const counts = new Map()
  for (const k of platformKeys) {
    const p = platformData?.[k]
    if (!p || isErrorPayload(p)) continue
    const posts = p.posts || p.topPosts || p.latestPosts || []
    for (const post of posts) {
      const raw = post.publishedAt || post.published_at || post.date || post.createdTime || post.snippet?.publishedAt
      if (!raw) continue
      const day = String(raw).slice(0, 10)
      counts.set(day, (counts.get(day) || 0) + 1)
    }
  }
  const out = []
  const end = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ date: key, count: counts.get(key) || 0 })
  }
  return out
}

/** Days since the most recent post across all channels, or null. */
export function daysSinceLastPost(platformData, platformKeys = PLATFORM_ORDER) {
  let latest = null
  for (const k of platformKeys) {
    const p = platformData?.[k]
    if (!p || isErrorPayload(p)) continue
    for (const post of p.posts || p.topPosts || p.latestPosts || []) {
      const raw = post.publishedAt || post.published_at || post.date || post.snippet?.publishedAt
      if (!raw) continue
      if (!latest || String(raw) > latest) latest = String(raw)
    }
  }
  if (!latest) return null
  const ms = Date.now() - new Date(latest).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

/**
 * stageOf — where the channel is on the awareness → consideration → conversion
 * ladder, from real signals: audience size, publishing consistency and
 * whether engagement has started at all.
 */
export function stageOf(platformData, summary, calendar, platformKeys = PLATFORM_ORDER) {
  const audience = summary?.totals?.audience || 0
  const engagement = summary?.totals?.engagement || 0
  const activeDays = calendar.filter((d) => d.count > 0).length
  const window = Math.max(1, calendar.length)
  const consistency = activeDays / window

  let stage = 'awareness'
  let label = 'Awareness'
  let blurb = 'People are discovering you exist. The job right now is showing up often enough to be remembered.'
  if (engagement > 0 && (audience >= 500 || consistency >= 0.12)) {
    stage = 'consideration'
    label = 'Consideration'
    blurb = 'People are comparing you against alternatives. Consistency plus a little engagement means the next job is depth: series, replies, saves.'
  }
  if (engagement > 50 && audience >= 2000 && consistency >= 0.2) {
    stage = 'conversion'
    label = 'Conversion'
    blurb = 'Your audience acts on what you publish. Optimise for clicks-through and repeat viewers now.'
  }
  return { stage, label, blurb, consistency, activeDays, window, audience, engagement }
}

/** The next audience milestone above the current number (100 / 500 / 1K / …). */
export function nextMilestone(value) {
  const steps = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]
  const next = steps.find((s) => s > value)
  if (!next) return null
  const prev = steps[steps.indexOf(next) - 1] || 0
  return { next, prev, progress: Math.min(1, Math.max(0, (value - prev) / (next - prev))) }
}
