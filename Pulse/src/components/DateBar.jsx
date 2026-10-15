const TABS = [
  { key:'overview', label:'Overview' },
  { key:'facebook', label:'Facebook', color:'#2E7CF6' },
  { key:'instagram', label:'Instagram', color:'#DD2A7B' },
  { key:'youtube', label:'YouTube', color:'#FF3B4E' },
  { key:'linkedin', label:'LinkedIn', color:'#0A66C2' },
  { key:'pinterest', label:'Pinterest', color:'#E60023' },
  { key:'searchConsole', label:'GSC', color:'#34A853' },
]
const PRESETS = ['last_7d','last_14d','last_30d','last_90d','last_365d']

export default function DateBar({ range, onChange, tab, onTab }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">Pulse</h1>
        <div className="flex items-center gap-1.5 bg-surface2 rounded-lg p-1 border border-hairline">
          {PRESETS.map(p => (
            <button key={p} onClick={() => onChange({ preset: p })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${range.preset === p ? 'bg-ink text-text border border-hairline2' : 'text-text-muted hover:text-text'}`}>
              {p.replace('_',' ')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button key={t.key} onClick={() => onTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${tab === t.key ? 'bg-surface2 border-hairline2 text-text' : 'border-transparent text-text-muted hover:text-text hover:bg-surface/60'}`}
          >
            {t.color && <span className="w-2 h-2 rounded-full" style={{background:t.color}} />}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
