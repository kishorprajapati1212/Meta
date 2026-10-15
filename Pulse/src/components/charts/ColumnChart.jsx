import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts'
import ChartTooltip from './ChartTooltip'
import { dateAxis, compact } from '../../lib/format'

/**
 * ColumnChart — bars (+ optional line overlay) on a daily axis.
 * Used for "posts per day vs impressions" and "GSC clicks vs impressions",
 * where a column shows the event and a line shows the volume behind it.
 */
export default function ColumnChart({
  data = [],
  bars = [],
  lines = [],
  height = 280,
  spanDays = 30,
  leftUnit = '',
  rightAxis = null,
  emptyMessage = 'No daily rows for this range.',
  stacked = false,
}) {
  if (!data.length || (!bars.length && !lines.length)) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <p className="text-[13px] text-faint">{emptyMessage}</p>
      </div>
    )
  }

  const meta = {}
  ;[...bars, ...lines].forEach((s) => {
    meta[s.key] = { label: s.label, kind: s.kind || 'sum', unit: s.unit || '' }
  })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: rightAxis ? 4 : 12, bottom: 0, left: -8 }}>
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
          yAxisId="left"
          tickFormatter={(v) => compact(v)}
          stroke="#D5DAE3"
          tick={{ fontSize: 11, fill: '#94A1B4' }}
          tickLine={false}
          axisLine={false}
          width={54}
          allowDecimals={false}
        />
        {rightAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(v) => compact(v)}
            stroke="#D5DAE3"
            tick={{ fontSize: 11, fill: '#94A1B4' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
        ) : null}
        <Tooltip content={<ChartTooltip meta={meta} />} cursor={{ fill: 'rgba(47,107,255,.06)' }} />
        {(bars.length + lines.length) > 1 ? (
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11.5, paddingBottom: 4 }}
            formatter={(v) => <span style={{ color: '#3E4A5E' }}>{meta[v]?.label || v}</span>}
          />
        ) : null}
        {bars.map((b) => (
          <Bar
            key={b.key}
            yAxisId={b.axis || 'left'}
            dataKey={b.key}
            name={b.key}
            fill={b.color}
            radius={b.radius ?? [3, 3, 0, 0]}
            maxBarSize={b.maxBarSize ?? 26}
            stackId={stacked ? 'a' : undefined}
            isAnimationActive={false}
          />
        ))}
        {lines.map((l) => (
          <Line
            key={l.key}
            yAxisId={l.axis || 'left'}
            type="monotone"
            dataKey={l.key}
            name={l.key}
            stroke={l.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#fff' }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
