import { useMemo, useState } from 'react'
import {
  Sprout,
  Compass,
  Target,
  CalendarCheck2,
  Flame,
  Lightbulb,
  Globe2,
  ArrowRight,
  PenLine,
  MessageSquareHeart,
  PlugZap,
  TrendingUp,
} from 'lucide-react'
import { Panel as Card } from '../ui/Card'
import { Pill } from '../ui/Pill'
import { compact, percent } from '../../lib/format'
import { flagOf, nameOf, codeOf } from '../../lib/countries'
import { cls } from '../../lib/cls'

/**
 * OverviewExtras — the layer that makes a young channel look like a business
 * instead of a wall of zeros.
 *
 * A channel in the awareness stage legitimately has zero engagement, so a
 * dashboard that leads with six empty KPI cards reads as broken. These panels
 * lead with the numbers that ARE real at that stage — audience size, publishing
 * consistency, geography, milestones — and put the zeros in context with an
 * honest explanation of what moves them.
 */

const STAGE_META = {
  awareness: { Icon: Sprout, color: '#2F6BFF', tint: '#EAF0FF', step: 1 },
  consideration: { Icon: Compass, color: '#C8871B', tint: '#FFF7E8', step: 2 },
  conversion: { Icon: Target, color: '#12924F', tint: '#E7F6EE', step: 3 },
}

// A sustainable cadence for a small team: three publishing days a week.
const TARGET_DAYS_PER_WEEK = 3

// ────────────────────────────────────────────────────────────────────────────
export function StageHero({ stage, summary, calendar, lastPostDays, onNavigate }) {
  const meta = STAGE_META[stage.stage] || STAGE_META.awareness
  const Icon = meta.Icon
  const targetDays = Math.round((calendar.length / 7) * TARGET_DAYS_PER_WEEK)
  const cadencePct = targetDays > 0 ? Math.min(1, stage.activeDays / targetDays) : 0
  const audience = summary?.totals?.audience || 0
  const posts = summary?.totals?.posts || 0
  const connected = summary?.connected || 0

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_1.1fr] gap-6 lg:gap-8">
        {/* Stage */}
        <div className="flex flex-col justify-between gap-4 rounded-xl p-4" style={{ background: meta.tint }}>
          <div>
            <p className="eyebrow" style={{ color: meta.color }}>Growth stage</p>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: meta.color, color: '#fff' }}>
                <Icon className="w-5 h-5" strokeWidth={2.2} />
              </span>
              <h2 className="text-[26px] leading-none font-bold tracking-tight text-ink">{stage.label}</h2>
            </div>
            <p className="mt-2.5 max-w-[46ch] text-[12.5px] leading-relaxed text-body">{stage.blurb}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {['Awareness', 'Consideration', 'Conversion'].map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: i + 1 === meta.step ? 26 : 12, background: i + 1 <= meta.step ? meta.color : '#C9D3E0' }}
                />
              </div>
            ))}
            <span className="ml-2 text-[10.5px] font-medium text-faint">stage {meta.step} of 3</span>
          </div>
        </div>

        {/* Consistency */}
        <div className="flex flex-col gap-3">
          <p className="eyebrow">Showing up</p>
          <div className="flex items-end gap-2">
            <span className="num text-[34px] leading-none font-bold text-ink">{stage.activeDays}</span>
            <span className="pb-1 text-[12px] text-muted">publishing days / {stage.window}</span>
          </div>
          <div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className="rounded-full transition-all"
                style={{ width: `${cadencePct * 100}%`, background: cadencePct >= 0.8 ? '#12924F' : cadencePct >= 0.4 ? '#C8871B' : '#2F6BFF' }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">
              {Math.round(cadencePct * 100)}% of a sustainable cadence ({TARGET_DAYS_PER_WEEK} publishing days/week)
            </p>
          </div>
          <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <Flame className={cls('w-4 h-4', lastPostDays === 0 || lastPostDays === 1 ? 'text-warn' : 'text-faint')} />
              <div>
                <p className="num text-[15px] font-semibold leading-tight text-ink">{lastPostDays === null ? '—' : `${lastPostDays}d`}</p>
                <p className="text-[10.5px] text-faint">since last post</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-faint" />
              <div>
                <p className="num text-[15px] font-semibold leading-tight text-ink">{posts}</p>
                <p className="text-[10.5px] text-faint">published in range</p>
              </div>
            </div>
          </div>
        </div>

        {/* Headline numbers that are real even at zero engagement */}
        <div className="flex flex-col gap-3">
          <p className="eyebrow">What you have built</p>
          <div className="grid grid-cols-3 gap-3">
            <HeroStat label="Audience" value={audience} sub="followers + subs" tone="#2F6BFF" />
            <HeroStat label="Content" value={posts} sub="pieces published" tone="#7C3AED" />
            <HeroStat label="Channels" value={connected} sub="connected" tone="#12924F" />
          </div>
          {stage.milestone && (
            <div className="rounded-lg border border-line bg-sunken/50 p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-[11.5px] font-semibold text-body">Next audience milestone</p>
                <p className="num text-[11.5px] text-muted">
                  {compact(audience)} / {compact(stage.milestone.next)}
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(stage.milestone.progress * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-faint">
                {compact(stage.milestone.next - audience)} to go — every publish-and-reply cycle moves this bar.
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function HeroStat({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="num mt-1 text-[24px] leading-none font-bold" style={{ color: tone }}>{compact(value)}</p>
      <p className="mt-1 text-[10.5px] text-faint">{sub}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
/** GitHub-style publishing calendar. Honest signal for a channel with no engagement yet. */
export function ActivityHeat({ calendar, streaks }) {
  const [hover, setHover] = useState(null)
  const weeks = useMemo(() => {
    const out = []
    // Pad the first week so columns line up with weekdays.
    const first = new Date(calendar[0]?.date || Date.now())
    const pad = (first.getUTCDay() + 6) % 7 // Monday-first
    let cur = []
    for (let i = 0; i < pad; i++) cur.push(null)
    for (const day of calendar) {
      cur.push(day)
      if (cur.length === 7) {
        out.push(cur)
        cur = []
      }
    }
    if (cur.length) {
      while (cur.length < 7) cur.push(null)
      out.push(cur)
    }
    return out
  }, [calendar])

  const months = useMemo(() => {
    const seen = []
    for (const week of weeks) {
      const first = week.find(Boolean)
      if (!first) continue
      const m = new Date(first.date).toLocaleString('en', { month: 'short', timeZone: 'UTC' })
      if (seen[seen.length - 1] !== m) seen.push(m)
      else seen.push(null)
    }
    return seen
  }, [weeks])

  const shade = (count) => {
    if (!count) return '#EDF1F7'
    if (count === 1) return '#BFD4FF'
    if (count === 2) return '#7FA8FF'
    if (count <= 4) return '#2F6BFF'
    return '#1D4FD7'
  }

  return (
    <Card
      title="Publishing calendar"
      sub="One square per day, darker = more published. Consistency is the metric you control completely."
      icon={<CalendarCheck2 className="w-4 h-4" strokeWidth={2.2} />}
      right={
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1"><Flame className="w-3.5 h-3.5 text-warn" /> best streak {streaks.best}d</span>
          <span className="flex items-center gap-1.5">
            less
            {[0, 1, 2, 3, 5].map((c) => (
              <i key={c} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: shade(c) }} />
            ))}
            more
          </span>
        </div>
      }
    >
      <div className="relative overflow-x-auto pb-1">
        <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 13 }}>
          {months.map((m, i) => (
            <span key={i} className="w-[10px] shrink-0 text-[9.5px] text-faint" style={{ width: 13 }}>
              {m || ''}
            </span>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) =>
                day ? (
                  <button
                    key={day.date}
                    className="h-[10px] w-[10px] rounded-[3px] transition-transform hover:scale-125"
                    style={{ background: shade(day.count) }}
                    onMouseEnter={() => setHover(`${day.date}: ${day.count} published`)}
                    onMouseLeave={() => setHover(null)}
                    aria-label={`${day.date}: ${day.count} published`}
                  />
                ) : (
                  <span key={di} className="h-[10px] w-[10px]" />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 h-4 text-[11px] text-muted">{hover || `${streaks.active} publishing days · current streak ${streaks.current}d`}</p>
    </Card>
  )
}

/** current + best publishing streak in days. */
export function computeStreaks(calendar) {
  let best = 0
  let run = 0
  for (const d of calendar) {
    run = d.count > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  let current = 0
  for (let i = calendar.length - 1; i >= 0; i--) {
    // Allow a 1-day gap today (a streak isn't dead before the day ends).
    if (calendar[i].count > 0) current++
    else if (i === calendar.length - 1) continue
    else break
  }
  return { best, current, active: calendar.filter((d) => d.count > 0).length }
}

// ────────────────────────────────────────────────────────────────────────────
/** Rule-based, data-specific next actions. No generic advice — every line cites a number. */
export function InsightsPanel({ insights, onNavigate }) {
  if (!insights.length) return null
  return (
    <Card title="What to do next" sub="Generated from your own numbers, in priority order." icon={<Lightbulb className="w-4 h-4" strokeWidth={2.2} />}>
      <ul className="flex flex-col gap-2.5">
        {insights.map((ins, i) => {
          const Icon = ins.icon || Lightbulb
          return (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-line bg-white p-3 transition-shadow hover:shadow-lift"
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${ins.color}14`, color: ins.color }}
              >
                <Icon className="w-4 h-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{ins.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{ins.body}</p>
              </div>
              {ins.action ? (
                <button className="btn btn-ghost btn-sm shrink-0" onClick={() => onNavigate?.(ins.action.view)}>
                  {ins.action.label} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Build the insight list from the same view models the page renders. */
export function buildInsights({ stage, lastPostDays, summary, platformData, healthDetails }) {
  const out = []
  const totals = summary?.totals || {}

  if (lastPostDays !== null && lastPostDays > 14) {
    out.push({
      icon: PenLine,
      color: '#DC4849',
      title: `It has been ${lastPostDays} days since anything was published`,
      body: 'Reach decays within two weeks of silence on every platform. One pin, reel or short per publishing day is enough to restart the curve — the calendar above shows exactly which weeks went quiet.',
      action: { view: 'overview', label: 'See calendar' },
    })
  } else if (stage.activeDays === 0) {
    out.push({
      icon: PenLine,
      color: '#C8871B',
      title: 'No publishing days in this window yet',
      body: 'Every metric on this page is downstream of publishing. At the awareness stage the single highest-leverage move is frequency: three publishing days a week for eight weeks is what turns an empty engagement row into a real one.',
    })
  }

  if (totals.impressions > 0 && totals.engagement === 0) {
    out.push({
      icon: MessageSquareHeart,
      color: '#C8871B',
      title: `${compact(totals.impressions)} impressions, zero engagement — that is a hook problem, not a reach problem`,
      body: 'People are seeing the content and scrolling past. Test a stronger first line or first frame, and end every piece with one explicit ask (save, comment a word, click). Engagement rate should clear ~1% before you invest in posting more.',
    })
  }

  for (const row of summary?.platforms || []) {
    if (row.ok) continue
    const detail = healthDetails?.[row.platform]
    out.push({
      icon: PlugZap,
      color: '#DC4849',
      title: `${(platformData?.[row.platform] && 'x') || ''}${row.platform} is not contributing numbers`,
      body: detail?.hint || detail?.message || row.error || 'The channel returned an error for this range.',
      action: { view: 'connections', label: 'Fix connection' },
    })
  }

  const gsc = platformData?.searchConsole
  const gscOverview = gsc?.overview
  if (gscOverview?.impressions?.total > 20 && (gscOverview?.ctr?.total || 0) < 2) {
    out.push({
      icon: TrendingUp,
      color: '#2FA84F',
      title: `Google shows you ${compact(gscOverview.impressions.total)} times but clicks stay at ${percent(gscOverview.ctr.total || 0)} CTR`,
      body: 'High impressions with sub-2% CTR means titles and meta descriptions are losing the results page. Rewrite the five pages with the most impressions to lead with the outcome, not the brand name.',
      action: { view: 'searchConsole', label: 'Open Search Console' },
    })
  }

  if (stage.stage === 'awareness' && stage.milestone) {
    out.push({
      icon: Target,
      color: '#2F6BFF',
      title: `${compact(stage.milestone.next - stage.audience)} people to the ${compact(stage.milestone.next)} milestone`,
      body: 'Milestones beat vanity metrics at this stage: they are the number a collaborator or sponsor asks for. Pin your single best-performing piece and reply to every comment this week — replies are the cheapest follower growth there is.',
      action: { view: 'audience', label: 'See who they are' },
    })
  }

  return out.slice(0, 5)
}

// ────────────────────────────────────────────────────────────────────────────
/** Compact geography teaser that pulls people into the Audience page. */
export function GeoTeaser({ countries, onNavigate }) {
  if (!countries?.length) return null
  const top = countries.slice(0, 5)
  return (
    <Card
      title="Where the audience is"
      sub="Across every channel that reports geography"
      icon={<Globe2 className="w-4 h-4" strokeWidth={2.2} />}
      right={
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.('audience')}>
          Full audience view <ArrowRight className="w-3.5 h-3.5" />
        </button>
      }
    >
      <ul className="flex flex-col gap-2">
        {top.map((c) => {
          const code = codeOf(c.code || c.name)
          return (
            <li key={code || c.name} className="flex items-center gap-2.5">
              <span className="text-[15px] leading-none">{flagOf(code)}</span>
              <span className="flex-1 truncate text-[12.5px] font-medium text-body">{nameOf(c.code || c.name)}</span>
              <span className="num text-[12px] text-muted">{c.channels} channel{c.channels === 1 ? '' : 's'}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (c.channels / top[0].channels) * 100)}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
