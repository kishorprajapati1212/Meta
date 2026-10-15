import { AlertTriangle, Inbox, PlugZap, RefreshCw, Info, Loader2 } from 'lucide-react'
import { cls } from '../../lib/cls'

export function Skeleton({ className = '' }) {
  return <div className={cls('skeleton', className)} />
}

/** Card-shaped skeleton so the layout never jumps when data lands. */
export function KpiSkeleton({ count = 6, className = '' }) {
  return (
    <div className={cls('grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

export function PanelSkeleton({ rows = 6, className = '' }) {
  return (
    <div className={cls('card p-5 flex flex-col gap-3', className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-56 w-full rounded-lg" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  )
}

export function LoadingBlock({ label = 'Loading analytics…', className = '' }) {
  return (
    <div className={cls('card p-10 flex flex-col items-center justify-center gap-3 text-center', className)}>
      <Loader2 className="w-5 h-5 text-brand animate-spin" strokeWidth={2.2} />
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  )
}

export function EmptyState({ title = 'No data yet', message, hint, action, icon: Icon = Inbox, className = '' }) {
  return (
    <div className={cls('flex flex-col items-center justify-center text-center px-6 py-12 gap-3', className)}>
      <span className="w-11 h-11 rounded-full bg-sunken border border-line flex items-center justify-center text-faint">
        <Icon className="w-5 h-5" strokeWidth={1.8} />
      </span>
      <div className="max-w-md">
        <p className="font-display text-[15px] font-bold text-ink">{title}</p>
        {message ? <p className="text-[13px] text-muted mt-1.5 leading-relaxed">{message}</p> : null}
        {hint ? (
          <p className="text-[12px] text-faint mt-2 leading-relaxed bg-sunken border border-line rounded-lg px-3 py-2 text-left">
            {hint}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Could not load this platform', message, hint, onRetry, className = '' }) {
  return (
    <div className={cls('flex flex-col items-center justify-center text-center px-6 py-12 gap-3', className)}>
      <span className="w-11 h-11 rounded-full bg-neg-soft border border-neg-line flex items-center justify-center text-neg">
        <AlertTriangle className="w-5 h-5" strokeWidth={1.9} />
      </span>
      <div className="max-w-lg">
        <p className="font-display text-[15px] font-bold text-ink">{title}</p>
        {message ? <p className="text-[13px] text-body mt-1.5 leading-relaxed break-words">{message}</p> : null}
        {hint ? (
          <p className="text-[12px] text-muted mt-2.5 leading-relaxed bg-warn-soft border border-warn-line rounded-lg px-3 py-2.5 text-left">
            <span className="font-semibold text-warn">How to fix it: </span>
            {hint}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <button className="btn mt-1" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function UnconfiguredState({ platform, message, hint }) {
  return (
    <div className="card p-8 flex flex-col items-center text-center gap-3">
      <span className="w-11 h-11 rounded-full bg-sunken border border-line flex items-center justify-center text-faint">
        <PlugZap className="w-5 h-5" strokeWidth={1.8} />
      </span>
      <div className="max-w-md">
        <p className="font-display text-[15px] font-bold text-ink">{platform} is not connected</p>
        <p className="text-[13px] text-muted mt-1.5">{message}</p>
        {hint ? <p className="text-[12px] text-faint mt-2 leading-relaxed">{hint}</p> : null}
      </div>
    </div>
  )
}

/** Inline notice bar for backend `notice` / partialErrors text. */
export function NoticeBar({ children, tone = 'warn', className = '', icon = null }) {
  const tones = {
    warn: 'bg-warn-soft border-warn-line text-warn',
    info: 'bg-brand-soft border-brand-line text-brand-ink',
    error: 'bg-neg-soft border-neg-line text-neg',
    ok: 'bg-pos-soft border-pos-line text-pos',
  }
  return (
    <div className={cls('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed', tones[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon || <Info className="w-3.5 h-3.5" strokeWidth={2.2} />}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
