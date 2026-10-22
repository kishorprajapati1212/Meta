import { useState } from 'react'
import {
  Activity, ArrowRight, BadgeCheck, CheckCircle2, ChevronDown, Clock, EyeOff, FileText, Gauge, Info,
  Lightbulb, ListChecks, MessageCircle, MousePointerClick, PlugZap, Target, TrendingUp, UserPlus, Zap,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { Pill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import { cls } from '../../lib/cls'
import { compact, percent, truncate } from '../../lib/format'
import { readPref, writePref, PREF_KEYS } from '../../lib/prefs'

/**
 * DiagnosisPanel — the "why is this 0, and what do I actually do" layer.
 *
 * The numbers are computed server-side (src/utils/diagnosis.js) so the API and
 * the dashboard can never disagree about a diagnosis. This component only
 * renders `payload.data.diagnosis`:
 *
 *   1. the blocked funnel stage  — where the channel dies
 *   2. the funnel itself         — Published → Seen → Engaged → Followers → Clicked
 *   3. "why each card reads 0"   — per metric, grouped by cause
 *   4. the benchmark             — industry reference, always labelled as such
 *   5. next actions              — ordered, with the effort stated
 *
 * Education content aimed at institutions reads very differently from content
 * aimed at students, so the audience target is part of the diagnosis and can be
 * switched right here (`audience` + `onAudienceChange` come from App state and
 * are sent to the API as `?audience=`).
 */

export const AUDIENCE_OPTIONS = [
  {
    value: 'institutions',
    label: 'Universities & institutes',
    title: 'Admissions teams, colleges, schools, coaching institutes, ed-tech buyers',
  },
  {
    value: 'students',
    label: 'Students & parents',
    title: 'Learners, aspirants and the parents who decide for them',
  },
]

const STAGES = {
  unreachable: { tone: 'neg', Icon: PlugZap, label: 'Channel could not be read' },
  'no-content': { tone: 'warn', Icon: FileText, label: 'Nothing published in range' },
  'no-distribution': { tone: 'neg', Icon: Zap, label: 'Published but not distributed' },
  // The platform knows the content (real id + URL, marked synced) but returns no
  // metrics for it — Pinterest does that for non-Business accounts. 0 here means
  // "not measured", which needs a different fix from "nobody saw it".
  'not-reported': { tone: 'warn', Icon: EyeOff, label: 'Platform reports no metrics' },
  'pending-lag': { tone: 'brand', Icon: Clock, label: 'Waiting on platform reporting' },
  'seen-not-engaged': { tone: 'warn', Icon: MessageCircle, label: 'Seen but not engaging' },
  'engaged-not-followed': { tone: 'warn', Icon: UserPlus, label: 'Engaging but not following' },
  'no-conversion': { tone: 'flat', Icon: MousePointerClick, label: 'No click-through yet' },
  healthy: { tone: 'pos', Icon: CheckCircle2, label: 'Working' },
}

// src/utils/diagnosis.js emits ok | zero | unavailable for each funnel stage.
const V_OK = { tone: 'pos', bar: 'bg-pos', text: 'text-pos', label: 'moving' }
const V_ZERO = { tone: 'neg', bar: 'bg-neg', text: 'text-neg', label: 'blocked' }
const V_NA = { tone: 'flat', bar: 'bg-line2', text: 'text-faint', label: 'not published' }
const VERDICT = {
  ok: V_OK, zero: V_ZERO, unavailable: V_NA,
  // tolerated aliases, so an older or newer API cannot grey out the funnel
  pass: V_OK, thin: V_ZERO, fail: V_ZERO, unknown: V_NA,
}

const FIT_TONE = { high: 'pos', medium: 'warn', low: 'neg' }

/** The API sends `yours` already expressed in percent (3.42 → "3.42%"). */
function pct(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return percent(n, n > 0 && n < 1 ? 2 : 1)
}

/** `typical` is prose ("1.9% average · 5.2% for education") — read the first figure. */
function typicalNumber(text) {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(String(text || ''))
  return m ? Number(m[1]) : null
}

function FunnelStrip({ funnel }) {
  if (!Array.isArray(funnel) || !funnel.length) return null
  return (
    <div className="flex items-stretch gap-1.5 overflow-x-auto no-scrollbar pb-1">
      {funnel.map((s, i) => {
        const v = VERDICT[s.verdict] || V_NA
        return (
          <div key={s.key} className="flex items-stretch gap-1.5 shrink-0">
            <div
              className={cls(
                'w-[132px] rounded-xl border border-line bg-sunken px-2.5 py-2 flex flex-col gap-1',
                (s.verdict === 'zero' || s.verdict === 'fail') && 'border-neg-line bg-neg-soft/40'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10.5px] uppercase tracking-wide text-faint">{s.label}</span>
                <span className={cls('w-1.5 h-1.5 rounded-full', v.bar)} aria-hidden="true" />
              </div>
              <span className={cls('num text-[17px] font-semibold leading-none', s.verdict === 'unavailable' ? 'text-faint text-[13px]' : 'text-ink')}>{s.display}</span>
              {s.note ? (
                <span className="text-[10.5px] leading-snug text-muted" title={s.note}>{truncate(s.note, 34)}</span>
              ) : (
                <span className={cls('text-[10.5px] font-medium', v.text)}>{v.label}</span>
              )}
            </div>
            {i < funnel.length - 1 ? (
              <ArrowRight className="w-3.5 h-3.5 self-center text-faint shrink-0" strokeWidth={2} aria-hidden="true" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const ZERO_LIMIT = 6

function ZeroList({ zeros }) {
  if (!Array.isArray(zeros) || !zeros.length) return null
  const shown = zeros.slice(0, ZERO_LIMIT)
  const rest = zeros.length - shown.length
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-line bg-sunken flex items-center gap-2">
        <Info className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} aria-hidden="true" />
        <span className="text-[12px] font-semibold text-body">Why these cards read 0</span>
        <span className="num ml-auto text-[11px] text-faint">{zeros.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((z, i) => (
          <li key={`${z.key}-${i}`} className="px-2.5 py-1.5 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] font-medium text-ink">{z.label}</span>
              <Pill tone="flat" className="text-[10px]">{z.reason.replace(/-/g, ' ')}</Pill>
              {z.source ? <span className="num text-[10px] text-faint">{z.source}</span> : null}
            </div>
            <span className="text-[11.5px] leading-snug text-muted line-clamp-2" title={z.explanation}>
              {z.explanation}
            </span>
          </li>
        ))}
        {rest > 0 ? (
          <li className="px-2.5 py-1.5 text-[11px] text-faint">
            + {rest} more card{rest === 1 ? '' : 's'} read 0 for the same reason — the fix above covers all of them.
          </li>
        ) : null}
      </ul>
    </div>
  )
}

function BenchmarkRow({ benchmark }) {
  if (!benchmark) return null
  const { metric, yours, typical, tier, reference } = benchmark
  const typicalNum = typicalNumber(typical)
  const yoursNum = Number(yours)
  const comparable = typicalNum !== null && Number.isFinite(yoursNum) && yoursNum > 0
  const above = comparable && yoursNum >= typicalNum
  return (
    <div className="rounded-xl border border-line bg-sunken px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Gauge className="w-3.5 h-3.5 text-brand-ink" strokeWidth={2.2} aria-hidden="true" />
        <span className="text-[12px] font-semibold text-body capitalize">{metric} vs the education niche</span>
        {comparable ? (
          <Pill tone={above ? 'pos' : 'warn'} className="text-[10px]">
            {above ? 'at or above reference' : 'below reference'}
          </Pill>
        ) : null}
        {tier ? <span className="num text-[10.5px] text-faint ml-auto">{tier}</span> : null}
      </div>
      {yours === null || yours === undefined ? (
        <p className="text-[11px] leading-snug text-muted">
          No rate yet — there is no reach to divide by. The reference below is the target once this channel is served.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <div className="text-[10.5px] uppercase tracking-wide text-faint">Yours</div>
          <div className="num text-[15px] font-semibold text-ink">{pct(yours)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <div className="text-[10.5px] uppercase tracking-wide text-faint">Typical</div>
          <div className="text-[12.5px] font-medium text-ink leading-snug">{typical || '—'}</div>
        </div>
      </div>
      {reference ? <p className="text-[11px] leading-relaxed text-faint">{reference}</p> : null}
    </div>
  )
}

function ActionList({ actions }) {
  if (!Array.isArray(actions) || !actions.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((a, i) => (
        <div
          key={`${a.title}-${i}`}
          className={cls(
            'rounded-xl border px-2.5 py-2 flex gap-2',
            a.priority === 1 ? 'border-brand-line bg-brand-soft/40' : 'border-line bg-surface'
          )}
        >
          <span
            className={cls(
              'num shrink-0 w-5 h-5 rounded-md text-[11px] font-semibold grid place-items-center mt-0.5',
              a.priority === 1 ? 'bg-brand text-white' : 'bg-line2 text-body'
            )}
          >
            {i + 1}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-semibold text-ink">{a.title}</span>
              {a.effort ? <Pill tone="flat" className="text-[10px]">{a.effort}</Pill> : null}
            </div>
            <span className="text-[11.5px] leading-snug text-muted line-clamp-2" title={a.detail}>
              {a.detail}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DiagnosisPanel({
  diagnosis,
  platformLabel,
  audience,
  onAudienceChange,
  showAudience = true,
  className = '',
}) {
  // Declared before the early return on purpose: this panel is mounted by pages
  // that also render it with no diagnosis at all, and a hook after a conditional
  // return changes the hook order between renders.
  const [open, setOpen] = useState(() => readPref(PREF_KEYS.diagnosisOpen, true))
  if (!diagnosis || !diagnosis.stage) return null
  const stage = STAGES[diagnosis.stage] || STAGES.healthy
  const StageIcon = stage.Icon
  const fit = diagnosis.audienceFit || null
  const zeros = diagnosis.zeros || []
  const actions = diagnosis.actions || []
  const evidence = diagnosis.evidence || {}
  const toggle = () => {
    const next = !open
    setOpen(next)
    writePref(PREF_KEYS.diagnosisOpen, next)
  }

  return (
    <Card className={className}>
      <CardHeader
        icon={<Target className="w-4 h-4" strokeWidth={2.1} aria-hidden="true" />}
        title={platformLabel ? `Growth diagnosis · ${platformLabel}` : 'Growth diagnosis'}
        sub="Why the numbers look like this, and what moves them"
        right={
          showAudience && onAudienceChange ? (
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
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start gap-3 flex-wrap">
          <span
            className={cls(
              'shrink-0 w-9 h-9 rounded-xl grid place-items-center border',
              stage.tone === 'pos' && 'bg-pos-soft border-pos-line text-pos',
              stage.tone === 'warn' && 'bg-warn-soft border-warn-line text-warn',
              stage.tone === 'neg' && 'bg-neg-soft border-neg-line text-neg',
              stage.tone === 'brand' && 'bg-brand-soft border-brand-line text-brand-ink',
              stage.tone === 'flat' && 'bg-sunken border-line text-muted'
            )}
          >
            <StageIcon className="w-4.5 h-4.5" strokeWidth={2.1} aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-[220px] flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={stage.tone === 'flat' ? 'neutral' : stage.tone} icon={<StageIcon className="w-3 h-3" strokeWidth={2.4} />}>
                {stage.label}
              </Pill>
              {fit ? (
                <Pill tone={FIT_TONE[fit.fit] || 'neutral'} icon={<BadgeCheck className="w-3 h-3" strokeWidth={2.2} />}>
                  {fit.fit} fit for {diagnosis.audience === 'students' ? 'students' : 'institutions'}
                </Pill>
              ) : null}
              {evidence.lagging && !evidence.notReported ? (
                <Pill tone="brand" icon={<Clock className="w-3 h-3" strokeWidth={2.2} />}>reporting lag</Pill>
              ) : null}
              {evidence.notReported ? (
                <Pill tone="warn" icon={<EyeOff className="w-3 h-3" strokeWidth={2.2} />}>not measured, not zero</Pill>
              ) : null}
              {evidence.lowReach && evidence.seenPerPost != null ? (
                <Pill tone="neg" icon={<Gauge className="w-3 h-3" strokeWidth={2.2} />}>
                  {evidence.seenPerPost} {evidence.seenKey || 'impressions'} per post
                </Pill>
              ) : null}
            </div>
            <p className="text-[13px] leading-snug text-body line-clamp-2" title={diagnosis.headline}>
              {diagnosis.headline}
            </p>
            {fit && fit.why ? (
              <p className="text-[11.5px] leading-snug text-muted line-clamp-1" title={fit.why}>
                {fit.why}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="diagnosis-detail"
          className="btn w-full justify-center text-[12px]"
        >
          <ChevronDown className={cls('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} strokeWidth={2.2} aria-hidden="true" />
          {open ? 'Collapse the diagnosis' : `Expand: funnel · ${zeros.length} zero reason${zeros.length === 1 ? '' : 's'} · ${actions.length} action${actions.length === 1 ? '' : 's'}`}
        </button>

        {/* Rendered (not unmounted) while collapsed so the whole diagnosis stays
            in the DOM for screen readers, search and the smoke test. */}
        <div id="diagnosis-detail" className={cls('flex-col gap-3', open ? 'flex' : 'hidden')}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-faint" strokeWidth={2.2} aria-hidden="true" />
            <span className="text-[11px] uppercase tracking-wide text-faint font-semibold">Where the funnel stops</span>
          </div>
          <FunnelStrip funnel={diagnosis.funnel} />
        </div>

        {/* Zeros and actions share the row on wide screens: same information,
            roughly half the vertical space. */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-start">
          {zeros.length ? <ZeroList zeros={zeros} /> : null}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-faint" strokeWidth={2.2} aria-hidden="true" />
              <span className="text-[11px] uppercase tracking-wide text-faint font-semibold">Next actions</span>
              <span className="num ml-auto text-[11px] text-faint">{actions.length}</span>
            </div>
            <ActionList actions={actions} />
          </div>
        </div>

        <BenchmarkRow benchmark={diagnosis.benchmark} />

        {diagnosis.mechanics ? (
          <p className="text-[11.5px] leading-snug text-muted flex items-start gap-1.5" title={diagnosis.mechanics}>
            <Lightbulb className="w-3.5 h-3.5 shrink-0 text-brand-ink mt-px" strokeWidth={2.1} aria-hidden="true" />
            <span className="line-clamp-1">
              <span className="font-semibold text-body">How this channel distributes: </span>
              {diagnosis.mechanics}
            </span>
          </p>
        ) : null}

        <p className="text-[10.5px] leading-snug text-faint flex items-start gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={2} aria-hidden="true" />
          <span>
            Diagnosed from {compact(evidence.postsRead || 0)} post(s) the API returned for this range
            {evidence.engagedSource && evidence.engagedSource !== 'account insights'
              ? ` · engagement summed from posts (${evidence.engagedSource})`
              : ''}
            . Benchmarks are published industry references for the education niche, not data from your accounts.
          </span>
        </p>
        </div>
      </CardBody>
    </Card>
  )
}
