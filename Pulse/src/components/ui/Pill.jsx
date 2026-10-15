import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle2, CircleSlash, PlugZap, Info } from 'lucide-react'
import { cls } from '../../lib/cls'
import { signedPercent, trendTone } from '../../lib/format'

const TONES = {
  pos: 'bg-pos-soft text-pos border-pos-line',
  neg: 'bg-neg-soft text-neg border-neg-line',
  flat: 'bg-sunken text-muted border-line',
  brand: 'bg-brand-soft text-brand-ink border-brand-line',
  warn: 'bg-warn-soft text-warn border-warn-line',
  neutral: 'bg-sunken text-body border-line2',
}

export function Pill({ tone = 'neutral', children, className = '', icon = null }) {
  return (
    <span className={cls('chip', TONES[tone] || TONES.neutral, className)}>
      {icon}
      {children}
    </span>
  )
}

/**
 * TrendPill — renders a metric's % change with the correct polarity.
 * `lowerIsBetter` metrics (GSC average position) flip the colour, not the sign.
 */
export function TrendPill({ metric, className = '', showFlat = true, compactLabel = false }) {
  const tone = trendTone(metric)
  const t = metric?.trend
  if (t === null || t === undefined || Number.isNaN(t)) return null
  if (t === 0 && !showFlat) return null

  const Icon = tone === 'pos' ? ArrowUpRight : tone === 'neg' ? ArrowDownRight : Minus
  return (
    <span
      className={cls(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold num border',
        TONES[tone],
        className
      )}
      title={
        metric?.previous !== null && metric?.previous !== undefined
          ? `Previous period: ${metric.previous}`
          : 'Change vs. the first half of this range'
      }
    >
      <Icon className="w-3 h-3" strokeWidth={2.5} />
      {compactLabel ? (t > 0 ? 'up' : t < 0 ? 'down' : 'flat') : signedPercent(t)}
    </span>
  )
}

const STATUS_MAP = {
  ok: { tone: 'pos', Icon: CheckCircle2, label: 'Connected' },
  empty: { tone: 'warn', Icon: Info, label: 'No data' },
  error: { tone: 'neg', Icon: AlertTriangle, label: 'Error' },
  unconfigured: { tone: 'neutral', Icon: PlugZap, label: 'Not configured' },
  loading: { tone: 'brand', Icon: CircleSlash, label: 'Loading' },
  unknown: { tone: 'neutral', Icon: CircleSlash, label: 'Unknown' },
}

export function StatusPill({ status = 'unknown', label, className = '', dot = false }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.unknown
  if (dot) {
    return (
      <span className={cls('inline-flex items-center gap-1.5', className)}>
        <span
          className={cls(
            'w-1.5 h-1.5 rounded-full',
            status === 'ok' ? 'bg-pos' : status === 'error' ? 'bg-neg' : status === 'empty' ? 'bg-warn' : 'bg-faint'
          )}
        />
        <span className="text-[11px] font-medium text-muted">{label || cfg.label}</span>
      </span>
    )
  }
  return (
    <Pill tone={cfg.tone} className={className} icon={<cfg.Icon className="w-3 h-3" strokeWidth={2.2} />}>
      {label || cfg.label}
    </Pill>
  )
}

/** Small uppercase tag used for sources / groups ("Zernio", "Audience"). */
export function Tag({ children, className = '', color }) {
  return (
    <span
      className={cls('inline-flex items-center rounded-md bg-sunken border border-line px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted', className)}
      style={color ? { color, borderColor: `${color}33`, background: `${color}0F` } : undefined}
    >
      {children}
    </span>
  )
}
