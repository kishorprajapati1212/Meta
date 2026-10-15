import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartTooltip from './ChartTooltip'
import { dateAxis, formatValue, compact } from '../../lib/format'
import { platformMeta } from '../../lib/platforms'

/**
 * MultiLine — cross-platform comparison on one time axis.
 * `series` = [{ key, label, color, kind, unit }]
 */
export default function MultiLine({ data = [], series = [], height = 320, spanDays = 30, valueKind = 'sum', showLegend = true }) {
  if (!data.length || !series.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <p className="text-[13px] text-faint">No overlapping daily data across these channels.</p>
      </div>
    )
  }
  const meta = {}
  series.forEach((s) => { meta[s.key] = { label: s.label, kind: s.kind || valueKind, unit: s.unit || '' } })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: -8 }}>
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
          tickFormatter={(v) => compact(v)}
          stroke="#D5DAE3"
          tick={{ fontSize: 11, fill: '#94A1B4' }}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <Tooltip content={<ChartTooltip meta={meta} />} cursor={{ stroke: '#C9D9FF', strokeWidth: 1 }} />
        {showLegend ? (
          <Legend
            verticalAlign="top"
            align="right"
            height={30}
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11.5, paddingBottom: 6 }}
            formatter={(value) => <span style={{ color: '#3E4A5E' }}>{meta[value]?.label || platformMeta(value).label}</span>}
          />
        ) : null}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#fff' }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export { formatValue }
