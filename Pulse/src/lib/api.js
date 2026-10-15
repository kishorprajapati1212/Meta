/**
 * api.js — the only module that talks to the backend.
 *
 * Base URL resolution:
 *   1. an explicit override the user typed in the UI (localStorage)
 *   2. VITE_API_BASE_URL baked in at build time
 *   3. '' → same origin, which the Vite dev server proxies to the API and
 *      which works in production when Express serves the built dashboard.
 */
import axios from 'axios'

const STORE_KEY = 'pulse.apiBaseUrl'
const BUILD_BASE = import.meta.env.VITE_API_BASE_URL || ''

export function getBaseUrl() {
  try {
    const stored = localStorage.getItem(STORE_KEY)
    if (stored !== null) return stored
  } catch {
    /* private mode */
  }
  return BUILD_BASE
}

export function setBaseUrl(url) {
  try {
    if (url) localStorage.setItem(STORE_KEY, url)
    else localStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
}

export function effectiveBase() {
  const b = getBaseUrl()
  return b || window.location.origin
}

function client(timeout = 90000) {
  return axios.create({ baseURL: getBaseUrl(), timeout })
}

/** Backend path per platform key (searchConsole is served at /api/gsc). */
export function endpointFor(platformKey) {
  return platformKey === 'searchConsole' ? 'gsc' : platformKey
}

export function rangeParams(range, extra = {}) {
  const p =
    range && range.since && range.until
      ? { since: range.since, until: range.until }
      : { date_preset: range?.preset || 'last_30d' }
  return { ...p, compact: 'true', ...extra }
}

export async function fetchIndex() {
  const { data } = await client(15000).get('/api')
  return data
}

export async function fetchHealth() {
  const { data } = await client(45000).get('/api/health')
  return data
}

export async function fetchCombined(range) {
  const { data } = await client(120000).get('/api/combined', { params: rangeParams(range) })
  return data
}

export async function fetchPlatform(platformKey, range, extra = {}) {
  const { data } = await client(90000).get(`/api/${endpointFor(platformKey)}`, {
    params: rangeParams(range, extra),
  })
  return data
}

export async function fetchZernioDebug() {
  const { data } = await client(60000).get('/api/zernio/debug')
  return data
}

export async function fetchZernioAccounts() {
  const { data } = await client(30000).get('/api/zernio/accounts')
  return data
}

export async function fetchYouTubeDebug() {
  const { data } = await client(60000).get('/api/youtube/debug')
  return data
}

/** Friendly message for any axios failure. */
export function describeError(err) {
  if (!err) return 'Unknown error'
  if (err.code === 'ECONNABORTED') return 'The request timed out — the API is taking too long to answer.'
  const status = err.response?.status
  const body = err.response?.data
  const msg = body?.error?.message || body?.message || body?.notice || err.message
  if (!status) return `Cannot reach the API at ${effectiveBase()} — ${msg}`
  return `HTTP ${status} — ${msg}`
}
