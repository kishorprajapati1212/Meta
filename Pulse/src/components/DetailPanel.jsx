import { useState } from 'react'
import { formatCompact, formatTrend, formatDateLong } from '../utils/format'
import TrendChart from './TrendChart'
import Sparkline from './Sparkline'

export default function DetailPanel({ platform, payload, color }) {
  if (!payload || payload.error) {
    return <div className="panel p-8 text-center"><p className="text-text-muted font-mono text-sm">{payload?.error || 'No data available'}</p></div>
  }

  const { overview = {}, timeseries = [], metrics = [], topPosts = [], posts = [], notice } = payload
  const [selectedMetric, setSelectedMetric] = useState(metrics[0]?.id || null)
  const metric = metrics.find(m => m.id === selectedMetric) || metrics[0]

  // Render metrics grid
  const renderMetrics = () => {
    if (!metrics.length) return null
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map(m => (
          <button key={m.id} onClick={() => setSelectedMetric(m.id)}
            className={`panel2 p-4 text-left flex flex-col gap-2 hover:border-amber/40 transition-all ${selectedMetric === m.id ? 'ring-1 ring-amber/50' : ''}`}>
            <p className="text-xs text-text-muted">{m.label}</p>
            <p className="text-xl font-bold text-text tabular-nums">{formatCompact(m.summary?.total || m.summary?.latest)}</p>
            <Sparkline data={(m.values||[]).map(v=>({date:v.date,value:v.value})).slice(-14)} color={color} height={24} />
          </button>
        ))}
      </div>
    )
  }

  // Render posts (LinkedIn/Pinterest)
  const renderPosts = () => {
    if (!posts.length) return null
    return (
      <div className="flex flex-col gap-3">
        <p className="eyebrow">Posts ({posts.length})</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {posts.slice(0, 6).map((p, i) => (
            <a key={i} href={p.platformUrl} target="_blank" rel="noopener noreferrer" className="panel2 p-4 flex gap-3 hover:border-hairline2 transition-all">
              {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text line-clamp-2">{p.content || 'No content'}</p>
                <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-text-faint">
                  {p.analytics?.impressions > 0 && <span>{formatCompact(p.analytics.impressions)} imp</span>}
                  {p.analytics?.likes > 0 && <span>{formatCompact(p.analytics.likes)} likes</span>}
                  {p.analytics?.comments > 0 && <span>{formatCompact(p.analytics.comments)} cmts</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {notice && <div className="panel2 p-3 text-[11px] text-amber/90 font-mono">{notice}</div>}

      {/* Overview cards */}
      {Object.keys(overview).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(overview).filter(([k]) => k !== 'channel').slice(0, 8).map(([k, v]) => (
            <div key={k} className="panel2 p-3 text-center">
              <p className="text-xl font-bold text-text tabular-nums">{formatCompact(v.total)}</p>
              <p className="text-[10px] text-text-faint uppercase font-mono">{k}</p>
              {v.trend != null && <span className={`text-[10px] font-mono ${v.trend >= 0 ? 'text-good' : 'text-bad'}`}>{formatTrend(v.trend)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Timeseries chart */}
      {timeseries.length > 0 && (() => {
        const k = Object.keys(overview).filter(k => k !== 'channel')[0]
        const ts = timeseries.map(r => ({ date: r.date, value: r[k] || r.clicks || r.impressions || r.reach || r.likes || r.views || 0 }))
        return (
          <div className="panel p-4">
            <TrendChart data={ts} color={color} height={200} label={k} />
          </div>
        )
      })()}

      {/* Metrics */}
      {renderMetrics()}

      {/* Post feed */}
      {renderPosts()}
    </div>
  )
}
