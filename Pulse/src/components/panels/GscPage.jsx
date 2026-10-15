import { useMemo, useState } from 'react'
import { Search, Globe, MonitorSmartphone, FileText, KeyRound, Lightbulb, ExternalLink, TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { NoticeBar, EmptyState, ErrorState, Skeleton } from '../ui/States'
import { Pill, Tag, TrendPill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import PageHeader from '../platform/PageHeader'
import KpiCard from '../metrics/KpiCard'
import MetricTable from '../metrics/MetricTable'
import DataTable from '../ui/DataTable'
import ColumnChart from '../charts/ColumnChart'
import AreaTrend from '../charts/AreaTrend'
import BarList from '../charts/BarList'
import Donut from '../charts/Donut'
import { usePlatformDetail } from '../../hooks/usePlatformDetail'
import { metricsOf, timelineOf, isErrorPayload, errorText, platformState } from '../../lib/normalize'
import { platformMeta } from '../../lib/platforms'
import { compact, dateLong, formatValue, percent, decimal, hostOf } from '../../lib/format'
import { cls } from '../../lib/cls'

const COLOR = platformMeta('searchConsole').color

const DIMENSIONS = [
  { value: 'date', label: 'Timeline', Icon: TrendingUp },
  { value: 'query', label: 'Keywords', Icon: KeyRound },
  { value: 'page', label: 'Pages', Icon: FileText },
  { value: 'country', label: 'Countries', Icon: Globe },
  { value: 'device', label: 'Devices', Icon: MonitorSmartphone },
]

/**
 * GscPage — Google Search Console.
 *
 * The combined endpoint only carries the date timeline, so each non-date
 * dimension is fetched on demand from GET /api/gsc?dimensions=… and rendered
 * as both a ranked bar list and an exportable table.
 */
export default function GscPage({ payload, range, sample, healthDetail, onRetry }) {
  const [dim, setDim] = useState('date')
  const [chartMetric, setChartMetric] = useState('impressions')
  const meta = platformMeta('searchConsole')

  const detail = usePlatformDetail('searchConsole', range, dim === 'date' ? {} : { dimensions: dim, rowLimit: 100 }, {
    enabled: dim !== 'date' && !isErrorPayload(payload),
    sample,
  })

  const metrics = useMemo(() => metricsOf('searchConsole', payload), [payload])
  const timeline = useMemo(() => timelineOf(payload), [payload])
  const state = platformState('searchConsole', payload, healthDetail)
  const items = dim === 'date' ? [] : detail.data?.topItems || []
  // NOTE: this hook must stay above every early return — hooks order is fixed
  // across renders, and this component can flip between error and data states.
  const opportunities = useMemo(
    () => findOpportunities(detail.data?.topItems || payload?.topItems || []),
    [detail.data, payload]
  )

  if (isErrorPayload(payload)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader platformKey="searchConsole" status={healthDetail?.configured === false ? 'unconfigured' : 'error'} source={meta.source} blurb={meta.blurb} />
        <Card>
          <ErrorState title="Search Console data could not be loaded" message={errorText(payload)} hint={payload?.hint || healthDetail?.hint} onRetry={onRetry} />
        </Card>
      </div>
    )
  }

  const gscMeta = payload?.meta || {}
  const account = {
    name: hostOf(gscMeta.siteUrl || 'Search Console'),
    handle: gscMeta.siteUrl || null,
    link: gscMeta.siteUrl || null,
    stats: [
      gscMeta.rowCount != null && { label: 'Rows returned', value: gscMeta.rowCount },
      gscMeta.dataPoints != null && { label: 'Days in window', value: gscMeta.dataPoints },
      (gscMeta.verifiedSites || []).length > 0 && { label: 'Verified properties', value: gscMeta.verifiedSites.length },
    ].filter(Boolean),
  }

  const chartRows = timeline.map((r) => ({ ...r }))
  const chartSpec = {
    clicks: { label: 'Clicks', kind: 'sum' },
    impressions: { label: 'Impressions', kind: 'sum' },
    ctr: { label: 'CTR', kind: 'rate', unit: '%' },
    position: { label: 'Avg position', kind: 'avg' },
  }[chartMetric]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        platformKey="searchConsole"
        account={account}
        status={sample ? 'ok' : healthDetail?.status === 'ok' ? 'ok' : state.state}
        statusLabel={sample ? 'Sample data' : undefined}
        source={gscMeta.source || meta.source}
        dateRange={gscMeta.dateRange}
        blurb={meta.blurb}
        right={
          <div className="flex flex-col items-end gap-1.5">
            {gscMeta.previousRange ? (
              <Tag>vs {dateLong(gscMeta.previousRange.from)} – {dateLong(gscMeta.previousRange.to)}</Tag>
            ) : null}
            {(gscMeta.verifiedSites || []).length > 1 ? (
              <span className="text-[11px] text-faint text-right max-w-[220px]">
                {gscMeta.verifiedSites.length} properties verified — showing {hostOf(gscMeta.siteUrl)}
              </span>
            ) : null}
          </div>
        }
      />

      {gscMeta.note ? <NoticeBar tone="info">{gscMeta.note}</NoticeBar> : null}
      {state.message && state.message !== gscMeta.note ? <NoticeBar tone="warn">{state.message}</NoticeBar> : null}

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {['clicks', 'impressions', 'ctr', 'position'].map((k) => {
          const m = metrics.find((x) => x.key === k)
          if (!m) return null
          return (
            <KpiCard
              key={k}
              metric={m}
              color={COLOR}
              size="lg"
              selected={chartMetric === k}
              onClick={() => setChartMetric(k)}
              footnote={
                k === 'position'
                  ? 'Lower is better — a falling number is an improvement'
                  : k === 'ctr'
                  ? 'Clicks ÷ impressions'
                  : m.previous !== null && m.previous !== undefined
                  ? `previous window ${formatValue(m.previous, m)}`
                  : null
              }
            />
          )
        })}
      </section>

      {/* ── Charts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Clicks vs impressions"
            sub="Columns are clicks, the line is the impression volume behind them"
            icon={<TrendingUp className="w-4 h-4" strokeWidth={2} />}
            right={
              <Segmented
                size="sm"
                value={chartMetric}
                onChange={setChartMetric}
                options={['clicks', 'impressions', 'ctr', 'position'].map((k) => ({ value: k, label: chartSpecLabel(k) }))}
              />
            }
          />
          <CardBody>
            {chartMetric === 'clicks' || chartMetric === 'impressions' ? (
              <ColumnChart
                data={chartRows}
                bars={[{ key: 'clicks', label: 'Clicks', color: COLOR, maxBarSize: 18 }]}
                lines={[{ key: 'impressions', label: 'Impressions', color: '#94A1B4', axis: 'right' }]}
                rightAxis
                height={300}
                spanDays={spanOf(payload, range)}
                emptyMessage="No Search Console rows for this window."
              />
            ) : (
              <AreaTrend
                data={chartRows}
                seriesKey={chartMetric}
                color={chartMetric === 'position' ? '#C8871B' : COLOR}
                label={chartSpec.label}
                kind={chartSpec.kind}
                unit={chartSpec.unit}
                height={300}
                spanDays={spanOf(payload, range)}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Performance mix" sub="Clicks and impressions by device" icon={<MonitorSmartphone className="w-4 h-4" strokeWidth={2} />} />
          <CardBody>
            <DeviceSplit range={range} sample={sample} enabled={!isErrorPayload(payload)} />
          </CardBody>
        </Card>
      </div>

      {/* ── Dimensions ───────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Breakdown"
          sub={dim === 'date' ? 'Daily rows for the window' : `Grouped by ${DIMENSIONS.find((d) => d.value === dim)?.label.toLowerCase()}`}
          icon={<Search className="w-4 h-4" strokeWidth={2} />}
          right={
            <Segmented
              size="sm"
              value={dim}
              onChange={setDim}
              options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
            />
          }
        />
        <CardBody>
          {dim === 'date' ? (
            timeline.length ? (
              <DataTable
                rows={timeline.slice().reverse()}
                columns={[
                  { key: 'date', label: 'Date', sortValue: (r) => r.date, render: (r) => <span className="num text-ink font-medium">{dateLong(r.date)}</span> },
                  { key: 'clicks', label: 'Clicks', align: 'right', render: (r) => <span className="num">{compact(r.clicks)}</span> },
                  { key: 'impressions', label: 'Impressions', align: 'right', render: (r) => <span className="num">{compact(r.impressions)}</span> },
                  { key: 'ctr', label: 'CTR', align: 'right', render: (r) => <span className="num">{percent(r.ctr, 2)}</span> },
                  {
                    key: 'position',
                    label: 'Avg position',
                    align: 'right',
                    render: (r) => <span className="num">{r.position === null || r.position === undefined ? <span className="text-faint">—</span> : decimal(r.position, 2)}</span>,
                  },
                ]}
                initialSort={{ key: 'date', dir: 'desc' }}
                exportName="gsc-daily"
                maxHeight={420}
                dense
              />
            ) : (
              <EmptyState title="No daily rows" message="Search Console returned no rows for this window." />
            )
          ) : detail.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : detail.error ? (
            <ErrorState title={`Could not load the ${dim} breakdown`} message={detail.error} onRetry={onRetry} />
          ) : items.length ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
              <div>
                <p className="eyebrow mb-2.5">Top 10 by clicks</p>
                <BarList
                  items={items.slice(0, 10).map((it, i) => ({
                    id: `${it.label}-${i}`,
                    label: it.label,
                    value: it.clicks,
                    rank: i + 1,
                    href: it.url || null,
                    footnote: `${compact(it.impressions)} impressions · ${percent(it.ctr, 2)} CTR · position ${it.position ?? '—'}`,
                  }))}
                  color={COLOR}
                  showShare
                />
              </div>
              <DataTable
                rows={items}
                columns={dimensionColumns(dim)}
                initialSort={{ key: 'clicks', dir: 'desc' }}
                exportName={`gsc-${dim}`}
                maxHeight={460}
                dense
                emptyMessage={`No ${dim} rows returned.`}
              />
            </div>
          ) : (
            <EmptyState
              title={`No ${dim} data`}
              message={`Search Console returned no grouped rows for this window. A newly verified property can take a few days to accumulate ${dim === 'query' ? 'queries' : dim} data.`}
            />
          )}
        </CardBody>
      </Card>

      {/* ── Opportunities ────────────────────────────────────── */}
      {opportunities.length ? (
        <Card>
          <CardHeader
            title="Quick wins"
            sub="Queries with real impression volume but a below-average click-through rate"
            icon={<Lightbulb className="w-4 h-4" strokeWidth={2} />}
          />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {opportunities.map((o) => (
                <li key={o.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-sunken/50 px-3.5 py-2.5">
                  <span className="text-[13px] font-medium text-ink truncate max-w-[46ch]">{o.label}</span>
                  <span className="text-[11.5px] text-muted num">{compact(o.impressions)} impressions</span>
                  <Pill tone={o.ctr < 1 ? 'neg' : 'warn'}>{percent(o.ctr, 2)} CTR</Pill>
                  <span className="text-[11.5px] text-muted num">position {decimal(o.position, 1)}</span>
                  <span className="text-[11.5px] text-faint ml-auto">
                    {o.potentialClicks > 0 ? `≈ ${compact(o.potentialClicks)} extra clicks at the average CTR` : 'already above average'}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <MetricTable
        metrics={metrics}
        platformKey="searchConsole"
        color={COLOR}
        title="All search metrics"
        subtitle={`Everything the Search Console API returned for ${gscMeta.dateRange?.from || 'this window'} → ${gscMeta.dateRange?.to || 'today'}.`}
      />

      {(gscMeta.verifiedSites || []).length ? (
        <Card>
          <CardHeader title="Verified properties" sub="Search Console properties this credential can read" icon={<Globe className="w-4 h-4" strokeWidth={2} />} />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {gscMeta.verifiedSites.map((s) => (
                <li key={s.siteUrl} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                  <span className={cls('w-2 h-2 rounded-full', s.siteUrl === gscMeta.siteUrl ? 'bg-pos' : 'bg-line2')} />
                  <span className="text-[13px] text-ink font-medium truncate">{s.siteUrl}</span>
                  <Tag className="ml-auto">{s.permissionLevel}</Tag>
                  {s.siteUrl === gscMeta.siteUrl ? <Pill tone="pos">In use</Pill> : null}
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-faint mt-3">
              To switch property, set <code className="font-mono bg-sunken px-1 rounded">GSC_SITE_URL</code> in the backend .env and restart the API.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────

function DeviceSplit({ range, sample, enabled }) {
  const detail = usePlatformDetail('searchConsole', range, { dimensions: 'device', rowLimit: 10 }, { enabled, sample })
  const items = detail.data?.topItems || []
  const colors = { Desktop: '#2F6BFF', Mobile: '#2FA84F', Tablet: '#C8871B' }

  if (detail.loading) return <Skeleton className="h-52 w-full rounded-xl" />
  if (!items.length) {
    return <EmptyState title="No device data" message="Search Console returned no device breakdown for this window." />
  }
  const mapped = items.map((i) => ({ label: i.label, value: i.impressions, color: colors[i.label] || '#94A1B4' }))
  return (
    <div className="flex flex-col gap-4">
      <Donut items={mapped} centerLabel="Impressions" height={180} />
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between text-[12.5px]">
            <span className="text-body">{i.label}</span>
            <span className="num text-ink">
              {compact(i.clicks)} clicks · {percent(i.ctr, 2)} CTR
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function dimensionColumns(dim) {
  const first = {
    query: { key: 'label', label: 'Search query', render: (r) => <span className="text-ink font-medium">{r.label}</span> },
    page: {
      key: 'label',
      label: 'Page',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="text-ink font-medium font-mono text-[12px] truncate max-w-[42ch]" title={r.url || r.label}>{r.label}</span>
          {r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-faint hover:text-brand-ink shrink-0">
              <ExternalLink className="w-3 h-3" strokeWidth={2} />
            </a>
          ) : null}
        </span>
      ),
    },
    country: { key: 'label', label: 'Country', render: (r) => <span className="text-ink font-medium">{r.label} <span className="text-faint uppercase text-[11px] ml-1">{r.keys?.[0]}</span></span> },
    device: { key: 'label', label: 'Device', render: (r) => <span className="text-ink font-medium">{r.label}</span> },
  }[dim]

  return [
    first,
    { key: 'clicks', label: 'Clicks', align: 'right', render: (r) => <span className="num">{compact(r.clicks)}</span> },
    { key: 'impressions', label: 'Impressions', align: 'right', render: (r) => <span className="num">{compact(r.impressions)}</span> },
    { key: 'ctr', label: 'CTR', align: 'right', render: (r) => <span className="num">{percent(r.ctr, 2)}</span> },
    { key: 'position', label: 'Position', align: 'right', render: (r) => <span className="num">{r.position == null ? '—' : decimal(r.position, 2)}</span> },
    {
      key: 'clickShare',
      label: 'Share',
      align: 'right',
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1.5 w-14 rounded-full bg-line overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (r.clickShare || 0) * 2)}%`, background: COLOR }} />
          </span>
          <span className="num text-muted">{percent(r.clickShare || 0, 1)}</span>
        </span>
      ),
    },
  ]
}

function findOpportunities(items) {
  if (!items.length) return []
  const withImpressions = items.filter((i) => i.impressions >= 50)
  if (withImpressions.length < 3) return []
  const totalClicks = withImpressions.reduce((s, i) => s + i.clicks, 0)
  const totalImpressions = withImpressions.reduce((s, i) => s + i.impressions, 0)
  const avgCtr = totalImpressions ? (totalClicks / totalImpressions) * 100 : 0
  return withImpressions
    .filter((i) => i.ctr < avgCtr && i.position <= 20)
    .map((i) => ({ ...i, potentialClicks: Math.round(i.impressions * (avgCtr / 100) - i.clicks) }))
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 6)
}

function chartSpecLabel(k) {
  return { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Position' }[k] || k
}

function spanOf(payload, range) {
  const dr = payload?.meta?.dateRange
  if (dr?.from && dr?.to) return Math.max(2, Math.round((new Date(dr.to) - new Date(dr.from)) / 86400000))
  return { last_7d: 7, last_14d: 14, last_90d: 90, last_365d: 365 }[range?.preset] || 30
}
