/**
 * graphInsights.js — talking to Meta Graph /insights without losing data.
 *
 * Three production problems this module exists to solve:
 *
 *  1. "(#100) There cannot be more than 30 days (2592000 s) between since and
 *     until." Instagram (and several Page metrics) reject any window longer than
 *     30 days, so the 90-day / 120-day / all-time presets returned NOTHING for
 *     the whole platform. Every request is now split into ≤29-day windows and
 *     the results are merged back into one series.
 *  2. "(#100) Invalid parameter" when Meta retires a metric. A group requests
 *     several metrics in one call, so ONE retired metric used to take the whole
 *     group down. The group is now retried metric-by-metric and whatever Meta
 *     still serves is kept; the rest is reported as a quiet, optional note.
 *  3. Misleading hints. A parameter error is not a permission error — blaming
 *     `pages_read_engagement` sent people off to fix the wrong thing. Hints are
 *     now chosen from Meta's own error code.
 *
 * Nothing here knows about Facebook vs Instagram: callers pass a `requestOne`
 * function that performs a single Graph call for (metric, since, until).
 */
const { isNetworkError, networkHint } = require('./upstreamErrors');

const MAX_WINDOW_SECONDS = 29 * 86400; // Meta's limit is 2592000 s; stay inside it
const MAX_WINDOWS = 8; // ~232 days of per-window calls before we clamp and say so
const CONCURRENCY = 3; // polite parallelism — Meta rate-limits bursts
const DEFAULT_TIMEOUT = 30000;

/** Split [since, until] (unix seconds) into Graph-legal windows. */
function insightWindows(since, until) {
  const s = Number(since);
  const u = Number(until);
  if (!Number.isFinite(s) || !Number.isFinite(u) || u <= s) {
    return { windows: [{ since: s, until: u }], clamped: false, clampedSince: null, requested: { since: s, until: u } };
  }
  const span = u - s;
  if (span <= MAX_WINDOW_SECONDS) {
    return { windows: [{ since: s, until: u }], clamped: false, clampedSince: null, requested: { since: s, until: u } };
  }

  // Too long for MAX_WINDOWS chunks → keep the MOST RECENT data and say so.
  const earliestAllowed = u - MAX_WINDOWS * MAX_WINDOW_SECONDS;
  const start = Math.max(s, earliestAllowed);
  const clamped = start > s;

  const windows = [];
  let cursor = start;
  while (cursor < u) {
    const end = Math.min(cursor + MAX_WINDOW_SECONDS, u);
    windows.push({ since: cursor, until: end });
    if (end >= u) break;
    cursor = end;
  }
  return { windows, clamped, clampedSince: clamped ? start : null, requested: { since: s, until: u } };
}

/** Merge Graph `data[]` blocks from several windows into one per-metric series. */
function mergeInsightBlocks(blocks) {
  const byName = new Map();
  for (const block of blocks || []) {
    for (const metric of block || []) {
      if (!metric || !metric.name) continue;
      const existing = byName.get(metric.name);
      if (!existing) {
        byName.set(metric.name, { ...metric, values: [...(metric.values || [])] });
        continue;
      }
      existing.values.push(...(metric.values || []));
      if (!existing.title && metric.title) existing.title = metric.title;
      if (!existing.description && metric.description) existing.description = metric.description;
    }
  }
  for (const metric of byName.values()) {
    // Windows touch at their boundaries, so the same end_time can arrive twice.
    const byEnd = new Map();
    for (const v of metric.values) {
      const key = String(v && v.end_time !== undefined ? v.end_time : JSON.stringify(v));
      byEnd.set(key, v);
    }
    metric.values = [...byEnd.values()].sort((a, b) => String(a.end_time || '').localeCompare(String(b.end_time || '')));
  }
  return [...byName.values()];
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const graphError = (e) => e?.response?.data?.error || null;
const graphCode = (e) => {
  const err = graphError(e);
  const code = err?.code ?? err?.error_subcode;
  return code === undefined || code === null ? null : Number(code);
};
const graphMessage = (e) => graphError(e)?.message || e?.message || 'Unknown Graph error';
const graphStatus = (e) => e?.response?.status || null;

/**
 * graphHint — an actionable sentence chosen from Meta's error code, so the
 * dashboard stops telling people to fix permissions when the real problem is a
 * retired metric or a rate limit.
 */
function graphHint(e, platformLabel = 'this account') {
  if (isNetworkError(e)) return networkHint("Meta's Graph API");
  const code = graphCode(e);
  const msg = String(graphMessage(e) || '').toLowerCase();

  if (code === 190 || msg.includes('expired') || msg.includes('invalid oauth') || msg.includes('session')) {
    return 'ACCESS_TOKEN is expired or invalid — generate a fresh one, put it in .env as ACCESS_TOKEN and restart the API.';
  }
  if (code === 10 || code === 200 || code === 283 || msg.includes('permission') || msg.includes('does not have access')) {
    return `The token does not carry the insight permission for ${platformLabel} (pages_read_engagement for a Page, instagram_manage_insights for a Business account).`;
  }
  if (code === 100 || msg.includes('invalid parameter') || msg.includes('unsupported') || msg.includes('not supported') || msg.includes('deprecated') || msg.includes('cannot be more than')) {
    return 'Meta rejected the parameters, not the credentials. Metrics Meta no longer serves are skipped automatically, and ranges longer than 30 days are split into 30-day windows.';
  }
  if ([4, 17, 32, 613, 80004].includes(code) || msg.includes('rate limit') || msg.includes('too many calls')) {
    return 'Meta rate limit reached. The dashboard keeps the last good numbers and retries — nothing to fix in .env.';
  }
  if (code === 104 || code === 803 || msg.includes('unknown alias') || msg.includes('does not exist')) {
    return 'The account id was not recognised — check FACEBOOK_PAGE_ID / INSTAGRAM_ID in .env.';
  }
  return null;
}

/**
 * fetchAcrossWindows — one metric (or metric list) over a Graph-legal set of
 * windows, merged into a single series.
 */
async function fetchAcrossWindows(since, until, requestOne) {
  const plan = insightWindows(since, until);
  const blocks = await mapLimit(plan.windows, CONCURRENCY, (w) => requestOne(w.since, w.until));
  return {
    raw: mergeInsightBlocks(blocks),
    windows: plan.windows.length,
    clamped: plan.clamped,
    clampedSince: plan.clampedSince,
    requested: plan.requested,
  };
}

/**
 * fetchMetricGroup — request a whole group; if Meta rejects the parameter set,
 * retry metric-by-metric and keep everything that still works.
 *
 * @param {object} opts
 * @param {string} opts.metric        comma-separated metric list
 * @param {number} opts.since         unix seconds
 * @param {number} opts.until         unix seconds
 * @param {(metric:string, since:number, until:number) => Promise<Array>} opts.requestOne
 * @param {string} [opts.platformLabel]
 * @returns {Promise<{ok:boolean, raw?:Array, dropped?:Array, windows?:number, clamped?:boolean, recovered?:boolean, message?:string, code?:number|null, hint?:string|null, status?:number|null}>}
 */
async function fetchMetricGroup({ metric, since, until, requestOne, platformLabel = 'this account', timeout = DEFAULT_TIMEOUT }) {
  void timeout;
  const metrics = String(metric).split(',').map((m) => m.trim()).filter(Boolean);
  try {
    const r = await fetchAcrossWindows(since, until, (s, u) => requestOne(metric, s, u));
    return { ok: true, ...r, dropped: [] };
  } catch (e) {
    const retryable =
      metrics.length > 1 &&
      (graphCode(e) === 100 ||
        /invalid parameter|unsupported|not supported|deprecated|cannot be more than/i.test(String(graphMessage(e))));

    if (!retryable) {
      return { ok: false, raw: [], dropped: [], message: graphMessage(e), code: graphCode(e), hint: graphHint(e, platformLabel), status: graphStatus(e), windows: 0, clamped: false };
    }

    // One retired metric must not take the whole group down.
    const kept = [];
    const dropped = [];
    let windows = 0;
    let clamped = false;
    let clampedSince = null;
    for (const one of metrics) {
      try {
        const r = await fetchAcrossWindows(since, until, (s, u) => requestOne(one, s, u));
        kept.push(...r.raw);
        windows = Math.max(windows, r.windows);
        clamped = clamped || r.clamped;
        clampedSince = clampedSince || r.clampedSince;
      } catch (e2) {
        dropped.push({ metric: one, message: graphMessage(e2), code: graphCode(e2) });
      }
    }

    if (kept.length) {
      return { ok: true, raw: kept, dropped, windows, clamped, clampedSince, recovered: true };
    }
    return {
      ok: false,
      raw: [],
      dropped,
      message: graphMessage(e),
      code: graphCode(e),
      hint: graphHint(e, platformLabel),
      status: graphStatus(e),
      windows,
      clamped,
    };
  }
}

module.exports = {
  insightWindows,
  mergeInsightBlocks,
  fetchAcrossWindows,
  fetchMetricGroup,
  graphHint,
  graphMessage,
  graphCode,
  graphStatus,
  mapLimit,
  MAX_WINDOW_SECONDS,
  MAX_WINDOWS,
};
