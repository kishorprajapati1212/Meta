import { ArrowUpRight, ArrowDownRight, Facebook, Instagram, Youtube, Linkedin, Image, Search, AlertTriangle } from 'lucide-react'
import Sparkline from './Sparkline'
import { formatCompact, formatTrend, primaryMetricLabel } from '../utils/format'

const CONFIG = {
  facebook: { label: 'Facebook', Icon: Facebook, color: '#2E7CF6' },
  instagram: { label: 'Instagram', Icon: Instagram, color: '#DD2A7B' },
  youtube: { label: 'YouTube', Icon: Youtube, color: '#FF3B4E' },
  linkedin: { label: 'LinkedIn', Icon: Linkedin, color: '#0A66C2' },
  pinterest: { label: 'Pinterest', Icon: Image, color: '#E60023' },
  searchConsole: { label: 'GSC', Icon: Search, color: '#34A853' },
}

export default function PlatformCard({ platform, payload, onSelect, active }) {
  const cfg = CONFIG[platform]
  const isError = !payload || payload.success === false || payload.error
  const overview = payload?.overview
  const metric = primaryMetricLabel(overview, payload)
  const trend = metric?.trend ?? 0
  const isUp = trend >= 0

  const sparkData = (() => {
    if (!payload?.timeseries) return []
    if (payload.metrics && metric?.key && ['followers','engagement','reach','views','pageViews','subsGained','impressions','clicks','likes','comments'].includes(metric.key)) {
      const idGuess = {
        followers:['page_follows','follower_count'],engagement:['page_post_engagements','total_interactions'],
        reach:['reach'],views:['views'],pageViews:['page_views_total'],subsGained:['subscribersGained'],
        impressions:['impressions'],clicks:['clicks'],likes:['likes'],comments:['comments'],
      }[metric.key] || []
      const m = payload.metrics?.find(m => idGuess.includes(m.id))
      if (m) return m.values.map(v => ({date:v.date,value:v.value}))
    }
    return payload.timeseries.map(r => {
      const val = r.clicks || r.impressions || r.reach || r.likes || r.views || r.page_views_total || r.engagement || r.postCount || 0
      return {date:r.date,value:val}
    }).filter(v => v.value > 0)
  })()

  return (
    <button onClick={() => onSelect(platform)}
      className={`text-left panel p-4 flex flex-col gap-3 transition-all hover:border-hairline2 group relative overflow-hidden ${active?'ring-1 ring-amber/50 border-amber/40':''}`}
      style={{borderTopColor:cfg.color,borderTopWidth:2}}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <cfg.Icon className="w-3.5 h-3.5" style={{color:cfg.color}} strokeWidth={2}/>
          <span className="text-xs font-display font-medium text-text">{cfg.label}</span>
        </div>
        {isError ? (
          <AlertTriangle className="w-3.5 h-3.5 text-bad" strokeWidth={2}/>
        ) : metric ? (
          <div className={`flex items-center gap-0.5 text-[10px] font-mono ${isUp?'text-good':'text-bad'}`}>
            {isUp?<ArrowUpRight className="w-3 h-3"/>:<ArrowDownRight className="w-3 h-3"/>}
            {formatTrend(trend)}
          </div>
        ) : null}
      </div>
      {isError ? (
        <div className="py-2"><p className="text-[11px] text-text-faint font-mono leading-relaxed">{typeof payload?.error==='string'?payload.error.slice(0,80):payload?.error?.message?.slice(0,80)||'Unavailable'}</p></div>
      ) : (
        <>
          <div>
            <p className="font-display text-2xl font-semibold text-text tabular-nums">{metric?formatCompact(metric.total):'—'}</p>
            <p className="text-[10px] text-text-muted mt-0.5">{metric?.label||'No data'}</p>
          </div>
          <Sparkline data={sparkData} color={cfg.color} height={36}/>
        </>
      )}
    </button>
  )
}
