import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCompact, formatDateShort, formatDateLong } from '../utils/format'

function CustomTooltip({ active, payload, label, color }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface2 border border-hairline2 rounded-lg px-3 py-2 shadow-panel">
      <p className="text-[11px] font-mono text-text-faint mb-0.5">{formatDateLong(label)}</p>
      <p className="text-sm font-mono font-medium" style={{ color }}>
        {formatCompact(payload[0].value)}
      </p>
    </div>
  )
}

export default function TrendChart({ data, color = '#F2A93B', label, height = 280 }) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center text-text-faint gap-2"
      >
        <p className="text-sm font-mono">No time series data for this range.</p>
      </div>
    )
  }

  const gradId = `trend-${color.replace('#', '')}`

  return (
    <div>
      {label && (
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="text-xs font-mono text-text-muted">{label}</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1B1F2A" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateShort}
            stroke="#5B606E"
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#5B606E' }}
            axisLine={{ stroke: '#262B38' }}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            tickFormatter={formatCompact}
            stroke="#5B606E"
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#5B606E' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<CustomTooltip color={color} />} cursor={{ stroke: '#31384A', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
