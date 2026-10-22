import { useState } from 'react'
import { Activity, Server, PlugZap, RefreshCw, Terminal, CheckCircle2, AlertTriangle, FlaskConical, Save, RotateCcw, ExternalLink, FileDown, Download, EyeOff, KeyRound } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { StatusPill, Pill, Tag } from '../ui/Pill'
import BrandIcon from '../ui/BrandIcon'
import { NoticeBar, EmptyState } from '../ui/States'
import { fetchZernioDebug, fetchYouTubeDebug, fetchZernioAccounts, fetchReport, reportUrl, fetchIndex, setBaseUrl, getBaseUrl, effectiveBase, describeError } from '../../lib/api'
import { healthCountsOf, healthDetailsOf } from '../../lib/normalize'
import { PLATFORM_ORDER, platformMeta } from '../../lib/platforms'
import { relativeTime, dateTime, compact } from '../../lib/format'
import { cls } from '../../lib/cls'

/**
 * ConnectionsPage — the operations view.
 * Everything the dashboard can tell you about WHY a number is missing lives
 * here: credential state per platform, the exact upstream error, the fix, and
 * one-click diagnostic runs against the Zernio and YouTube debug endpoints.
 */
export default function ConnectionsPage({ health, healthError, sampleMode, onToggleSample, onRefresh, refreshing, lastUpdated }) {
  // App passes a Date, but an ISO string / epoch number must not crash the page.
  const syncStamp = lastUpdated instanceof Date ? lastUpdated : lastUpdated ? new Date(lastUpdated) : null
  const syncLabel = syncStamp && !Number.isNaN(syncStamp.getTime()) ? dateTime(syncStamp.toISOString()) : '—'
  const details = healthDetailsOf(health)
  const counts = healthCountsOf(health)
  const meta = health?.meta || {}
  const [url, setUrl] = useState(getBaseUrl())
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState(null)
  const [report, setReport] = useState({ state: 'idle' })
  const [accounts, setAccounts] = useState({ state: 'idle' })

  async function runReport(days = 30) {
    setReport({ state: 'loading', days })
    try {
      const res = await fetchReport({ days, raw: true })
      setReport({ state: 'ok', days, res })
    } catch (e) {
      setReport({ state: 'error', days, message: describeError(e) })
    }
  }

  function downloadReport() {
    const res = report.res
    if (!res) return
    try {
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `meta-report-${String(res?.meta?.generatedAt || new Date().toISOString()).slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch {
      window.open(reportUrl({ days: report.days || 30 }), '_blank')
    }
  }

  async function runAccounts() {
    setAccounts({ state: 'loading' })
    try {
      const res = await fetchZernioAccounts()
      setAccounts({ state: 'ok', list: res?.data?.accounts || [], hasAnalyticsAccess: res?.data?.hasAnalyticsAccess })
    } catch (e) {
      setAccounts({ state: 'error', message: describeError(e) })
    }
  }

  async function saveBase() {
    setBaseUrl(url.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
    onRefresh()
  }

  async function testConnection() {
    setProbe({ state: 'loading' })
    try {
      const info = await fetchIndex()
      setProbe({ state: 'ok', info })
    } catch (e) {
      setProbe({ state: 'error', message: describeError(e) })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {sampleMode ? (
        <NoticeBar tone="warn" icon={<FlaskConical className="w-3.5 h-3.5" strokeWidth={2.2} />}>
          <b>Sample data mode is on.</b> Every number on screen is generated locally so the layout can be reviewed —
          nothing below reflects your accounts.{' '}
          <button className="underline font-semibold" onClick={onToggleSample}>Switch back to live data</button>
        </NoticeBar>
      ) : null}

      {healthError ? (
        <NoticeBar tone="error">
          <b>Health check failed:</b> {typeof healthError === 'string' ? healthError : healthError?.message || String(healthError)}
        </NoticeBar>
      ) : null}

      {/* ── Channel status ───────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Channel connections"
          sub={`Credential and reachability check · ${health?.data ? `${counts.ok}/${counts.total} healthy` : 'no health data yet'}`}
          icon={<Activity className="w-4 h-4" strokeWidth={2} />}
          right={
            <button className="btn text-[12px]" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cls('w-3.5 h-3.5', refreshing && 'animate-spin')} strokeWidth={2} />
              Re-check
            </button>
          }
        />
        {!health ? (
          <CardBody>
            <EmptyState title="No health data" message="GET /api/health has not answered yet." action={<button className="btn-primary" onClick={onRefresh}>Run health check</button>} />
          </CardBody>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
            {PLATFORM_ORDER.map((pk) => {
              const d = details[pk] || {}
              const pm = platformMeta(pk)
              const status = d.status || 'unknown'
              return (
                <div key={pk} className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${pm.color}12`, color: pm.color }}>
                      <BrandIcon platform={pk} className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-ink truncate">{pm.label}</p>
                      <p className="text-[11px] text-faint truncate">{d.source || pm.source}</p>
                    </div>
                    <StatusPill
                      status={status === 'ok' ? 'ok' : d.configured === false || status === 'not_configured' ? 'unconfigured' : status === 'no_account' ? 'empty' : 'error'}
                      label={status === 'ok' ? 'Connected' : status === 'no_account' ? 'No account' : status === 'not_configured' ? 'Not set' : status === 'untested' ? 'Untested' : 'Failing'}
                    />
                  </div>

                  <p className={cls('text-[12.5px] leading-relaxed break-words', status === 'ok' ? 'text-body' : 'text-neg')}>
                    {d.message || 'Not checked yet.'}
                  </p>

                  {d.hint ? (
                    <p className="text-[11.5px] leading-relaxed bg-warn-soft border border-warn-line text-warn rounded-lg px-2.5 py-2">
                      <b>Fix: </b>{d.hint}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-auto pt-2 border-t border-line/70 text-[11px] text-faint num">
                    {d.followers != null ? <span>{d.followers.toLocaleString('en-US')} followers</span> : null}
                    {d.accountId ? <span className="font-mono truncate max-w-[130px]" title={d.accountId}>id {d.accountId}</span> : null}
                    {d.hasAnalyticsAccess === false ? <Pill tone="warn">Analytics access off</Pill> : null}
                    {d.sites?.length ? <span className="truncate max-w-[180px]" title={d.sites.join(', ')}>{d.sites.length} site(s)</span> : null}
                    {d.checkedAt ? <span className="ml-auto">checked {relativeTime(d.checkedAt)}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Diagnostics ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DebugCard
          title="Zernio diagnostics"
          sub="Walks every Zernio call the LinkedIn and Pinterest endpoints depend on"
          endpoint="GET /api/zernio/debug"
          runner={fetchZernioDebug}
          accent="#0A66C2"
        />
        <DebugCard
          title="YouTube diagnostics"
          sub="Token refresh → channel read → analytics report, step by step"
          endpoint="GET /api/youtube/debug"
          runner={fetchYouTubeDebug}
          accent="#FF0033"
        />
      </div>

      {/* ── One-call diagnostic report ───────────────────────── */}
      <Card>
        <CardHeader
          title="Full diagnostic report"
          sub="One call returns everything: all six channels, both audience diagnoses, the raw upstream bodies and the Pinterest / LinkedIn probes"
          icon={<FileDown className="w-4 h-4" strokeWidth={2} />}
          right={<Tag>GET /api/report</Tag>}
        />
        <CardBody className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-relaxed text-muted">
            Send this when a number looks wrong. It bypasses every cache, times each upstream call, redacts all
            credentials, and says per channel whether a zero came from the platform or from this API.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => runReport(30)} disabled={report.state === 'loading'}>
              {report.state === 'loading' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={2} /> : <FileDown className="w-3.5 h-3.5" strokeWidth={2} />}
              Build report (30 days)
            </button>
            <button className="btn" onClick={() => runReport(90)} disabled={report.state === 'loading'}>90 days</button>
            <a className="btn" href={reportUrl({ days: 90, format: 'text' })} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
              Text digest
            </a>
            {report.state === 'ok' ? (
              <button className="btn" onClick={downloadReport}>
                <Download className="w-3.5 h-3.5" strokeWidth={2} />
                Download JSON
              </button>
            ) : null}
          </div>

          {report.state === 'error' ? <NoticeBar tone="error">{report.message}</NoticeBar> : null}

          {report.state === 'ok' ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Fact label="API version" value={report.res?.meta?.version || '—'} />
                <Fact label="Built in" value={`${report.res?.meta?.tookMs ?? '—'} ms`} />
                <Fact label="Payload" value={`${compact(Math.round((report.res?.meta?.bytes || 0) / 1024))} KB`} />
                <Fact label="Upstream errors" value={String((report.res?.errors || []).length)} />
              </div>

              {Object.entries(report.res?.data?.probes || {}).map(([key, pr]) => (
                <div
                  key={key}
                  className={cls(
                    'rounded-xl border px-3.5 py-3 flex flex-col gap-1.5',
                    pr.entitlementGap ? 'border-warn-line bg-warn-soft/50' : 'border-line bg-sunken/50'
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <BrandIcon platform={key} className="w-4 h-4" />
                    <span className="text-[12.5px] font-semibold text-ink capitalize">{key} probe</span>
                    {pr.entitlementGap ? (
                      <Pill tone="warn" icon={<EyeOff className="w-3 h-3" strokeWidth={2.2} />}>not measured upstream</Pill>
                    ) : pr.postsWithAnyMetric > 0 ? (
                      <Pill tone="pos">metrics upstream</Pill>
                    ) : (
                      <Pill tone="neutral">no metrics upstream</Pill>
                    )}
                    <span className="text-[11px] text-faint num ml-auto">
                      {pr.postsUpstream ?? 0} post(s) · {pr.postsWithAnyMetric ?? 0} with metrics
                      {pr.oldestPostAgeDays != null ? ` · oldest ${pr.oldestPostAgeDays}d` : ''}
                    </span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-body">{pr.verdict}</p>
                </div>
              ))}

              {report.res?.meta?.truncations?.length ? (
                <p className="text-[11.5px] text-faint">
                  {report.res.meta.truncations.length} list(s) were capped for size — the full payload is in the
                  downloaded JSON.
                </p>
              ) : null}
              <p className="text-[11.5px] text-faint">
                From a terminal instead:{' '}
                <code className="font-mono text-muted">npm run report -- --api {effectiveBase() || '<your-api-url>'}</code>
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── Zernio account entitlements ─────────────────────── */}
      <Card>
        <CardHeader
          title="Connected accounts (Zernio)"
          sub="What LinkedIn and Pinterest actually allow this connection to read"
          icon={<KeyRound className="w-4 h-4" strokeWidth={2} />}
          right={
            <button className="btn text-[12px]" onClick={runAccounts} disabled={accounts.state === 'loading'}>
              {accounts.state === 'loading' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={2} /> : <PlugZap className="w-3.5 h-3.5" strokeWidth={2} />}
              Read accounts
            </button>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {accounts.state === 'idle' ? (
            <p className="text-[12.5px] text-faint">
              Shows account type, granted scopes and the account-level gauges. When Pinterest returns no pin count,
              board count or monthly views, its organic analytics are not available to this connection — that is an
              entitlement gap, not a posting problem.
            </p>
          ) : null}
          {accounts.state === 'error' ? <NoticeBar tone="error">{accounts.message}</NoticeBar> : null}
          {accounts.state === 'ok' ? (
            <div className="flex flex-col gap-2.5">
              {accounts.hasAnalyticsAccess === false ? (
                <NoticeBar tone="warn">
                  Zernio reports <b>analytics access is off</b> for this API key — post metrics stay empty until it is
                  enabled on the plan.
                </NoticeBar>
              ) : null}
              {(accounts.list || []).map((a) => {
                const gaugesEmpty = a.pinCount == null && a.boardCount == null && a.monthlyViews == null
                return (
                  <div key={a.zernioAccountId || a.platform} className="rounded-xl border border-line bg-sunken/50 px-3.5 py-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <BrandIcon platform={a.platform} className="w-4 h-4" />
                      <span className="text-[13px] font-semibold text-ink">@{a.username || '—'}</span>
                      {a.accountType ? <Pill tone="neutral">{a.accountType}</Pill> : null}
                      {a.platform === 'pinterest' && !a.accountType && gaugesEmpty ? (
                        <Pill tone="warn" icon={<EyeOff className="w-3 h-3" strokeWidth={2.2} />}>no analytics entitlement</Pill>
                      ) : null}
                      {a.needsReconnection ? <Pill tone="neg">needs reconnection</Pill> : null}
                      {a.platformStatus && a.platformStatus !== 'ok' ? <Pill tone="warn">{String(a.platformStatus)}</Pill> : null}
                      <span className="text-[11px] text-faint num ml-auto">
                        connected {a.connectedAt ? String(a.connectedAt).slice(0, 10) : '—'}
                        {a.lastSuccessfulPublishAt ? ` · last publish ${String(a.lastSuccessfulPublishAt).slice(0, 10)}` : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <Fact label="Followers" value={a.followers != null ? compact(a.followers) : '—'} />
                      <Fact label="Pins" value={a.pinCount != null ? compact(a.pinCount) : 'not reported'} />
                      <Fact label="Boards" value={a.boardCount != null ? compact(a.boardCount) : 'not reported'} />
                      <Fact label="Monthly views" value={a.monthlyViews != null ? compact(a.monthlyViews) : 'not reported'} />
                      <Fact label="Scopes" value={a.scopes?.length ? `${a.scopes.length} granted` : 'not reported'} />
                    </div>
                    {a.platformStatusReason ? (
                      <p className="text-[11.5px] text-warn">{a.platformStatusReason}</p>
                    ) : null}
                    {a.scopes?.length ? (
                      <p className="text-[11px] text-faint font-mono break-words">{a.scopes.join(', ')}</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── API target ───────────────────────────────────────── */}
      <Card>
        <CardHeader title="API target" sub="Where this dashboard reads its data from" icon={<Server className="w-4 h-4" strokeWidth={2} />} />
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[260px] flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-muted">Base URL</span>
              <input
                className="input font-mono text-[12.5px]"
                value={url}
                placeholder="leave empty for same origin (recommended)"
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
              />
            </label>
            <button className="btn-primary" onClick={saveBase}>
              <Save className="w-3.5 h-3.5" strokeWidth={2.2} />
              Save &amp; reload
            </button>
            <button
              className="btn"
              onClick={() => { setUrl(''); setBaseUrl(''); onRefresh() }}
              title="Clear the override and use the same origin"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
              Reset
            </button>
            <button className="btn" onClick={testConnection}>
              <PlugZap className="w-3.5 h-3.5" strokeWidth={2} />
              Test
            </button>
          </div>

          <p className="text-[12px] text-faint">
            Currently resolving to <code className="font-mono bg-sunken px-1.5 py-0.5 rounded text-body">{effectiveBase()}</code>.
            In development the Vite server proxies <code className="font-mono">/api</code> to the backend, so same-origin works out of the box.
          </p>

          {probe?.state === 'loading' ? <p className="text-[12.5px] text-muted">Contacting the API…</p> : null}
          {probe?.state === 'error' ? <NoticeBar tone="error">{probe.message}</NoticeBar> : null}
          {probe?.state === 'ok' ? (
            <div className="rounded-xl border border-pos-line bg-pos-soft/60 p-3.5">
              <p className="text-[12.5px] font-semibold text-pos flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.4} />
                {probe.info.name} v{probe.info.version} answered
              </p>
              <p className="text-[11.5px] text-body mt-1.5 font-mono break-words">
                platforms: {(probe.info.platforms || []).join(', ')}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── Server ───────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Backend" sub="Runtime facts reported by the API itself" icon={<Terminal className="w-4 h-4" strokeWidth={2} />} />
        <CardBody>
          {health ? (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Fact label="API version" value={meta.version || '—'} />
              <Fact label="Uptime" value={meta.uptime ? `${Math.round(meta.uptime / 60)} min` : '—'} />
              <Fact label="Health check took" value={meta.checkedInMs ? `${meta.checkedInMs} ms` : '—'} />
              <Fact label="Server time" value={health.data?.serverTime ? dateTime(health.data.serverTime) : '—'} />
              <Fact label="Channels configured" value={`${counts.configured} / ${counts.total}`} />
              <Fact label="Channels healthy" value={`${counts.ok} / ${counts.total}`} />
              <Fact label="Last dashboard sync" value={syncLabel} />
              <Fact label="Data mode" value={sampleMode ? 'Sample (local)' : 'Live API'} />
            </dl>
          ) : (
            <p className="text-[13px] text-faint">No health payload yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-sunken/50 px-3.5 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-[13px] font-semibold text-ink mt-1 num break-words">{value}</dd>
    </div>
  )
}

function DebugCard({ title, sub, endpoint, runner, accent }) {
  const [state, setState] = useState({ status: 'idle' })

  async function run() {
    setState({ status: 'loading' })
    try {
      const res = await runner()
      setState({ status: 'ok', data: res?.data || res })
    } catch (e) {
      setState({ status: 'error', message: describeError(e) })
    }
  }

  const summary = state.data?.summary
  const ok = summary && /ok/i.test(summary) && !/fail|issue/i.test(summary)

  return (
    <Card>
      <CardHeader
        title={title}
        sub={sub}
        icon={<Terminal className="w-4 h-4" strokeWidth={2} />}
        right={
          <div className="flex items-center gap-2">
            <Tag>{endpoint.replace('GET ', '')}</Tag>
            <button className="btn text-[12px]" onClick={run} disabled={state.status === 'loading'}>
              {state.status === 'loading' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={2} /> : <PlugZap className="w-3.5 h-3.5" strokeWidth={2} />}
              Run
            </button>
          </div>
        }
      />
      <CardBody>
        {state.status === 'idle' ? (
          <p className="text-[12.5px] text-faint">
            Runs the endpoint and prints exactly which upstream call failed and why. Nothing is modified.
          </p>
        ) : null}
        {state.status === 'loading' ? <p className="text-[12.5px] text-muted">Running…</p> : null}
        {state.status === 'error' ? <NoticeBar tone="error">{state.message}</NoticeBar> : null}
        {state.status === 'ok' ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              {ok ? <CheckCircle2 className="w-4 h-4 text-pos" strokeWidth={2.2} /> : <AlertTriangle className="w-4 h-4 text-warn" strokeWidth={2.2} />}
              <span className={cls('text-[13px] font-semibold', ok ? 'text-pos' : 'text-warn')}>{summary}</span>
            </div>
            <pre className="text-[11px] leading-relaxed font-mono text-muted bg-sunken border border-line rounded-xl p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words">
              {JSON.stringify(state.data, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
