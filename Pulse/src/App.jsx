import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import OverviewPage from './components/panels/OverviewPage'
import PlatformPage from './components/panels/PlatformPage'
import GscPage from './components/panels/GscPage'
import ConnectionsPage from './components/panels/ConnectionsPage'
import AudiencePage from './components/panels/AudiencePage'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { NoticeBar } from './components/ui/States'
import { Card } from './components/ui/Card'
import { ErrorState } from './components/ui/States'
import { useAnalytics } from './hooks/useAnalytics'
import { readPref, writePref, PREF_KEYS } from './lib/prefs'
import { effectiveBase } from './lib/api'
import { PLATFORM_ORDER, platformMeta } from './lib/platforms'
import { dateLong, relativeTime } from './lib/format'

const TITLES = {
  overview: { title: 'Overview', sub: 'All six channels in one view' },
  audience: { title: 'Audience', sub: 'Age, gender, geography and devices — per platform' },
  connections: { title: 'Connections', sub: 'Credentials, health and API diagnostics' },
}

export default function App() {
  const [view, setView] = useState(() => readPref(PREF_KEYS.view, 'overview'))
  const [audienceChannel, setAudienceChannel] = useState('all')
  const [range, setRange] = useState(() => readPref(PREF_KEYS.range, { preset: 'last_30d' }))
  const [sampleMode, setSampleMode] = useState(() => readPref(PREF_KEYS.sample, false))
  const [collapsed, setCollapsed] = useState(() => readPref(PREF_KEYS.sidebar, false))
  const [mobileNav, setMobileNav] = useState(false)

  const {
    platformData, summary, health, healthDetails, loading, refreshing, retrying, stale, error, healthError, lastUpdated, isSample, refetch,
  } = useAnalytics(range, { sample: sampleMode })

  useEffect(() => writePref(PREF_KEYS.view, view), [view])
  useEffect(() => writePref(PREF_KEYS.range, range), [range])
  useEffect(() => writePref(PREF_KEYS.sample, sampleMode), [sampleMode])
  useEffect(() => writePref(PREF_KEYS.sidebar, collapsed), [collapsed])

  // "r" refreshes, unless the user is typing in a field.
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) refetch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refetch])

  const isPlatform = PLATFORM_ORDER.includes(view)
  const payload = isPlatform ? platformData?.[view] : null
  const effectiveRange = useMemo(() => {
    for (const pk of PLATFORM_ORDER) {
      const dr = platformData?.[pk]?.meta?.dateRange
      if (dr?.from && dr?.to) return dr
    }
    return null
  }, [platformData])

  const header = useMemo(() => {
    if (isPlatform) {
      const pm = platformMeta(view)
      const dr = payload?.meta?.dateRange || effectiveRange
      return {
        title: pm.label,
        sub: dr?.from ? `${pm.source} · ${dateLong(dr.from)} – ${dateLong(dr.to)}` : pm.blurb,
      }
    }
    const t = TITLES[view] || TITLES.overview
    return {
      title: t.title,
      sub: effectiveRange?.from
        ? `${t.sub} · ${dateLong(effectiveRange.from)} – ${dateLong(effectiveRange.to)}`
        : t.sub,
    }
  }, [view, isPlatform, payload, effectiveRange])

  const onRefresh = useCallback(() => refetch(), [refetch])
  const toggleSample = useCallback(() => setSampleMode((v) => !v), [])

  return (
    <div className="min-h-screen flex bg-canvas">
      <Sidebar
        active={view}
        onChange={setView}
        healthDetails={healthDetails || {}}
        platformData={platformData || {}}
        collapsed={collapsed}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
        sampleMode={isSample}
        apiBase={effectiveBase()}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          title={header.title}
          subtitle={header.sub}
          range={range}
          onRangeChange={setRange}
          effectiveRange={effectiveRange}
          onRefresh={onRefresh}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          sampleMode={isSample}
          onToggleSample={toggleSample}
          onOpenMobileNav={() => setMobileNav(true)}
          error={error}
          connected={summary?.connected ?? 0}
          total={summary?.platforms?.length ?? 6}
        />

        <main className="flex-1 px-4 sm:px-6 py-5 pb-16 max-w-[1560px] w-full mx-auto">
          <div className="flex flex-col gap-3 mb-3 empty:mb-0">
            {retrying && !error ? (
              <NoticeBar tone="info">The API is slow to answer (cold starts can take a few seconds) — retrying automatically…</NoticeBar>
            ) : null}
            {error && platformData ? (
              <NoticeBar tone="warn">
                <b>Showing the last data that loaded.</b> This refresh could not reach the API: {error} Nothing is lost — the next
                successful refresh replaces it.
              </NoticeBar>
            ) : null}
            {stale && healthError ? (
              <NoticeBar tone="warn">Connection status is unavailable right now: {healthError}</NoticeBar>
            ) : null}
          </div>
          <ErrorBoundary onRetry={onRefresh}>
          {error && !platformData ? (
            <Card>
              <ErrorState
                title="The analytics API did not answer"
                message={error}
                hint="Check that the backend is running, then confirm the base URL on the Connections page. Sample mode (the flask icon, top right) renders the full dashboard with generated numbers if you just want to review the design."
                onRetry={onRefresh}
              />
            </Card>
          ) : view === 'overview' ? (
            <OverviewPage
              platformData={platformData}
              summary={summary}
              healthDetails={healthDetails || {}}
              range={range}
              sample={isSample}
              onNavigate={setView}
              loading={loading}
              onRetry={onRefresh}
            />
          ) : view === 'audience' ? (
            <AudiencePage
              platformData={platformData}
              range={effectiveRange}
              sample={sample}
              initialChannel={audienceChannel}
              onChannelChange={setAudienceChannel}
              onNavigate={(v) => {
                const target = String(v)
                if (target.startsWith('audience:')) {
                  setAudienceChannel(target.slice('audience:'.length))
                  return
                }
                setView(target)
              }}
            />
          ) : view === 'connections' ? (
            <ConnectionsPage
              health={health}
              healthError={healthError}
              sampleMode={isSample}
              onToggleSample={toggleSample}
              onRefresh={onRefresh}
              refreshing={refreshing}
              lastUpdated={lastUpdated}
            />
          ) : view === 'searchConsole' ? (
            <GscPage
              payload={payload}
              range={range}
              sample={isSample}
              healthDetail={healthDetails?.searchConsole}
              onRetry={onRefresh}
            />
          ) : (
            <PlatformPage
              platformKey={view}
              onNavigate={(v) => {
                const target = String(v)
                if (target.startsWith('audience:')) {
                  setAudienceChannel(target.slice('audience:'.length))
                  setView('audience')
                  return
                }
                setView(target)
              }}
              payload={payload}
              healthDetail={healthDetails?.[view]}
              range={range}
              sample={isSample}
              onRetry={onRefresh}
            />
          )}
          </ErrorBoundary>
        </main>

        <footer className="border-t border-line px-4 sm:px-6 py-4">
          <div className="max-w-[1560px] mx-auto flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-faint">
            <span className="num">
              Pulse · 6-platform analytics desk · Meta Graph, YouTube Analytics, Search Console &amp; Zernio
            </span>
            <span className="flex items-center gap-3">
              {lastUpdated ? <span className="num">Updated {relativeTime(lastUpdated.toISOString())}</span> : null}
              <span className="hidden sm:inline">Press</span>
              <kbd className="hidden sm:inline-flex items-center rounded border border-line2 bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">R</kbd>
              <span className="hidden sm:inline">to refresh</span>
              <a href={`${effectiveBase()}/docs.html`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-brand-ink">
                <BookOpen className="w-3 h-3" strokeWidth={2} /> API docs
              </a>
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
