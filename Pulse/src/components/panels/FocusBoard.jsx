import { ArrowRight, Crosshair, Trophy } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { Pill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import BrandIcon from '../ui/BrandIcon'
import { AUDIENCE_OPTIONS } from '../../lib/audience'
import { platformMeta } from '../../lib/platforms'
import { cls } from '../../lib/cls'
import { truncate } from '../../lib/format'

/**
 * FocusBoard — "where should this week go?"
 *
 * Ranks the connected channels by (a) whether they are blocked and (b) whether
 * they reach the audience the content is written for. Unblocking a dead channel
 * that talks to universities beats polishing one that already works, which is
 * the opposite of what a plain follower-count ranking would suggest.
 *
 * Rows come from `data.focus` in GET /api/combined — ranked server-side so the
 * dashboard and the API cannot disagree.
 */

const STAGE_TONE = {
  'no-distribution': 'neg',
  'no-content': 'warn',
  'seen-not-engaged': 'warn',
  'engaged-not-followed': 'warn',
  'no-conversion': 'flat',
  'pending-lag': 'brand',
  healthy: 'pos',
}

const STAGE_LABEL = {
  'no-distribution': 'not distributed',
  'no-content': 'nothing published',
  'seen-not-engaged': 'seen, not engaging',
  'engaged-not-followed': 'not following yet',
  'no-conversion': 'no click-through',
  'pending-lag': 'waiting on reporting',
  healthy: 'working',
}

const FIT_TONE = { high: 'pos', medium: 'warn', low: 'neg' }

export default function FocusBoard({ focus, audience, onAudienceChange, onNavigate, className = '' }) {
  const rows = Array.isArray(focus) ? focus : []
  if (!rows.length) return null
  const top = rows[0]
  const maxScore = rows.reduce((m, r) => Math.max(m, Number(r.score) || 0), 0) || 1

  return (
    <Card className={className}>
      <CardHeader
        icon={<Crosshair className="w-4 h-4" strokeWidth={2.1} aria-hidden="true" />}
        title="Where to focus this week"
        sub={
          audience === 'students'
            ? 'Ranked for reaching students and parents'
            : 'Ranked for reaching universities, colleges and institutes'
        }
        right={
          onAudienceChange ? (
            <Segmented
              size="sm"
              ariaLabel="Who this content targets"
              options={AUDIENCE_OPTIONS}
              value={audience || 'institutions'}
              onChange={onAudienceChange}
            />
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-2.5">
        {top && top.firstAction ? (
          <div className="rounded-xl border border-brand-line bg-brand-soft/40 px-3 py-2 flex items-start gap-2.5">
            <Trophy className="w-4 h-4 shrink-0 text-brand-ink mt-0.5" strokeWidth={2.1} aria-hidden="true" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] font-semibold text-ink">
                Highest-value move: {platformMeta(top.platform).label}
              </span>
              <span className="text-[12.5px] leading-snug text-body line-clamp-1" title={top.firstAction}>
                {top.firstAction}
              </span>
            </div>
          </div>
        ) : null}

        <ol className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {rows.map((r, i) => {
            const meta = platformMeta(r.platform)
            const tone = STAGE_TONE[r.stage] || 'flat'
            const width = Math.max(6, Math.round(((Number(r.score) || 0) / maxScore) * 100))
            const button = typeof onNavigate === 'function'
            const Row = button ? 'button' : 'div'
            return (
              <li key={r.platform}>
                <Row
                  type={button ? 'button' : undefined}
                  onClick={button ? () => onNavigate(r.platform === 'searchConsole' ? 'searchConsole' : r.platform) : undefined}
                  className={cls(
                    'w-full text-left rounded-xl border border-line bg-surface px-3 py-2 flex items-start gap-2.5',
                    button && 'hover:border-line2 hover:bg-sunken transition-colors'
                  )}
                >
                  <span className="num shrink-0 w-5 h-5 rounded-md bg-line2 text-body text-[11px] font-semibold grid place-items-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="shrink-0 mt-0.5" style={{ color: meta.color }}>
                    <BrandIcon platform={r.platform} className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ink">{meta.label}</span>
                      <Pill tone={tone === 'flat' ? 'neutral' : tone} className="text-[10px]">
                        {STAGE_LABEL[r.stage] || r.stage}
                      </Pill>
                      {r.audienceFit ? (
                        <Pill tone={FIT_TONE[r.audienceFit] || 'neutral'} className="text-[10px]">
                          {r.audienceFit} fit
                        </Pill>
                      ) : null}
                      {button ? (
                        <ArrowRight className="w-3.5 h-3.5 text-faint ml-auto shrink-0" strokeWidth={2} aria-hidden="true" />
                      ) : null}
                    </div>
                    <p
                      className="text-[11.5px] leading-snug text-muted line-clamp-2"
                      title={r.headline || r.audienceWhy || ''}
                    >
                      {r.headline || r.audienceWhy || ''}
                    </p>
                    <div className="h-1 rounded-full bg-line overflow-hidden" aria-hidden="true">
                      <div
                        className={cls(
                          'h-full rounded-full',
                          tone === 'neg' ? 'bg-neg' : tone === 'warn' ? 'bg-warn' : tone === 'pos' ? 'bg-pos' : 'bg-brand'
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                </Row>
              </li>
            )
          })}
        </ol>

        <p className="text-[10.5px] leading-snug text-faint">
          Priority = how blocked the channel is × how well it reaches your audience. Open a channel for the full funnel.
        </p>
      </CardBody>
    </Card>
  )
}
