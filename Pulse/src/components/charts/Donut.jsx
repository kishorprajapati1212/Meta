import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import ChartTooltip from './ChartTooltip'
import { compact, formatValue } from '../../lib/format'

/**
 * Donut — share-of-total across channels, with the total in the middle.
 * Slices with a zero value are dropped from the ring but still listed in the
 * legend below, so nothing disappears silently.
 */
export default function Donut({ items = [], height = 210, centerLabel = 'Total', unit = '', kind = 'sum' }) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0)
  const data = items.filter((i) => Number(i.value) > 0)

  if (!data.length) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center gap-2">
        <div className="w-24 h-24 rounded-full border-[10px] border-line" />
        <p className="text-[12.5px] text-faint">Nothing to split yet — every channel is at zero.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip meta={Object.fromEntries(data.map((d) => [d.label, { label: d.label, kind, unit }]))} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="88%"
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="#fff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-display text-[22px] font-bold text-ink num">{formatValue(total, { kind, unit })}</span>
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-faint font-semibold">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full flex flex-col gap-1.5 mt-3">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: i.color || '#D5DAE3' }} />
              <span className="text-body truncate">{i.label}</span>
            </span>
            <span className="num text-ink font-medium shrink-0">
              {compact(i.value)}
              <span className="text-faint ml-1.5 text-[11px]">
                {total ? `${Math.round(((Number(i.value) || 0) / total) * 1000) / 10}%` : '0%'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
