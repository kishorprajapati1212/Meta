import { cls } from '../../lib/cls'

/**
 * Card — the single surface primitive. Everything on the dashboard is a Card
 * with a title row and a body, so spacing/radius/shadow stay consistent.
 */
export function Card({ children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={cls('card', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function CardHeader({ title, sub, right, icon, className = '', pad = true }) {
  return (
    <div className={cls('flex items-start justify-between gap-4 border-b border-line', pad && 'px-5 py-3.5', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon ? <span className="mt-0.5 shrink-0 text-muted">{icon}</span> : null}
        <div className="min-w-0">
          <h3 className="section-title truncate">{title}</h3>
          {sub ? <p className="section-sub mt-0.5 leading-snug">{sub}</p> : null}
        </div>
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
    </div>
  )
}

export function CardBody({ children, className = '' }) {
  return <div className={cls('p-5', className)}>{children}</div>
}

export function CardFooter({ children, className = '' }) {
  return <div className={cls('border-t border-line px-5 py-3', className)}>{children}</div>
}

/** Labelled block used inside panels (e.g. "Source · Zernio"). */
export function Field({ label, children, className = '' }) {
  return (
    <div className={cls('min-w-0', className)}>
      <p className="eyebrow mb-1">{label}</p>
      <div className="text-[13px] text-ink font-medium truncate">{children}</div>
    </div>
  )
}
