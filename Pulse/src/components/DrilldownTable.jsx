import { useState, useMemo } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { formatFull, formatDateLong } from '../utils/format'

export default function DrilldownTable({ metrics }) {
  const [selectedId, setSelectedId] = useState(metrics?.[0]?.id)
  const [sortDesc, setSortDesc] = useState(true)

  const metric = metrics?.find((m) => m.id === selectedId) || metrics?.[0]

  const rows = useMemo(() => {
    if (!metric) return []
    const v = [...(metric.values || [])]
    v.sort((a, b) => (sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))
    return v
  }, [metric, sortDesc])

  if (!metrics || metrics.length === 0) {
    return <p className="text-sm text-text-faint font-mono">No metrics available for this range.</p>
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-hairline">
        <p className="eyebrow">Drill-down</p>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-surface2 border border-hairline2 rounded-lg px-3 py-1.5 text-xs font-mono text-text outline-none focus:border-amber"
        >
          {metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface2">
            <tr>
              <th className="text-left px-4 py-2.5">
                <button
                  onClick={() => setSortDesc((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wide text-text-muted hover:text-text"
                >
                  Date <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-4 py-2.5 text-[11px] font-mono uppercase tracking-wide text-text-muted">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} className={i % 2 === 0 ? 'bg-transparent' : 'bg-surface2/40'}>
                <td className="px-4 py-2 text-text-muted font-mono text-xs">{formatDateLong(r.date)}</td>
                <td className="px-4 py-2 text-right font-mono text-text tabular-nums">{formatFull(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
