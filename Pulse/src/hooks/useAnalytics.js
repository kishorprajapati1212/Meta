import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCombined, fetchHealth } from '../lib/api'

export function useAnalytics(range) {
  const [combined, setCombined] = useState(null)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const isFirstLoad = useRef(true)

  const load = useCallback(async () => {
    if (isFirstLoad.current) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [combinedRes, healthRes] = await Promise.allSettled([
        fetchCombined(range),
        fetchHealth(),
      ])
      if (combinedRes.status === 'fulfilled') {
        setCombined(combinedRes.value)
      } else {
        setError(combinedRes.reason?.message || 'Could not reach the analytics API.')
      }
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
      isFirstLoad.current = false
    }
  }, [range])

  useEffect(() => {
    isFirstLoad.current = true
    load()
  }, [load])

  return { combined, health, loading, refreshing, error, lastUpdated, refetch: load }
}
