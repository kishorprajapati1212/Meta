/**
 * sample.js — a complete, realistic payload in the exact v4.1 API shape.
 *
 * It exists for ONE reason: the live account currently returns near-zero data
 * (Facebook/Instagram token expired, Pinterest analytics not synced), which
 * makes it impossible to review the dashboard. Sample mode is clearly labelled
 * in the UI, is OFF by default, and never writes anywhere.
 *
 * Values are generated from a seeded PRNG so numbers are stable between renders.
 */
import { PLATFORM_ORDER } from './platforms'

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const DAY = 86400000

function isoDay(offset) {
  return new Date(Date.now() - offset * DAY).toISOString().slice(0, 10)
}

function rangeDates(range) {
  const days = range?.since && range?.until
    ? Math.max(2, Math.round((new Date(range.until) - new Date(range.since)) / DAY) + 1)
    : { last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90, last_365d: 365 }[range?.preset || 'last_30d'] || 30
  const out = []
  for (let i = days - 1; i >= 0; i--) out.push(isoDay(i))
  return out
}

/** Weekend dip + slow growth + noise, always ≥ 0 integers. */
function shape(rand, base, i, n) {
  const d = new Date(isoDay(n - 1 - i) + 'T00:00:00')
  const weekend = [0, 6].includes(d.getUTCDay()) ? 0.62 : 1
  const growth = 0.75 + (i / Math.max(1, n - 1)) * 0.55
  const noise = 0.72 + rand() * 0.56
  return Math.max(0, Math.round(base * weekend * growth * noise))
}

const MIN_TREND_BASELINE = 10

/**
 * pct — mirrors src/utils/metrics.js: a percentage only exists when the
 * baseline is real and big enough to mean something. Returns null otherwise,
 * never a fabricated +100% off a zero baseline.
 */
function pct(cur, prev, kind) {
  const c = Number(cur)
  const p = Number(prev)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  const t = Math.round(((c - p) / Math.abs(p)) * 1000) / 10
  if (kind === 'rate') return t
  return Math.abs(p) < MIN_TREND_BASELINE ? null : t
}

const dirOf = (t) => (t === null ? null : t > 0 ? 'up' : t < 0 ? 'down' : 'flat')

function summarize(kind, values) {
  const n = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const mid = Math.floor(n / 2)
  const prev = values.slice(0, mid).reduce((a, b) => a + b, 0)
  const cur = values.slice(mid).reduce((a, b) => a + b, 0)
  if (kind === 'gauge') {
    const trend = pct(values[n - 1], values[0], 'gauge')
    return { total: values[n - 1], previous: values[0], trend, trendBasis: trend === null ? null : 'last-day-vs-first-day', average: Math.round(sum / n), latest: values[n - 1], min: Math.min(...values), max: Math.max(...values), points: n, activePoints: values.filter((v) => v > 0).length, kind, unit: '', direction: dirOf(trend) }
  }
  if (kind === 'rate' || kind === 'avg') {
    const mean = (arr) => Math.round((arr.reduce((a, b) => a + b, 0) / (arr.length || 1)) * 100) / 100
    const total = mean(values)
    const previous = mid ? mean(values.slice(0, mid)) : null
    const trend = previous === null ? null : pct(mean(values.slice(mid)), previous, kind)
    return { total, previous, trend, trendBasis: trend === null ? null : 'second-half-vs-first-half', average: total, latest: values[n - 1], min: Math.min(...values), max: Math.max(...values), points: n, activePoints: values.filter((v) => v > 0).length, kind, unit: kind === 'rate' ? '%' : '', direction: dirOf(trend) }
  }
  const trend = mid ? pct(cur, prev, kind) : null
  return { total: sum, previous: mid ? prev : null, trend, trendBasis: trend === null ? null : 'second-half-vs-first-half', average: Math.round(sum / n), latest: values[n - 1], min: Math.min(...values), max: Math.max(...values), points: n, activePoints: values.filter((v) => v > 0).length, kind, unit: '', direction: dirOf(trend) }
}

function metric(id, label, kind, values, dates, unit = '', group = 'Performance', description = '') {
  const s = summarize(kind, values)
  return {
    id, label, description, period: 'day', kind, unit, group,
    values: dates.map((d, i) => ({ date: d, value: values[i] })),
    summary: { ...s, unit },
  }
}

function overviewFrom(metrics, extras = {}) {
  const o = {}
  for (const m of metrics) {
    const key = m.overviewKey || m.id
    o[key] = {
      key, id: m.id, label: m.label, kind: m.kind, unit: m.unit, group: m.group,
      description: m.description,
      total: m.summary.total, previous: m.summary.previous, trend: m.summary.trend,
      average: m.summary.average, latest: m.summary.latest, min: m.summary.min, max: m.summary.max,
      points: m.summary.points, hasData: m.summary.activePoints > 0 || (m.kind === 'gauge' && m.summary.total > 0),
    }
  }
  return { ...o, ...extras }
}

function timeseriesFrom(metrics, dates) {
  return dates.map((d, i) => {
    const row = { date: d }
    for (const m of metrics) row[m.id] = m.values[i].value
    row.hasData = metrics.some((m) => m.values[i].value > 0)
    return row
  })
}

// ── Facebook ────────────────────────────────────────────────────
function facebook(dates, rand) {
  const n = dates.length
  const followers = []
  let f = 18240
  for (let i = 0; i < n; i++) { f += Math.round(rand() * 26 - 4); followers.push(f) }
  const metrics = [
    Object.assign(metric('follower_count', 'Followers', 'gauge', followers, dates, '', 'Audience', 'Total page followers'), { overviewKey: 'followers' }),
    Object.assign(metric('page_views_total', 'Page views', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 420, i, n)), dates, '', 'Traffic'), { overviewKey: 'pageViews' }),
    Object.assign(metric('page_impressions_unique', 'Reach', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 3100, i, n)), dates, '', 'Traffic'), { overviewKey: 'reach' }),
    Object.assign(metric('page_impressions', 'Impressions', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 5400, i, n)), dates, '', 'Traffic'), { overviewKey: 'impressions' }),
    Object.assign(metric('page_media_view', 'Media views', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 1850, i, n)), dates, '', 'Consumption'), { overviewKey: 'contentViews' }),
    Object.assign(metric('page_total_media_view_unique', 'Unique media viewers', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 1240, i, n)), dates, '', 'Consumption'), { overviewKey: 'uniqueViewers' }),
    Object.assign(metric('page_post_engagements', 'Post engagements', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 310, i, n)), dates, '', 'Engagement'), { overviewKey: 'engagement' }),
    Object.assign(metric('page_daily_follows', 'New follows', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 22, i, n)), dates, '', 'Audience'), { overviewKey: 'newFollows' }),
    Object.assign(metric('page_daily_unfollows_unique', 'Unfollows', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 6, i, n)), dates, '', 'Audience'), { overviewKey: 'unfollows' }),
    Object.assign(metric('page_video_views', 'Video views', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 940, i, n)), dates, '', 'Consumption'), { overviewKey: 'videoViews' }),
  ]
  const overview = overviewFrom(metrics)
  overview.account = {
    name: 'Kishor Prajapati', username: 'kishor.prajapati.design',
    picture: '', link: 'https://facebook.com/kishor.prajapati.design', category: 'Digital creator',
    followers: followers[n - 1], likes: 17980,
  }
  overview.followers = { ...overview.followers, label: 'Page followers' }
  const eng = overview.engagement.total
  const reach = overview.reach.total
  overview.engagementRate = { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement', total: Math.round((eng / reach) * 10000) / 100, previous: null, trend: 0, hasData: true, derived: true, formula: 'Post engagements ÷ reach' }
  return {
    meta: { dateRange: { from: dates[0], to: dates[n - 1] }, source: 'Meta Graph API', metricCount: metrics.length, dataPoints: metrics.length * n, account: overview.account },
    overview, timeseries: timeseriesFrom(metrics, dates), metrics,
  }
}

// ── Instagram ───────────────────────────────────────────────────
function instagram(dates, rand) {
  const n = dates.length
  const followers = []
  let f = 9420
  for (let i = 0; i < n; i++) { f += Math.round(rand() * 40 - 8); followers.push(f) }
  const metrics = [
    Object.assign(metric('follower_count', 'Followers', 'gauge', followers, dates, '', 'Audience'), { overviewKey: 'followers' }),
    Object.assign(metric('reach', 'Reach', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 4200, i, n)), dates, '', 'Traffic'), { overviewKey: 'reach' }),
    Object.assign(metric('profile_views', 'Profile views', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 260, i, n)), dates, '', 'Traffic'), { overviewKey: 'profileVisits' }),
    Object.assign(metric('likes', 'Likes', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 620, i, n)), dates, '', 'Engagement'), { overviewKey: 'likes' }),
    Object.assign(metric('comments', 'Comments', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 48, i, n)), dates, '', 'Engagement'), { overviewKey: 'comments' }),
    Object.assign(metric('shares', 'Shares', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 74, i, n)), dates, '', 'Engagement'), { overviewKey: 'shares' }),
    Object.assign(metric('saves', 'Saves', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 132, i, n)), dates, '', 'Engagement'), { overviewKey: 'saves' }),
    Object.assign(metric('total_interactions', 'Total interactions', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 880, i, n)), dates, '', 'Engagement'), { overviewKey: 'interactions' }),
    Object.assign(metric('website_clicks', 'Website clicks', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 36, i, n)), dates, '', 'Traffic'), { overviewKey: 'websiteClicks' }),
  ]
  const overview = overviewFrom(metrics)
  overview.account = { name: 'Kishor Prajapati', username: 'kishor.codes', picture: '', link: 'https://instagram.com/kishor.codes', followers: followers[n - 1], following: 612, mediaCount: 284 }
  overview.engagementRate = { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement', total: Math.round((overview.interactions.total / overview.reach.total) * 10000) / 100, previous: null, trend: 0, hasData: true, derived: true, formula: 'Total interactions ÷ reach' }
  return {
    meta: { dateRange: { from: dates[0], to: dates[n - 1] }, source: 'Meta Graph API', metricCount: metrics.length, dataPoints: metrics.length * n, account: overview.account },
    overview, timeseries: timeseriesFrom(metrics, dates), metrics,
  }
}

// ── YouTube ─────────────────────────────────────────────────────
function youtube(dates, rand) {
  const n = dates.length
  const metrics = [
    Object.assign(metric('views', 'Views', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 340, i, n)), dates, '', 'Consumption'), { overviewKey: 'views' }),
    Object.assign(metric('estimatedMinutesWatched', 'Watch time', 'duration', Array.from({ length: n }, (_, i) => shape(rand, 1180, i, n)), dates, 'min', 'Consumption'), { overviewKey: 'watchTime' }),
    Object.assign(metric('averageViewDuration', 'Avg view duration', 'avg', Array.from({ length: n }, (_, i) => 90 + Math.round(rand() * 70)), dates, 's', 'Quality'), { overviewKey: 'avgViewDuration' }),
    Object.assign(metric('averageViewPercentage', 'Avg view %', 'rate', Array.from({ length: n }, (_, i) => Math.round((38 + rand() * 22) * 100) / 100), dates, '%', 'Quality'), { overviewKey: 'avgViewPercentage' }),
    Object.assign(metric('subscribersGained', 'Subscribers gained', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 14, i, n)), dates, '', 'Audience'), { overviewKey: 'subsGained' }),
    Object.assign(metric('subscribersLost', 'Subscribers lost', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 3, i, n)), dates, '', 'Audience'), { overviewKey: 'subsLost' }),
    Object.assign(metric('likes', 'Likes', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 42, i, n)), dates, '', 'Engagement'), { overviewKey: 'likes' }),
    Object.assign(metric('comments', 'Comments', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 7, i, n)), dates, '', 'Engagement'), { overviewKey: 'comments' }),
    Object.assign(metric('shares', 'Shares', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 5, i, n)), dates, '', 'Engagement'), { overviewKey: 'shares' }),
    Object.assign(metric('dislikes', 'Dislikes', 'sum', Array.from({ length: n }, (_, i) => shape(rand, 1, i, n)), dates, '', 'Engagement'), { overviewKey: 'dislikes' }),
  ]
  const overview = overviewFrom(metrics)
  const account = {
    name: 'Kishor Builds', handle: '@kishorbuilds', picture: '', publishedAt: '2021-03-14T00:00:00Z', country: 'IN',
    followers: 4182, lifetime: { subscribers: 4182, totalViews: 318400, totalVideos: 96 }, source: 'data_api',
  }
  overview.account = account
  overview.channel = { name: account.name, handle: account.handle, thumbnail: '', publishedAt: account.publishedAt, lifetime: account.lifetime }
  overview.followers = { key: 'followers', id: 'subscriberCount', label: 'Subscribers', kind: 'gauge', unit: '', group: 'Audience', total: 4182, previous: 4182 - overview.subsGained.total, trend: Math.round((overview.subsGained.total / (4182 - overview.subsGained.total)) * 1000) / 10, hasData: true, source: 'data_api' }
  overview.watchTimeHours = { key: 'watchTimeHours', label: 'Watch time (hours)', kind: 'duration', unit: 'h', group: 'Consumption', total: Math.round((overview.watchTime.total / 60) * 10) / 10, previous: null, trend: overview.watchTime.trend, hasData: true, derived: true }
  overview.netSubscribers = { key: 'netSubscribers', label: 'Net subscribers', kind: 'sum', unit: '', group: 'Audience', total: overview.subsGained.total - overview.subsLost.total, previous: null, trend: 0, hasData: true, derived: true }
  overview.engagementRate = { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', unit: '%', group: 'Engagement', total: Math.round(((overview.likes.total + overview.comments.total + overview.shares.total) / overview.views.total) * 10000) / 100, previous: null, trend: 0, hasData: true, derived: true, formula: '(likes + comments + shares) ÷ views' }
  overview.avgViewDuration.formatted = `${Math.floor(overview.avgViewDuration.total / 60)}m ${Math.round(overview.avgViewDuration.total % 60)}s`
  return {
    meta: { dateRange: { from: dates[0], to: dates[n - 1] }, source: 'YouTube Analytics API', channelId: 'UC_sample', metricCount: metrics.length, dataPoints: metrics.length * n, account },
    overview, timeseries: timeseriesFrom(metrics, dates), metrics,
  }
}

// ── Zernio (LinkedIn / Pinterest) ───────────────────────────────
const ZERNIO_COPY = {
  linkedin: [
    'Shipped a cross-platform analytics dashboard this week — 6 APIs, one view. Here is what broke first: token expiry.',
    'Unpopular opinion: most dashboards fail on metric semantics, not on charts. A follower count is a gauge, not a sum.',
    'Rebuilt our Pinterest pipeline today. Turns out "overview: {}" was hiding 3 real pins behind a zero-filter.',
    'Design note: show zeros. An empty card is a lie; a zero with a reason is a conversation.',
    'Weekly retro — search clicks up 34%, impressions flat. CTR is the lever, not volume.',
  ],
  pinterest: [
    'Dark-mode dashboard UI patterns — 12 components worth stealing',
    'Analytics card layout: KPI, sparkline, delta, context',
    'Colour tokens for data viz that pass WCAG AA',
    'Search Console keyword clustering worksheet',
    'Minimal SaaS sidebar anatomy',
    'Typography scale for dense data tables',
    'Engagement funnel illustration (impressions → clicks → saves)',
    'Content calendar template for solo creators',
  ],
}

function zernio(platform, dates, rand) {
  const n = dates.length
  const isPin = platform === 'pinterest'
  const base = isPin
    ? { impressions: 4600, clicks: 96, saves: 54, views: 210, outboundClicks: 31, closeups: 78 }
    : { impressions: 2350, reach: 1780, clicks: 62, likes: 74, comments: 9, shares: 6, saves: 12, sends: 4, follows: 3 }

  const daily = dates.map((date, i) => {
    const d = new Date(date + 'T00:00:00')
    const weekend = [0, 6].includes(d.getUTCDay()) ? 0.7 : 1
    const growth = 0.8 + (i / Math.max(1, n - 1)) * 0.5
    const row = { date, posts: 0, followers: null, hasData: false }
    for (const [k, b] of Object.entries(base)) {
      row[k] = Math.max(0, Math.round(b * weekend * growth * (0.6 + rand() * 0.9)))
    }
    row.engagement = isPin
      ? row.clicks + row.saves + row.outboundClicks
      : row.likes + row.comments + row.shares + row.saves + row.sends + row.clicks
    const denom = row.impressions || row.reach || 0
    row.engagementRate = denom ? Math.round((row.engagement / denom) * 10000) / 100 : 0
    return row
  })

  // followers
  let fol = isPin ? 1284 : 512
  const followerTimeseries = dates.map((date) => {
    fol += Math.round(rand() * (isPin ? 9 : 4)) - 1
    return { date, followers: fol, growth: 0 }
  })
  followerTimeseries.forEach((r, i) => { r.growth = i ? r.followers - followerTimeseries[i - 1].followers : 0 })
  daily.forEach((r) => { const f = followerTimeseries.find((x) => x.date === r.date); if (f) r.followers = f.followers })

  // posts
  const copy = ZERNIO_COPY[platform]
  const posts = copy.map((content, i) => {
    const dayIndex = Math.max(0, n - 1 - Math.round((i + 1) * (n / (copy.length + 1))))
    const date = dates[dayIndex] || dates[n - 1]
    const scale = 1 - i * 0.09
    const a = isPin
      ? {
          impressions: Math.round(12400 * scale * (0.7 + rand() * 0.6)),
          clicks: Math.round(240 * scale * (0.7 + rand() * 0.6)),
          saves: Math.round(88 * scale * (0.7 + rand() * 0.6)),
          outboundClicks: Math.round(61 * scale * (0.6 + rand() * 0.7)),
          views: i % 3 === 0 ? Math.round(320 * scale) : 0,
          reach: 0, likes: 0, comments: 0, shares: 0, sends: 0, follows: 0,
        }
      : {
          impressions: Math.round(5420 * scale * (0.7 + rand() * 0.6)),
          reach: Math.round(3200 * scale * (0.7 + rand() * 0.6)),
          likes: Math.round(156 * scale * (0.7 + rand() * 0.6)),
          comments: Math.round(23 * scale * (0.6 + rand() * 0.8)),
          shares: Math.round(12 * scale * (0.6 + rand() * 0.8)),
          saves: Math.round(9 * scale), sends: Math.round(4 * scale), clicks: Math.round(88 * scale),
          outboundClicks: 0, views: 0, follows: 0,
        }
    const engagement = Object.entries(a).reduce((s, [k, v]) => (['impressions', 'reach'].includes(k) ? s : s + v), 0)
    const denom = a.impressions || a.reach
    daily[dayIndex] && (daily[dayIndex].posts += 1)
    return {
      postId: `${platform}_sample_${i + 1}`,
      content,
      title: isPin ? content.slice(0, 48) : null,
      publishedAt: `${date}T09:${String(10 + i * 3).padStart(2, '0')}:00.000Z`,
      date,
      platformUrl: isPin ? `https://pinterest.com/pin/${9100000 + i}` : `https://linkedin.com/feed/update/urn:li:share:710000${i}`,
      mediaType: isPin ? (i % 4 === 0 ? 'video' : 'image') : i % 3 === 0 ? 'image' : 'text',
      thumbnailUrl: '',
      status: 'published',
      platform,
      boardName: isPin ? ['UI Design', 'Dev Setup', 'Inspiration', 'Data Viz'][i % 4] : null,
      isExternal: i % 3 === 0,
      syncStatus: 'synced',
      analytics: { ...a, engagement, engagementRate: denom ? Math.round((engagement / denom) * 10000) / 100 : 0 },
    }
  })

  const totals = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, sends: 0, clicks: 0, outboundClicks: 0, closeups: 0, views: 0, follows: 0, reposts: 0, profileViews: 0, websiteClicks: 0, engagement: 0 }
  for (const row of daily) for (const k of Object.keys(totals)) if (k in row) totals[k] += row[k]
  for (const p of posts) totals.outboundClicks += 0
  totals.closeups = isPin ? Math.round(totals.impressions * 0.017) : 0

  const ers = posts.map((p) => p.analytics.engagementRate)
  const avgEngagementRate = Math.round((ers.reduce((a, b) => a + b, 0) / ers.length) * 100) / 100

  const mid = Math.floor(n / 2)
  const half = (key, arr) => arr.slice(0, mid).reduce((s, r) => s + (r[key] || 0), 0)
  const half2 = (key, arr) => arr.slice(mid).reduce((s, r) => s + (r[key] || 0), 0)
  const trendOf = (key) => {
    const a = half(key, daily)
    const b = half2(key, daily)
    return a === 0 ? (b === 0 ? 0 : 100) : Math.round(((b - a) / a) * 1000) / 10
  }

  const entry = (key, label, kind, total, previous, group, unit = '') => ({
    key, label, kind, unit: unit || (kind === 'rate' ? '%' : ''), group,
    total: kind === 'rate' || kind === 'avg' ? Math.round(total * 100) / 100 : Math.round(total),
    previous: previous === null ? null : kind === 'rate' ? Math.round(previous * 100) / 100 : Math.round(previous),
    trend: previous === null ? 0 : Math.round(((total - previous) / (Math.abs(previous) || 1)) * 1000) / 10,
    hasData: Boolean(total),
  })

  const account = isPin
    ? {
        zernioAccountId: 'acct_pin_sample', platform, username: 'kishor.pins', displayName: 'Kishor Pins',
        profilePicture: '', followers: fol, pinCount: 342, boardCount: 18, monthlyViews: 96400,
        externalPostCount: 7, lastSyncedAt: new Date().toISOString(), isActive: true,
      }
    : {
        zernioAccountId: 'acct_li_sample', platform, username: 'kishor-prajapati', displayName: 'Kishor Prajapati',
        profilePicture: '', followers: fol, pinCount: null, boardCount: null, monthlyViews: null,
        externalPostCount: 2, lastSyncedAt: new Date().toISOString(), isActive: true,
      }

  const overview = isPin
    ? {
        impressions: entry('impressions', 'Impressions', 'sum', totals.impressions, half('impressions', daily) * 2, 'Performance'),
        clicks: entry('clicks', 'Pin clicks', 'sum', totals.clicks, half('clicks', daily) * 2, 'Performance'),
        outboundClicks: entry('outboundClicks', 'Outbound clicks', 'sum', totals.outboundClicks, half('outboundClicks', daily) * 2, 'Performance'),
        saves: entry('saves', 'Saves', 'sum', totals.saves, half('saves', daily) * 2, 'Engagement'),
        closeups: entry('closeups', 'Closeups', 'sum', totals.closeups, null, 'Engagement'),
        views: entry('views', 'Video views', 'sum', totals.views, half('views', daily) * 2, 'Engagement'),
        engagement: entry('engagement', 'Total engagement', 'sum', totals.engagement, half('engagement', daily) * 2, 'Engagement'),
        engagementRate: entry('engagementRate', 'Engagement rate', 'rate', avgEngagementRate, null, 'Engagement'),
        posts: entry('posts', 'Pins published', 'count', posts.length, daily.slice(0, mid).reduce((s, r) => s + r.posts, 0), 'Activity'),
        followers: entry('followers', 'Followers', 'gauge', fol, followerTimeseries[0].followers, 'Audience'),
        pins: entry('pins', 'Total pins', 'gauge', 342, null, 'Audience'),
        boards: entry('boards', 'Boards', 'gauge', 18, null, 'Audience'),
        monthlyViews: entry('monthlyViews', 'Monthly views', 'gauge', 96400, null, 'Audience'),
      }
    : {
        impressions: entry('impressions', 'Impressions', 'sum', totals.impressions, half('impressions', daily) * 2, 'Performance'),
        reach: entry('reach', 'Reach', 'sum', totals.reach, half('reach', daily) * 2, 'Performance'),
        clicks: entry('clicks', 'Clicks', 'sum', totals.clicks, half('clicks', daily) * 2, 'Performance'),
        likes: entry('likes', 'Reactions', 'sum', totals.likes, half('likes', daily) * 2, 'Engagement'),
        comments: entry('comments', 'Comments', 'sum', totals.comments, half('comments', daily) * 2, 'Engagement'),
        shares: entry('shares', 'Reposts', 'sum', totals.shares, half('shares', daily) * 2, 'Engagement'),
        saves: entry('saves', 'Saves', 'sum', totals.saves, half('saves', daily) * 2, 'Engagement'),
        sends: entry('sends', 'Sends', 'sum', totals.sends, half('sends', daily) * 2, 'Engagement'),
        follows: entry('follows', 'Follows from posts', 'sum', totals.follows, half('follows', daily) * 2, 'Engagement'),
        engagement: entry('engagement', 'Total engagement', 'sum', totals.engagement, half('engagement', daily) * 2, 'Engagement'),
        engagementRate: entry('engagementRate', 'Engagement rate', 'rate', avgEngagementRate, null, 'Engagement'),
        posts: entry('posts', 'Posts published', 'count', posts.length, daily.slice(0, mid).reduce((s, r) => s + r.posts, 0), 'Activity'),
        followers: entry('followers', 'Followers', 'gauge', fol, followerTimeseries[0].followers, 'Audience'),
      }

  // every trend above used a rough previous — recompute cleanly
  for (const [k, v] of Object.entries(overview)) {
    if (['followers', 'pins', 'boards', 'monthlyViews', 'engagementRate', 'closeups'].includes(k)) continue
    v.trend = trendOf(k === 'posts' ? 'posts' : k)
    v.previous = Math.round(v.total / (1 + v.trend / 100 || 1))
  }

  const topPosts = [...posts].sort((a, b) => b.analytics.engagement - a.analytics.engagement).slice(0, 12)
  const boards = isPin
    ? [
        { id: 'b1', name: 'UI Design', pinCount: 84, privacy: 'PUBLIC' },
        { id: 'b2', name: 'Dev Setup', pinCount: 51, privacy: 'PUBLIC' },
        { id: 'b3', name: 'Inspiration', pinCount: 207, privacy: 'PUBLIC' },
      ]
    : []

  return {
    meta: {
      dateRange: { from: dates[0], to: dates[n - 1] }, source: 'Zernio', hasAnalyticsAccess: true,
      postCount: posts.length, totalDataPoints: daily.filter((r) => r.hasData || r.posts).length,
      account, boards, boardCount: boards.length,
      sync: { skipped: false, attempted: 3, synced: 3, failed: 0 },
      diagnostics: { warnings: [], steps: { accounts: { ok: true, matched: 1, total: 2 }, analytics: { ok: true, posts: posts.length }, followerStats: { ok: true, points: n }, boards: isPin ? { ok: true, count: 3 } : undefined, sync: { skipped: false, attempted: 3 } } },
    },
    overview, timeseries: daily, topPosts, posts, totals, avgEngagementRate,
    platformBreakdown: { [platform]: { posts: posts.length, impressions: totals.impressions, reach: totals.reach, clicks: totals.clicks, likes: totals.likes, comments: totals.comments, shares: totals.shares, saves: totals.saves, views: totals.views, engagement: totals.engagement } },
    followerTimeseries,
  }
}

// ── Google Search Console ───────────────────────────────────────
const KEYWORDS = [
  ['react analytics dashboard', 412, 9840, 4.19, 6.4],
  ['zernio api pinterest', 268, 3120, 8.59, 3.1],
  ['google search console api node', 214, 5280, 4.05, 8.7],
  ['meta graph api insights', 186, 4410, 4.22, 9.2],
  ['youtube analytics api example', 151, 3980, 3.79, 11.5],
  ['social media kpi dashboard', 132, 2870, 4.6, 7.8],
  ['pinterest api boards', 98, 2140, 4.58, 12.3],
  ['express cors react vite', 76, 1880, 4.04, 14.1],
  ['linkedin post analytics api', 64, 1620, 3.95, 10.9],
  ['recharts area chart gradient', 51, 1340, 3.81, 15.6],
]
const PAGES = [
  ['/blog/cross-platform-analytics-dashboard', 512, 11240, 4.56, 5.8],
  ['/projects/pulse', 388, 8420, 4.61, 4.2],
  ['/notes/zernio-api-guide', 246, 5180, 4.75, 7.1],
  ['/blog/search-console-api-node', 194, 4860, 3.99, 9.4],
  ['/', 122, 6240, 1.96, 12.8],
  ['/about', 48, 1120, 4.29, 18.2],
]
const COUNTRIES = [['in', 986, 21400], ['us', 412, 12800], ['gb', 96, 3100], ['de', 74, 2400], ['ca', 61, 1900], ['au', 44, 1500]]
const DEVICES = [['DESKTOP', 812, 19800], ['MOBILE', 704, 20400], ['TABLET', 57, 2900]]

function gsc(dates, rand) {
  const n = dates.length
  const clicks = Array.from({ length: n }, (_, i) => shape(rand, 46, i, n))
  const impressions = Array.from({ length: n }, (_, i) => shape(rand, 1180, i, n))
  const ctr = clicks.map((c, i) => (impressions[i] ? Math.round((c / impressions[i]) * 10000) / 100 : 0))
  const position = impressions.map(() => Math.round((4 + rand() * 9) * 100) / 100)
  const metrics = [
    metric('clicks', 'Clicks', 'sum', clicks, dates, '', 'Traffic'),
    metric('impressions', 'Impressions', 'sum', impressions, dates, '', 'Traffic'),
    metric('ctr', 'CTR', 'rate', ctr, dates, '%', 'Quality'),
    metric('position', 'Avg position', 'avg', position, dates, '', 'Quality'),
  ]
  const mid = Math.floor(n / 2)
  const s = (arr) => arr.slice(mid).reduce((a, b) => a + b, 0)
  const p = (arr) => arr.slice(0, mid).reduce((a, b) => a + b, 0)
  const trend = (a, b) => (b === 0 ? 0 : Math.round(((a - b) / b) * 1000) / 10)
  const totalClicks = clicks.reduce((a, b) => a + b, 0)
  const totalImpr = impressions.reduce((a, b) => a + b, 0)
  const overview = {
    clicks: { key: 'clicks', id: 'clicks', label: 'Clicks', kind: 'sum', unit: '', group: 'Traffic', total: totalClicks, previous: p(clicks), trend: trend(s(clicks), p(clicks)), average: Math.round(totalClicks / n), hasData: true, points: n },
    impressions: { key: 'impressions', id: 'impressions', label: 'Impressions', kind: 'sum', unit: '', group: 'Traffic', total: totalImpr, previous: p(impressions), trend: trend(s(impressions), p(impressions)), average: Math.round(totalImpr / n), hasData: true, points: n },
    ctr: { key: 'ctr', id: 'ctr', label: 'CTR', kind: 'rate', unit: '%', group: 'Quality', total: Math.round((totalClicks / totalImpr) * 10000) / 100, previous: Math.round((p(clicks) / p(impressions)) * 10000) / 100, trend: 0, hasData: true, points: n },
    position: { key: 'position', id: 'position', label: 'Avg position', kind: 'avg', unit: '', group: 'Quality', total: Math.round((position.reduce((a, b) => a + b, 0) / n) * 100) / 100, previous: Math.round((p(position) / mid) * 100) / 100, trend: 0, hasData: true, points: n },
  }
  overview.ctr.trend = Math.round(((overview.ctr.total - overview.ctr.previous) / overview.ctr.previous) * 1000) / 10
  overview.position.trend = Math.round(((overview.position.total - overview.position.previous) / overview.position.previous) * 1000) / 10

  return {
    meta: {
      dateRange: { from: dates[0], to: dates[n - 1] },
      effectiveRange: { from: dates[0], to: dates[n - 1], days: n },
      previousRange: { from: isoDay(n * 2), to: isoDay(n) },
      siteUrl: 'https://kishor-prajapti.netlify.app/',
      verifiedSites: [{ siteUrl: 'https://kishor-prajapti.netlify.app/', permissionLevel: 'siteOwner' }],
      dimensions: ['date'], rowCount: n, dataPoints: n, source: 'Google Search Console API',
      note: 'Search Console data lags ~2–3 days, so the window ends 2 days ago.',
    },
    overview,
    timeseries: dates.map((d, i) => ({ date: d, clicks: clicks[i], impressions: impressions[i], ctr: ctr[i], position: position[i], hasData: impressions[i] > 0 })),
    metrics,
    previousTotals: { clicks: p(clicks), impressions: p(impressions), ctr: overview.ctr.previous, position: overview.position.previous },
    topItems: KEYWORDS.map(([k, c, imp, c2, pos]) => ({ keys: [k], label: k, clicks: c, impressions: imp, ctr: c2, position: pos, clickShare: Math.round((c / totalClicks) * 10000) / 100 })),
  }
}

export function sampleTopItems(dim) {
  const build = (rows, keyName) => {
    const totalClicks = rows.reduce((s, r) => s + r[1], 0)
    const totalImpr = rows.reduce((s, r) => s + r[2], 0)
    return rows.map((r) => {
      const [key, clicks, impressions] = r
      const ctr = r[3] ?? (impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0)
      const position = r[4] ?? Math.round((3 + (impressions % 17)) * 10) / 10
      const label =
        keyName === 'country' ? key.toUpperCase() : keyName === 'page' ? key : keyName === 'device' ? key[0] + key.slice(1).toLowerCase() : key
      return {
        keys: [key], label, url: keyName === 'page' ? `https://kishor-prajapti.netlify.app${key}` : null,
        clicks, impressions, ctr, position,
        clickShare: Math.round((clicks / (totalClicks || 1)) * 10000) / 100,
        impressionShare: Math.round((impressions / (totalImpr || 1)) * 10000) / 100,
      }
    })
  }
  if (dim === 'query') return build(KEYWORDS, 'query')
  if (dim === 'page') return build(PAGES, 'page')
  if (dim === 'country') return build(COUNTRIES, 'country')
  if (dim === 'device') return build(DEVICES, 'device')
  return []
}

/**
 * sampleDemographics — the exact v4.2 demographics contract, per platform,
 * including the honest "not available" shape Zernio produces.
 */
export function sampleDemographics(key) {
  if (key === 'youtube') {
    return {
      available: true, source: 'YouTube Analytics API · viewerPercentage', unit: 'share', asOf: '2026-10-15', note: null,
      gender: { male: 61.4, female: 36.2, unknown: 2.4 },
      age: [
        { bucket: '13-17', male: 2.1, female: 1.4, total: 3.5 },
        { bucket: '18-24', male: 18.6, female: 10.2, total: 28.8 },
        { bucket: '25-34', male: 24.4, female: 13.9, total: 38.3 },
        { bucket: '35-44', male: 9.8, female: 6.4, total: 16.2 },
        { bucket: '45-54', male: 4.1, female: 2.6, total: 6.7 },
        { bucket: '55-64', male: 1.7, female: 1.2, total: 2.9 },
        { bucket: '65+', male: 0.7, female: 0.5, total: 1.2 },
      ],
      countries: [
        { code: 'IN', value: 41.2, share: 41.2 }, { code: 'US', value: 13.8, share: 13.8 },
        { code: 'PK', value: 6.4, share: 6.4 }, { code: 'GB', value: 5.1, share: 5.1 },
        { code: 'BD', value: 4.3, share: 4.3 }, { code: 'CA', value: 3.0, share: 3.0 },
        { code: 'AE', value: 2.6, share: 2.6 }, { code: 'AU', value: 2.2, share: 2.2 },
        { code: 'DE', value: 1.9, share: 1.9 }, { code: 'NP', value: 1.6, share: 1.6 },
      ],
      cities: null,
      devices: [
        { label: 'Mobile phone', value: 68.4, share: 68.4 }, { label: 'Desktop', value: 21.2, share: 21.2 },
        { label: 'Tablet', value: 6.1, share: 6.1 }, { label: 'TV', value: 4.3, share: 4.3 },
      ],
      missing: ['cities'],
    }
  }
  if (key === 'instagram') {
    return {
      available: true, source: 'Instagram Graph API · audience insights', unit: 'count', asOf: '2026-10-15',
      note: 'Instagram reports the composition of your current followers, not of the people reached in the selected range.',
      gender: { male: 54.8, female: 44.1, unknown: 1.1 },
      age: [
        { bucket: '18-24', male: 210, female: 168, total: 378 },
        { bucket: '25-34', male: 342, female: 288, total: 630 },
        { bucket: '35-44', male: 121, female: 96, total: 217 },
        { bucket: '45-54', male: 44, female: 31, total: 75 },
        { bucket: '55-64', male: 12, female: 9, total: 21 },
        { bucket: '65+', male: 4, female: 3, total: 7 },
      ],
      countries: [
        { code: 'IN', value: 742, share: 57.8 }, { code: 'US', value: 168, share: 13.1 },
        { code: 'GB', value: 92, share: 7.2 }, { code: 'CA', value: 61, share: 4.8 },
        { code: 'AU', value: 48, share: 3.7 }, { code: 'AE', value: 41, share: 3.2 },
      ],
      cities: [
        { name: 'Ahmedabad', value: 214, share: 16.7 }, { name: 'Mumbai', value: 168, share: 13.1 },
        { name: 'London', value: 84, share: 6.5 }, { name: 'New York', value: 61, share: 4.8 },
        { name: 'Toronto', value: 44, share: 3.4 },
      ],
      devices: null,
      missing: ['devices'],
    }
  }
  if (key === 'facebook') {
    return {
      available: true, source: 'Meta Graph API · page_fans demographics', unit: 'count', asOf: '2026-10-15',
      note: 'Facebook reports the composition of current Page fans. Meta has retired parts of this surface on newer Graph versions, so some dimensions may be absent.',
      gender: { male: 58.2, female: 40.6, unknown: 1.2 },
      age: [
        { bucket: '18-24', male: 148, female: 102, total: 250 },
        { bucket: '25-34', male: 296, female: 214, total: 510 },
        { bucket: '35-44', male: 132, female: 88, total: 220 },
        { bucket: '45-54', male: 51, female: 29, total: 80 },
        { bucket: '55-64', male: 18, female: 11, total: 29 },
        { bucket: '65+', male: 7, female: 4, total: 11 },
      ],
      countries: [
        { code: 'IN', value: 688, share: 62.4 }, { code: 'US', value: 142, share: 12.9 },
        { code: 'GB', value: 71, share: 6.4 }, { code: 'CA', value: 52, share: 4.7 },
        { code: 'AU', value: 38, share: 3.4 },
      ],
      cities: null, devices: null,
      missing: ['devices', 'cities'],
    }
  }
  if (key === 'searchConsole') {
    return {
      available: true, source: 'Google Search Console · searchAnalytics', unit: 'count', asOf: '2026-10-12',
      note: 'Search Console reports where searchers are, not who they are — age and gender do not exist in this dataset.',
      gender: null, age: null,
      countries: [
        { name: 'India', value: 18, share: 60.0, impressions: 21 },
        { name: 'United States', value: 6, share: 20.0, impressions: 5 },
        { name: 'United Kingdom', value: 3, share: 10.0, impressions: 2 },
        { name: 'Canada', value: 2, share: 6.7, impressions: 1 },
        { name: 'Germany', value: 1, share: 3.3, impressions: 1 },
      ],
      cities: null,
      devices: [
        { label: 'Mobile phone', value: 19, share: 63.3, impressions: 22 },
        { label: 'Desktop', value: 10, share: 33.3, impressions: 7 },
        { label: 'Tablet', value: 1, share: 3.3, impressions: 1 },
      ],
      missing: ['age', 'gender', 'cities'],
    }
  }
  return {
    available: false, source: 'Zernio', unit: 'share', asOf: null,
    note: `Zernio’s public API does not expose audience demographics (age, gender, location) for ${key === 'pinterest' ? 'Pinterest' : 'LinkedIn'}. The audience section below therefore only shows what the platform itself publishes.`,
    gender: null, age: null, countries: null, cities: null, devices: null,
    missing: ['age', 'gender', 'countries', 'cities', 'devices'],
  }
}

export function sampleCombined(range, sampleAudience = 'institutions') {
  const dates = rangeDates(range)
  const rand = rng(20261015)
  const data = {
    facebook: facebook(dates, rand),
    instagram: instagram(dates, rand),
    youtube: youtube(dates, rand),
    linkedin: zernio('linkedin', dates, rand),
    pinterest: zernio('pinterest', dates, rand),
    searchConsole: gsc(dates, rand),
  }

  for (const key of PLATFORM_ORDER) data[key].demographics = sampleDemographics(key)
  // Sample mode has no API, so the growth diagnosis is reproduced from the same
  // numbers (see sampleDiagnosis above) and the ranking follows the same rules.
  for (const key of PLATFORM_ORDER) data[key].diagnosis = sampleDiagnosis(key, data[key], sampleAudience)
  data.audience = sampleAudience
  data.focus = sampleFocus(data, sampleAudience)

  const platforms = PLATFORM_ORDER.map((key) => {
    const p = data[key]
    const o = p.overview || {}
    const t = (k) => o[k]?.total || 0
    const engagement = t('engagement') || t('interactions') || t('likes') + t('comments') + t('shares') + t('saves')
    return {
      platform: key, ok: true, error: null,
      audience: t('followers') || o.account?.lifetime?.subscribers || 0,
      impressions: t('impressions'), reach: t('reach'),
      views: t('views') || t('contentViews') || t('pageViews'),
      engagement, clicks: t('clicks'),
      posts: p.meta?.postCount || t('posts') || 0,
      engagementRate: t('engagementRate'),
      trend: o.followers?.trend || 0,
      lifetime: o.account?.lifetime || null,
      account: p.meta?.account || null,
      dateRange: p.meta?.dateRange,
      hasData: true,
    }
  })

  const audience = platforms.reduce((s, p) => s + p.audience, 0)
  const impressions = platforms.reduce((s, p) => s + Math.max(p.impressions, p.reach, p.views), 0)
  const engagement = platforms.reduce((s, p) => s + p.engagement, 0)
  const gscOv = data.searchConsole.overview

  data.summary = {
    generatedAt: new Date().toISOString(),
    platforms,
    totals: {
      audience, impressions, engagement,
      clicks: platforms.reduce((s, p) => s + p.clicks, 0) + gscOv.clicks.total,
      posts: platforms.reduce((s, p) => s + p.posts, 0),
      engagementRate: impressions ? Math.round((engagement / impressions) * 10000) / 100 : 0,
      searchClicks: gscOv.clicks.total, searchImpressions: gscOv.impressions.total,
      searchCtr: gscOv.ctr.total, searchPosition: gscOv.position.total,
    },
    connected: 6, failed: [], topReachPlatform: 'instagram',
  }

  return {
    success: true,
    platform: 'combined',
    meta: { generatedAt: new Date().toISOString(), dateRange: { from: dates[0], to: dates[dates.length - 1] }, sample: true },
    data,
    sample: true,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Sample-mode growth diagnosis
 *
 * Sample mode has no API, so the diagnosis the server would return is
 * reproduced here from the same sample numbers: the funnel is read off the
 * overview totals and the stage follows the same precedence the backend uses
 * (src/utils/diagnosis.js). Benchmarks are the same published education-niche
 * references, clearly labelled as references and never as this account's data.
 * ───────────────────────────────────────────────────────────────────────── */

const SAMPLE_LABELS = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube',
  linkedin: 'LinkedIn', pinterest: 'Pinterest', searchConsole: 'Search Console',
}

// Reference engagement rates for the education niche, per follower band.
const SAMPLE_BENCH = {
  facebook: { nano: 5.6, micro: 5.2, mid: 2.9, large: 1.8 },
  instagram: { nano: 5.9, micro: 5.4, mid: 3.1, large: 2.1 },
  youtube: { nano: 4.6, micro: 4.0, mid: 3.0, large: 2.4 },
  linkedin: { nano: 5.6, micro: 3.4, mid: 3.0, large: 1.9 },
  pinterest: { nano: 3.2, micro: 1.9, mid: 1.5, large: 1.1 },
}

const SAMPLE_FIT = {
  institutions: {
    linkedin: ['high', 'Admissions committees, principals and department heads are all on LinkedIn — the decision-makers for education content.'],
    searchConsole: ['high', 'Institutions search before they follow: "syllabus", "admission process", " accreditation" queries are buying intent.'],
    youtube: ['high', 'Long-form lectures and campus walkthroughs are what institutions evaluate you on, and they keep ranking for years.'],
    facebook: ['medium', 'Parent and community groups are here; institutional decision-makers are not their primary feed.'],
    instagram: ['low', 'Skews young. Great for student reach, weak for reaching a registrar or a principal.'],
    pinterest: ['low', 'A student and teacher inspiration board, not a place institutions evaluate providers.'],
  },
  students: {
    instagram: ['high', 'Students live here — reels and carousels are the fastest route to a young audience.'],
    youtube: ['high', 'Students search for explanations and watch full lectures; the format matches how they learn.'],
    pinterest: ['medium', 'Strong for notes, projects and exam-prep inspiration boards.'],
    linkedin: ['medium', 'Students appear later in their journey, mostly for internships and placements.'],
    searchConsole: ['medium', 'Students search, but the queries are informational rather than enrolment-driven.'],
    facebook: ['low', 'The youngest cohort has largely left Facebook for Instagram and YouTube.'],
  },
}

const SAMPLE_MECHANICS = {
  facebook: 'Page organic reach is capped and falling; the algorithm favours content that sparks comments and shares within the first hour.',
  instagram: 'Reach is decided in the first few hours by saves, shares and watch-through — carousels and reels out-perform single images.',
  youtube: 'Impressions are earned by click-through rate and average view duration; a video keeps being recommended for months if both hold up.',
  linkedin: 'Dwell time and early comments drive distribution. Personal profiles out-reach company pages by a wide margin.',
  pinterest: 'Pins are indexed like search results: impressions build over weeks, and analytics lag publishing by 24–48 hours.',
  searchConsole: 'Position decides clicks. Data is delayed 2–3 days and averaged, so a new page can take weeks to show movement.',
}

function sampleStageOf(e) {
  if (!e.published) return 'no-content'
  if (!e.seen) return 'no-distribution'
  if (!e.engaged) return 'seen-not-engaged'
  if (!e.followers) return 'engaged-not-followed'
  if (!e.converted) return 'no-conversion'
  return 'healthy'
}

function sampleFunnel(platform, o, seen, engaged, followers, converted) {
  const rows = [
    { key: 'published', label: 'Published', value: o.posts?.total ?? null, sourceKey: 'posts' },
    { key: 'seen', label: platform === 'youtube' ? 'Views' : platform === 'searchConsole' ? 'Impressions' : 'Seen', value: seen, sourceKey: 'impressions' },
    { key: 'engaged', label: 'Engaged', value: engaged, sourceKey: 'engagement' },
    { key: 'followed', label: 'Followers', value: followers, sourceKey: 'followers' },
    { key: 'converted', label: 'Clicked', value: converted, sourceKey: 'clicks' },
  ]
  return rows.map((r) => ({
    ...r,
    display: r.value === null || r.value === undefined ? 'not published' : r.value.toLocaleString('en-IN'),
    verdict: r.value === null || r.value === undefined ? 'unavailable' : r.value > 0 ? 'ok' : 'zero',
  }))
}

function sampleZeros(platform, o) {
  const out = []
  const LABELS = {
    likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', saves_and_reposts: 'Saves',
    engagement: 'Engagement', interactions: 'Interactions', total_interactions: 'Interactions',
    clicks: 'Clicks', outboundClicks: 'Outbound clicks', followers: 'Followers', reach: 'Reach',
    impressions: 'Impressions', posts: 'Posts', views: 'Views', contentViews: 'Content views',
    watchTime: 'Watch time', subscribersGained: 'Subscribers gained', replies: 'Replies', sends: 'Sends',
  }
  for (const [key, card] of Object.entries(o || {})) {
    if (!card || typeof card !== 'object') continue
    if (card.unavailable) continue
    if (Number(card.total) !== 0) continue
    if (!LABELS[key]) continue
    out.push({
      key,
      label: LABELS[key],
      reason: platform === 'pinterest' && (key === 'likes' || key === 'comments')
        ? 'unpublished'
        : 'seen-not-engaged',
      explanation: platform === 'pinterest' && (key === 'likes' || key === 'comments')
        ? 'Pinterest only reports impressions and clicks — there is no like or comment count to show.'
        : 'The API reports this metric as zero for the selected range, so it is real, not a connection problem.',
      source: 'sample',
    })
  }
  return out.slice(0, 6)
}

function sampleBenchmark(platform, followers, rate) {
  const bands = SAMPLE_BENCH[platform]
  if (!bands) return null
  const tier = followers < 1000 ? 'nano' : followers < 10000 ? 'micro' : followers < 100000 ? 'mid' : 'large'
  const typical = bands[tier]
  // Same shape the API sends: `yours` is a number in percent, `typical` is prose.
  return {
    metric: 'engagement rate',
    yours: Math.round(Number(rate) * 100) / 100,
    typical: `${typical}% for education-niche ${tier} accounts`,
    tier: `${SAMPLE_LABELS[platform]} · ${tier} account · education niche`,
    reference: `Published 2026 industry benchmarks for the education niche — a reference range, not your data.`,
    note: null,
  }
}

function sampleActions(platform, stage, audience) {
  const fit = SAMPLE_FIT[audience]?.[platform]?.[0] || 'medium'
  const lead = fit === 'high'
    ? `This is a high-fit channel for ${audience === 'students' ? 'students' : 'universities and institutes'} — prioritise it.`
    : fit === 'low'
      ? `This channel is a weak fit for ${audience === 'students' ? 'students' : 'institutional'} audiences — keep it light.`
      : null
  const byStage = {
    'no-content': ['Publish 3 posts this week', 'Nothing in the range means nothing to measure. Consistency beats volume at this stage.'],
    'no-distribution': ['Re-publish with a different hook', 'The content exists but the algorithm did not serve it. Change the first line and the format, then post at a peak hour.'],
    'seen-not-engaged': ['Ask a question in the first line', 'Reach without engagement means the content was scrolled past. End with one specific question relevant to your audience.'],
    'engaged-not-followed': ['Add a reason to follow', 'People engaged but did not stay. Publish a short series so there is something to follow for.'],
    'no-conversion': ['Put one clear link or call to action', 'Attention is not turning into visits. One link, one ask, in the post and the profile.'],
    healthy: ['Double down on the best format', 'This channel is working. Find the top post and publish three variations of it.'],
  }[stage] || ['Review the range', 'Widen the date range to see more history.']
  const actions = [{ priority: 1, title: byStage[0], detail: byStage[1], effort: 'this week' }]
  if (lead) actions.push({ priority: 2, title: 'Treat this as a primary channel', detail: lead, effort: 'ongoing' })
  return actions
}

/** One channel's sample diagnosis, mirroring the server contract. */
export function sampleDiagnosis(platform, payload, audience = 'institutions') {
  const o = payload?.overview || {}
  const t = (k) => Number(o[k]?.total) || 0
  const posts = Array.isArray(payload?.posts) ? payload.posts : []
  const published = t('posts') || posts.length
  const seen = platform === 'youtube' ? t('views') : platform === 'searchConsole' ? t('impressions') : t('impressions') || t('reach') || t('views') || t('contentViews') || t('pageViews')
  const engaged = t('engagement') || t('interactions') || t('total_interactions') || (t('likes') + t('comments') + t('shares') + t('saves'))
  const followers = t('followers') || Number(o.account?.lifetime?.subscribers) || 0
  const converted = t('clicks') || t('outboundClicks') || t('websiteClicks') || t('profileViews') || 0
  const stage = sampleStageOf({ published, seen, engaged, followers, converted })
  const rate = Number(o.engagementRate?.total) || (seen ? (engaged / seen) * 100 : 0)
  const fit = SAMPLE_FIT[audience]?.[platform] || ['medium', '']
  const headline = {
    'no-content': `Nothing was published to ${SAMPLE_LABELS[platform]} in this range, so every metric reads zero.`,
    'no-distribution': `${SAMPLE_LABELS[platform]} published ${published} item(s) but the algorithm served almost none of them.`,
    'seen-not-engaged': `${SAMPLE_LABELS[platform]} reached ${seen.toLocaleString('en-IN')} people but only ${engaged.toLocaleString('en-IN')} interactions followed.`,
    'engaged-not-followed': `People are engaging on ${SAMPLE_LABELS[platform]} but not following — there is no reason to come back yet.`,
    'no-conversion': `${SAMPLE_LABELS[platform]} is getting attention but no click-through to your site or profile.`,
    healthy: `${SAMPLE_LABELS[platform]} is moving through the whole funnel: seen, engaged, followed and clicked.`,
  }[stage]

  return {
    platform,
    audience,
    audienceFit: { fit: fit[0], why: fit[1] },
    stage,
    headline,
    funnel: sampleFunnel(platform, o, seen, engaged, followers, converted),
    zeros: sampleZeros(platform, o),
    benchmark: sampleBenchmark(platform, followers, rate),
    actions: sampleActions(platform, stage, audience),
    mechanics: SAMPLE_MECHANICS[platform] || null,
    evidence: {
      published, seen, engaged, followers, converted,
      engagedSource: 'account insights', postsRead: posts.length, youngPosts: 0, lagging: false,
    },
  }
}

const STAGE_WEIGHT = {
  'no-distribution': 3, 'no-content': 2.6, 'seen-not-engaged': 2.2,
  'no-conversion': 1.8, 'engaged-not-followed': 1.6, healthy: 1.2, 'pending-lag': 0.8,
}
const FIT_WEIGHT = { high: 1.5, medium: 1, low: 0.6 }

/** Ranked "where to focus" list for sample mode. */
export function sampleFocus(data, audience = 'institutions') {
  return Object.keys(SAMPLE_LABELS)
    .filter((k) => data && data[k])
    .map((k) => {
      const d = sampleDiagnosis(k, data[k], audience)
      const score = Math.round((STAGE_WEIGHT[d.stage] || 1) * (FIT_WEIGHT[d.audienceFit.fit] || 1) * 100) / 100
      return {
        platform: k, stage: d.stage, headline: d.headline, score,
        audienceFit: d.audienceFit.fit, audienceWhy: d.audienceFit.why,
        firstAction: d.actions[0]?.title || null,
      }
    })
    .sort((a, b) => b.score - a.score)
}

export function sampleHealth() {
  const mk = (platform, source, message, extra = {}) => ({
    platform, source, configured: true, status: 'ok', message,
    checkedAt: new Date().toISOString(), hint: null, ...extra,
  })
  return {
    success: true,
    platform: 'system',
    meta: { uptime: 4210, checkedInMs: 812, version: '4.1.0 (sample)' },
    data: {
      healthy: true,
      platforms: { facebook: 'ok', instagram: 'ok', youtube: 'ok', searchConsole: 'ok', linkedin: 'ok', pinterest: 'ok' },
      details: {
        facebook: mk('facebook', 'graph', 'Page token acquired', { account: 'Kishor Prajapati' }),
        instagram: mk('instagram', 'graph', 'Instagram business account reachable', { account: '@kishor.codes' }),
        youtube: mk('youtube', 'google-oauth', 'Refresh token valid', { account: 'Kishor Builds' }),
        linkedin: mk('linkedin', 'zernio', '@kishor-prajapati', { followers: 512, hasAnalyticsAccess: true }),
        pinterest: mk('pinterest', 'zernio', '@kishor.pins', { followers: 1284, hasAnalyticsAccess: true }),
        searchConsole: mk('searchConsole', 'google-oauth', '1 verified site', { sites: ['https://kishor-prajapti.netlify.app/'] }),
      },
      configured: 6, ok: 6, total: 6, serverTime: new Date().toISOString(),
    },
    sample: true,
  }
}

export function samplePlatform(key, range, extra = {}) {
  const payload = sampleCombined(range)
  if (key === 'searchConsole' && extra.dimensions && extra.dimensions !== 'date') {
    const base = payload.data.searchConsole
    return { success: true, platform: 'gsc', meta: { ...base.meta, dimensions: [extra.dimensions] }, data: { overview: base.overview, timeseries: base.timeseries, metrics: base.metrics, topItems: sampleTopItems(extra.dimensions) }, sample: true }
  }
  const p = payload.data[key === 'searchConsole' ? 'searchConsole' : key]
  return { success: true, platform: key, meta: p.meta, data: { ...p, demographics: p.demographics || sampleDemographics(key) }, sample: true }
}
