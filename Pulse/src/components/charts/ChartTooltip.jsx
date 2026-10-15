import { dateLong, formatValueFull, formatValue } from '../../lib/format'

/**
 * Shared recharts tooltip — a white card with the date, the metric name and
 * both compact and full-precision numbers.
 */
export default function ChartTooltip({ active, payload, label, meta, unit, kind, labelFormatter = dateLong }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-pop min-w-[150px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint mb-1.5">
        {labelFormatter(label)}
      </p>
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
          const m = meta?.[entry.dataKey] || {}
          const value = entry.value
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-[12px] text-body">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color || entry.stroke || entry.fill }} />
                {m.label || entry.name || entry.dataKey}
              </span>
              <span className="text-[12.5px] font-semibold text-ink num" title={formatValueFull(value, { kind: m.kind || kind, unit: m.unit || unit })}>
                {formatValue(value, { kind: m.kind || kind, unit: m.unit || unit })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
