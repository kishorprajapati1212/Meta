function transformMetric(raw) {
  return {
    id: raw.name, label: raw.title || raw.name, description: raw.description || '', period: raw.period,
    values: (raw.values || []).map(v => ({ date: new Date(v.end_time).toISOString().slice(0, 10), value: v.value })).filter(v => v.value != null).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
function transformMetrics(rawMetrics, compact) {
  const metrics = rawMetrics.map(transformMetric);
  const withSummaries = metrics.map(m => {
    const vals = m.values.map(v => v.value);
    const sum = vals.reduce((a, b) => a + b, 0);
    const count = vals.length || 1;
    const avg = Math.round(sum / count);
    const cur = vals[vals.length - 1] ?? 0;
    const prev = vals.length > 1 ? vals[vals.length - 2] : cur;
    const tr = prev > 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : 0;
    return { ...m, summary: { total: sum, average: avg, latest: cur, previous: prev, trend: tr } };
  });
  const timeseries = buildTimeseries(metrics, compact);
  return { metrics: withSummaries, timeseries };
}
function buildTimeseries(metrics, compact) {
  const dm = {};
  for (const m of metrics) for (const v of m.values) {
    if (!dm[v.date]) dm[v.date] = { date: v.date };
    dm[v.date][m.id] = v.value;
  }
  let rows = Object.values(dm).sort((a, b) => a.date.localeCompare(b.date));
  if (compact) rows = rows.filter(r => Object.values(r).some(v => typeof v === 'number' && v > 0));
  return rows;
}
function buildOverview(metrics) {
  const o = {}, by = {};
  for (const m of metrics) by[m.id] = m;
  const add = (k, id) => { if (by[id] && by[id].summary) { const v = by[id].summary; o[k] = { total: v.total, average: v.average, trend: v.trend }; } };
  add('followers', 'page_follows'); if (!o.followers) add('followers', 'follower_count');
  add('pageViews', 'page_views_total'); add('contentViews', 'page_media_view');
  add('uniqueViewers', 'page_total_media_view_unique'); add('engagement', 'page_post_engagements');
  add('newFollows', 'page_daily_follows'); add('reach', 'reach'); add('profileVisits', 'profile_views');
  add('interactions', 'total_interactions'); add('views', 'views'); add('watchTime', 'estimatedMinutesWatched');
  add('subsGained', 'subscribersGained'); add('likes', 'likes'); add('comments', 'comments'); add('shares', 'shares');
  add('clicks', 'clicks'); add('impressions', 'impressions'); add('ctr', 'ctr'); add('position', 'position');
  return o;
}
module.exports = { transformMetrics, buildOverview };
