import { Activity, RefreshCw } from 'lucide-react'
const LABELS = { facebook:'FB', instagram:'IG', youtube:'YT', searchConsole:'GSC', linkedin:'LI', pinterest:'PI' }
const DOT = { ok:'bg-green-400', failed:'bg-red-400', no_account:'bg-yellow-400', not_configured:'bg-gray-600' }

export default function TopBar({ health, lastUpdated, refreshing, onRefresh }) {
  const p = health?.data?.platforms || {}
  return (
    <div className="border-b border-hairline bg-ink/90 backdrop-blur sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-11 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-amber" strokeWidth={2} /><span className="eyebrow">pulse</span></div>
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="hidden sm:flex items-center gap-2">
            {Object.entries(LABELS).map(([k, l]) => {
              const s = p[k]
              const isOk = s === 'ok' || s?.startsWith('ok')
              const isErr = typeof s === 'string' && s !== 'ok' && s !== 'not_configured' && s !== 'no_account' && !s?.startsWith('ok')
              return <div key={k} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-green-400' : isErr ? 'bg-red-400' : s === 'no_account' || s === 'not_configured' ? 'bg-yellow-400' : 'bg-gray-600'}`} /><span className="text-[10px] font-mono text-text-muted">{l}</span></div>
            })}
          </div>
          <span className="hidden md:inline text-[10px] font-mono text-text-faint">{lastUpdated ? 'sync ' + lastUpdated.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : 'connecting…'}</span>
          <button onClick={onRefresh} className="text-text-muted hover:text-amber"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
    </div>
  )
}
