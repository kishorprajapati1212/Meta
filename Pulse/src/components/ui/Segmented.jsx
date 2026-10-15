import { cls } from '../../lib/cls'

/**
 * Segmented — pill-group control used for date presets, chart modes and the
 * GSC dimension switcher.
 */
export default function Segmented({ options, value, onChange, size = 'md', className = '', ariaLabel }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[12.5px]'
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cls('inline-flex items-center gap-0.5 rounded-xl border border-line bg-sunken p-0.5 overflow-x-auto no-scrollbar', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            title={o.title || o.label}
            onClick={() => onChange(o.value)}
            className={cls(
              'relative whitespace-nowrap rounded-[10px] font-medium transition-all',
              pad,
              active
                ? 'bg-surface text-ink shadow-card border border-line'
                : 'text-muted border border-transparent hover:text-ink hover:bg-surface/60'
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {o.icon}
              {o.label}
              {o.badge !== undefined && o.badge !== null ? (
                <span
                  className={cls(
                    'num rounded-full px-1.5 text-[10px] font-semibold',
                    active ? 'bg-brand-soft text-brand-ink' : 'bg-line text-muted'
                  )}
                >
                  {o.badge}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
