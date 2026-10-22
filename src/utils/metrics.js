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

/**
 * Smallest baseline a percentage may be computed from. Below this the ratio is
 * noise: 3 → 9 reads "+200%" and means nothing about a young account.
 */
const MIN_TREND_BASELINE = 10;

/**
 * Percentage change — returns null instead of inventing a number.
 *
 * v4.3.4: this used to return 100 for ANY non-zero value over a zero baseline
 * (`if (p === 0) return c === 0 ? 0 : 100`), which is how a dashboard for a
 * beginner account ended up printing "+100%" for the first like it ever
 * received, and "+953%" for reach going 33 → 346. The arithmetic was correct;
 * the claim was not. No baseline, no percentage.
 */
function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) return null;
  return round(((c - p) / Math.abs(p)) * 100, 1);
}

/**
 * justifiedTrend — a percentage only survives when a baseline exists AND is
 * large enough to mean something. Rates keep their own scale (CTR 1.2% → 1.5%
 * is a real statement); counts, sums, levels and averages need at least
 * MIN_TREND_BASELINE in the comparison window.
 */
function justifiedTrend(current, previous, kind) {
  const t = pctChange(current, previous);
  if (t === null) return null;
  if (kind === 'rate') return t;
  if (Math.abs(Number(previous)) < MIN_TREND_BASELINE) return null;
  return t;
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
/**
 * summarize — aggregate a daily series into a summary, respecting metric KIND.
 *
 * The trend is a WITHIN-RANGE comparison, never "vs yesterday" or "vs last
 * week": flow metrics compare the second half of the selected window with the
 * first half, gauges compare the last day with the first day. That basis is now
 * published alongside the number (`trendBasis`, `trendWindows`) so no UI can
 * present it as something it is not, and the number is `null` whenever the
 * comparison is not justified. Only GSC carries a true previous-window trend.
 */
function summarize(id, values) {
  const kind = kindOf(id);
  const nums = (values || []).map((v) => Number(v.value) || 0);
  const dates = (values || []).map((v) => v.date);
  const n = nums.length;
  const { prev, cur } = halves(nums);
  const mid = Math.floor(n / 2);
  const hasDates = n > 0 && dates.length === n && dates.every(Boolean);

  let total;
  let previous = null;
  let trend = null;
  let trendBasis = null;
  let trendWindows = null;

  const halvesWindows = () =>
    hasDates && mid > 0
      ? { current: { from: dates[mid], to: dates[n - 1] }, previous: { from: dates[0], to: dates[mid - 1] } }
      : null;

  switch (kind) {
    case 'gauge': {
      // Level metric: the "total" is where we ended up, not the sum of days.
      total = n ? nums[n - 1] : 0;
      previous = n ? nums[0] : null;
      trend = justifiedTrend(total, previous, 'gauge');
      trendBasis = trend === null ? null : 'last-day-vs-first-day';
      trendWindows = trend === null || !hasDates ? null : { current: dates[n - 1], previous: dates[0] };
      break;
    }
    case 'rate':
    case 'avg': {
      total = round(mean(nums), kind === 'rate' ? 2 : 1);
      previous = cur.length && prev.length ? round(mean(prev), 2) : null;
      trend = previous === null ? null : justifiedTrend(round(mean(cur), 2), previous, kind);
      trendBasis = trend === null ? null : 'second-half-vs-first-half';
      trendWindows = trend === null ? null : halvesWindows();
      break;
    }
    default: {
      // sum | duration | count
      total = round(sum(nums), 2);
      previous = cur.length && prev.length ? round(sum(prev), 2) : null;
      trend = previous === null ? null : justifiedTrend(sum(cur), previous, kind);
      trendBasis = trend === null ? null : 'second-half-vs-first-half';
      trendWindows = trend === null ? null : halvesWindows();
    }
  }

  const nonZero = nums.filter((v) => v !== 0);
  return {
    total,
    previous,
    trend,
    trendBasis,
    trendWindows,
    average: round(n ? sum(nums) / n : 0, 2),
    latest: n ? nums[n - 1] : 0,
    min: n ? Math.min(...nums) : 0,
    max: n ? Math.max(...nums) : 0,
    points: n,
    activePoints: nonZero.length,
    kind,
    unit: unitOf(id),
    // null means "not measured", which is NOT the same claim as "flat".
    direction: trend === null ? null : trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
    favourable: trend === null || trend === 0 ? null : trendIsGood(id, trend),
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
  justifiedTrend,
  MIN_TREND_BASELINE,
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
