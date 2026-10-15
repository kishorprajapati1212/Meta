import { useState } from 'react'
import { Calendar } from 'lucide-react'

const PRESETS = [
  { key: 'last_7d', label: '7D' },
  { key: 'last_14d', label: '14D' },
  { key: 'last_30d', label: '30D' },
  { key: 'last_90d', label: '90D' },
]

export default function DateRangeControl({ range, onChange }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const isCustom = Boolean(range.since)

  function applyCustom(e) {
    e.preventDefault()
    if (since && until) {
      onChange({ since, until })
      setCustomOpen(false)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-hairline">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange({ preset: p.key })}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
              range.preset === p.key && !isCustom
                ? 'bg-amber text-ink'
                : 'text-text-muted hover:text-text hover:bg-surface3'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setCustomOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
            isCustom ? 'bg-amber text-ink' : 'text-text-muted hover:text-text hover:bg-surface3'
          }`}
        >
          <Calendar className="w-3 h-3" strokeWidth={2} />
          Custom
        </button>
      </div>

      {customOpen && (
        <form
          onSubmit={applyCustom}
          className="absolute right-0 mt-2 p-4 panel z-40 w-72 animate-rise"
        >
          <p className="eyebrow mb-3">Custom range</p>
          <div className="flex flex-col gap-3">
            <label className="text-xs text-text-muted flex flex-col gap-1">
              Since
              <input
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                required
                className="bg-surface2 border border-hairline2 rounded-lg px-2.5 py-1.5 text-text text-sm font-mono focus:border-amber outline-none"
              />
            </label>
            <label className="text-xs text-text-muted flex flex-col gap-1">
              Until
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                required
                className="bg-surface2 border border-hairline2 rounded-lg px-2.5 py-1.5 text-text text-sm font-mono focus:border-amber outline-none"
              />
            </label>
            <button
              type="submit"
              className="mt-1 bg-amber text-ink text-xs font-semibold rounded-lg py-2 hover:brightness-110 transition"
            >
              Apply range
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
