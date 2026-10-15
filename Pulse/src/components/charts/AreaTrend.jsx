import { useMemo } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ComposedChart,
} from 'recharts'
import ChartTooltip from './ChartTooltip'
import { dateAxis, formatValue, isNum } from '../../lib/format'

/**
 * AreaTrend — the main per-platform chart.
 *
 * Handles the things that make analytics charts honest:
 *   • kind-aware Y axis (a % axis and a counter axis are not the same scale)
 *   • an optional dashed "previous period" comparison line
 *   • an average reference line
 *   • zero-only series render as a flat baseline with an explanatory caption
 */
export default function AreaTrend({
  data = [],
  seriesKey = 'value',
  previousKey = null,
  color = '#2F6BFF',
  label = '',
  kind = 'sum',
  unit = '',
  height = 300,
  showAverage = true,
  spanDays = 30,
  emptyMessage = 'No daily values for this metric in the selected range.',
}) {
  const id = useMemo(() => `area-${Math.random().toString(36).slice(2, 9)}`, [])
  const rows = data.filter((d) => d && d.date)
  const hasSignal = rows.some((r) => isNum(r[seriesKey]) && r[seriesKey] !== 0)
  const avg = useMemo(() => {
    const vals = rows.map((r) => Number(r[seriesKey]) || 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }, [rows, seriesKey])

  if (!rows.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <p className="text-[13px] text-faint">{emptyMessage}</p>
      </div>
    )
  }

  const isRate = kind === 'rate' || unit === '%'
  const tickFmt = (v) => formatValue(v, { kind, unit, dp: isRate ? 1 : 0 })

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={hasSignal ? 0.26 : 0.06} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#EDF0F5" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => dateAxis(d, spanDays)}
            stroke="#D5DAE3"
            tick={{ fontSize: 11, fill: '#94A1B4' }}
            tickLine={false}
            axisLine={{ stroke: '#E7EAF0' }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={tickFmt}
            stroke="#D5DAE3"
            tick={{ fontSize: 11, fill: '#94A1B4' }}
            tickLine={false}
            axisLine={false}
            width={58}
            domain={isRate ? [0, (max) => Math.ceil(Math.max(max, 1) * 1.15)] : [0, 'auto']}
          />
          <Tooltip
            content={
              <ChartTooltip
                kind={kind}
                unit={unit}
                meta={{
                  [seriesKey]: { label: label || 'Value', kind, unit },
                  ...(previousKey ? { [previousKey]: { label: 'Previous period', kind, unit } } : {}),
                }}
              />
            }
            cursor={{ stroke: '#C9D9FF', strokeWidth: 1 }}
          />
          {showAverage && hasSignal && avg > 0 ? (
            <ReferenceLine
              y={avg}
              stroke="#94A1B4"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{ value: `avg ${formatValue(avg, { kind, unit })}`, position: 'insideTopRight', fill: '#94A1B4', fontSize: 10.5 }}
            />
          ) : null}
          {previousKey ? (
            <Line
              type="monotone"
              dataKey={previousKey}
              stroke="#94A1B4"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
          <Area
            type="monotone"
            dataKey={seriesKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#fff' }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      {!hasSignal ? (
        <p className="text-[12px] text-faint mt-2 text-center">
          Every day in this range is zero — the chart baseline is real data, not a rendering error.
        </p>
      ) : null}
    </div>
  )
}
