import TrendChart from './TrendChart'
import { EmptyState } from './States'
import { primaryMetricLabel } from '../utils/format'

const CONFIG = {
  facebook: { label: 'Facebook', color: '#2E7CF6' },
  instagram: { label: 'Instagram', color: '#DD2A7B' },
  youtube: { label: 'YouTube', color: '#FF3B4E' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2' },
  pinterest: { label: 'Pinterest', color: '#E60023' },
  searchConsole: { label: 'Search Console', color: '#34A853' },
}

export default function OverviewTrends({ platformData }) {
  const platforms = Object.keys(CONFIG).filter(p => platformData?.[p] && !platformData[p].error)

  if (platforms.length === 0) return <EmptyState message="No platform data available for this range." />

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {platforms.map(p => {
        const payload = platformData[p]
        const metric = primaryMetricLabel(payload.overview, payload)
        const series = buildSeries(payload, metric?.key)
        return (
          <div key={p} className="panel p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-display font-medium text-text">{CONFIG[p].label}</span>
              <span className="text-[11px] font-mono text-text-faint">{metric?.label||'—'}</span>
            </div>
            {series.length > 0 ? (
              <TrendChart data={series} color={CONFIG[p].color} height={160} />
            ) : (
              <div className="flex items-center justify-center" style={{height:160}}>
                <p className="text-xs text-text-faint font-mono">No chart data yet</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function buildSeries(payload, overviewKey) {
  if (payload.metrics && overviewKey) {
    const idGuess = {
      followers:['page_follows','follower_count'],engagement:['page_post_engagements','total_interactions'],
      reach:['reach'],views:['views'],pageViews:['page_views_total'],subsGained:['subscribersGained'],
    }[overviewKey]||[]
    const m = payload.metrics?.find(m=>idGuess.includes(m.id)) || payload.metrics?.[0]
    if (m) return m.values.map(v=>({date:v.date,value:v.value}))
  }
  if (payload.timeseries) {
    return payload.timeseries.map(r=>{
      const val=r.clicks||r.impressions||r.reach||r.likes||r.views||r.page_views_total||r.page_media_view||r.postCount||0
      return {date:r.date,value:val}
    }).filter(v=>v.value>0)
  }
  return []
}
