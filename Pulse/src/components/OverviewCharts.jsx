import TrendChart from './TrendChart'
import { primaryMetric } from '../utils/format'

export default function OverviewCharts({ data, colors }) {
  if (!data) return null
  const platforms = ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole'].filter(p => data[p] && !data[p].error && data[p].timeseries?.length)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {platforms.map(p => {
        const d = data[p]
        const m = primaryMetric(d.overview)
        const series = (d.timeseries || []).map(r => {
          const val = m?.key ? (r[m.key] || r.clicks || r.impressions || r.reach || r.likes || r.views || 0) : (r.clicks || r.impressions || r.reach || r.likes || r.views || 0)
          return { date: r.date, value: val }
        }).filter(v => v.value > 0)
        return (
          <div key={p} className="panel p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-text">{p === 'searchConsole' ? 'GSC' : p.charAt(0).toUpperCase() + p.slice(1)}</span>
              <span className="text-[11px] font-mono text-text-faint">{m?.key || 'activity'}</span>
            </div>
            <TrendChart data={series} color={colors[p] || '#888'} height={140} />
          </div>
        )
      })}
    </div>
  )
}
