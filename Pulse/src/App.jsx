import { useEffect, useMemo, useState } from 'react'
import { RadioTower } from 'lucide-react'
import { useAnalytics } from './hooks/useAnalytics'
import SignalStrip from './components/SignalStrip'
import DateRangeControl from './components/DateRangeControl'
import PulseRing from './components/PulseRing'
import PlatformCard from './components/PlatformCard'
import PlatformTabs from './components/PlatformTabs'
import OverviewTrends from './components/OverviewTrends'
import MetricsGrid from './components/MetricsGrid'
import TrendChart from './components/TrendChart'
import DrilldownTable from './components/DrilldownTable'
import ChannelHeader from './components/ChannelHeader'
import GSCPanel from './components/GSCPanel'
import { LoadingState, ErrorState } from './components/States'
import { formatCompact, formatDateLong } from './utils/format'

const PLATFORM_COLOR = {
  facebook: '#2E7CF6', instagram: '#DD2A7B', youtube: '#FF3B4E',
  linkedin: '#0A66C2', pinterest: '#E60023', searchConsole: '#34A853',
}

const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'linkedin', 'pinterest', 'searchConsole']
const ZERNIO = ['linkedin', 'pinterest']

export default function App() {
  const [range, setRange] = useState({ preset: 'last_30d' })
  const [tab, setTab] = useState('overview')
  const [selectedMetricId, setSelectedMetricId] = useState(null)

  const { combined, health, loading, refreshing, error, lastUpdated, refetch } = useAnalytics(range)
  const platformData = combined?.data

  useEffect(() => { setSelectedMetricId(null) }, [tab, range])

  const activePayload = tab !== 'overview' ? platformData?.[tab] : null
  const isZernio = ZERNIO.includes(tab)
  const isGSC = tab === 'searchConsole'
  const activeMetrics = (!isZernio && !isGSC) ? (activePayload?.metrics || []) : []
  const activeMetric = useMemo(() => {
    if (!activeMetrics.length) return null
    return activeMetrics.find(m => m.id === selectedMetricId) || activeMetrics[0]
  }, [activeMetrics, selectedMetricId])

  // LinkedIn/Pinterest: overview cards from overview object
  const zernioOverview = isZernio && activePayload?.overview ? Object.entries(activePayload.overview).filter(([k]) => k !== 'channel') : []
  const zernioTimeseries = isZernio && activePayload?.timeseries ? activePayload.timeseries : []
  const zernioPosts = isZernio ? (activePayload?.posts || activePayload?.latestPosts || []) : [];

  return (
    <div className="min-h-screen bg-ink">
      <SignalStrip health={health} lastUpdated={lastUpdated} onRefresh={refetch} refreshing={refreshing} />

      <header className="max-w-7xl mx-auto px-5 sm:px-8 pt-10 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <RadioTower className="w-4 h-4 text-amber" strokeWidth={2} />
              <span className="eyebrow">social pulse</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-text tracking-tight">
              Cross-platform command center
            </h1>
            <p className="text-sm text-text-muted mt-1.5 max-w-lg">
              Facebook, Instagram, YouTube, LinkedIn, Pinterest & Google Search Console — fused into one dashboard.
            </p>
          </div>
          <DateRangeControl range={range} onChange={setRange} />
        </div>
        {combined?.data && (
          <p className="text-[11px] font-mono text-text-faint mt-4">
            Showing {rangeLabel(range, platformData)}
          </p>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-5 sm:px-8 pb-24 flex flex-col gap-8">
        {loading && <LoadingState />}
        {!loading && error && !combined && <ErrorState message={error} onRetry={refetch} />}

        {!loading && combined && (
          <>
            {/* Pulse ring + 6 platform cards */}
            <section className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-5 items-stretch">
              <div className="panel flex items-center justify-center p-6">
                <PulseRing platformData={platformData} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {ALL_PLATFORMS.map(p => (
                  <PlatformCard
                    key={p} platform={p}
                    payload={platformData?.[p]}
                    active={tab === p} onSelect={setTab}
                  />
                ))}
              </div>
            </section>

            {/* Tabs + Content */}
            <section className="flex flex-col gap-5">
              <PlatformTabs active={tab} onChange={setTab} />

              {tab === 'overview' && <OverviewTrends platformData={platformData} />}

              {/* GSC Panel */}
              {isGSC && activePayload && !activePayload.error && (
                <GSCPanel data={activePayload} color={PLATFORM_COLOR.searchConsole} range={range} />
              )}
              {isGSC && activePayload?.error && (
                <ErrorState message={typeof activePayload.error === 'string' ? activePayload.error : 'GSC unavailable'} onRetry={refetch} />
              )}

              {/* Zernio: LinkedIn / Pinterest */}
              {isZernio && activePayload && !activePayload.error && (
                <div className="flex flex-col gap-5">
                  {activePayload.notice && (
                    <div className="panel2 p-3 text-[11px] text-amber/90 font-mono">{activePayload.notice}</div>
                  )}

                  {/* Channel-like header from account info */}
                  {activePayload.meta?.account && (
                    <div className="panel p-4 flex items-center gap-4">
                      <span className="w-10 h-10 rounded-full bg-surface2 border border-hairline2 flex items-center justify-center font-display font-bold text-lg"
                        style={{ color: PLATFORM_COLOR[tab] }}>
                        {activePayload.meta.account.displayName?.charAt(0) || tab.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-display font-semibold text-text">{activePayload.meta.account.displayName || activePayload.meta.account.username}</p>
                        <p className="text-xs text-text-muted font-mono">@{activePayload.meta.account.username} · {activePayload.meta.account.followers || 0} followers</p>
                      </div>
                    </div>
                  )}

                  {/* Overview cards */}
                  {zernioOverview.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {zernioOverview.map(([k, v]) => (
                        <div key={k} className="panel2 p-3 text-center">
                          <p className="text-xl font-bold text-text tabular-nums">{formatCompact(v.total)}</p>
                          <p className="text-[10px] text-text-faint uppercase font-mono">{k}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Timeseries chart */}
                  {zernioTimeseries.length > 0 && zernioOverview.length > 0 && (
                    <div className="panel p-5">
                      <TrendChart
                        data={zernioTimeseries.map(r => {
                          const firstKey = zernioOverview[0]?.[0] || 'impressions'
                          return { date: r.date, value: r[firstKey] || r.impressions || r.reach || r.likes || r.views || 0 }
                        })}
                        color={PLATFORM_COLOR[tab]}
                        label={zernioOverview[0]?.[0] || 'Activity'}
                      />
                    </div>
                  )}

                  {/* Posts feed */}
                  {zernioPosts.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <p className="eyebrow">Recent Posts</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {zernioPosts.slice(0, 6).map((post, i) => (
                          <a key={i} href={post.platformUrl} target="_blank" rel="noopener noreferrer"
                            className="panel2 p-4 flex gap-3 hover:border-hairline2 transition-all group">
                            {post.thumbnailUrl && <img src={post.thumbnailUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-text line-clamp-2 group-hover:text-amber/80 transition-colors">{post.content || 'No content'}</p>
                              <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-text-faint">
                                {post.analytics?.impressions > 0 && <span>{formatCompact(post.analytics.impressions)} imp</span>}
                                {post.analytics?.likes > 0 && <span>{formatCompact(post.analytics.likes)} likes</span>}
                                {post.analytics?.comments > 0 && <span>{formatCompact(post.analytics.comments)} cmts</span>}
                                {post.analytics?.engagementRate > 0 && <span>{post.analytics.engagementRate}% ER</span>}
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {zernioPosts.length === 0 && !activePayload.notice && (
                    <div className="panel p-6 text-center">
                      <p className="text-sm text-text-muted font-mono">No posts found via Zernio. Publish through Zernio to see analytics.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Meta / YouTube detail */}
              {tab !== 'overview' && !isZernio && !isGSC && activePayload && !activePayload.error && (
                <div className="flex flex-col gap-5">
                  {(tab === 'youtube' || tab === 'facebook') && activePayload.overview?.channel && (
                    <ChannelHeader channel={activePayload.overview.channel} notice={activePayload.notice} platform={tab} />
                  )}
                  {activePayload.notice && !activePayload.overview?.channel && (
                    <div className="panel2 p-3 text-[11px] text-amber/90 font-mono">{activePayload.notice}</div>
                  )}
                  <MetricsGrid metrics={activeMetrics} color={PLATFORM_COLOR[tab]} selectedId={activeMetric?.id} onSelect={setSelectedMetricId} />
                  {activeMetric && (
                    <div className="panel p-5">
                      <TrendChart data={activeMetric.values.map(v => ({ date: v.date, value: v.value }))} color={PLATFORM_COLOR[tab]} label={activeMetric.label} />
                    </div>
                  )}
                  <DrilldownTable metrics={activeMetrics} />
                </div>
              )}

              {/* Error state for detail tabs */}
              {tab !== 'overview' && activePayload?.error && (
                <ErrorState message={typeof activePayload.error === 'string' ? activePayload.error : activePayload.error?.message || 'Unavailable'} onRetry={refetch} />
              )}
            </section>
          </>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-5 sm:px-8 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-hairline text-[11px] font-mono text-text-faint">
          <span>Pulse · 6-platform analytics desk</span>
          <span>Meta · YouTube · GSC · Zernio APIs</span>
        </div>
      </footer>
    </div>
  )
}

function rangeLabel(range, platformData) {
  const any = platformData?.facebook?.meta || platformData?.instagram?.meta || platformData?.youtube?.meta
  const dr = any?.dateRange
  if (dr?.from && dr?.to) return `${formatDateLong(dr.from)} — ${formatDateLong(dr.to)}`
  if (range.since) return `${formatDateLong(range.since)} — ${formatDateLong(range.until)}`
  return range.preset?.replace('_', ' ')
}
