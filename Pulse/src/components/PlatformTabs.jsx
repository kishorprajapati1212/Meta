import { LayoutGrid, Facebook, Instagram, Youtube, Linkedin, Image, Search } from 'lucide-react'

const TABS = [
  { key: 'overview', label: 'Overview', Icon: LayoutGrid, color: '#F2A93B' },
  { key: 'facebook', label: 'Facebook', Icon: Facebook, color: '#2E7CF6' },
  { key: 'instagram', label: 'Instagram', Icon: Instagram, color: '#DD2A7B' },
  { key: 'youtube', label: 'YouTube', Icon: Youtube, color: '#FF3B4E' },
  { key: 'linkedin', label: 'LinkedIn', Icon: Linkedin, color: '#0A66C2' },
  { key: 'pinterest', label: 'Pinterest', Icon: Image, color: '#E60023' },
  { key: 'searchConsole', label: 'Search Console', Icon: Search, color: '#34A853' },
]

export default function PlatformTabs({ active, onChange }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
      {TABS.map(t => {
        const isActive = active === t.key
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${
              isActive ? 'bg-surface2 border-hairline2 text-text' : 'border-transparent text-text-muted hover:text-text hover:bg-surface/60'
            }`}
          >
            <t.Icon className="w-3.5 h-3.5" style={{ color: isActive ? t.color : undefined }} strokeWidth={2} />
            {t.label}
            {isActive && <span className="w-1 h-1 rounded-full ml-0.5" style={{ background: t.color }} />}
          </button>
        )
      })}
    </div>
  )
}
