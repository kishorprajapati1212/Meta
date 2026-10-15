import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { formatCompact, formatTrend, primaryMetric } from '../utils/format'
import Sparkline from './Sparkline'

const LABELS = { facebook:'Facebook', instagram:'Instagram', youtube:'YouTube', linkedin:'LinkedIn', pinterest:'Pinterest', searchConsole:'GSC' }

export default function PlatformGrid({ data, colors, onSelect }) {
  if (!data) return null
  const platforms = Object.keys(LABELS)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {platforms.map(p => {
        const d = data[p]
        const isErr = !d || d.error
        const ov = d?.overview || {}
        const m = primaryMetric(ov)
        const trend = m?.trend ?? 0
        const ts = (d?.timeseries || []).map(r => ({ date: r.date, value: r.clicks || r.impressions || r.reach || r.likes || r.views || r.page_views_total || 0 })).filter(v => v.value > 0).slice(-14)

        return (
          <button key={p} onClick={() => onSelect(p)}
            className="text-left panel p-4 flex flex-col gap-3 hover:border-hairline2 transition-all" style={{ borderTopColor: colors[p] || '#888', borderTopWidth: 2 }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">{LABELS[p]}</span>
              {!isErr && m && (
                <span className={`flex items-center gap-0.5 text-[10px] font-mono ${trend >= 0 ? 'text-good' : 'text-bad'}`}>
                  {trend > 0 ? <ArrowUpRight className="w-3 h-3" /> : trend < 0 ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                  {formatTrend(trend)}
                </span>
              )}
            </div>
            {isErr ? (
              <p className="text-[11px] text-text-faint font-mono">{typeof d.error === 'string' ? d.error.slice(0,60) : 'Unavailable'}</p>
            ) : (
              <>
                <p className="text-2xl font-bold text-text tabular-nums">{m ? formatCompact(m.total) : '—'}</p>
                <Sparkline data={ts} color={colors[p] || '#888'} height={32} />
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
