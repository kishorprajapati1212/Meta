/**
 * demographics.js — one honest audience-shape contract for every platform.
 *
 * Each platform reports audience composition differently and none of them
 * guarantees it: YouTube returns *viewer shares* (and hides them below its
 * privacy threshold), Instagram and Facebook return *follower counts*,
 * Search Console returns *clicks/impressions* per country or device, and
 * Zernio (LinkedIn/Pinterest) exposes no demographics at all.
 *
 * So the contract is explicit about what is and isn't there:
 *
 *   data.demographics = {
 *     available:   bool            — at least one dimension returned data
 *     source:      string          — which upstream produced it
 *     unit:        'share' | 'count'  — how to read the numbers
 *     asOf:        'YYYY-MM-DD' | null
 *     note:        string | null   — why a dimension may be missing
 *     gender:      { male, female, unknown } | null        (same unit)
 *     age:         [{ bucket, male, female, total }] | null (same unit)
 *     countries:   [{ code, name, value, share }] | null    (share always %)
 *     cities:      [{ name, value, share }] | null
 *     devices:     [{ label, value, share }] | null
 *     missing:     ['age', …]      — dimensions this platform cannot supply
 *   }
 *
 * `share` is ALWAYS a percentage of the dimension total, even when the
 * upstream gave absolute counts, so the UI can draw one set of charts.
 */

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

function empty(source, note, missing = []) {
  return {
    available: false,
    source,
    unit: 'share',
    asOf: null,
    note: note || null,
    gender: null,
    age: null,
    countries: null,
    cities: null,
    devices: null,
    missing,
  };
}

/** Attach a 0–100 `share` to each row of an absolutely-valued list. */
function withShare(rows, key = 'value') {
  const total = rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  return rows.map((r) => ({
    ...r,
    share: total > 0 ? round(((Number(r[key]) || 0) / total) * 100, 1) : 0,
  }));
}

/** Rows that already carry a percentage just need clamping + sorting. */
function asShareRows(rows, key = 'value') {
  const sorted = [...rows].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
  return sorted.map((r) => ({ ...r, share: round(Number(r[key]) || 0, 1) }));
}

/**
 * Turn [{segment, value}] where segment is like "male.18-24" or "F.13-17"
 * into the gender / age tables. Tolerant of every casing and separator the
 * upstreams actually use.
 */
function splitAgeGender(rows) {
  const gender = { male: 0, female: 0, unknown: 0 };
  const buckets = new Map();

  for (const row of rows) {
    const raw = String(row.segment || row.key || '');
    const value = Number(row.value) || 0;
    const norm = raw.toLowerCase().replace(/[^a-z0-9]+/g, '.');
    let g = 'unknown';
    if (/^(m|male)\b/.test(norm) || norm.includes('.male') || norm.startsWith('male')) g = 'male';
    else if (/^(f|female)\b/.test(norm) || norm.includes('.female') || norm.startsWith('female')) g = 'female';

    let bucket = (raw.match(/(\d{1,2}\s*-\s*\d{1,2}\+?|\d{2}\+|<\s?\d{1,2})/i) || [null])[0];
    if (bucket) bucket = bucket.replace(/\s+/g, '');
    else if (/(65\+|unknown)/i.test(raw)) bucket = /65/.test(raw) ? '65+' : 'unknown';

    gender[g] += value;
    if (bucket) {
      const cur = buckets.get(bucket) || { bucket, male: 0, female: 0, total: 0 };
      cur[g === 'unknown' ? 'male' : g] += value;
      cur.total += value;
      buckets.set(bucket, cur);
    }
  }

  const gTotal = gender.male + gender.female + gender.unknown;
  const order = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];
  const age = [...buckets.values()]
    .sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket))
    .map((b) => ({ ...b, male: round(b.male, 1), female: round(b.female, 1), total: round(b.total, 1) }));

  return {
    gender: gTotal > 0
      ? {
          male: round((gender.male / gTotal) * 100, 1),
          female: round((gender.female / gTotal) * 100, 1),
          unknown: round((gender.unknown / gTotal) * 100, 1),
        }
      : null,
    age: age.length ? age : null,
    genderTotal: gTotal,
  };
}

const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

/** YouTube's ageGroup codes ("age18-24") → display buckets. */
function ytAge(code) {
  const m = String(code).match(/age(\d{2})-(\d{2})/);
  if (m) return `${Number(m[1])}-${Number(m[2])}`;
  if (/age65/.test(code)) return '65+';
  if (/age13/.test(code)) return '13-17';
  return 'unknown';
}

/** Normalise YouTube's gender codes. */
function ytGender(code) {
  const c = String(code).toLowerCase();
  if (c === 'male' || c === 'm') return 'male';
  if (c === 'female' || c === 'f') return 'female';
  return 'unknown';
}

const DEVICE_LABELS = {
  DESKTOP: 'Desktop',
  MOBILE: 'Mobile phone',
  TABLET: 'Tablet',
  TV: 'TV',
  game_console: 'Game console',
  desktop: 'Desktop',
  mobile: 'Mobile phone',
  tablet: 'Tablet',
};

function deviceLabel(code) {
  return DEVICE_LABELS[code] || String(code).replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

module.exports = {
  empty,
  withShare,
  asShareRows,
  splitAgeGender,
  ytAge,
  ytGender,
  deviceLabel,
  round,
  AGE_ORDER,
};
