import { Menu, RefreshCw, FlaskConical, Clock3, WifiOff } from 'lucide-react'
import { cls } from '../../lib/cls'
import DateRangePicker from './DateRangePicker'
import { relativeTime } from '../../lib/format'

/**
 * Topbar — sticky bar with the page title, the effective date window, the
 * range picker, sample-data toggle and refresh.
 */
export default function Topbar({
  title,
  subtitle,
  range,
  onRangeChange,
  effectiveRange = null,
  onRefresh,
  refreshing = false,
  lastUpdated = null,
  sampleMode = false,
  onToggleSample = () => {},
  onOpenMobileNav = () => {},
  error = null,
  connected = 0,
  total = 6,
}) {
  return (
    <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md border-b border-line">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
        <button className="btn-ghost lg:hidden -ml-1.5" onClick={onOpenMobileNav} aria-label="Open navigation">
          <Menu className="w-4.5 h-4.5" strokeWidth={2} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-display text-[16px] sm:text-[17px] font-bold text-ink truncate">{title}</h1>
            {sampleMode ? (
              <span className="chip bg-warn-soft text-warn border-warn-line shrink-0" title="Locally generated numbers — not your account">
                <FlaskConical className="w-3 h-3" strokeWidth={2.2} />
                Sample data
              </span>
            ) : null}
            {error ? (
              <span className="chip bg-neg-soft text-neg border-neg-line shrink-0">
                <WifiOff className="w-3 h-3" strokeWidth={2.2} />
                API unreachable
              </span>
            ) : null}
          </div>
          <p className="text-[11.5px] text-muted truncate mt-0.5 flex items-center gap-2">
            {subtitle}
            {lastUpdated ? (
              <span className="inline-flex items-center gap-1 text-faint shrink-0">
                <Clock3 className="w-3 h-3" strokeWidth={2} />
                synced {relativeTime(lastUpdated.toISOString())}
              </span>
            ) : null}
            {!sampleMode && connected < total ? (
              <span className="text-faint shrink-0 num">· {connected}/{total} channels live</span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <DateRangePicker range={range} onChange={onRangeChange} effectiveRange={effectiveRange} />

          <button
            className={cls('btn-ghost', !sampleMode && 'xl:hidden')}
            onClick={onToggleSample}
            title={sampleMode ? 'Switch back to live API data' : 'Preview the dashboard with generated sample data'}
          >
            <FlaskConical className={cls('w-4 h-4', sampleMode && 'text-warn')} strokeWidth={2} />
          </button>
          {!sampleMode ? (
            <button className="btn-ghost hidden xl:inline-flex" onClick={onToggleSample} title="Preview with sample data">
              <FlaskConical className="w-4 h-4" strokeWidth={2} />
              Sample
            </button>
          ) : (
            <button className="btn hidden xl:inline-flex border-warn-line bg-warn-soft text-warn" onClick={onToggleSample}>
              Exit sample
            </button>
          )}

          <button className="btn" onClick={onRefresh} disabled={refreshing} title="Re-fetch everything">
            <RefreshCw className={cls('w-3.5 h-3.5', refreshing && 'animate-spin')} strokeWidth={2} />
            <span className="hidden sm:inline">{refreshing ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
