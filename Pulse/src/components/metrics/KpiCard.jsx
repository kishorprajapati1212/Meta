import { Info } from 'lucide-react'
import { cls } from '../../lib/cls'
import { formatValue, formatValueFull } from '../../lib/format'
import Sparkline from '../charts/Sparkline'

/**
 * KpiCard — one metric, rendered with the correct semantics for its kind:
 *   value      → formatValue(total, {kind, unit})   (never sums a gauge)
 *   sparkline  → the metric's own daily series — this IS the trend
 *   zero state → muted value + "no data yet", never a hidden card
 *
 * v4.3.4: the card no longer prints a % change badge. It used to show
 * second-half-vs-first-half of the same window as if it were growth, plus an
 * absolute delta against that same first-half sum, and "0%" whenever the
 * backend had never measured a comparison at all. A card shows a number and a
 * graph; the metric table below it shows comparisons, labelled with their basis.
 */
export default function KpiCard({
  metric,
  color = '#2F6BFF',
  selected = false,
  onClick = null,
  showSparkline = true,
  size = 'md',
  footnote = null,
  className = '',
}) {
  if (!metric) return null
  const { label, kind = 'sum', unit = '', total, series = [], hasData, description, formula, group, estimated, source } = metric
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick || undefined}
      title={onClick ? `Chart this metric` : undefined}
      className={cls(
        'card text-left flex flex-col gap-2.5 relative overflow-hidden transition-all',
        size === 'lg' ? 'p-5' : 'p-4',
        onClick && 'card-hover cursor-pointer',
        selected && 'ring-2 ring-brand/25 border-brand-line shadow-lift',
        className
      )}
    >
      <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: selected ? color : `${color}00` }} />

      <div className="min-w-0">
        <p className="text-[12px] font-medium text-muted truncate flex items-center gap-1">
          {label}
          {(description || formula) && onClick === null ? (
            <span className="text-faint" title={formula ? `${description || ''} (${formula})` : description}>
              <Info className="w-3 h-3" strokeWidth={2} />
            </span>
          ) : null}
        </p>
        {group && size === 'lg' ? <p className="text-[10px] uppercase tracking-[0.08em] text-faint font-semibold mt-0.5">{group}</p> : null}
      </div>

      <span
        className={cls('font-display font-bold num tracking-tight', size === 'lg' ? 'text-kpi' : 'text-[24px] leading-8', !hasData && 'text-faint')}
        title={
          (estimated ? 'Estimated — ' : '') +
          (description ? description + ' · ' : '') +
          formatValueFull(total, { kind, unit })
        }
      >
        {estimated ? '≈' : ''}
        {formatValue(total, { kind, unit })}
      </span>

      {showSparkline ? (
        <Sparkline data={series} color={hasData ? color : '#C9D1DC'} height={size === 'lg' ? 44 : 34} />
      ) : null}

      {!hasData ? (
        <p className="text-[11px] text-faint -mt-1">No activity recorded in this range</p>
      ) : footnote ? (
        <p className="text-[11px] text-faint -mt-1 num">{footnote}</p>
      ) : source === 'posts' ? (
        <p className="text-[11px] text-faint -mt-1" title={description || undefined}>
          Summed from your posts in this range
        </p>
      ) : estimated ? (
        <p className="text-[11px] text-faint -mt-1" title={description || undefined}>
          Estimated
        </p>
      ) : null}
    </Tag>
  )
}
