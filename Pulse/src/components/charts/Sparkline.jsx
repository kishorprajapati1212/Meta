import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'

/**
 * Sparkline — 30px-tall trend glyph inside KPI cards. No axes, no grid, no
 * interaction: it exists to show direction and shape at a glance.
 * Flat/empty series render a dashed baseline rather than a misleading line.
 */
export default function Sparkline({ data = [], color = '#2F6BFF', height = 34, fill = true, strokeWidth = 1.75 }) {
  const id = useMemo(() => `spark-${Math.random().toString(36).slice(2, 9)}`, [])
  const points = (data || []).map((d) => ({ value: Number(d.value) || 0 }))
  const hasSignal = points.some((p) => p.value !== 0)

  if (points.length < 2 || !hasSignal) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <div className="w-full border-t border-dashed border-line2" />
      </div>
    )
  }

  return (
    <div style={{ height }} className="w-full -mb-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={strokeWidth}
            fill={fill ? `url(#${id})` : 'transparent'}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
