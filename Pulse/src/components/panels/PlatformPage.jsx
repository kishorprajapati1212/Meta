import { useMemo, useState } from 'react'
import { LineChart as LineChartIcon, Layers, Users, Bug, ChevronDown } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { NoticeBar, EmptyState, ErrorState } from '../ui/States'
import { Tag, TrendPill, StatusPill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import PageHeader from '../platform/PageHeader'
import PostGrid from '../platform/PostGrid'
import BoardList from '../platform/BoardList'
import DemographicsStrip from '../platform/DemographicsStrip'
import KpiCard from '../metrics/KpiCard'
import MetricTable from '../metrics/MetricTable'
import DataTable from '../ui/DataTable'
import AreaTrend from '../charts/AreaTrend'
import ColumnChart from '../charts/ColumnChart'
import {
  metricsOf, timelineOf, accountOf, platformState, isErrorPayload, errorText, diagnosticsOf, seriesOf,
} from '../../lib/normalize'
import { platformMeta, ZERNIO_PLATFORMS } from '../../lib/platforms'
import { dateLong, formatValue } from '../../lib/format'
import { cls } from '../../lib/cls'

const KPI_LIMIT = 8

/** A metric the platform publishes as a single level has no daily series. */
const hasSeries = (m) => Array.isArray(m?.series) && m.series.length > 0

/**
 * PlatformPage — one channel, everything the API returned about it.
 *
 * Layout (identical for all 5 non-GSC platforms, so muscle memory works):
 *   header → notices → KPI grid → main chart → daily breakdown table →
 *   full metric table → platform-specific panels (posts / boards / audience)
 */
export default function PlatformPage({ platformKey, payload, healthDetail, range, sample, onRetry, onNavigate, audience, onAudienceChange }) {
  const meta = platformMeta(platformKey)
  const [selected, setSelected] = useState(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const isZernio = ZERNIO_PLATFORMS.includes(platformKey)
  const metrics = useMemo(() => metricsOf(platformKey, payload), [platformKey, payload])
  const timeline = useMemo(() => timelineOf(payload), [payload])
  const account = accountOf(payload)
  const state = platformState(platformKey, payload, healthDetail)

  const chartMetric = useMemo(() => {
    if (!metrics.length) return null
    // Prefer a metric that actually has daily values. Instagram publishes
    // follower_count as one level with no per-day breakdown, so defaulting to
    // the first metric with data used to open the page on an empty chart.
    return (
      metrics.find((m) => m.key === selected) ||
      metrics.find((m) => m.hasData && hasSeries(m)) ||
      metrics.find((m) => m.hasData) ||
      metrics[0]
    )
  }, [metrics, selected])

  if (isErrorPayload(payload)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader platformKey={platformKey} account={null} status={healthDetail?.configured === false ? 'unconfigured' : 'error'} source={meta.source} blurb={meta.blurb} />
        <Card>
          <ErrorState
            title={`${meta.label} data could not be loaded`}
            message={errorText(payload)}
            hint={payload?.hint || healthDetail?.hint}
            onRetry={onRetry}
          />
        </Card>
      </div>
    )
  }

  const kpis = metrics.slice(0, KPI_LIMIT)
  const posts = payload?.posts || payload?.topPosts || []
  const boards = payload?.meta?.boards || []
  const diagnostics = diagnosticsOf(payload)
  const safePartial = Array.isArray(payload?.partialErrors) ? payload.partialErrors.filter((e) => e && typeof e === 'object') : []
  const partialErrors = safePartial.filter((e) => !e.optional)
  const optionalErrors = safePartial.filter((e) => e.optional)

  // The side chart only earns a panel when there is something in it. An empty
  // box that says "No follower series in the payload." under a Followers card
  // that has already printed the number is noise, not information.
  const followerSeries = seriesOf(payload, 'followers')
  const publishingSignal = timeline.some(
    (r) => (r.posts || 0) !== 0 || (r.impressions || 0) !== 0 || (r.reach || 0) !== 0
  )
  const subscriberMovement = timeline.some(
    (r) => (r.subscribersGained || 0) !== 0 || (r.subscribersLost || 0) !== 0
  )
  const secondaryPanel = isZernio ? (
    publishingSignal ? (
      <Card>
        <CardHeader
          title="Publishing vs reach"
          sub="Posts per day (bars) against impressions (line)"
          icon={<Layers className="w-4 h-4" strokeWidth={2} />}
        />
        <CardBody>
          <ColumnChart
            data={timeline}
            bars={[{ key: 'posts', label: platformKey === 'pinterest' ? 'Pins' : 'Posts', color: `${meta.color}66`, maxBarSize: 18 }]}
            lines={[{ key: 'impressions', label: 'Impressions', color: meta.color, axis: 'right' }]}
            height={260}
            spanDays={spanOf(payload, range)}
            rightAxis
            emptyMessage="No daily rows in this range."
          />
        </CardBody>
      </Card>
    ) : null
  ) : platformKey === 'youtube' ? (
    subscriberMovement ? (
      <Card>
        <CardHeader
          title="Audience"
          sub="Subscriber movement per day"
          icon={<Users className="w-4 h-4" strokeWidth={2} />}
        />
        <CardBody>
          <ColumnChart
            data={timeline}
            bars={[
              { key: 'subscribersGained', label: 'Gained', color: '#12924F', maxBarSize: 14 },
              { key: 'subscribersLost', label: 'Lost', color: '#DC4849', maxBarSize: 14 },
            ]}
            height={260}
            spanDays={spanOf(payload, range)}
            stacked={false}
            emptyMessage="No subscriber movement recorded."
          />
        </CardBody>
      </Card>
    ) : null
  ) : followerSeries.length ? (
    <Card>
      <CardHeader
        title="Audience"
        sub="Follower level per day"
        icon={<Users className="w-4 h-4" strokeWidth={2} />}
      />
      <CardBody>
        <AreaTrend
          data={followerSeries}
          color={meta.color}
          label="Followers"
          kind="gauge"
          height={260}
          showAverage={false}
          spanDays={spanOf(payload, range)}
        />
      </CardBody>
    </Card>
  ) : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        platformKey={platformKey}
        account={account}
        status={state.state === 'empty' ? 'empty' : healthDetail?.status === 'ok' || sample ? 'ok' : state.state}
        statusLabel={sample ? 'Sample data' : undefined}
        source={payload?.meta?.source || meta.source}
        dateRange={payload?.meta?.dateRange}
        lastSyncedAt={payload?.meta?.account?.lastSyncedAt}
        blurb={meta.blurb}
        state={state.state}
        right={
          <div className="flex flex-col items-end gap-1.5">
            <Tag>{isZernio ? 'via Zernio' : 'direct API'}</Tag>
            {payload?.meta?.postCount !== undefined ? (
              <span className="text-[11.5px] text-faint num">{payload.meta.postCount} items in range</span>
            ) : null}
            {payload?.meta?.dataPoints ? (
              <span className="text-[11.5px] text-faint num">{payload.meta.dataPoints} data points</span>
            ) : null}
          </div>
        }
      />

      {/* clamp: a backend notice can run to several sentences (Pinterest's
          entitlement note does). Two lines on the page, the rest one click away —
          the text stays in the DOM either way. */}
      {state.message ? (
        <NoticeBar tone={state.state === 'empty' ? 'warn' : 'info'} clamp={2}>{state.message}</NoticeBar>
      ) : null}
      {partialErrors.map((e, i) => (
        <NoticeBar key={i} tone="warn" clamp={2}>
          <b>Partial data:</b> {e.message}
          {e.hint ? <span className="block mt-1 opacity-85">{e.hint}</span> : null}
          {e.metrics ? <span className="block mt-1 text-[11px] opacity-70 font-mono">{e.metrics}</span> : null}
        </NoticeBar>
      ))}

      {/* ── KPI grid ─────────────────────────────────────────── */}
      {kpis.length ? (
        <section>
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <p className="eyebrow">Headline metrics</p>
            <p className="text-[11.5px] text-faint num">
              {metrics.filter((m) => m.hasData).length} of {metrics.length} metrics have data · click a card to chart it
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {kpis.map((m) => (
              <KpiCard
                key={m.key}
                metric={m}
                color={meta.color}
                selected={chartMetric?.key === m.key}
                onClick={() => setSelected(m.key)}
              />
            ))}
          </div>
        </section>
      ) : (
        <Card>
          <EmptyState
            title="No metrics in this payload"
            message="The API answered but returned no metric fields. Check the date range, then the Connections page for credential problems."
          />
        </Card>
      )}

      {/* ── Main chart + secondary ───────────────────────────── */}
      {chartMetric ? (
        <div className={cls('grid gap-5', secondaryPanel && 'grid-cols-1 xl:grid-cols-3')}>
          <Card className={secondaryPanel ? 'xl:col-span-2' : ''}>
            <CardHeader
              title={chartMetric.label}
              sub={
                chartMetric.description ||
                (hasSeries(chartMetric)
                  ? `${formatValue(chartMetric.total, chartMetric)} total · ${chartMetric.points ?? chartMetric.series.length} daily values`
                  : `${formatValue(chartMetric.total, chartMetric)} total · published as a single value, no daily series`)
              }
              icon={<LineChartIcon className="w-4 h-4" strokeWidth={2} />}
              right={
                <div className="flex items-center gap-2">
                  <TrendPill metric={chartMetric} />
                  <MetricSelect metrics={metrics} value={chartMetric.key} onChange={setSelected} />
                </div>
              }
            />
            <CardBody>
              {hasSeries(chartMetric) ? (
                <AreaTrend
                  data={chartMetric.series}
                  color={meta.color}
                  label={chartMetric.label}
                  kind={chartMetric.kind}
                  unit={chartMetric.unit}
                  height={300}
                  spanDays={spanOf(payload, range)}
                />
              ) : (
                <p className="py-12 text-center text-[12.5px] leading-relaxed text-muted">
                  {chartMetric.label} is published as a single value —{' '}
                  <b className="num text-ink">{formatValue(chartMetric.total, chartMetric)}</b>.{' '}
                  {meta.label} sends no daily breakdown for it, so there is nothing to plot.
                </p>
              )}
              {chartMetric.formula ? (
                <p className="text-[11.5px] text-faint mt-2 text-center">Derived metric — {chartMetric.formula}</p>
              ) : null}
            </CardBody>
          </Card>

          {secondaryPanel}
        </div>
      ) : null}

      {/* ── Daily breakdown ──────────────────────────────────── */}
      {timeline.length ? (
        <DailyTable platformKey={platformKey} timeline={timeline} metrics={metrics} color={meta.color} />
      ) : null}

      {/* ── Every metric ─────────────────────────────────────── */}
      <MetricTable
        metrics={metrics}
        platformKey={platformKey}
        color={meta.color}
        title="All metrics"
        subtitle={`Every field ${meta.source} returned for ${payload?.meta?.dateRange?.from || 'this range'} → ${payload?.meta?.dateRange?.to || 'today'}, with how each one is aggregated.`}
      />

      {/* ── Zernio extras: posts, boards, follower history ───── */}
      {isZernio ? (
        <>
          {payload?.followerTimeseries?.length ? (
            <Card>
              <CardHeader
                title="Follower history"
                sub={`${payload.followerTimeseries.length} daily snapshots from Zernio follower-stats`}
                icon={<Users className="w-4 h-4" strokeWidth={2} />}
                right={
                  <TrendPill
                    metric={{
                      trend: metrics.find((m) => m.key === 'followers')?.trend ?? 0,
                      previous: payload.followerTimeseries[0]?.followers,
                    }}
                  />
                }
              />
              <CardBody>
                <AreaTrend
                  data={payload.followerTimeseries.map((r) => ({ date: r.date, value: r.followers }))}
                  color={meta.color}
                  label="Followers"
                  kind="gauge"
                  height={220}
                  showAverage={false}
                  spanDays={spanOf(payload, range)}
                />
              </CardBody>
            </Card>
          ) : null}

          <PostGrid
            posts={posts}
            platformKey={platformKey}
            title={platformKey === 'pinterest' ? 'Pins' : 'Posts'}
            subtitle={
              payload?.meta?.sync?.attempted
                ? `${posts.length} returned · analytics sync triggered for ${payload.meta.sync.attempted} external item(s)`
                : undefined
            }
          />

          {platformKey === 'pinterest' ? (
            <BoardList boards={boards} account={payload?.meta?.account} color={meta.color} />
          ) : null}
        </>
      ) : null}

      {/* ── Audience composition (only what this platform reports) ── */}
      {payload && !isErrorPayload(payload) ? (
        <DemographicsStrip demo={payload.demographics || null} color={meta.color} onNavigate={undefined} onOpen={onNavigate ? () => onNavigate(`audience:${platformKey}`) : null} />
      ) : null}

      {/* ── Diagnostics ──────────────────────────────────────── */}
      {diagnostics.length || optionalErrors.length ? (
        <Card>
          <button
            className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
            onClick={() => setShowDiagnostics((v) => !v)}
          >
            <span className="flex items-center gap-2.5">
              <Bug className="w-4 h-4 text-muted" strokeWidth={2} />
              <span>
                <span className="section-title block">API diagnostics</span>
                <span className="section-sub block mt-0.5">
                  Which upstream call produced what — useful when a number looks wrong
                </span>
              </span>
            </span>
            <ChevronDown className={cls('w-4 h-4 text-faint transition-transform', showDiagnostics && 'rotate-180')} strokeWidth={2} />
          </button>
          {showDiagnostics ? (
            <div className="border-t border-line p-5 flex flex-col gap-3">
              {diagnostics.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {diagnostics.map((d) => (
                    <div key={d.step} className="rounded-xl border border-line bg-sunken/60 p-3">
                      <div className="flex items-center gap-2">
                        <StatusPill status={d.ok ? 'ok' : d.skipped ? 'unknown' : 'error'} dot label={d.step} />
                      </div>
                      <p className="text-[11.5px] text-muted mt-1.5 break-words font-mono leading-relaxed">
                        {d.detail || (d.ok ? 'ok' : 'failed')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {optionalErrors.length ? (
                <div className="flex flex-col gap-2">
                  <p className="eyebrow">Optional metric groups that were unavailable</p>
                  {optionalErrors.map((e, i) => (
                    <p key={i} className="text-[12px] text-muted font-mono break-words">
                      · {e.metrics || e.group}: {e.message}
                    </p>
                  ))}
                </div>
              ) : null}

              {payload?.meta ? (
                <div className="rounded-xl border border-line bg-sunken/60 p-3">
                  <p className="eyebrow mb-1.5">Raw meta</p>
                  <pre className="text-[11px] text-muted font-mono overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(payload.meta, null, 2).slice(0, 2400)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function MetricSelect({ metrics, value, onChange }) {
  const [open, setOpen] = useState(false)
  const current = metrics.find((m) => m.key === value)
  return (
    <div className="relative">
      <button className="btn text-[12px] max-w-[190px]" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{current?.label || 'Select metric'}</span>
        <ChevronDown className={cls('w-3.5 h-3.5 shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={2} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 mt-1.5 z-40 w-60 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface shadow-pop p-1 animate-rise">
            {metrics.map((m) => (
              <li key={m.key}>
                <button
                  className={cls(
                    'w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] flex items-center justify-between gap-2 hover:bg-sunken transition-colors',
                    m.key === value ? 'bg-brand-soft text-brand-ink font-semibold' : 'text-body'
                  )}
                  onClick={() => { onChange(m.key); setOpen(false) }}
                >
                  <span className="truncate">{m.label}</span>
                  <span className="num text-[11px] text-faint shrink-0">{formatValue(m.total, m)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function DailyTable({ platformKey, timeline, metrics, color }) {
  const columns = useMemo(() => {
    const numericKeys = []
    timeline.forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k === 'date' || k === 'hasData') return
        if (!numericKeys.includes(k) && typeof row[k] === 'number') numericKeys.push(k)
      })
    })
    const labelFor = (k) => {
      const m = metrics.find((x) => x.key === k || x.id === k)
      return m?.label || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
    }
    const kindFor = (k) => metrics.find((x) => x.key === k || x.id === k) || { kind: 'sum', unit: '' }
    return [
      {
        key: 'date',
        label: 'Date',
        sortValue: (r) => r.date,
        render: (r) => (
          <span className="num text-ink font-medium whitespace-nowrap">
            {dateLong(r.date)}
            <span className="text-faint ml-1.5 text-[11px]">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
          </span>
        ),
      },
      ...numericKeys.map((k) => ({
        key: k,
        label: labelFor(k),
        align: 'right',
        sortValue: (r) => r[k],
        render: (r) => {
          const v = r[k]
          const m = kindFor(k)
          if (v === null || v === undefined) return <span className="text-faint">—</span>
          return (
            <span className={cls('num', v === 0 ? 'text-faint' : 'text-ink font-medium')} title={String(v)}>
              {formatValue(v, m)}
            </span>
          )
        },
      })),
    ]
  }, [timeline, metrics])

  const totals = useMemo(() => {
    const t = {}
    columns.slice(1).forEach((c) => {
      const m = metrics.find((x) => x.key === c.key || x.id === c.key)
      const values = timeline.map((r) => Number(r[c.key]) || 0)
      t[c.key] = m?.kind === 'gauge' ? values[values.length - 1] : m?.kind === 'rate' || m?.kind === 'avg'
        ? values.reduce((a, b) => a + b, 0) / (values.length || 1)
        : values.reduce((a, b) => a + b, 0)
    })
    return t
  }, [columns, timeline, metrics])

  return (
    <DataTable
      rows={timeline.slice().reverse()}
      columns={columns}
      initialSort={{ key: 'date', dir: 'desc' }}
      exportName={`${platformKey}-daily`}
      maxHeight={440}
      dense
      emptyMessage="No daily rows for this range."
      footer={
        <tr className="border-t border-line">
          <td className="td font-semibold text-ink">Range total</td>
          {columns.slice(1).map((c) => {
            const m = metrics.find((x) => x.key === c.key || x.id === c.key) || { kind: 'sum', unit: '' }
            return (
              <td key={c.key} className="td-num font-semibold text-ink" title={String(totals[c.key])}>
                {formatValue(totals[c.key], m)}
              </td>
            )
          })}
        </tr>
      }
    />
  )
}

function spanOf(payload, range) {
  const dr = payload?.meta?.dateRange
  if (dr?.from && dr?.to) return Math.max(2, Math.round((new Date(dr.to) - new Date(dr.from)) / 86400000))
  return { last_7d: 7, last_14d: 14, last_90d: 90, last_365d: 365 }[range?.preset] || 30
}

