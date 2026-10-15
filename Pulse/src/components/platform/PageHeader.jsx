import { cls } from '../../lib/cls'
import BrandIcon from '../ui/BrandIcon'
import { Pill, StatusPill, Tag } from '../ui/Pill'
import { compact, relativeTime, full } from '../../lib/format'
import { ExternalLink } from 'lucide-react'

/**
 * PageHeader — the channel header on every platform page: avatar/brand mark,
 * name, handle, source API, connection status and the account-level stats the
 * backend exposes (lifetime views, pins, boards, monthly views…).
 */
export default function PageHeader({
  platformKey,
  account = null,
  status = 'ok',
  statusLabel,
  source,
  dateRange = null,
  lastSyncedAt = null,
  blurb,
  right = null,
  state,
}) {
  const meta = { label: platformKey, color: '#6B7A90', ...(PLATFORM_COLORS[platformKey] || {}) }
  const stats = account?.stats || []

  return (
    <div className="card overflow-hidden">
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${meta.color}, ${meta.color}55)` }} />
      <div className="p-5 flex flex-wrap items-start gap-4">
        <span
          className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border"
          style={{ background: account?.picture ? 'transparent' : `${meta.color}12`, borderColor: `${meta.color}30` }}
        >
          {account?.picture ? (
            <img src={account.picture} alt="" className="w-12 h-12 rounded-2xl object-cover" />
          ) : (
            <BrandIcon platform={platformKey} className="w-6 h-6" style={{ color: meta.color }} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[19px] font-bold text-ink truncate">
              {account?.name || meta.label}
            </h2>
            <StatusPill status={status} label={statusLabel} />
            {state === 'empty' ? <Pill tone="warn">No activity in range</Pill> : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[12.5px] text-muted">
            {account?.handle ? <span className="font-medium text-body">@{String(account.handle).replace(/^@/, '')}</span> : null}
            {account?.category ? <span className="text-faint">· {account.category}</span> : null}
            {source ? <Tag>{source}</Tag> : null}
            {account?.followers ? (
              <span className="num" title="Current follower/subscriber count">
                {compact(account.followers)} followers
              </span>
            ) : null}
            {dateRange?.from ? (
              <span className="num text-faint">
                {dateRange.from} → {dateRange.to}
              </span>
            ) : null}
            {lastSyncedAt ? <span className="text-faint">synced {relativeTime(lastSyncedAt)}</span> : null}
            {account?.link ? (
              <a
                href={account.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-ink hover:underline font-medium"
              >
                View profile <ExternalLink className="w-3 h-3" strokeWidth={2} />
              </a>
            ) : null}
          </div>

          {blurb ? <p className="text-[12.5px] text-faint mt-1.5">{blurb}</p> : null}

          {stats.length ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3.5 pt-3.5 border-t border-line">
              {stats.map((s) => (
                <div key={s.label}>
                  <p className="eyebrow">{s.label}</p>
                  <p className="text-[15px] font-semibold text-ink num mt-0.5" title={full(s.value)}>
                    {compact(s.value)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
      </div>
    </div>
  )
}

const PLATFORM_COLORS = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  youtube: { label: 'YouTube', color: '#FF0033' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2' },
  pinterest: { label: 'Pinterest', color: '#E60023' },
  searchConsole: { label: 'Search Console', color: '#2FA84F' },
}

export { cls }
