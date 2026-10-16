/**
 * resilience.js — why the dashboard used to flip between "here is your data" and
 * "Service not available" from one minute to the next.
 *
 * Three things happen on a real deployment:
 *   • an upstream (Meta, Google, Zernio) occasionally takes 30–60 s or hangs, and
 *     one slow platform used to hold the whole /api/combined response hostage
 *     until the host's own proxy gave up and served its 502/503 page;
 *   • a free-tier host sleeps, so the FIRST request after idle is slow or fails;
 *   • a transient 429/5xx from one upstream wiped data that had loaded fine a
 *     minute earlier.
 *
 * So every platform fetch now runs with:
 *   1. a hard timeout (PLATFORM_TIMEOUT_MS) — the response always comes back;
 *   2. a cache of the last good payload (CACHE_TTL_MS fresh, CACHE_STALE_MS
 *      usable) — a failed refresh serves the previous numbers, clearly labelled
 *      `stale: true` with an age, instead of an error card;
 *   3. an injected `notice` so the UI can say what happened in one line.
 *
 * The cache is in-process memory only: no new dependency, no new env var, and it
 * disappears on restart (which is correct — it is a safety net, not a database).
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // fresh for 5 minutes
const CACHE_STALE_MS = 60 * 60 * 1000; // servable for up to an hour after that
const MAX_ENTRIES = 300;
const PLATFORM_TIMEOUT_MS = Number(process.env.PLATFORM_TIMEOUT_MS || 50000);

const entries = new Map();

function cacheKey(name, query) {
  const q = query || {};
  const parts = [
    q.date_preset || '',
    q.since || '',
    q.until || '',
    q.dimensions || '',
    q.rowLimit || '',
    q.compare || '',
    q.type || '',
  ];
  return `${name}|${parts.join('|')}`;
}

function cacheGet(key) {
  const e = entries.get(key);
  if (!e) return null;
  const age = Date.now() - e.at;
  if (age > CACHE_STALE_MS) {
    entries.delete(key);
    return null;
  }
  // Refresh recency so the oldest entry is the one evicted next.
  entries.delete(key);
  entries.set(key, e);
  return { value: e.value, age, fresh: age <= e.ttl };
}

function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(key, { value, at: Date.now(), ttl });
}

/** How long until each key expires — surfaced by /api/health for debugging. */
function cacheStats() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  for (const e of entries.values()) {
    const age = now - e.at;
    if (age <= e.ttl) fresh += 1;
    else stale += 1;
  }
  return { entries: entries.size, fresh, stale, ttlMs: CACHE_TTL_MS, staleMs: CACHE_STALE_MS };
}

function clearCache() {
  entries.clear();
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`${label} did not answer within ${Math.round(ms / 1000)}s`), {
          code: 'UPSTREAM_TIMEOUT',
          httpStatus: 504,
          hint: 'The upstream API is slow right now. The dashboard keeps the last good numbers and retries on the next refresh.',
        })
      );
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const joinNotice = (existing, extra) => (existing ? `${existing} ${extra}` : extra);

/**
 * fetchWithFallback — run one platform's fetch with a timeout and a cache.
 *
 * @returns {Promise<{value:object, fromCache:boolean, ageMs:number|null}>}
 * @throws the original error when it failed AND there is nothing cached to fall
 *         back on, so the caller can still report an honest error.
 */
async function fetchWithFallback(name, produce, query, { timeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const key = cacheKey(name, query);
  try {
    const value = await withTimeout(produce(), timeoutMs, name);
    cacheSet(key, value);
    return { value, fromCache: false, ageMs: null };
  } catch (e) {
    const cached = cacheGet(key);
    if (cached) {
      const minutes = Math.max(1, Math.round(cached.age / 60000));
      const reason = e && e.message ? e.message : String(e);
      const note = `Showing the last successful load (${minutes} min old) because the live request failed: ${reason}`;
      const value = cached.value && typeof cached.value === 'object' ? cached.value : {};
      return {
        value: {
          ...value,
          stale: true,
          staleAgeMs: cached.age,
          notice: joinNotice(value.notice, note),
          partialErrors: [
            ...(Array.isArray(value.partialErrors) ? value.partialErrors : []),
            { group: 'refresh', optional: true, stale: true, message: note, hint: e && e.hint ? e.hint : null },
          ],
        },
        fromCache: true,
        ageMs: cached.age,
        error: e,
      };
    }
    throw e;
  }
}

module.exports = {
  fetchWithFallback,
  withTimeout,
  cacheKey,
  cacheGet,
  cacheSet,
  cacheStats,
  clearCache,
  CACHE_TTL_MS,
  CACHE_STALE_MS,
  PLATFORM_TIMEOUT_MS,
};
