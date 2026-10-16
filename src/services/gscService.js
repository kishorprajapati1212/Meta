/**
 * gscService.js — Google Search Console (Webmasters v3 REST).
 *
 * v4.1:
 *   • trends were hard-coded to 0. Now the endpoint queries the PREVIOUS
 *     equal-length window too and computes real % change (disable with
 *     ?compare=false).
 *   • timeseries is dense (one row per day, zeros filled) so charts don't gap.
 *   • overview/metrics carry { kind, unit, label, previous, trend, hasData }
 *     via the shared metrics layer, so CTR is a % and position is an average
 *     (both were previously summed or rounded incorrectly).
 *   • topItems gain a share-of-clicks %, a human label (country names,
 *     device names) and are grouped correctly for multi-dimension queries.
 */
const axios = require('axios');
const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const { summarize, round, pctChange } = require('../utils/metrics');
const demo = require('../utils/demographics');
const { isNetworkError, networkHint } = require('../utils/upstreamErrors');

let gscCache = null;
let gscExpiry = 0;

const DAY = 86400;
const GSC_LAG_DAYS = 2; // Search Console data is 2–3 days behind

async function getGSCAccessToken() {
  if (gscCache && Date.now() < gscExpiry) return gscCache;
  if (!config.GSC_REFRESH_TOKEN || !config.GSC_CLIENT_ID) {
    throw Object.assign(new Error('GSC credentials are not configured'), {
      code: 'GSC_NOT_CONFIGURED',
      httpStatus: 500,
      hint: 'Set GSC_REFRESH_TOKEN, GSC_CLIENT_ID, GSC_CLIENT_SECRET (and optionally GSC_SITE_URL) in .env.',
    });
  }
  const p = new URLSearchParams({
    client_id: config.GSC_CLIENT_ID,
    client_secret: config.GSC_CLIENT_SECRET,
    refresh_token: config.GSC_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  try {
    const { data } = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });
    gscCache = data.access_token;
    gscExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return gscCache;
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error || e.message;
    throw Object.assign(new Error('GSC token refresh failed: ' + msg), {
      code: 'GSC_TOKEN_FAILED',
      httpStatus: 401,
      hint:
        String(msg).includes('invalid_grant')
          ? 'The refresh token was revoked or belongs to a different client. Re-authorise in the OAuth Playground with the webmasters.readonly scope using GSC_CLIENT_ID/SECRET.'
          : 'Check GSC_CLIENT_ID / GSC_CLIENT_SECRET / GSC_REFRESH_TOKEN.',
    });
  }
}

// ── Verified sites ──────────────────────────────────────────────
async function getSites() {
  try {
    const token = await getGSCAccessToken();
    const { data } = await axios.get(config.GSC_API_BASE + '/sites', {
      headers: { Authorization: 'Bearer ' + token },
      timeout: 20000,
    });
    return (data.siteEntry || []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));
  } catch (e) {
    console.error('[GSC] Sites error:', e.response?.data?.error?.message || e.message);
    return [];
  }
}

// ── Search Analytics query ──────────────────────────────────────
async function querySearchAnalytics(siteUrl, { dimensions, startDate, endDate, rowLimit, type }) {
  const token = await getGSCAccessToken();
  const body = {
    startDate,
    endDate,
    dimensions: dimensions || ['date'],
    rowLimit: Math.min(parseInt(rowLimit, 10) || 1000, 25000),
    dataState: 'all',
    ...(type && { type }),
  };
  const url = `${config.GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  try {
    const { data } = await axios.post(url, body, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return { rows: data.rows || [], responseAggregationType: data.responseAggregationType };
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.message;
    throw Object.assign(new Error('Search Console query failed: ' + detail), {
      code: 'GSC_QUERY_FAILED',
      httpStatus: e.response?.status || 502,
      hint: isNetworkError(e)
        ? networkHint('the Google Search Console API')
        : e.response?.status === 403
        ? 'The Google account behind GSC_REFRESH_TOKEN is not a verified user of this property.'
        : e.response?.status === 404
        ? 'GSC_SITE_URL must exactly match a verified property (including the trailing slash / sc-domain: prefix).'
        : null,
      details: e.response?.data || null,
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────
function enumerateDates(startDate, endDate) {
  const out = [];
  const cur = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  let guard = 0;
  while (cur <= end && guard < 800) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

const COUNTRIES = {
  US: 'United States', GB: 'United Kingdom', IN: 'India', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium',
  CH: 'Switzerland', AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  IE: 'Ireland', PT: 'Portugal', PL: 'Poland', CZ: 'Czechia', GR: 'Greece', HU: 'Hungary',
  RO: 'Romania', UA: 'Ukraine', RU: 'Russia', TR: 'Turkey', IL: 'Israel', AE: 'UAE',
  SA: 'Saudi Arabia', EG: 'Egypt', ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru',
  JP: 'Japan', CN: 'China', KR: 'South Korea', SG: 'Singapore', MY: 'Malaysia', ID: 'Indonesia',
  TH: 'Thailand', PH: 'Philippines', VN: 'Vietnam', HK: 'Hong Kong', TW: 'Taiwan',
  NZ: 'New Zealand', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal',
};
const DEVICES = { DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' };
const DIM_LABEL = { query: 'Search query', page: 'Page', country: 'Country', device: 'Device', date: 'Date', searchAppearance: 'Appearance' };

function labelFor(dimensions, keys) {
  const d = dimensions[0];
  if (d === 'country') return COUNTRIES[keys[0]] || keys[0] || 'Unknown';
  if (d === 'device') return DEVICES[String(keys[0]).toUpperCase()] || keys[0] || 'Unknown';
  if (d === 'page') {
    try {
      const u = new URL(keys[0]);
      return (u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')) + (u.search || '');
    } catch {
      return keys[0];
    }
  }
  return keys.join(' › ') || 'Unknown';
}

function rowToItem(row, dimensions) {
  return {
    keys: row.keys || [],
    label: labelFor(dimensions, row.keys || []),
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.impressions > 0 ? round((row.clicks / row.impressions) * 100, 2) : 0,
    position: row.position != null ? round(row.position, 2) : null,
  };
}

// ── Transform: date dimension ───────────────────────────────────
function buildTimeline(rows, dates, previous) {
  const byDate = {};
  for (const d of dates) byDate[d] = { date: d, clicks: 0, impressions: 0, positionSum: 0, positionCount: 0 };
  for (const r of rows) {
    const d = (r.keys || [])[0];
    if (!byDate[d]) byDate[d] = { date: d, clicks: 0, impressions: 0, positionSum: 0, positionCount: 0 };
    byDate[d].clicks += r.clicks || 0;
    byDate[d].impressions += r.impressions || 0;
    if (r.position != null) {
      byDate[d].positionSum += r.position;
      byDate[d].positionCount += 1;
    }
  }
  const timeseries = Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      clicks: d.clicks,
      impressions: d.impressions,
      ctr: d.impressions > 0 ? round((d.clicks / d.impressions) * 100, 2) : 0,
      position: d.positionCount ? round(d.positionSum / d.positionCount, 2) : null,
      hasData: d.clicks > 0 || d.impressions > 0,
    }));

  const metricOf = (id, label, pick, kind, unit) => ({
    id,
    label,
    kind,
    unit: unit || '',
    period: 'day',
    description: '',
    values: timeseries.map((t) => ({ date: t.date, value: pick(t) })),
  });

  const metrics = [
    metricOf('clicks', 'Clicks', (t) => t.clicks, 'sum'),
    metricOf('impressions', 'Impressions', (t) => t.impressions, 'sum'),
    metricOf('ctr', 'CTR', (t) => t.ctr, 'rate', '%'),
    metricOf('position', 'Avg position', (t) => (t.position === null ? 0 : t.position), 'avg'),
  ].map((m) => ({ ...m, summary: summarize(m.id, m.values) }));

  // Position is meaningless on zero-impression days — recompute honestly.
  const posVals = timeseries.filter((t) => t.position !== null).map((t) => ({ date: t.date, value: t.position }));
  const posMetric = metrics.find((m) => m.id === 'position');
  if (posVals.length) {
    posMetric.values = posVals;
    posMetric.summary = summarize('position', posVals);
  } else {
    posMetric.summary = { ...posMetric.summary, total: 0, average: 0, latest: 0, hasNoData: true };
  }

  const overview = {};
  const addOverview = (key, metric, prevAgg) => {
    const s = metric.summary;
    const cur = key === 'ctr' || key === 'position' ? s.total : s.total;
    const previous = prevAgg && prevAgg[key] != null ? prevAgg[key] : null;
    overview[key] = {
      key,
      id: metric.id,
      label: metric.label,
      kind: metric.kind,
      unit: metric.unit,
      group: key === 'clicks' || key === 'impressions' ? 'Traffic' : 'Quality',
      total: cur,
      average: s.average,
      latest: s.latest,
      min: s.min,
      max: s.max,
      points: s.points,
      previous,
      trend: previous === null ? 0 : pctChange(cur, previous),
      hasData: s.activePoints > 0,
    };
  };

  let prevAgg = null;
  if (previous && previous.length) {
    const pClicks = previous.reduce((s, r) => s + (r.clicks || 0), 0);
    const pImpr = previous.reduce((s, r) => s + (r.impressions || 0), 0);
    const pPos = previous.filter((r) => r.position != null);
    prevAgg = {
      clicks: pClicks,
      impressions: pImpr,
      ctr: pImpr > 0 ? round((pClicks / pImpr) * 100, 2) : 0,
      position: pPos.length ? round(pPos.reduce((s, r) => s + r.position, 0) / pPos.length, 2) : null,
    };
  }

  addOverview('clicks', metrics[0], prevAgg);
  addOverview('impressions', metrics[1], prevAgg);
  addOverview('ctr', metrics[2], prevAgg);
  addOverview('position', metrics[3], prevAgg);

  return { metrics, timeseries, overview, previous: prevAgg };
}

// ── Transform: non-date dimensions ──────────────────────────────
function buildTopItems(rows, dimensions) {
  const grouped = {};
  for (const r of rows) {
    const key = (r.keys || []).join('||') || 'unknown';
    if (!grouped[key]) grouped[key] = { keys: r.keys || [], clicks: 0, impressions: 0, positionSum: 0, positionCount: 0 };
    grouped[key].clicks += r.clicks || 0;
    grouped[key].impressions += r.impressions || 0;
    if (r.position != null) {
      grouped[key].positionSum += r.position;
      grouped[key].positionCount += 1;
    }
  }
  const items = Object.values(grouped)
    .map((g) => ({
      keys: g.keys,
      label: labelFor(dimensions, g.keys),
      url: dimensions[0] === 'page' ? g.keys[0] : null,
      clicks: g.clicks,
      impressions: g.impressions,
      ctr: g.impressions > 0 ? round((g.clicks / g.impressions) * 100, 2) : 0,
      position: g.positionCount ? round(g.positionSum / g.positionCount, 2) : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const totalClicks = items.reduce((s, i) => s + i.clicks, 0);
  const totalImpressions = items.reduce((s, i) => s + i.impressions, 0);
  items.forEach((i) => {
    i.clickShare = totalClicks > 0 ? round((i.clicks / totalClicks) * 100, 2) : 0;
    i.impressionShare = totalImpressions > 0 ? round((i.impressions / totalImpressions) * 100, 2) : 0;
  });

  const avgCtr = totalImpressions > 0 ? round((totalClicks / totalImpressions) * 100, 2) : 0;
  const withPos = items.filter((i) => i.position != null);
  const avgPos = withPos.length ? round(withPos.reduce((s, i) => s + i.position, 0) / withPos.length, 2) : null;

  const overview = {
    clicks: { key: 'clicks', label: 'Clicks', kind: 'sum', unit: '', group: 'Traffic', total: totalClicks, previous: null, trend: 0, hasData: totalClicks > 0 },
    impressions: { key: 'impressions', label: 'Impressions', kind: 'sum', unit: '', group: 'Traffic', total: totalImpressions, previous: null, trend: 0, hasData: totalImpressions > 0 },
    ctr: { key: 'ctr', label: 'CTR', kind: 'rate', unit: '%', group: 'Quality', total: avgCtr, previous: null, trend: 0, hasData: avgCtr > 0 },
    ...(avgPos !== null
      ? { position: { key: 'position', label: 'Avg position', kind: 'avg', unit: '', group: 'Quality', total: avgPos, previous: null, trend: 0, hasData: true } }
      : {}),
    uniqueItems: { key: 'uniqueItems', label: `${DIM_LABEL[dimensions[0]] || 'Rows'} returned`, kind: 'count', unit: '', group: 'Coverage', total: items.length, previous: null, trend: 0, hasData: items.length > 0 },
  };

  return { topItems: items, overview, metrics: [], timeseries: [] };
}

// ── Main ────────────────────────────────────────────────────────

/**
 * fetchDemographics — where search traffic comes from. Search Console has no
 * age or gender data at all (Google keeps that in Analytics, which this API
 * does not use), so those dimensions are honestly reported as missing.
 * Values are clicks; `share` is each row's share of total clicks.
 */
async function fetchDemographics(siteUrl, startDate, endDate) {
  const source = 'Google Search Console · searchAnalytics';
  const missing = ['age', 'gender', 'cities'];
  const blank = (note) => ({ ...demo.empty(source, note, [...missing, 'countries', 'devices']), unit: 'count' });
  try {
    const [countryRes, deviceRes] = await Promise.all([
      querySearchAnalytics(siteUrl, { dimensions: ['country'], startDate, endDate, rowLimit: 60 }).catch(() => ({ rows: [] })),
      querySearchAnalytics(siteUrl, { dimensions: ['device'], startDate, endDate, rowLimit: 10 }).catch(() => ({ rows: [] })),
    ]);
    const countries = demo.withShare(
      countryRes.rows
        .filter((r) => r.keys && r.keys[0])
        .map((r) => ({ name: String(r.keys[0]), value: r.clicks || 0, impressions: r.impressions || 0 }))
        .sort((a, b) => b.value - a.value)
    );
    const devices = demo.withShare(
      deviceRes.rows
        .filter((r) => r.keys && r.keys[0])
        .map((r) => ({ label: demo.deviceLabel(String(r.keys[0])), value: r.clicks || 0, impressions: r.impressions || 0 }))
        .sort((a, b) => b.value - a.value)
    );
    const available = Boolean(countries.length || devices.length);
    return {
      available,
      source,
      unit: 'count',
      asOf: endDate,
      note: available
        ? 'Search Console reports where searchers are, not who they are — age and gender do not exist in this dataset.'
        : 'No search traffic rows in this window, so there is no geography to show yet.',
      gender: null,
      age: null,
      countries: countries.length ? countries : null,
      cities: null,
      devices: devices.length ? devices : null,
      missing,
    };
  } catch (e) {
    return blank('Demographics unavailable: ' + (e.message || e));
  }
}

async function fetchInsights(query) {
  const sites = await getSites();
  const siteUrl = config.GSC_SITE_URL || (sites.length ? sites[0].siteUrl : null);

  if (!siteUrl) {
    throw Object.assign(
      new Error('No verified Search Console property found'),
      {
        code: 'GSC_NO_SITE',
        httpStatus: 404,
        hint: 'Set GSC_SITE_URL in .env to a verified property (exact URL, e.g. https://example.com/ or sc-domain:example.com), or verify the property in Search Console.',
        sites,
      }
    );
  }

  const dimensions = (query.dimensions || 'date').split(',').map((s) => s.trim()).filter(Boolean);
  const { since, until } = parseDateRange(query, true);

  const now = Math.floor(Date.now() / 1000);
  const safeUntil = Math.min(until, now - GSC_LAG_DAYS * DAY);
  const safeSince = Math.min(since, safeUntil - DAY);
  const startDate = toDateStr(safeSince);
  const endDate = toDateStr(safeUntil);
  const days = enumerateDates(startDate, endDate).length;

  const rowLimit = Math.min(parseInt(query.rowLimit, 10) || (dimensions[0] === 'date' ? 1000 : 250), 25000);
  const demographicsPromise = fetchDemographics(siteUrl, startDate, endDate);
  const { rows } = await querySearchAnalytics(siteUrl, {
    dimensions,
    startDate,
    endDate,
    rowLimit,
    type: query.type,
  });

  // Previous equal-length window → real trends.
  let previousRows = null;
  const wantCompare = query.compare !== 'false' && dimensions[0] === 'date';
  if (wantCompare) {
    const prevEnd = toDateStr(safeSince - DAY);
    const prevStart = toDateStr(safeSince - days * DAY);
    try {
      const prev = await querySearchAnalytics(siteUrl, {
        dimensions: ['date'],
        startDate: prevStart,
        endDate: prevEnd,
        rowLimit,
        type: query.type,
      });
      previousRows = prev.rows;
    } catch (e) {
      console.warn('[GSC] compare window failed:', e.message);
    }
  }

  const isTimeline = dimensions.length === 1 && dimensions[0] === 'date';
  const result = isTimeline
    ? buildTimeline(rows, enumerateDates(startDate, endDate), previousRows)
    : buildTopItems(rows, dimensions);

  const dates = enumerateDates(startDate, endDate);
  const previousRange = wantCompare
    ? { from: toDateStr(safeSince - days * DAY), to: toDateStr(safeSince - DAY) }
    : null;

  const demographics = await demographicsPromise;

  return {
    platform: 'gsc',
    meta: {
      dateRange: dateRangeMeta(safeSince, safeUntil),
      effectiveRange: { from: startDate, to: endDate, days },
      previousRange,
      siteUrl,
      verifiedSites: sites,
      dimensions,
      dimensionLabels: dimensions.map((d) => DIM_LABEL[d] || d),
      rowCount: rows.length,
      dataPoints: isTimeline ? dates.length : result.topItems?.length || 0,
      source: 'Google Search Console API',
      note: `Search Console data lags ~${GSC_LAG_DAYS}–3 days, so the window ends ${endDate}.`,
    },
    overview: result.overview,
    timeseries: result.timeseries,
    metrics: result.metrics,
    demographics,
    ...(result.topItems && { topItems: result.topItems }),
    ...(previousRows && isTimeline && { previousTotals: result.previous }),
    ...(rows.length === 0
      ? { notice: `No Search Console rows for ${startDate} → ${endDate}. The property may be new, or the URL prefix/domain variant may differ from GSC_SITE_URL.` }
      : {}),
  };
}

module.exports = { fetchInsights, getGSCAccessToken, getSites, querySearchAnalytics };
