import { primaryTrend } from '../utils/format'

const PLATFORMS = [
  { key: 'facebook', color: '#2E7CF6' },
  { key: 'instagram', color: '#DD2A7B' },
  { key: 'youtube', color: '#FF3B4E' },
  { key: 'linkedin', color: '#0A66C2' },
  { key: 'pinterest', color: '#E60023' },
  { key: 'searchConsole', color: '#34A853' },
]

function trendToRatio(trend) {
  const clamped = Math.max(-40, Math.min(40, trend || 0))
  return (clamped + 40) / 80
}

export default function PulseRing({ platformData, size = 216 }) {
  const cx = size / 2, cy = size / 2, strokeWidth = 6, gap = 6
  const count = PLATFORMS.length
  const totalGap = gap * (count - 1)
  const arcLen = (360 - totalGap) / count
  const baseRadius = size / 2 - strokeWidth * 2.8

  const trends = PLATFORMS.map(p => ({
    ...p,
    trend: platformData?.[p.key] ? primaryTrend(platformData[p.key].overview) : null,
  }))

  const valid = trends.filter(t => t.trend !== null)
  const composite = valid.length > 0 ? valid.reduce((s, t) => s + t.trend, 0) / valid.length : 0

  function describeArc(radius, startDeg, sweepDeg) {
    const s = polar(radius, startDeg), e = polar(radius, startDeg + sweepDeg)
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${e.x} ${e.y}`
  }
  function polar(radius, deg) {
    const rad = ((deg - 90) * Math.PI) / 180
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {trends.map((t, i) => {
          const radius = baseRadius - i * (strokeWidth + 3)
          const startDeg = i * (arcLen + gap)
          const ratio = t.trend === null ? 0 : trendToRatio(t.trend)
          return (
            <g key={t.key}>
              <path d={describeArc(radius, startDeg, arcLen)} stroke="#1B1F2A" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
              {t.trend !== null && (
                <path d={describeArc(radius, startDeg, arcLen * ratio)} stroke={t.color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${t.color}88)` }} />
              )}
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="eyebrow">Pulse</span>
        <span className="font-display text-4xl font-semibold text-text tabular-nums">
          {composite > 0 ? '+' : ''}{composite.toFixed(1)}<span className="text-xl text-text-muted">%</span>
        </span>
        <span className="text-[11px] text-text-faint font-mono mt-0.5">6-platform blend</span>
      </div>
    </div>
  )
}
