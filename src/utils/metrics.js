/**
 * metrics.js — single source of truth for "what kind of number is this?"
 *
 * Every metric the API returns is classified into a KIND, which decides how it
 * must be aggregated and how the frontend must format it:
 *
 *   sum      → additive counter (impressions, likes, clicks). total = Σ days
 *   gauge    → point-in-time level (followers, pins, boards). total = LAST value
 *   rate     → percentage (ctr, engagementRate). total = weighted/mean %, never Σ
 *   avg      → mean of a per-day average (avgViewDuration). total = mean
 *   duration → time quantity (watch time, seconds). total = Σ, unit aware
 *   count    → number of things (posts published, unique items). total = Σ
 *
 * Aggregating a gauge or a rate by summing is the #1 source of "wrong numbers"
 * in analytics dashboards (30 days × 1,200 followers ≠ 36,000 followers).
 */

const KIND = {
  // ── Meta / Facebook ────────────────────────────────────────────
  follower_count: { kind: 'gauge', label: 'Followers', unit: '' },
  page_follows: { kind: 'sum', label: 'New follows', unit: '' },
  page_daily_follows: { kind: 'sum', label: 'Follows', unit: '' },
  page_daily_follows_unique: { kind: 'sum', label: 'Follows (unique)', unit: '' },
  page_daily_unfollows_unique: { kind: 'sum', label: 'Unfollows', unit: '' },
  page_views_total: { kind: 'sum', label: 'Page views', unit: '' },
  page_post_engagements: { kind: 'sum', label: 'Post engagements', unit: '' },
  page_media_view: { kind: 'sum', label: 'Media views', unit: '' },
  page_total_media_view_unique: { kind: 'sum', label: 'Unique media viewers', unit: '' },
  page_impressions: { kind: 'sum', label: 'Impressions', unit: '' },
  page_impressions_unique: { kind: 'sum', label: 'Reach (impressions)', unit: '' },
  page_fans: { kind: 'gauge', label: 'Page likes', unit: '' },
  page_fan_adds: { kind: 'sum', label: 'New page likes', unit: '' },
  page_video_views: { kind: 'sum', label: 'Video views', unit: '' },

  // ── Instagram ──────────────────────────────────────────────────
  reach: { kind: 'sum', label: 'Reach', unit: '' },
  impressions: { kind: 'sum', label: 'Impressions', unit: '' },
  profile_views: { kind: 'sum', label: 'Profile views', unit: '' },
  website_clicks: { kind: 'sum', label: 'Website clicks', unit: '' },
  likes: { kind: 'sum', label: 'Likes', unit: '' },
  comments: { kind: 'sum', label: 'Comments', unit: '' },
  shares: { kind: 'sum', label: 'Shares', unit: '' },
  saves: { kind: 'sum', label: 'Saves', unit: '' },
  sends: { kind: 'sum', label: 'Sends', unit: '' },
  reposts: { kind: 'sum', label: 'Reposts', unit: '' },
  total_interactions: { kind: 'sum', label: 'Total interactions', unit: '' },
  follows: { kind: 'sum', label: 'Follows from posts', unit: '' },

  // ── YouTube ────────────────────────────────────────────────────
  views: { kind: 'sum', label: 'Views', unit: '' },
  estimatedMinutesWatched: { kind: 'duration', label: 'Watch time', unit: 'min' },
  averageViewDuration: { kind: 'avg', label: 'Avg view duration', unit: 's' },
  averageViewPercentage: { kind: 'rate', label: 'Avg view %', unit: '%' },
  subscribersGained: { kind: 'sum', label: 'Subscribers gained', unit: '' },
  subscribersLost: { kind: 'sum', label: 'Subscribers lost', unit: '' },
  dislikes: { kind: 'sum', label: 'Dislikes', unit: '' },
  annotationClickThroughRate: { kind: 'rate', label: 'Click-through rate', unit: '%' },

  // ── Google Search Console ──────────────────────────────────────
  clicks: { kind: 'sum', label: 'Clicks', unit: '' },
  ctr: { kind: 'rate', label: 'CTR', unit: '%' },
  position: { kind: 'avg', label: 'Avg position', unit: '', invertTrend: true },

  // ── Zernio (LinkedIn / Pinterest) ──────────────────────────────
  engagement: { kind: 'sum', label: 'Engagement', unit: '' },
  engagementRate: { kind: 'rate', label: 'Engagement rate', unit: '%' },
  outboundClicks: { kind: 'sum', label: 'Outbound clicks', unit: '' },
  pinClicks: { kind: 'sum', label: 'Pin clicks', unit: '' },
  closeups: { kind: 'sum', label: 'Closeups', unit: '' },
  posts: { kind: 'count', label: 'Posts published', unit: '' },
  pins: { kind: 'gauge', label: 'Total pins', unit: '' },
  boards: { kind: 'gauge', label: 'Boards', unit: '' },
  monthlyViews: { kind: 'gauge', label: 'Monthly views', unit: '' },
  followers: { kind: 'gauge', label: 'Followers', unit: '' },
  activeDays: { kind: 'count', label: 'Active days', unit: '' },
};

const DEFAULT_META = { kind: 'sum', label: null, unit: '' };

function meta(id) {
  return KIND[id] || DEFAULT_META;
}
function kindOf(id) {
  return meta(id).kind;
}
function labelOf(id, fallback) {
  return meta(id).label || fallback || humanize(id);
}
function unitOf(id) {
  return meta(id).unit || '';
}
/** For some metrics "up" is bad (avg position 40 → 12 is an improvement). */
function trendIsGood(id, delta) {
  if (meta(id).invertTrend) return delta < 0;
  return delta > 0;
}
function humanize(id) {
  return String(id)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function round(n, dp = 2) {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** Percentage change, safe against zero / null baselines. */
function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? 0 : 100;
  return round(((c - p) / Math.abs(p)) * 100, 1);
}

/** Split an ordered list of {value} into two equal halves (previous | current). */
function halves(values) {
  const n = values.length;
  if (n === 0) return { prev: [], cur: [] };
  if (n === 1) return { prev: [], cur: values };
  const mid = Math.floor(n / 2);
  return { prev: values.slice(0, mid), cur: values.slice(mid) };
}

function sum(arr) {
  return arr.reduce((s, v) => s + (Number(v) || 0), 0);
}
function mean(arr) {
  const nums = arr.map((v) => Number(v) || 0).filter((v) => Number.isFinite(v));
  return nums.length ? sum(nums) / nums.length : 0;
}

/**
 * Aggregate a daily value series into a summary, respecting the metric KIND.
 * `values` = [{ date, value }] already sorted ascending by date.
 */
function summarize(id, values) {
  const kind = kindOf(id);
  const nums = (values || []).map((v) => Number(v.value) || 0);
  const n = nums.length;
  const { prev, cur } = halves(nums);

  let total;
  let previous = null;
  let trend = 0;

  switch (kind) {
    case 'gauge': {
      // Level metric: the "total" is where we ended up, not the sum of days.
      total = n ? nums[n - 1] : 0;
      previous = n ? nums[0] : null;
      trend = pctChange(total, previous);
      break;
    }
    case 'rate':
    case 'avg': {
      total = round(mean(nums), kind === 'rate' ? 2 : 1);
      previous = cur.length && prev.length ? round(mean(prev), 2) : null;
      trend = previous === null ? 0 : pctChange(round(mean(cur), 2), previous);
      break;
    }
    default: {
      // sum | duration | count
      total = round(sum(nums), 2);
      previous = cur.length && prev.length ? round(sum(prev), 2) : null;
      trend = previous === null ? 0 : pctChange(sum(cur), previous);
    }
  }

  const nonZero = nums.filter((v) => v !== 0);
  return {
    total,
    previous,
    trend,
    average: round(n ? sum(nums) / n : 0, 2),
    latest: n ? nums[n - 1] : 0,
    min: n ? Math.min(...nums) : 0,
    max: n ? Math.max(...nums) : 0,
    points: n,
    activePoints: nonZero.length,
    kind,
    unit: unitOf(id),
    direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
    favourable: trend === 0 ? null : trendIsGood(id, trend),
  };
}

/**
 * Turn a set of daily rows (objects keyed by metric id) into a summary map.
 * rows = [{ date, views: 3, likes: 0, ... }]
 */
function summarizeRows(rows, keys) {
  const out = {};
  for (const key of keys) {
    const values = (rows || [])
      .filter((r) => r && r[key] !== undefined && r[key] !== null)
      .map((r) => ({ date: r.date, value: Number(r[key]) || 0 }));
    out[key] = summarize(key, values);
  }
  return out;
}

module.exports = {
  KIND,
  meta,
  kindOf,
  labelOf,
  unitOf,
  trendIsGood,
  humanize,
  round,
  pctChange,
  halves,
  sum,
  mean,
  summarize,
  summarizeRows,
};
