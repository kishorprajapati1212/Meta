import { Info } from 'lucide-react'
import { cls } from '../../lib/cls'
import { formatValue, formatValueFull, trendTone } from '../../lib/format'
import { TrendPill } from '../ui/Pill'
import Sparkline from '../charts/Sparkline'

/**
 * KpiCard — one metric, rendered with the correct semantics for its kind:
 *   value      → formatValue(total, {kind, unit})   (never sums a gauge)
 *   delta      → % change + absolute change vs the previous window
 *   sparkline  → the metric's own daily series
 *   zero state → muted value + "no data yet", never a hidden card
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
  const { label, kind = 'sum', unit = '', total, previous, trend, series = [], hasData, description, formula, group } = metric
  const tone = trendTone(metric)
  const Tag = onClick ? 'button' : 'div'

  const absoluteDelta =
    previous !== null && previous !== undefined ? Math.round((total - previous) * 100) / 100 : null

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

      <div className="flex items-start justify-between gap-2">
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
        {trend !== null && trend !== undefined ? <TrendPill metric={metric} /> : null}
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={cls('font-display font-bold num tracking-tight', size === 'lg' ? 'text-kpi' : 'text-[24px] leading-8', !hasData && 'text-faint')}
          title={formatValueFull(total, { kind, unit })}
        >
          {formatValue(total, { kind, unit })}
        </span>
        {absoluteDelta !== null && absoluteDelta !== 0 ? (
          <span className={cls('text-[11.5px] num font-medium', tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-faint')}>
            {absoluteDelta > 0 ? '+' : ''}
            {formatValue(absoluteDelta, { kind: kind === 'rate' ? 'rate' : 'sum', unit: kind === 'rate' ? 'pt' : '' })}
          </span>
        ) : null}
      </div>

      {showSparkline ? (
        <Sparkline data={series} color={hasData ? color : '#C9D1DC'} height={size === 'lg' ? 44 : 34} />
      ) : null}

      {!hasData ? (
        <p className="text-[11px] text-faint -mt-1">No activity recorded in this range</p>
      ) : footnote ? (
        <p className="text-[11px] text-faint -mt-1 num">{footnote}</p>
      ) : null}
    </Tag>
  )
}
