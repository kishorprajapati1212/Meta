// Transform raw Meta/YouTube API responses into frontend-friendly shape:
//   { metrics: [...], timeseries: [...], overview: {...} }

function transformMetric(raw) {
  return {
    id: raw.name,
    label: raw.title || raw.name,
    description: raw.description || '',
    period: raw.period,
    values: (raw.values || [])
      .map(v => ({ date: new Date(v.end_time).toISOString().slice(0, 10), value: v.value }))
      .filter(v => v.value !== undefined && v.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function transformMetrics(rawMetrics) {
  const metrics = rawMetrics.map(transformMetric);

  const withSummaries = metrics.map(m => {
    const vals = m.values.map(v => v.value);
    const sum = vals.reduce((a, b) => a + b, 0);
    const count = vals.length;
    const avg = count > 0 ? Math.round(sum / count) : 0;
    const current = vals[vals.length - 1] ?? 0;
    const previous = vals.length > 1 ? vals[vals.length - 2] : current;
    const trend = previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : 0;
    return { ...m, summary: { total: sum, average: avg, latest: current, previous, trend } };
  });

  const timeseries = buildTimeseries(metrics);
  return { metrics: withSummaries, timeseries };
}

function buildTimeseries(metrics) {
  const dateMap = {};
  for (const m of metrics) {
    for (const v of m.values) {
      if (!dateMap[v.date]) dateMap[v.date] = { date: v.date };
      dateMap[v.date][m.id] = v.value;
    }
  }
  return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
}

function buildOverview(metrics) {
  const overview = {};
  const byId = {};
  for (const m of metrics) byId[m.id] = m;

  if (byId.page_follows) { const v = byId.page_follows.summary; overview.followers = { total: v.latest, trend: v.trend }; }
  if (byId.follower_count && !overview.followers) { const v = byId.follower_count.summary; overview.followers = { total: v.latest, trend: v.trend }; }
  if (byId.page_views_total) { const v = byId.page_views_total.summary; overview.pageViews = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.page_media_view) { const v = byId.page_media_view.summary; overview.contentViews = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.page_total_media_view_unique) { const v = byId.page_total_media_view_unique.summary; overview.uniqueViewers = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.page_post_engagements) { const v = byId.page_post_engagements.summary; overview.engagement = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.page_daily_follows) { const v = byId.page_daily_follows.summary; overview.newFollows = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.reach) { const v = byId.reach.summary; overview.reach = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.profile_views) { const v = byId.profile_views.summary; overview.profileVisits = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.total_interactions) { const v = byId.total_interactions.summary; overview.interactions = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.views) { const v = byId.views.summary; overview.views = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.estimatedMinutesWatched) { const v = byId.estimatedMinutesWatched.summary; overview.watchTime = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.subscribersGained) { const v = byId.subscribersGained.summary; overview.subsGained = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.likes) { const v = byId.likes.summary; overview.likes = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.comments) { const v = byId.comments.summary; overview.comments = { total: v.total, average: v.average, trend: v.trend }; }
  if (byId.shares) { const v = byId.shares.summary; overview.shares = { total: v.total, average: v.average, trend: v.trend }; }

  return overview;
}

module.exports = { transformMetrics, buildOverview };
