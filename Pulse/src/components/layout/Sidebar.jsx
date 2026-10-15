import { LayoutGrid, Activity, X, ExternalLink, FlaskConical } from 'lucide-react'
import { cls } from '../../lib/cls'
import { PLATFORM_ORDER, platformMeta } from '../../lib/platforms'
import BrandIcon from '../ui/BrandIcon'
import { isErrorPayload } from '../../lib/normalize'

/**
 * Sidebar — primary navigation. Each platform row carries a live status dot
 * derived from /api/health plus the actual payload state, so a broken token is
 * visible before you click into it.
 */
export default function Sidebar({
  active,
  onChange,
  healthDetails = {},
  platformData = {},
  collapsed = false,
  mobileOpen = false,
  onCloseMobile = () => {},
  sampleMode = false,
  apiBase = '',
  onToggleCollapse = () => {},
}) {
  const items = [
    { key: 'overview', label: 'Overview', Icon: LayoutGrid, color: '#2F6BFF' },
    ...PLATFORM_ORDER.map((key) => ({ key, label: platformMeta(key).label, Brand: key, color: platformMeta(key).color })),
    { key: 'connections', label: 'Connections', Icon: Activity, color: '#6B7A90' },
  ]

  function statusOf(key) {
    if (key === 'overview' || key === 'connections') return null
    const detail = healthDetails[key]
    const payload = platformData[key]
    if (detail && detail.status && detail.status !== 'ok') {
      return detail.configured === false ? 'off' : detail.status === 'no_account' ? 'off' : 'bad'
    }
    if (payload && isErrorPayload(payload)) return 'bad'
    if (detail?.status === 'ok') return 'good'
    return payload ? 'good' : 'idle'
  }

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const isActive = active === item.key
        const status = statusOf(item.key)
        return (
          <button
            key={item.key}
            onClick={() => { onChange(item.key); onCloseMobile() }}
            title={collapsed ? item.label : undefined}
            className={cls(
              'group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all',
              isActive ? 'bg-surface text-ink shadow-card border border-line' : 'text-muted border border-transparent hover:text-ink hover:bg-surface/70',
              collapsed && 'justify-center px-0'
            )}
          >
            <span
              className={cls('flex items-center justify-center w-6 h-6 rounded-lg shrink-0 transition-colors')}
              style={{
                background: isActive ? `${item.color}14` : 'transparent',
                color: isActive ? item.color : undefined,
              }}
            >
              {item.Brand ? <BrandIcon platform={item.Brand} className="w-[15px] h-[15px]" /> : <item.Icon className="w-4 h-4" strokeWidth={2} />}
            </span>
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {status && !collapsed ? (
              <span className="ml-auto flex items-center gap-1.5">
                {sampleMode ? null : (
                  <span
                    className={cls(
                      'w-1.5 h-1.5 rounded-full',
                      status === 'good' && 'bg-pos',
                      status === 'bad' && 'bg-neg',
                      status === 'off' && 'bg-faint/60',
                      status === 'idle' && 'bg-line2'
                    )}
                    title={
                      status === 'good' ? 'Connected' : status === 'bad' ? 'Error — see Connections' : status === 'off' ? 'Not configured' : 'Unknown'
                    }
                  />
                )}
              </span>
            ) : null}
            {status && collapsed ? (
              <span
                className={cls(
                  'absolute right-1.5 top-1.5 w-1.5 h-1.5 rounded-full',
                  status === 'good' && 'bg-pos',
                  status === 'bad' && 'bg-neg',
                  status === 'off' && 'bg-faint/60',
                  status === 'idle' && 'bg-line2'
                )}
              />
            ) : null}
          </button>
        )
      })}
    </nav>
  )

  const inner = (
    <div className="flex flex-col h-full">
      <div className={cls('flex items-center gap-2.5 px-3 py-4', collapsed && 'justify-center px-0')}>
        <span className="w-8 h-8 rounded-[10px] bg-brand flex items-center justify-center shadow-card shrink-0">
          <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l4.5-6 4 4L17 6l4 8" />
          </svg>
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="font-display font-extrabold text-[15px] text-ink leading-tight">Pulse</p>
            <p className="text-[10.5px] text-faint font-medium leading-tight">Social &amp; SEO analytics</p>
          </div>
        ) : null}
        {!collapsed ? (
          <button className="btn-ghost ml-auto lg:hidden" onClick={onCloseMobile} aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {!collapsed ? <p className="eyebrow px-3 pt-2 pb-1.5">Channels</p> : null}
      <div className="px-2 flex-1 overflow-y-auto no-scrollbar">{nav}</div>

      <div className={cls('px-3 py-3 border-t border-line flex flex-col gap-2', collapsed && 'items-center px-1')}>
        {sampleMode ? (
          <span className={cls('chip bg-warn-soft text-warn border-warn-line w-full justify-center', collapsed && 'w-8 h-8 p-0 rounded-lg')} title="Sample data mode is on — numbers are generated locally">
            <FlaskConical className="w-3 h-3" strokeWidth={2.2} />
            {!collapsed ? 'Sample data' : null}
          </span>
        ) : null}
        {!collapsed ? (
          <>
            <p className="text-[10.5px] text-faint truncate" title={apiBase}>
              API · {apiBase.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'same origin'}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-[11.5px] px-1.5" onClick={onToggleCollapse} title="Collapse sidebar">
                <span className="inline-block rotate-180">›</span> Collapse
              </button>
            </div>
          </>
        ) : (
          <button className="btn-ghost text-[11.5px]" onClick={onToggleCollapse} title="Expand sidebar">
            ›
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside
        className={cls(
          'hidden lg:block sticky top-0 h-screen shrink-0 border-r border-line bg-canvas transition-all duration-200',
          collapsed ? 'w-[68px]' : 'w-[236px]'
        )}
      >
        {inner}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-ink/25 backdrop-blur-[1px] animate-fade" onClick={onCloseMobile} />
          <aside className="relative w-[262px] h-full bg-canvas border-r border-line shadow-pop animate-rise">
            {inner}
          </aside>
        </div>
      ) : null}
    </>
  )
}
