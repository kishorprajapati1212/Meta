/**
 * format.js — every number that reaches the screen goes through here, so a
 * gauge, a rate, a duration and a counter are never formatted the same way.
 */

const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decFmt = (dp = 2) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp })

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 1284 → "1,284" · 23700 → "23.7K" · 1_400_000 → "1.4M" */
export function compact(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs < 10000) return intFmt.format(n)
  if (abs < 1_000_000) return compactFmt.format(n).replace('.0K', 'K')
  return compactFmt.format(n)
}

export function full(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? intFmt.format(n) : '—'
}

export function decimal(v, dp = 2) {
  if (!isNum(v)) return '—'
  return decFmt(dp).format(v)
}

export function percent(v, dp = 1) {
  if (!isNum(v)) return '—'
  return `${decFmt(dp).format(v)}%`
}

export function signedPercent(v, dp = 1) {
  if (!isNum(v)) return '—'
  const s = v > 0 ? '+' : ''
  return `${s}${decFmt(dp).format(v)}%`
}

export function signedInt(v) {
  if (!isNum(v)) return '—'
  return `${v > 0 ? '+' : ''}${intFmt.format(v)}`
}

/** minutes → "1h 23m" / "47m" */
export function minutes(v) {
  if (!isNum(v)) return '—'
  if (v < 1) return `${Math.round(v * 60)}s`
  if (v < 60) return `${intFmt.format(Math.round(v))}m`
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** seconds → "1m 05s" */
export function seconds(v) {
  if (!isNum(v)) return '—'
  if (v < 60) return `${Math.round(v)}s`
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** The single entry point used by KPI cards and tables. */
export function formatValue(value, { kind = 'sum', unit = '', dp } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'

  if (unit === '%' || kind === 'rate') return percent(n, dp ?? (Math.abs(n) < 10 ? 2 : 1))
  if (unit === 'min' || kind === 'duration') return minutes(n)
  if (unit === 's') return seconds(n)
  if (unit === 'h') return `${decimal(n, 1)}h`
  if (kind === 'avg') return decimal(n, dp ?? (Math.abs(n) < 100 ? 1 : 0))
  if (kind === 'gauge' || kind === 'count' || kind === 'sum') return compact(n)
  return compact(n)
}

/** Full-precision string for tooltips / title attributes. */
export function formatValueFull(value, { kind = 'sum', unit = '' } = {}) {
  if (!isNum(value)) return '—'
  if (unit === '%' || kind === 'rate') return percent(value, 2)
  if (unit === 'min' || kind === 'duration') return `${full(Math.round(value))} min`
  if (unit === 's') return seconds(value)
  if (unit === 'h') return `${decimal(value, 2)} hours`
  if (kind === 'avg') return decimal(value, 2)
  return full(value)
}

export function trendOf(m) {
  return isNum(m?.trend) ? m.trend : null
}

/** "up" is good for everything except avg position (lower ranks better). */
export function trendTone(m) {
  const t = trendOf(m)
  if (t === null || t === 0) return 'flat'
  const lowerIsBetter = m?.key === 'position' || m?.id === 'position' || m?.invertTrend
  const good = lowerIsBetter ? t < 0 : t > 0
  return good ? 'pos' : 'neg'
}

export function dateShort(d) {
  if (!d) return ''
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dateLong(d) {
  if (!d) return ''
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(dt.getTime())
    ? String(d)
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dateAxis(d, spanDays) {
  if (!d) return ''
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(dt.getTime())) return String(d)
  if (spanDays > 120) return dt.toLocaleDateString('en-US', { month: 'short' })
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dateTime(iso) {
  if (!iso) return ''
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime())
    ? String(iso)
    : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return dateLong(iso)
}

export function truncate(s, n = 90) {
  if (!s) return ''
  const str = String(s).replace(/\s+/g, ' ').trim()
  return str.length > n ? `${str.slice(0, n - 1)}…` : str
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
