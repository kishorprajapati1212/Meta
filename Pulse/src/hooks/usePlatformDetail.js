import { useEffect, useRef, useState } from 'react'
import { fetchPlatform, describeError } from '../lib/api'
import { samplePlatform } from '../lib/sample'

/**
 * usePlatformDetail — fetches one platform endpoint when the dashboard needs
 * more than /api/combined provides (e.g. GSC keyword/page/country/device
 * breakdowns, or a non-compact daily table).
 */
export function usePlatformDetail(platformKey, range, extra = {}, { enabled = true, sample = false } = {}) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const key = JSON.stringify({ platformKey, range, extra, enabled, sample })
  const lastKey = useRef(null)

  useEffect(() => {
    if (!enabled || !platformKey) {
      setPayload(null)
      return undefined
    }
    let alive = true
    lastKey.current = key
    setLoading(true)
    setError(null)

    const run = async () => {
      try {
        const res = sample
          ? await Promise.resolve(samplePlatform(platformKey, range, extra))
          : await fetchPlatform(platformKey, range, extra)
        if (!alive || lastKey.current !== key) return
        setPayload(res)
      } catch (e) {
        if (!alive) return
        setError(describeError(e))
        setPayload(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    run()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { payload, data: payload?.data || null, meta: payload?.meta || null, loading, error, isSample: Boolean(payload?.sample) }
}
