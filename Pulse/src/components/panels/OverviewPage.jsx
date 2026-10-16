import { useMemo, useState } from 'react'
import {
  ArrowUpRight, ArrowDownRight, Heart, PenLine, Gauge, Search, Sparkles,
  ChevronRight, AlertTriangle,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { Pill, StatusPill, Tag, TrendPill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import BrandIcon from '../ui/BrandIcon'
import MultiLine from '../charts/MultiLine'
import Donut from '../charts/Donut'
import AreaTrend from '../charts/AreaTrend'
import BarList from '../charts/BarList'
import { EmptyState, NoticeBar, KpiSkeleton } from '../ui/States'
import { usePlatformDetail } from '../../hooks/usePlatformDetail'
import {
  channelDaily, activeChannels, isErrorPayload, errorText, topContent, accountOf, timelineOf,
  effectiveSummary, activityCalendarOf, daysSinceLastPost, stageOf, nextMilestone,
} from '../../lib/normalize'
import { StageHero, ActivityHeat, InsightsPanel, GeoTeaser, buildInsights, computeStreaks } from './OverviewExtras'
import { codeOf } from '../../lib/countries'
import { PLATFORM_ORDER, platformMeta } from '../../lib/platforms'
import { compact, formatValue, dateLong, dateShort, truncate, percent } from '../../lib/format'
import { cls } from '../../lib/cls'

const TREND_OPTIONS = [
  {
    value: 'reach',
    label: 'Reach',
    accessors: {
      facebook: (r) => r.page_impressions || r.page_impressions_unique || 0,
      instagram: (r) => r.reach || 0,
      linkedin: (r) => r.impressions || 0,
      pinterest: (r) => r.impressions || 0,
      searchConsole: (r) => r.impressions || 0,
    },
    note: 'YouTube has no reach metric — its views are charted separately.',
  },
  {
    value: 'engagement',
    label: 'Engagement',
    accessors: {
      facebook: (r) => r.page_post_engagements || 0,
      instagram: (r) => r.total_interactions || 0,
      youtube: (r) => (r.likes || 0) + (r.comments || 0) + (r.shares || 0),
      linkedin: (r) => r.engagement || 0,
      pinterest: (r) => r.engagement || 0,
    },
  },
  {
    value: 'views',
    label: 'Views',
    accessors: {
      facebook: (r) => r.page_media_view || r.page_video_views || 0,
      youtube: (r) => r.views || 0,
      pinterest: (r) => r.views || 0,
      linkedin: (r) => r.views || 0,
    },
  },
  {
    value: 'clicks',
    label: 'Clicks',
    accessors: {
      linkedin: (r) => r.clicks || 0,
      pinterest: (r) => r.clicks || 0,
      searchConsole: (r) => r.clicks || 0,
      instagram: (r) => r.website_clicks || 0,
    },
  },
  {
    value: 'audience',
    label: 'Audience',
    accessors: {
      facebook: (r) => r.follower_count || r.followers || 0,
      instagram: (r) => r.follower_count || r.followers || 0,
      linkedin: (r) => r.followers || 0,
      pinterest: (r) => r.followers || 0,
    },
    note: 'YouTube subscriber history is not exposed as a daily total by the Analytics API.',
  },
]

export default function OverviewPage({
  platformData,
  summary,
  healthDetails = {},
  range,
  sample = false,
  onNavigate,
  loading = false,
  onRetry,
}) {
  // The server's summary is preferred, but a missing or all-zero summary is
  // rebuilt from the platform payloads. That is exactly the v4.0 shape, and it
  // is why platform pages used to show numbers while the Overview showed 0 0.
  const summaryEff = useMemo(() => effectiveSummary(platformData, summary), [platformData, summary])
  const calendar = useMemo(() => activityCalendarOf(platformData, 120), [platformData])
  const lastPostDays = useMemo(() => daysSinceLastPost(platformData), [platformData])
  const stage = useMemo(
    () => ({ ...stageOf(platformData, summaryEff, calendar), milestone: nextMilestone(summaryEff?.totals?.audience || 0) }),
    [platformData, summaryEff, calendar]
  )
  const streaks = useMemo(() => computeStreaks(calendar), [calendar])
  const insights = useMemo(
    () => buildInsights({ stage, lastPostDays, summary: summaryEff, platformData, healthDetails }),
    [stage, lastPostDays, summaryEff, platformData, healthDetails]
  )
  const geoCountries = useMemo(() => {
    const counts = new Map()
    for (const k of PLATFORM_ORDER) {
      const d = platformData?.[k]?.demographics
      if (!d?.countries?.length) continue
      for (const c of d.countries) {
        const code = codeOf(c.code || c.name)
        if (!code) continue
        const cur = counts.get(code) || { code, name: c.name, channels: 0, value: 0 }
        cur.channels += 1
        cur.value += Number(c.value) || 0
        counts.set(code, cur)
      }
    }
    return [...counts.values()].sort((a, b) => b.channels - a.channels || b.value - a.value)
  }, [platformData])

  const kpis = useMemo(() => buildKpis(summaryEff, platformData), [summaryEff, platformData])
  const rows = summaryEff?.platforms || []
  const connected = rows.filter((r) => r.ok).length
  const failed = rows.filter((r) => !r.ok)
  const content = useMemo(() => topContent(platformData, 8), [platformData])
  const spanDays = useMemo(() => spanOf(platformData, range), [platformData, range])

  const gsc = platformData?.searchConsole
  const gscTimeline = gsc && !isErrorPayload(gsc) ? timelineOf(gsc) : []
  const keywords = usePlatformDetail('searchConsole', range, { dimensions: 'query', rowLimit: 25 }, {
    enabled: Boolean(gsc && !isErrorPayload(gsc)),
    sample,
  })
  const topKeywords = keywords.data?.topItems || gsc?.topItems || []

  if (loading && !platformData) {
    return (
      <div className="flex flex-col gap-5">
        <KpiSkeleton count={6} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <KpiSkeleton count={3} className="xl:col-span-2" />
          <KpiSkeleton count={1} />
        </div>
      </div>
    )
  }

  if (!platformData) {
    return (
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title="No data could be loaded"
          message="The API did not return a combined payload. Check the backend URL on the Connections page, then retry."
          action={onRetry ? <button className="btn-primary" onClick={onRetry}>Retry</button> : null}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Stage hero: numbers that are real even at zero engagement ── */}
      <StageHero stage={stage} summary={summaryEff} calendar={calendar} lastPostDays={lastPostDays} onNavigate={onNavigate} />

      {/* ── Headline KPIs ─────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <KpiTile key={k.id} {...k} />
        ))}
      </section>

      {/* ── Consistency + geography ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
        <ActivityHeat calendar={calendar} streaks={streaks} />
        <GeoTeaser countries={geoCountries} onNavigate={onNavigate} />
      </div>

      <InsightsPanel insights={insights} onNavigate={onNavigate} />

      {/* ── Channel performance ───────────────────────────────── */}
      <Card>
        <CardHeader
          title="Channel performance"
          sub={`${connected} of ${rows.length} channels answered · ${rangeLabel(platformData)}`}
          icon={<Gauge className="w-4 h-4" strokeWidth={2} />}
          right={
            <div className="flex items-center gap-2">
              {failed.length ? <Pill tone="neg">{failed.length} failing</Pill> : <Pill tone="pos">All channels responding</Pill>}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-sunken/70 border-b border-line">
                <th className="th">Channel</th>
                <th className="th text-right">Audience</th>
                <th className="th text-right">Impressions / reach</th>
                <th className="th text-right">Engagement</th>
                <th className="th text-right">Eng. rate</th>
                <th className="th text-right">Clicks</th>
                <th className="th text-right">Posts</th>
                <th className="th text-right">Audience trend</th>
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody>
              {PLATFORM_ORDER.map((pk) => {
                const r = rows.find((x) => x.platform === pk) || {}
                const meta = platformMeta(pk)
                const payload = platformData[pk]
                const err = isErrorPayload(payload)
                const detail = (healthDetails || {})[pk]
                return (
                  <tr
                    key={pk}
                    className="border-b border-line/60 last:border-0 hover:bg-brand-soft/30 cursor-pointer transition-colors"
                    onClick={() => onNavigate(pk)}
                  >
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: `${meta.color}12`, color: meta.color }}
                        >
                          <BrandIcon platform={pk} className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-ink truncate">{meta.label}</p>
                          <p className="text-[11px] text-faint truncate">
                            {err ? truncate(errorText(payload), 46) : accountLabel(payload) || meta.source}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="td-num">{r.audience ? compact(r.audience) : <span className="text-faint">—</span>}</td>
                    <td className="td-num">
                      {Math.max(r.impressions || 0, r.reach || 0, r.views || 0) > 0 ? (
                        compact(Math.max(r.impressions || 0, r.reach || 0, r.views || 0))
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                    <td className="td-num">{r.engagement ? compact(r.engagement) : <span className="text-faint">0</span>}</td>
                    <td className="td-num">
                      {r.engagementRate ? percent(r.engagementRate, 2) : <span className="text-faint">—</span>}
                    </td>
                    <td className="td-num">{r.clicks ? compact(r.clicks) : <span className="text-faint">0</span>}</td>
                    <td className="td-num">{r.posts ? compact(r.posts) : <span className="text-faint">0</span>}</td>
                    <td className="td text-right">
                      {err ? (
                        <StatusPill status={detail?.configured === false ? 'unconfigured' : 'error'} />
                      ) : r.trend ? (
                        <TrendPill metric={{ trend: r.trend }} />
                      ) : (
                        <span className="text-faint text-[12px]">flat</span>
                      )}
                    </td>
                    <td className="td text-right pr-4">
                      <ChevronRight className="w-4 h-4 text-faint inline" strokeWidth={2} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Trend + split ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CrossChannelTrend platformData={platformData} spanDays={spanDays} />
        </Card>

        <Card>
          <CardHeader
            title="Engagement split"
            sub="Where interactions came from in this range"
            icon={<Heart className="w-4 h-4" strokeWidth={2} />}
          />
          <CardBody>
            <Donut
              centerLabel="Engagement"
              items={PLATFORM_ORDER.map((pk) => {
                const r = rows.find((x) => x.platform === pk) || {}
                return { label: platformMeta(pk).label, value: r.engagement || 0, color: platformMeta(pk).color }
              })}
            />
          </CardBody>
        </Card>
      </div>

      {/* ── Search performance ────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Google Search Console"
          sub={gsc?.meta?.siteUrl ? `${gsc.meta.siteUrl} · ${gsc.meta.note || 'organic search performance'}` : 'Organic search performance'}
          icon={<Search className="w-4 h-4" strokeWidth={2} />}
          right={
            <button className="btn text-[12px]" onClick={() => onNavigate('searchConsole')}>
              Open Search Console <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          }
        />
        {isErrorPayload(gsc) ? (
          <CardBody>
            <NoticeBar tone="error">
              <b>Search Console unavailable.</b> {errorText(gsc)}
              {gsc?.hint ? <span className="block mt-1 text-muted">{gsc.hint}</span> : null}
            </NoticeBar>
          </CardBody>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-5 p-5">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['clicks', 'impressions', 'ctr', 'position'].map((k) => {
                  const m = gsc?.overview?.[k]
                  if (!m) return null
                  return (
                    <div key={k} className="rounded-xl border border-line bg-sunken/50 p-3">
                      <p className="eyebrow">{m.label}</p>
                      <p className="font-display text-[20px] font-bold text-ink num mt-1">{formatValue(m.total, m)}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <TrendPill metric={m} />
                        {m.previous !== null && m.previous !== undefined ? (
                          <span className="text-[10.5px] text-faint num">vs {formatValue(m.previous, m)}</span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              {gscTimeline.length ? (
                <AreaTrend
                  data={gscTimeline}
                  seriesKey="impressions"
                  label="Impressions"
                  color={platformMeta('searchConsole').color}
                  height={190}
                  spanDays={spanDays}
                />
              ) : (
                <EmptyState title="No search rows" message="Search Console returned no rows for this window." />
              )}
            </div>

            <div>
              <p className="eyebrow mb-2.5">Top search queries</p>
              {keywords.loading ? (
                <p className="text-[12.5px] text-faint">Loading keywords…</p>
              ) : topKeywords.length ? (
                <BarList
                  items={topKeywords.slice(0, 8).map((k, i) => ({
                    id: k.label + i,
                    label: k.label,
                    value: k.clicks,
                    rank: i + 1,
                    footnote: `${compact(k.impressions)} impressions · ${k.ctr}% CTR · position ${k.position ?? '—'}`,
                  }))}
                  color={platformMeta('searchConsole').color}
                  showShare
                />
              ) : (
                <EmptyState
                  title="No keywords yet"
                  message="Search Console has no queries for this range, or the property has just been verified."
                />
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Recent content ────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Recent content"
          sub="Latest posts and pins across LinkedIn and Pinterest, ranked by engagement"
          icon={<PenLine className="w-4 h-4" strokeWidth={2} />}
        />
        {content.length ? (
          <div className="divide-y divide-line">
            {content.map((c) => (
              <ContentRow key={`${c.platform}-${c.id}`} item={c} />
            ))}
          </div>
        ) : (
          <CardBody>
            <EmptyState
              title="No posts in this range"
              message="LinkedIn and Pinterest return the posts Zernio knows about. Publish (or sync) content and it will appear here with its metrics."
            />
          </CardBody>
        )}
      </Card>

      {/* ── Alerts ────────────────────────────────────────────── */}
      {failed.length || noticesOf(platformData).length ? (
        <Card>
          <CardHeader
            title="Needs attention"
            sub="Platforms that failed, returned nothing, or reported a partial problem"
            icon={<AlertTriangle className="w-4 h-4" strokeWidth={2} />}
            right={
              <button className="btn text-[12px]" onClick={() => onNavigate('connections')}>
                Open Connections <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            }
          />
          <CardBody className="flex flex-col gap-2.5">
            {failed.map((f) => {
              const payload = platformData?.[f.platform]
              const detail = (healthDetails || {})[f.platform]
              return (
                <NoticeBar key={f.platform} tone="error">
                  <b>{platformMeta(f.platform).label}:</b> {errorText(payload)}
                  {(payload?.hint || detail?.hint) ? (
                    <span className="block mt-1 opacity-80">{payload?.hint || detail?.hint}</span>
                  ) : null}
                </NoticeBar>
              )
            })}
            {noticesOf(platformData).map((n, i) => (
              <NoticeBar key={`${n.platform}-${i}`} tone="warn">
                <b>{platformMeta(n.platform).label}:</b> {n.text}
                {n.hint ? <span className="block mt-1 opacity-80">{n.hint}</span> : null}
              </NoticeBar>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function CrossChannelTrend({ platformData, spanDays }) {
  const [metricKey, setMetricKey] = useState('reach')
  const spec = TREND_OPTIONS.find((t) => t.value === metricKey) || TREND_OPTIONS[0]
  const channels = activeChannels(platformData, spec.accessors)
  const data = useMemo(
    () => channelDaily(platformData, spec.accessors, { skipEmpty: false }),
    [platformData, spec]
  )
  const series = channels.map((pk) => ({ key: pk, label: platformMeta(pk).label, color: platformMeta(pk).color }))
  const hasSignal = data.some((r) => channels.some((pk) => Number(r[pk]) > 0))

  return (
    <>
      <CardHeader
        title="Cross-channel trend"
        sub={spec.note || 'Daily values per channel over the selected range'}
        icon={<Sparkles className="w-4 h-4" strokeWidth={2} />}
        right={<Segmented options={TREND_OPTIONS.map((t) => ({ value: t.value, label: t.label }))} value={metricKey} onChange={setMetricKey} size="sm" />}
      />
      <CardBody>
        {!channels.length ? (
          <EmptyState
            title="Nothing to compare yet"
            message="No channel returned a daily series for this range. Widen the date range or fix the failing connections."
          />
        ) : !hasSignal ? (
          <div>
            <MultiLine data={data} series={series} height={290} spanDays={spanDays} />
            <p className="text-[12px] text-faint text-center mt-1">
              Every day in this range is zero for these channels — the flat line is the real value.
            </p>
          </div>
        ) : (
          <MultiLine data={data} series={series} height={290} spanDays={spanDays} />
        )}
      </CardBody>
    </>
  )
}

function ContentRow({ item }) {
  const meta = platformMeta(item.platform)
  const stats = [
    item.impressions > 0 && { label: 'impressions', value: item.impressions },
    item.clicks > 0 && { label: item.platform === 'pinterest' ? 'pin clicks' : 'clicks', value: item.clicks },
    item.saves > 0 && { label: 'saves', value: item.saves },
    item.likes > 0 && { label: 'likes', value: item.likes },
    item.comments > 0 && { label: 'comments', value: item.comments },
    item.shares > 0 && { label: 'shares', value: item.shares },
    item.views > 0 && { label: 'views', value: item.views },
  ].filter(Boolean)

  return (
    <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-sunken/60 transition-colors">
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: `${meta.color}12`, color: meta.color }}
      >
        <BrandIcon platform={item.platform} className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink leading-snug">{truncate(item.content, 150)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-faint num">
          <span>{item.publishedAt ? dateShort(item.publishedAt) : 'undated'}</span>
          {item.boardName ? <Tag>{item.boardName}</Tag> : null}
          {item.isExternal ? <Tag>External</Tag> : null}
          {stats.map((s) => (
            <span key={s.label}>
              <b className="text-body font-semibold">{compact(s.value)}</b> {s.label}
            </span>
          ))}
          {item.engagementRate > 0 ? <span className="text-brand-ink font-semibold">{item.engagementRate}% ER</span> : null}
          {!stats.length ? <span className="text-warn">no metrics synced</span> : null}
        </div>
      </div>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost shrink-0 text-[12px]"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
        </a>
      ) : null}
    </div>
  )
}

function KpiTile({ label, value, kind = 'sum', unit = '', sub, trend = null, breakdown = [], extra = [], onClick }) {
  const up = trend !== null && trend > 0
  const down = trend !== null && trend < 0
  const max = Math.max(...breakdown.map((b) => b.value || 0), 1)
  const zero = Number(value) === 0 && !(extra && extra.length)
  return (
    <div
      className={cls('card p-4 flex flex-col gap-2.5 card-hover', zero && 'bg-sunken/60 border-dashed')}
      title={zero ? 'Nothing recorded in this range yet — normal for a young channel. The stage panel above tracks what is moving.' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px] font-medium text-muted leading-tight">{label}</p>
        {trend !== null && trend !== undefined ? (
          <span
            className={cls(
              'inline-flex items-center gap-0.5 text-[11px] font-semibold num shrink-0',
              up ? 'text-pos' : down ? 'text-neg' : 'text-faint'
            )}
          >
            {up ? <ArrowUpRight className="w-3 h-3" strokeWidth={2.5} /> : down ? <ArrowDownRight className="w-3 h-3" strokeWidth={2.5} /> : null}
            {Math.abs(trend)}%
          </span>
        ) : null}
      </div>
      <p className={cls('font-display text-[24px] leading-7 font-bold num', zero ? 'text-faint' : 'text-ink')}>
        {formatValue(value, { kind, unit })}
      </p>
      {zero ? (
        <span className="-mt-1 inline-flex w-fit items-center rounded border border-dashed border-line px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-faint">
          not earned yet
        </span>
      ) : null}
      {extra.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {extra.map((e) => (
            <span key={e.label} className="text-[11px] text-faint num">
              {e.label} <b className="text-body font-semibold">{formatValue(e.value, e)}</b>
            </span>
          ))}
        </div>
      ) : null}
      {sub ? <p className="text-[10.5px] text-faint leading-tight">{sub}</p> : null}
      {breakdown.length ? (
        <div className="flex flex-col gap-1 mt-auto pt-1">
          {breakdown.slice(0, 4).map((b) => (
            <div key={b.platform} className="flex items-center gap-1.5">
              <BrandIcon platform={b.platform} className="w-2.5 h-2.5 shrink-0" style={{ color: platformMeta(b.platform).color }} />
              <div className="h-1 flex-1 rounded-full bg-line overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max((b.value / max) * 100, 2)}%`, background: platformMeta(b.platform).color }}
                />
              </div>
              <span className="text-[10px] text-faint num w-9 text-right">{compact(b.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────

function buildKpis(summary, platformData) {
  const t = summary?.totals || {}
  const rows = summary?.platforms || []
  const withAudience = rows.filter((r) => r.audience > 0)
  const prevAudience = withAudience.reduce((s, r) => {
    const f = platformData?.[r.platform]?.overview?.followers
    return s + (f && typeof f.previous === 'number' ? f.previous : r.audience)
  }, 0)
  const audienceTrend = prevAudience > 0 ? Math.round(((t.audience - prevAudience) / prevAudience) * 1000) / 10 : null

  const gsc = platformData?.searchConsole?.overview || {}

  return [
    {
      id: 'audience', label: 'Total audience', value: t.audience || 0, kind: 'gauge',
      sub: `${withAudience.length} channel${withAudience.length === 1 ? '' : 's'} reporting`, trend: audienceTrend,
      breakdown: withAudience.map((r) => ({ platform: r.platform, value: r.audience })),
    },
    {
      id: 'impressions', label: 'Impressions / reach', value: t.impressions || 0, kind: 'sum',
      sub: 'Largest of impressions, reach or views per channel', trend: null,
      breakdown: rows
        .map((r) => ({ platform: r.platform, value: Math.max(r.impressions || 0, r.reach || 0, r.views || 0) }))
        .filter((b) => b.value > 0),
    },
    {
      id: 'engagement', label: 'Engagement', value: t.engagement || 0, kind: 'sum',
      sub: 'Likes, comments, shares, saves and clicks', trend: null,
      breakdown: rows.map((r) => ({ platform: r.platform, value: r.engagement || 0 })).filter((b) => b.value > 0),
    },
    {
      id: 'posts', label: 'Content published', value: t.posts || 0, kind: 'count',
      sub: 'Posts, pins and videos in range', trend: null,
      breakdown: rows.map((r) => ({ platform: r.platform, value: r.posts || 0 })).filter((b) => b.value > 0),
    },
    {
      id: 'searchClicks', label: 'Search clicks', value: t.searchClicks || 0, kind: 'sum',
      sub: `${compact(t.searchImpressions || 0)} impressions from Google`, trend: gsc.clicks?.trend ?? null,
      extra: [
        { label: 'CTR', value: t.searchCtr || 0, kind: 'rate', unit: '%' },
        { label: 'Position', value: t.searchPosition || 0, kind: 'avg' },
      ],
    },
    {
      id: 'engagementRate', label: 'Engagement rate', value: t.engagementRate || 0, kind: 'rate', unit: '%',
      sub: 'Total engagement ÷ total impressions', trend: null,
    },
  ]
}

function accountLabel(payload) {
  const a = accountOf(payload)
  if (!a) return null
  return [a.name, a.handle ? `@${String(a.handle).replace(/^@/, '')}` : null].filter(Boolean).join(' · ')
}

function noticesOf(platformData) {
  const out = []
  for (const pk of PLATFORM_ORDER) {
    const p = platformData?.[pk]
    if (!p || isErrorPayload(p)) continue
    if (p.notice) out.push({ platform: pk, text: p.notice })
    for (const pe of Array.isArray(p.partialErrors) ? p.partialErrors : []) {
      if (!pe || typeof pe !== 'object' || pe.optional) continue
      out.push({ platform: pk, text: pe.message || 'A metric group was unavailable.', hint: pe.hint || null })
    }
  }
  return out
}

function spanOf(platformData, range) {
  for (const pk of PLATFORM_ORDER) {
    const dr = platformData?.[pk]?.meta?.dateRange
    if (dr?.from && dr?.to) {
      return Math.max(2, Math.round((new Date(dr.to) - new Date(dr.from)) / 86400000))
    }
  }
  return { last_7d: 7, last_14d: 14, last_90d: 90, last_365d: 365 }[range?.preset] || 30
}

function rangeLabel(platformData) {
  for (const pk of PLATFORM_ORDER) {
    const dr = platformData?.[pk]?.meta?.dateRange
    if (dr?.from && dr?.to) return `${dateLong(dr.from)} – ${dateLong(dr.to)}`
  }
  return ''
}
