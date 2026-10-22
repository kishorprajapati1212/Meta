import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCombined, fetchHealth, describeError } from '../lib/api'
import { sampleCombined, sampleHealth } from '../lib/sample'
import { healthDetailsOf } from '../lib/normalize'

/**
 * useAnalytics — loads GET /api/combined + GET /api/health for a date range.
 *
 * `combined` failing is fatal for the page; `health` failing is not (the
 * dashboard still renders, just without connection states). Sample mode
 * short-circuits both so the UI can be reviewed with no credentials.
 */
const BACKOFF_MS = [1200, 3500]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch with bounded retry. A free-tier host (Render) sleeps after inactivity,
 * so the first request of a session often 502s or times out; retrying with a
 * short backoff turns that into a non-event instead of an error card.
 */
async function withRetry(fn, tries = BACKOFF_MS.length + 1, onRetry) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < tries - 1) {
        onRetry?.(i + 1)
        await sleep(BACKOFF_MS[i])
      }
    }
  }
  throw lastErr
}

export function useAnalytics(range, { sample = false, autoRefreshMs = 0, audience = 'institutions' } = {}) {
  const [data, setData] = useState(null)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [stale, setStale] = useState(false)
  const first = useRef(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async () => {
    if (first.current) setLoading(true)
    else setRefreshing(true)
    setError(null)
    setHealthError(null)

    if (sample) {
      await new Promise((r) => setTimeout(r, 220))
      if (!mounted.current) return
      setData(sampleCombined(range, audience))
      setHealth(sampleHealth())
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
      first.current = false
      return
    }

    const [combinedRes, healthRes] = await Promise.allSettled([
      withRetry(() => fetchCombined(range, { audience }), BACKOFF_MS.length + 1, () => mounted.current && setRetrying(true)),
      withRetry(() => fetchHealth(), 2),
    ])
    if (!mounted.current) return
    setRetrying(false)

    if (combinedRes.status === 'fulfilled') {
      setData(combinedRes.value)
      setError(null)
      setStale(false)
    } else {
      // Never throw away good data because of one bad refresh: keep rendering
      // the last successful payload and label it as stale.
      setError(describeError(combinedRes.reason))
      setStale(true)
    }
    if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
    else setHealthError(describeError(healthRes.reason))

    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
    first.current = false
    // `audience` re-ranks the growth diagnosis server-side, so it must refetch.
  }, [range, sample, audience])

  useEffect(() => {
    first.current = true
    load()
  }, [load])

  useEffect(() => {
    if (!autoRefreshMs || loading) return undefined
    const id = setInterval(load, autoRefreshMs)
    return () => clearInterval(id)
  }, [autoRefreshMs, load, loading])

  return {
    data,
    platformData: data?.data || null,
    summary: data?.data?.summary || null,
    // v4.3.0: ranked "where to focus" list + the audience it was ranked for.
    focus: data?.data?.focus || [],
    diagnosedAudience: data?.data?.audience || audience,
    health,
    // Normalised across API versions: v4.1 sends data.details, v4.0 only sent
    // data.platforms as strings — both end up as the same rich shape.
    // Always an object: a null here would crash every panel that indexes it
    // while /api/health is unreachable (cold starts, flaky network).
    healthDetails: health ? healthDetailsOf(health) : {},
    loading,
    refreshing,
    retrying,
    stale,
    error,
    healthError,
    lastUpdated,
    isSample: Boolean(sample || data?.sample),
    refetch: load,
  }
}
