import { useMemo, useRef, useState } from 'react'
import { COUNTRIES, WORLD_VIEWBOX, projectLonLat } from '../../assets/worldMap'
import { COUNTRY_NAMES } from '../../lib/countries'

/**
 * WorldMap — a real choropleth, not a decorative blob.
 *
 * The country paths are generated at build time from Natural Earth 110m
 * boundaries (see scripts/build-worldmap.mjs), so this is genuine geography
 * with zero runtime dependencies. Fill is a sequential brand scale driven by
 * sqrt(value) so a single dominant country does not flatten everyone else.
 *
 * props:
 *   values     [{code, name?, value}]  — alpha-2 codes; names are resolved here
 *   unitLabel  string                  — e.g. '% of viewers' / 'clicks'
 *   format     (n) => string
 *   height     px for the svg box
 */
const BASE = '#E4EAF3'
const STROKE = '#FFFFFF'

// sequential scale: brand blue, light → deep
const SCALE = [
  [232, 240, 255],
  [164, 197, 255],
  [95, 148, 255],
  [47, 107, 255],
  [21, 74, 199],
]

function ramp(t) {
  const x = Math.max(0, Math.min(1, t)) * (SCALE.length - 1)
  const i = Math.min(SCALE.length - 2, Math.floor(x))
  const f = x - i
  const a = SCALE[i]
  const b = SCALE[i + 1]
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function WorldMap({ values = [], unitLabel = '', format = (n) => String(n), height = 260, emptyNote = 'No geography data in this range.' }) {
  const [hover, setHover] = useState(null)
  const boxRef = useRef(null)

  const byCode = useMemo(() => {
    const m = new Map()
    for (const v of values) {
      const code = String(v.code || COUNTRY_NAMES.nameToCode(v.name) || '').toUpperCase()
      if (!code) continue
      m.set(code, { ...v, code })
    }
    return m
  }, [values])

  const max = useMemo(() => Math.max(0, ...[...byCode.values()].map((v) => Number(v.value) || 0)), [byCode])

  const paths = useMemo(
    () =>
      COUNTRIES.map((c) => {
        const hit = c.id ? byCode.get(c.id) : null
        const v = hit ? Number(hit.value) || 0 : 0
        const fill = hit && v > 0 ? ramp(Math.sqrt(v / (max || 1))) : BASE
        return { id: c.id, name: c.name, d: c.d, fill, value: hit ? v : null, label: hit?.name || c.name }
      }),
    [byCode, max]
  )

  const onMove = (e, p) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    setHover({ x: e.clientX - box.left, y: e.clientY - box.top, name: p.label, value: p.value })
  }

  const ranked = useMemo(
    () => [...byCode.values()].filter((v) => Number(v.value) > 0).sort((a, b) => b.value - a.value),
    [byCode]
  )

  return (
    <div className="relative" ref={boxRef}>
      <svg viewBox={WORLD_VIEWBOX} style={{ width: '100%', height, display: 'block' }} role="img" aria-label="Audience by country">
        <rect x="0" y="0" width="1000" height="621" fill="transparent" />
        {paths.map((p) => (
          <path
            key={p.d.slice(0, 24) + p.name}
            d={p.d}
            fill={p.fill}
            stroke={STROKE}
            strokeWidth="0.5"
            style={{ cursor: p.value ? 'pointer' : 'default', transition: 'fill 120ms' }}
            onMouseEnter={(e) => onMove(e, p)}
            onMouseMove={(e) => onMove(e, p)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11px] shadow-lift"
          style={{ left: Math.min(hover.x + 12, 999), top: hover.y - 8 }}
        >
          <span className="font-semibold text-ink">{hover.name}</span>
          <span className="ml-2 num text-body">{hover.value === null ? 'no data' : format(hover.value)}</span>
          {hover.value !== null && unitLabel ? <span className="ml-1 text-faint">{unitLabel}</span> : null}
        </div>
      )}

      {ranked.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-line bg-white/90 px-3 py-1 text-[11px] text-muted">{emptyNote}</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-faint">
          <span>less</span>
          <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(0.35)}, ${ramp(0.7)}, ${ramp(1)})` }} />
          <span>more</span>
          <span className="ml-2 text-muted">{ranked.length} countries{unitLabel ? ` · ${unitLabel}` : ''}</span>
        </div>
      )}
    </div>
  )
}

/** Place a marker at a lon/lat — used for city dots on the audience map. */
export function projectCity(lon, lat) {
  return projectLonLat(lon, lat)
}
