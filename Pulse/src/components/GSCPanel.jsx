import { useState, useEffect } from 'react'
import { fetchPlatform } from '../lib/api'
import { formatCompact } from '../utils/format'
import TrendChart from './TrendChart'
import Sparkline from './Sparkline'

const DIMS = [
  { value: 'date', label: 'Timeline' },
  { value: 'query', label: 'Top Keywords' },
  { value: 'page', label: 'Top Pages' },
  { value: 'country', label: 'By Country' },
  { value: 'device', label: 'By Device' },
]

export default function GSCPanel({ data, color, range }) {
  const [dim, setDim] = useState('date')
  const [gscData, setGscData] = useState(data)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (dim === 'date') { setGscData(data); return }
    setLoading(true)
    fetchPlatform('gsc', range, { dimensions: dim, rowLimit: 50 })
      .then(d => { setGscData(d.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [dim, range])

  if (!gscData || gscData.error) {
    return <div className="panel p-8 text-center"><p className="text-text-muted font-mono text-sm">{gscData?.error || 'GSC not configured. Add GSC_* credentials in .env.'}</p></div>
  }

  const { overview = {}, timeseries = [], metrics = [], topItems = [], meta } = gscData

  return (
    <div className="flex flex-col gap-5">
      {/* Site info */}
      {meta?.siteUrl && (
        <div className="flex items-center gap-2 text-xs font-mono text-text-muted">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          <span>{meta.siteUrl}</span>
          {meta.note && <span className="text-text-faint"> · {meta.note}</span>}
        </div>
      )}

      {/* Dimension switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow">View:</span>
        {DIMS.map(o => (
          <button key={o.value} onClick={() => setDim(o.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${dim === o.value ? 'bg-surface2 border-amber/50 text-text' : 'border-transparent text-text-muted hover:text-text'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {loading && <div className="panel p-8 text-center"><p className="text-text-muted font-mono text-sm animate-pulse">Loading...</p></div>}

      {!loading && dim === 'date' && (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(overview).filter(([k]) => k !== 'uniqueItems').map(([k, v]) => (
              <div key={k} className="panel2 p-3 text-center">
                <p className="text-xl font-bold text-text tabular-nums">{k === 'ctr' ? (v.total || 0) + '%' : k === 'position' ? (v.total || '—') : formatCompact(v.total)}</p>
                <p className="text-[10px] text-text-faint uppercase font-mono">{k}</p>
              </div>
            ))}
          </div>

          {/* Timeseries chart */}
          {timeseries.length > 0 && (
            <div className="panel p-5">
              <TrendChart data={timeseries.map(r => ({ date: r.date, value: r.clicks || r.impressions || 0 }))} color={color} height={200} label="gsc" />
            </div>
          )}

          {/* Metric cards */}
          {metrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {metrics.map(m => (
                <div key={m.id} className="panel2 p-4 flex flex-col gap-2">
                  <p className="text-xs text-text-muted">{m.label}</p>
                  <p className="text-xl font-bold text-text tabular-nums">{m.id === 'ctr' ? (m.summary?.total || 0) + '%' : formatCompact(m.summary?.total)}</p>
                  <Sparkline data={(m.values || []).slice(-14).map(v => ({ date: v.date, value: v.value }))} color={color} height={24} />
                </div>
              ))}
            </div>
          )}

          {/* Drilldown table */}
          {metrics.length > 0 && (
            <DrilldownTableGSC metrics={metrics} />
          )}
        </>
      )}

      {/* Keywords / Pages / Countries / Devices */}
      {!loading && dim !== 'date' && topItems.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface2">
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-mono uppercase text-text-muted">{dim === 'query' ? 'Keyword' : dim === 'page' ? 'Page URL' : dim === 'country' ? 'Country' : 'Device'}</th>
                  <th className="text-right px-4 py-3 text-[11px] font-mono uppercase text-text-muted">Clicks</th>
                  <th className="text-right px-4 py-3 text-[11px] font-mono uppercase text-text-muted">Impr.</th>
                  <th className="text-right px-4 py-3 text-[11px] font-mono uppercase text-text-muted">CTR</th>
                  <th className="text-right px-4 py-3 text-[11px] font-mono uppercase text-text-muted">Pos</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((item, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-transparent' : 'bg-surface2/40'}>
                    <td className="px-4 py-2.5 text-text font-mono text-xs max-w-[300px] truncate">{item.keys.join(' / ')}</td>
                    <td className="px-4 py-2.5 text-right text-text tabular-nums font-mono">{formatCompact(item.clicks)}</td>
                    <td className="px-4 py-2.5 text-right text-text tabular-nums font-mono">{formatCompact(item.impressions)}</td>
                    <td className="px-4 py-2.5 text-right text-text tabular-nums font-mono">{item.ctr}%</td>
                    <td className="px-4 py-2.5 text-right text-text tabular-nums font-mono">{item.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && dim !== 'date' && topItems.length === 0 && (
        <div className="panel p-8 text-center"><p className="text-text-muted font-mono text-sm">No {dim} data for this range.</p></div>
      )}
    </div>
  )
}

function DrilldownTableGSC({ metrics }) {
  const [selectedId, setSelectedId] = useState(metrics?.[0]?.id)
  const [sortDesc, setSortDesc] = useState(true)
  const metric = metrics?.find(m => m.id === selectedId) || metrics?.[0]
  const rows = [...(metric?.values || [])].sort((a, b) => sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-hairline">
        <p className="eyebrow">Drill-down</p>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
          className="bg-surface2 border border-hairline2 rounded-lg px-3 py-1.5 text-xs font-mono text-text outline-none focus:border-amber">
          {metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface2">
            <tr>
              <th className="text-left px-4 py-2.5">
                <button onClick={() => setSortDesc(v => !v)} className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wide text-text-muted hover:text-text">
                  Date
                </button>
              </th>
              <th className="text-right px-4 py-2.5 text-[11px] font-mono uppercase tracking-wide text-text-muted">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} className={i % 2 === 0 ? 'bg-transparent' : 'bg-surface2/40'}>
                <td className="px-4 py-2 text-text-muted font-mono text-xs">{r.date}</td>
                <td className="px-4 py-2 text-right font-mono text-text tabular-nums">{r.value?.toLocaleString?.('en-US') ?? r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
