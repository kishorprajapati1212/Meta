import { ExternalLink } from 'lucide-react'
import { cls } from '../../lib/cls'
import { compact } from '../../lib/format'

/**
 * BarList — ranked horizontal bars. Used for top keywords, top pages,
 * countries, devices and boards, where a table alone doesn't show share.
 */
export default function BarList({
  items = [],
  color = '#2F6BFF',
  valueKey = 'value',
  labelKey = 'label',
  format = compact,
  secondary = null,
  max: forcedMax = null,
  emptyMessage = 'No rows to rank in this range.',
  className = '',
  showShare = false,
}) {
  if (!items.length) {
    return <p className={cls('text-[13px] text-faint py-8 text-center', className)}>{emptyMessage}</p>
  }
  const max = forcedMax ?? Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1)
  const total = items.reduce((s, i) => s + (Number(i[valueKey]) || 0), 0)

  return (
    <ul className={cls('flex flex-col gap-2.5', className)}>
      {items.map((item, i) => {
        const value = Number(item[valueKey]) || 0
        const pct = (value / max) * 100
        const label = item[labelKey] ?? item.label ?? `#${i + 1}`
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[12.5px] font-medium text-ink truncate" title={String(label)}>
                {item.rank ? <span className="num text-faint mr-1.5">{item.rank}.</span> : null}
                {String(label)}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {showShare && total > 0 ? (
                  <span className="text-[11px] text-faint num">{Math.round((value / total) * 1000) / 10}%</span>
                ) : null}
                {secondary ? <span className="text-[11.5px] text-muted num">{secondary(item)}</span> : null}
                <span className="text-[12.5px] font-semibold text-ink num">{format(value)}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-line/80 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, background: item.color || color, opacity: 0.9 - i * 0.02 }}
              />
            </div>
            {item.footnote ? <p className="text-[11px] text-faint mt-1 num">{item.footnote}</p> : null}
          </>
        )
        return (
          <li key={item.id ?? `${label}-${i}`}>
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-sunken transition-colors group"
              >
                {content}
                <ExternalLink className="hidden w-3 h-3 text-faint group-hover:inline" />
              </a>
            ) : (
              <div className="px-2 py-1.5 -mx-2">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
