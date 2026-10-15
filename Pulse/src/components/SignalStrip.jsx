import { RadioTower, RefreshCw } from 'lucide-react'
import StatusDot from './StatusDot'

const LABELS = { facebook:'FB', instagram:'IG', youtube:'YT', searchConsole:'GSC', linkedin:'LI', pinterest:'PI' }

export default function SignalStrip({ health, lastUpdated, onRefresh, refreshing }) {
  const platforms = health?.data?.platforms || {}
  const stat = (k) => {
    const s = platforms[k]
    if (!s) return 'unknown'
    if (s === 'ok' || (typeof s === 'string' && s.startsWith('ok'))) return 'ok'
    if (s === 'not_configured' || s === 'no_account' || s === 'untested') return 'unknown'
    return 'down'
  }
  return (
    <div className="border-b border-hairline bg-ink/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-11 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <RadioTower className="w-3.5 h-3.5 text-amber" strokeWidth={2}/>
          <span className="eyebrow">signal desk</span>
        </div>
        <div className="flex items-center gap-5">
          <div className="hidden sm:flex items-center gap-3">
            {Object.entries(LABELS).map(([k,l])=>(
              <div key={k} className="flex items-center gap-1">
                <StatusDot status={stat(k)}/>
                <span className="text-[10px] font-mono text-text-muted">{l}</span>
              </div>
            ))}
          </div>
          <div className="hidden md:block text-[11px] font-mono text-text-faint">
            {lastUpdated?`synced ${lastUpdated.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`:'connecting…'}
          </div>
          <button onClick={onRefresh} className="flex items-center gap-1.5 text-[11px] font-mono text-text-muted hover:text-amber transition-colors">
            <RefreshCw className={`w-3 h-3 ${refreshing?'animate-spin':''}`} strokeWidth={2}/>
            <span className="hidden sm:inline">refresh</span>
          </button>
        </div>
      </div>
    </div>
  )
}
