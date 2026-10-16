import { useEffect, useRef, useState } from 'react'
import { Calendar, Check } from 'lucide-react'
import { cls } from '../../lib/cls'
import { DATE_PRESETS } from '../../lib/platforms'
import { dateLong } from '../../lib/format'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

/**
 * DateRangePicker — presets (7/14/30/90/365) plus a custom since/until pair.
 * Emits the exact query-param shape the API understands:
 *   { preset: 'last_30d' }  or  { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' }
 */
export default function DateRangePicker({ range, onChange, className = '', effectiveRange = null }) {
  const [open, setOpen] = useState(false)
  const [since, setSince] = useState(daysAgo(30))
  const [until, setUntil] = useState(todayStr())
  const boxRef = useRef(null)

  const isCustom = Boolean(range?.since)

  useEffect(() => {
    if (!open) return undefined
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openCustom() {
    if (isCustom) {
      setSince(range.since)
      setUntil(range.until)
    } else if (effectiveRange?.from) {
      setSince(effectiveRange.from)
      setUntil(effectiveRange.to)
    }
    setOpen((v) => !v)
  }

  function apply(e) {
    e.preventDefault()
    if (!since || !until) return
    if (since > until) {
      setSince(until)
      return
    }
    onChange({ since, until })
    setOpen(false)
  }

  const quick = [
    { label: 'Last 7 days', since: daysAgo(7), until: todayStr() },
    { label: 'Last 30 days', since: daysAgo(30), until: todayStr() },
    { label: 'This year', since: `${new Date().getFullYear()}-01-01`, until: todayStr() },
  ]

  return (
    <div className={cls('relative', className)} ref={boxRef}>
      <div className="flex items-center gap-1">
        <div className="hidden sm:inline-flex items-center gap-0.5 rounded-xl border border-line bg-sunken p-0.5">
          {[DATE_PRESETS.find((p) => p.key === 'last_30d'), DATE_PRESETS.find((p) => p.key === 'last_90d'), DATE_PRESETS.find((p) => p.key === 'last_120d'), DATE_PRESETS.find((p) => p.key === 'all_time')].map((p) => (
            <button
              key={p.key}
              onClick={() => onChange({ preset: p.key })}
              className={cls(
                'px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold transition-all num',
                !isCustom && range?.preset === p.key
                  ? 'bg-surface text-ink shadow-card border border-line'
                  : 'text-muted border border-transparent hover:text-ink'
              )}
            >
              {p.key === 'all_time' ? 'All' : p.label.replace(' days', 'D').replace('12 months', '12M')}
            </button>
          ))}
        </div>

        <button
          onClick={openCustom}
          className={cls(
            'btn gap-1.5 whitespace-nowrap',
            isCustom && 'border-brand-line bg-brand-soft text-brand-ink'
          )}
          title="Pick a custom date range"
        >
          <Calendar className="w-3.5 h-3.5" strokeWidth={2} />
          <span className="num hidden md:inline">
            {isCustom
              ? `${dateLong(range.since)} – ${dateLong(range.until)}`
              : effectiveRange?.from
              ? `${dateLong(effectiveRange.from)} – ${dateLong(effectiveRange.to)}`
              : DATE_PRESETS.find((p) => p.key === range?.preset)?.label || 'Last 30 days'}
          </span>
          <span className="sm:hidden num">{isCustom ? 'Custom' : range?.preset?.replace('last_', '').replace('d', 'D') || '30D'}</span>
        </button>
      </div>

      {open ? (
        <form
          onSubmit={apply}
          className="absolute right-0 mt-2 w-[290px] rounded-xl border border-line bg-surface p-4 shadow-pop z-40 animate-rise"
        >
          <p className="eyebrow mb-2">Presets</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.key}
                onClick={() => { onChange({ preset: p.key }); setOpen(false) }}
                className={cls(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold num transition-colors',
                  !isCustom && range?.preset === p.key
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line text-muted hover:border-brand-line hover:text-brand-ink'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="eyebrow mb-3">Custom range</p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-muted">From</span>
              <input type="date" className="input num" value={since} max={until} onChange={(e) => setSince(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-muted">To</span>
              <input type="date" className="input num" value={until} min={since} max={todayStr()} onChange={(e) => setUntil(e.target.value)} required />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="chip bg-sunken text-muted border-line hover:border-brand-line hover:text-brand-ink transition-colors"
                  onClick={() => { setSince(q.since); setUntil(q.until) }}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="btn-primary flex-1">
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                Apply range
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-faint leading-relaxed">
              Search Console data lags 2–3 days, so its window ends earlier than the range you pick.
            </p>
          </div>
        </form>
      ) : null}
    </div>
  )
}
