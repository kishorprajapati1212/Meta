/**
 * transform.js — normalises raw platform metric payloads into the shape every
 * endpoint returns:
 *
 *   metrics[]    → { id, label, description, period, kind, unit, values[], summary{} }
 *   timeseries[] → one row per date with every metric as a column
 *   overview{}   → headline cards, keyed, each with total/previous/trend/kind/unit
 *
 * v4.1 changes (see context.md):
 *   • summaries now respect metric KIND (gauge/rate/avg are never summed)
 *   • trends compare the 2nd half of the range against the 1st half, not
 *     "last day vs the day before" (which produced meaningless ±100% swings)
 *   • overview no longer DROPS zero-value metrics — that was the reason
 *     Pinterest/LinkedIn rendered as an empty {} and the UI fell back to a
 *     single "Posts" card.
 */
const { summarize, labelOf, kindOf, unitOf, round, pctChange, sum, mean } = require('./metrics');

/** metric ids that describe a level, not a flow */
const GAUGE_IDS = ['follower_count', 'page_fans'];

function transformMetric(raw) {
  const id = raw.name;
  const values = (raw.values || [])
    .map((v) => ({
      date: new Date(v.end_time).toISOString().slice(0, 10),
      value: Number(v.value) || 0,
    }))
    .filter((v) => v.value !== null && !Number.isNaN(v.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    id,
    label: raw.title || labelOf(id, raw.name),
    description: raw.description || '',
    period: raw.period,
    kind: kindOf(id),
    unit: unitOf(id),
    values,
  };
}

function transformMetrics(rawMetrics, compact) {
  const metrics = rawMetrics.map(transformMetric).map((m) => ({
    ...m,
    summary: summarize(m.id, m.values),
  }));
  const timeseries = buildTimeseries(metrics, compact);
  return { metrics, timeseries };
}

function buildTimeseries(metrics, compact) {
  const byDate = {};
  for (const m of metrics) {
    for (const v of m.values) {
      if (!byDate[v.date]) byDate[v.date] = { date: v.date };
      byDate[v.date][m.id] = v.value;
    }
  }
  let rows = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  if (compact) {
    rows = rows.filter((r) =>
      Object.entries(r).some(([k, v]) => k !== 'date' && typeof v === 'number' && v > 0)
    );
  }
  return rows;
}

/**
 * Headline overview. `by` maps metric id → metric object.
 * Every candidate that EXISTS in the payload is emitted — including zeros —
 * so the frontend always has a complete, correctly-labelled card set.
 */
function buildOverview(metrics) {
  const by = {};
  for (const m of metrics) by[m.id] = m;
  const o = {};

  const add = (key, ids, opts = {}) => {
    const id = (Array.isArray(ids) ? ids : [ids]).find((i) => by[i]);
    if (!id) return;
    const m = by[id];
    const s = m.summary || summarize(m.id, m.values);
    o[key] = {
      key,
      id: m.id,
      label: opts.label || labelOf(key, m.label),
      description: opts.description || m.description || '',
      kind: opts.kind || s.kind,
      unit: opts.unit !== undefined ? opts.unit : s.unit,
      total: s.total,
      previous: s.previous,
      trend: s.trend,
      average: s.average,
      latest: s.latest,
      min: s.min,
      max: s.max,
      points: s.points,
      hasData: s.activePoints > 0 || (opts.kind === 'gauge' && s.total > 0),
    };
  };

  // ── audience (gauge — last value wins, never summed) ──────────
  add('followers', ['follower_count', 'page_fans'], { kind: 'gauge', label: 'Followers' });
  add('newFollows', ['page_daily_follows', 'page_follows'], { label: 'New follows' });
  add('unfollows', ['page_daily_unfollows_unique'], { label: 'Unfollows' });

  // ── reach & consumption ────────────────────────────────────────
  add('pageViews', ['page_views_total'], { label: 'Page views' });
  add('contentViews', ['page_media_view'], { label: 'Media views' });
  add('uniqueViewers', ['page_total_media_view_unique'], { label: 'Unique viewers' });
  add('impressions', ['impressions', 'page_impressions'], { label: 'Impressions' });
  add('reach', ['reach', 'page_impressions_unique'], { label: 'Reach' });
  add('profileVisits', ['profile_views'], { label: 'Profile visits' });

  // ── engagement ─────────────────────────────────────────────────
  add('engagement', ['page_post_engagements'], { label: 'Post engagements' });
  add('interactions', ['total_interactions'], { label: 'Interactions' });
  add('likes', ['likes'], { label: 'Likes' });
  add('comments', ['comments'], { label: 'Comments' });
  add('shares', ['shares'], { label: 'Shares' });
  add('saves', ['saves'], { label: 'Saves' });
  add('dislikes', ['dislikes'], { label: 'Dislikes' });

  // ── YouTube ────────────────────────────────────────────────────
  add('views', ['views'], { label: 'Views' });
  add('watchTime', ['estimatedMinutesWatched'], { kind: 'duration', unit: 'min', label: 'Watch time' });
  add('avgViewDuration', ['averageViewDuration'], { kind: 'avg', unit: 's', label: 'Avg view duration' });
  add('avgViewPercentage', ['averageViewPercentage'], { kind: 'rate', unit: '%', label: 'Avg view %' });
  add('subsGained', ['subscribersGained'], { label: 'Subscribers gained' });
  add('subsLost', ['subscribersLost'], { label: 'Subscribers lost' });

  // ── Google Search Console ──────────────────────────────────────
  add('clicks', ['clicks'], { label: 'Clicks' });
  add('ctr', ['ctr'], { kind: 'rate', unit: '%', label: 'CTR' });
  add('position', ['position'], { kind: 'avg', label: 'Avg position' });

  // ── derived: net audience change ───────────────────────────────
  if (o.newFollows && o.unfollows) {
    const net = round(o.newFollows.total - o.unfollows.total, 0);
    o.netFollows = {
      key: 'netFollows',
      label: 'Net follows',
      kind: 'sum',
      unit: '',
      total: net,
      previous: null,
      trend: 0,
      hasData: net !== 0,
    };
  }
  // ── derived: engagement rate (interactions ÷ reach) ────────────
  const engSource = o.interactions || o.engagement;
  const reachSource = o.reach || o.impressions;
  if (engSource && reachSource && reachSource.total > 0) {
    const rate = round((engSource.total / reachSource.total) * 100, 2);
    const prevRate =
      engSource.previous !== null && reachSource.previous
        ? round((engSource.previous / reachSource.previous) * 100, 2)
        : null;
    o.engagementRate = {
      key: 'engagementRate',
      label: 'Engagement rate',
      kind: 'rate',
      unit: '%',
      total: rate,
      previous: prevRate,
      trend: prevRate === null ? 0 : pctChange(rate, prevRate),
      hasData: rate > 0,
      derived: true,
      formula: `${engSource.label} ÷ ${reachSource.label}`,
    };
  }

  return o;
}

module.exports = { transformMetrics, buildOverview, buildTimeseries, GAUGE_IDS, sum, mean };
