import { useState } from 'react'
import { Download, EyeOff } from 'lucide-react'
import { cls } from '../../lib/cls'
import { formatValue, formatValueFull } from '../../lib/format'
import { exportCSV } from '../../lib/csv'
import { TrendPill, Tag } from '../ui/Pill'
import Sparkline from '../charts/Sparkline'
import { EmptyState } from '../ui/States'

/**
 * MetricTable — the "show me every number" view.
 *
 * One row per metric the backend returned, whatever its kind, including zeros.
 * This is the component that makes the old bug impossible: there is no
 * whitelist, no priority filter, and no fallback that hides metrics.
 */
export default function MetricTable({
  metrics = [],
  platformKey,
  color = '#2F6BFF',
  title = 'All metrics',
  subtitle = 'Every field the API returned for this range, with its aggregation type.',
  defaultHideEmpty = false,
  className = '',
}) {
  const [hideEmpty, setHideEmpty] = useState(defaultHideEmpty)
  const rows = hideEmpty ? metrics.filter((m) => m.hasData) : metrics

  if (!metrics.length) {
    return (
      <div className={cls('card', className)}>
        <EmptyState
          title="No metrics returned"
          message="The API answered successfully but included no metric fields for this platform and range."
        />
      </div>
    )
  }

  function doExport() {
    exportCSV(`${platformKey || 'platform'}-metrics`, rows, [
      { label: 'Metric', value: (r) => r.label },
      { label: 'Key', value: (r) => r.key },
      { label: 'Group', value: (r) => r.group },
      { label: 'Kind', value: (r) => r.kind },
      { label: 'Unit', value: (r) => r.unit },
      { label: 'Total', value: (r) => r.total },
      { label: 'Previous (2nd half vs 1st)', value: (r) => r.previous ?? '' },
      { label: 'Change % (2nd half vs 1st)', value: (r) => r.trend ?? '' },
      { label: 'Daily average', value: (r) => r.average ?? '' },
      { label: 'Peak day', value: (r) => peakOf(r) ?? '' },
      { label: 'Data points', value: (r) => r.points ?? (r.series || []).length },
    ])
  }

  return (
    <div className={cls('card overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        <div>
          <h3 className="section-title">{title}</h3>
          <p className="section-sub mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cls('btn text-[12px]', hideEmpty && 'border-brand-line bg-brand-soft text-brand-ink')}
            onClick={() => setHideEmpty((v) => !v)}
            title="Toggle rows whose value is zero for the whole range"
          >
            <EyeOff className="w-3.5 h-3.5" strokeWidth={2} />
            {hideEmpty ? `Showing ${rows.length} of ${metrics.length}` : 'Hide empty'}
          </button>
          <button className="btn text-[12px]" onClick={doExport} title="Download every metric as CSV">
            <Download className="w-3.5 h-3.5" strokeWidth={2} />
            CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[880px]">
          <thead>
            <tr className="bg-sunken/70 border-b border-line">
              <th className="th w-[26%]">Metric</th>
              <th className="th text-right">Total</th>
              <th className="th text-right" title="Second half of the selected range. Not a previous week or month.">
                1st half
              </th>
              <th className="th text-right">Daily avg</th>
              <th className="th text-right">Peak</th>
              <th className="th text-center w-[16%]" title="2nd half of this range vs the 1st half. Only shown when the baseline is large enough for a percentage to mean something.">
                Trend
              </th>
              <th className="th w-[18%]">Last {Math.min(60, rows[0]?.series?.length || 30)} days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const peak = peakOf(m)
              return (
                <tr key={`${m.key}-${i}`} className={cls('border-b border-line/60 last:border-0', i % 2 === 1 && 'bg-sunken/40')}>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.hasData ? color : '#D5DAE3' }} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink truncate" title={m.description || m.formula || m.label}>
                          {m.label}
                        </p>
                        <p className="text-[10.5px] text-faint font-mono truncate">
                          {m.key}
                          {m.derived ? ' · derived' : ''}
                          {m.source && m.source !== 'metrics[]' ? ` · ${m.source}` : ''}
                        </p>
                      </div>
                      <Tag className="ml-auto shrink-0">{kindLabel(m.kind)}</Tag>
                    </div>
                  </td>
                  <td className={cls('td-num font-semibold', !m.hasData && 'text-faint')} title={formatValueFull(m.total, m)}>
                    {formatValue(m.total, m)}
                    {m.unit && m.kind !== 'rate' ? <span className="text-[11px] text-faint ml-1">{m.unit}</span> : null}
                  </td>
                  <td className="td-num text-muted">
                    {m.previous === null || m.previous === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      formatValue(m.previous, m)
                    )}
                  </td>
                  <td className="td-num text-muted">
                    {m.average === null || m.average === undefined ? <span className="text-faint">—</span> : formatValue(m.average, m)}
                  </td>
                  <td className="td-num text-muted" title={peak ? `on ${peak.date}` : undefined}>
                    {peak ? formatValue(peak.value, m) : <span className="text-faint">—</span>}
                  </td>
                  <td className="td text-center">
                    <TrendPill metric={m} />
                    <span className="block text-[10.5px] text-faint mt-1 num">{m.points ?? (m.series || []).length} pts</span>
                  </td>
                  <td className="td">
                    <Sparkline data={m.series} color={m.hasData ? color : '#C9D1DC'} height={28} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2.5 border-t border-line bg-sunken/50 text-[11.5px] text-faint flex flex-wrap gap-x-4 gap-y-1">
        <span><b className="text-muted font-semibold">sum</b> — added across the range</span>
        <span><b className="text-muted font-semibold">gauge</b> — last value in the range</span>
        <span><b className="text-muted font-semibold">rate</b> — mean percentage</span>
        <span><b className="text-muted font-semibold">avg</b> — mean of daily averages</span>
        <span>Change compares the 2nd half of the range with the 1st half</span>
      </div>
    </div>
  )
}

function peakOf(m) {
  const series = m.series || []
  if (!series.length) return null
  let best = null
  for (const p of series) {
    const v = Number(p.value) || 0
    if (!best || v > best.value) best = { date: p.date, value: v }
  }
  return best && best.value > 0 ? best : null
}

function kindLabel(kind) {
  return { sum: 'total', gauge: 'level', rate: 'rate', avg: 'avg', duration: 'time', count: 'count' }[kind] || kind
}


