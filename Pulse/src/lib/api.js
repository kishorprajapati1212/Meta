import axios from 'axios'
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://meta-ptze.onrender.com'
const client = axios.create({ baseURL: BASE_URL, timeout: 30000 })

export function rangeParams(range, extra = {}) {
  if (!range) return { compact: 'true', ...extra }
  const p = range.since && range.until
    ? { since: range.since, until: range.until }
    : { date_preset: range.preset || 'last_30d' }
  return { ...p, compact: 'true', ...extra }
}

export async function fetchHealth() { const { data } = await client.get('/api/health'); return data }
export async function fetchCombined(range) { const { data } = await client.get('/api/combined', { params: rangeParams(range) }); return data }
export async function fetchPlatform(platform, range, extra = {}) { const { data } = await client.get(`/api/${platform}`, { params: rangeParams(range, extra) }); return data }
export { BASE_URL }
