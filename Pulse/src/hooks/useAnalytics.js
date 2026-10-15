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
export function useAnalytics(range, { sample = false, autoRefreshMs = 0 } = {}) {
  const [data, setData] = useState(null)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
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
      setData(sampleCombined(range))
      setHealth(sampleHealth())
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
      first.current = false
      return
    }

    const [combinedRes, healthRes] = await Promise.allSettled([fetchCombined(range), fetchHealth()])
    if (!mounted.current) return

    if (combinedRes.status === 'fulfilled') {
      setData(combinedRes.value)
    } else {
      setData(null)
      setError(describeError(combinedRes.reason))
    }
    if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
    else setHealthError(describeError(healthRes.reason))

    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
    first.current = false
  }, [range, sample])

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
    health,
    // Normalised across API versions: v4.1 sends data.details, v4.0 only sent
    // data.platforms as strings — both end up as the same rich shape.
    healthDetails: health ? healthDetailsOf(health) : null,
    loading,
    refreshing,
    error,
    healthError,
    lastUpdated,
    isSample: Boolean(sample || data?.sample),
    refetch: load,
  }
}
