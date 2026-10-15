export function formatCompact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const num = Number(n)
  if (Math.abs(num) < 1000) return num.toLocaleString('en-US')
  return new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(num)
}
export function formatFull(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('en-US')
}
export function formatTrend(t) {
  if (t === null || t === undefined || Number.isNaN(t)) return '—'
  return `${t>0?'+':''}${t.toFixed(1)}%`
}
export function formatDateShort(d) {
  if (!d) return ''; const dt = new Date(d+(d.length===10?'T00:00:00':''))
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})
}
export function formatDateLong(d) {
  if (!d) return ''; const dt = new Date(d+(d.length===10?'T00:00:00':''))
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
}
export function primaryTrend(overview) {
  if (!overview) return 0
  const priority = ['followers','impressions','clicks','engagement','reach','views','subsGained','pageViews','interactions','likes','comments']
  for (const key of priority) if (overview[key] && typeof overview[key].trend === 'number') return overview[key].trend
  const trends = Object.values(overview).filter(v=>v&&typeof v==='object'&&typeof v.trend==='number').map(v=>v.trend)
  if (!trends.length) return 0
  return trends.reduce((a,b)=>a+b,0)/trends.length
}
/** Primary metric with fallback for Zernio platforms where overview may be empty */
export function primaryMetricLabel(overview, payload) {
  if (overview && Object.keys(overview).length > 0) {
    const priority = [
      ['followers','Followers'],['impressions','Impressions'],['clicks','Clicks'],
      ['engagement','Engagement'],['views','Views'],['reach','Reach'],
      ['pageViews','Page Views'],['likes','Likes'],['comments','Comments'],['interactions','Interactions'],
    ]
    for (const [key,label] of priority) if (overview[key]) return { key, label, ...overview[key] }
    const k = Object.keys(overview)[0]
    if (k) return { key: k, label: k, ...overview[k] }
  }
  // Fallback: show post count if available (Zernio platforms)
  const pc = payload?.postCount || payload?.posts?.length || payload?.latestPosts?.length || 0
  const ts = payload?.timeseries?.length || 0
  if (pc > 0) return { key: 'posts', label: 'Posts', total: pc, trend: 0 }
  if (ts > 0) return { key: 'active', label: 'Active days', total: ts, trend: 0 }
  return null
}
