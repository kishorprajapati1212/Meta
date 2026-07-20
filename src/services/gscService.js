const axios = require('axios'); const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');

let gscCache = null; let gscExpiry = 0;

async function getGSCAccessToken() {
  if (gscCache && Date.now() < gscExpiry) return gscCache;
  const p = new URLSearchParams({ client_id: config.GSC_CLIENT_ID, client_secret: config.GSC_CLIENT_SECRET, refresh_token: config.GSC_REFRESH_TOKEN, grant_type: 'refresh_token' });
  try {
    const { data } = await axios.post(config.GOOGLE_TOKEN_URL, p.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    gscCache = data.access_token; gscExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return gscCache;
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error || e.message;
    throw Object.assign(new Error('GSC token refresh failed: ' + msg), { code: 'GSC_TOKEN_FAILED', httpStatus: 401 });
  }
}

// ── List verified sites ────────────────────────────────────────
async function getSites() {
  const token = await getGSCAccessToken();
  try {
    const { data } = await axios.get(config.GSC_API_BASE + '/sites', { headers: { Authorization: 'Bearer ' + token } });
    return (data.siteEntry || []).map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
  } catch (e) {
    console.error('[GSC] Sites error:', e.response?.data?.error?.message || e.message);
    return [];
  }
}

// ── Search Analytics Query ─────────────────────────────────────
async function querySearchAnalytics(siteUrl, query) {
  const token = await getGSCAccessToken();
  const { since, until } = parseDateRange(query, true);

  // GSC data is 2-3 days behind — don't query today/yesterday
  const now = Math.floor(Date.now() / 1000);
  const safeUntil = Math.min(until, now - 2 * 86400);

  const startDate = toDateStr(Math.min(since, safeUntil - 86400));
  const endDate = toDateStr(safeUntil);

  const requestBody = {
    startDate, endDate,
    dimensions: query.dimensions ? query.dimensions.split(',') : ['date'],
    rowLimit: Math.min(parseInt(query.rowLimit) || 100, 25000),
    ...(query.type && { type: query.type }),
    ...(query.dimensionFilterGroups && { dimensionFilterGroups: query.dimensionFilterGroups }),
  };

  const url = config.GSC_API_BASE + '/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query';

  try {
    const { data } = await axios.post(url, requestBody, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    return { rows: data.rows || [], responseAggregationType: data.responseAggregationType };
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.message;
    throw Object.assign(new Error('Search Console query failed: ' + detail), { code: 'GSC_QUERY_FAILED', details: e.response?.data || null, httpStatus: e.response?.status || 502 });
  }
}

// ── Transform GSC rows → our metrics format ───────────────────
function transformGSC(rows, dimensions) {
  if (!rows.length) return { metrics: [], timeseries: [], overview: {} };

  const dims = dimensions || ['date'];

  if (dims.length === 1 && dims[0] === 'date') {
    // Time-based: one row per date
    const byDate = {};
    for (const r of rows) {
      const date = r.keys[0];
      byDate[date] = {
        clicks: (byDate[date]?.clicks || 0) + (r.clicks || 0),
        impressions: (byDate[date]?.impressions || 0) + (r.impressions || 0),
      };
    }
    const dates = Object.keys(byDate).sort();

    const clicksVals = dates.map(d => ({ date: d, value: byDate[d].clicks }));
    const impressionsVals = dates.map(d => ({ date: d, value: byDate[d].impressions }));
    const ctrVals = dates.map(d => ({ date: d, value: byDate[d].impressions > 0 ? Math.round(byDate[d].clicks / byDate[d].impressions * 10000) / 100 : 0 }));
    const positionVals = dates.filter(d => rows.find(r => r.keys[0] === d && r.position != null)).map(d => {
      const matching = rows.filter(r => r.keys[0] === d && r.position != null);
      const avgPos = matching.reduce((s, r) => s + r.position, 0) / matching.length;
      return { date: d, value: Math.round(avgPos * 100) / 100 };
    });

    const clickSum = clicksVals.reduce((s, v) => s + v.value, 0);
    const impressionSum = impressionsVals.reduce((s, v) => s + v.value, 0);
    const avgCTR = impressionSum > 0 ? Math.round(clickSum / impressionSum * 10000) / 100 : 0;

    const metrics = [
      { id: 'clicks', label: 'Clicks', description: 'Total clicks from Google Search', period: 'day', values: clicksVals, summary: { total: clickSum, average: Math.round(clickSum / (dates.length || 1)), latest: clicksVals[clicksVals.length - 1]?.value || 0, previous: clicksVals.length > 1 ? clicksVals[clicksVals.length - 2]?.value || 0 : 0, trend: 0 } },
      { id: 'impressions', label: 'Impressions', description: 'Total impressions in Google Search', period: 'day', values: impressionsVals, summary: { total: impressionSum, average: Math.round(impressionSum / (dates.length || 1)), latest: impressionsVals[impressionsVals.length - 1]?.value || 0, previous: impressionsVals.length > 1 ? impressionsVals[impressionsVals.length - 2]?.value || 0 : 0, trend: 0 } },
      { id: 'ctr', label: 'CTR (%)', description: 'Click-through rate', period: 'day', values: ctrVals, summary: { total: avgCTR, average: Math.round(ctrVals.reduce((s, v) => s + v.value, 0) / (ctrVals.length || 1) * 100) / 100, latest: ctrVals[ctrVals.length - 1]?.value || 0, previous: ctrVals.length > 1 ? ctrVals[ctrVals.length - 2]?.value || 0 : 0, trend: 0 } },
    ];

    if (positionVals.length > 0) {
      const avgPos = Math.round(positionVals.reduce((s, v) => s + v.value, 0) / positionVals.length * 100) / 100;
      metrics.push({ id: 'position', label: 'Avg Position', description: 'Average position in Google Search results', period: 'day', values: positionVals, summary: { total: avgPos, average: Math.round(avgPos), latest: positionVals[positionVals.length - 1]?.value || 0, previous: positionVals.length > 1 ? positionVals[positionVals.length - 2]?.value || 0 : 0, trend: 0 } });
    }

    const timeseries = dates.map(d => {
      const clicksRow = byDate[d];
      const posRow = positionVals.find(v => v.date === d);
      return { date: d, clicks: clicksRow?.clicks || 0, impressions: clicksRow?.impressions || 0, ctr: clicksRow?.impressions > 0 ? Math.round(clicksRow.clicks / clicksRow.impressions * 10000) / 100 : 0, position: posRow?.value || null };
    });

    const overview = { clicks: { total: clickSum, trend: 0 }, impressions: { total: impressionSum, trend: 0 }, ctr: { total: avgCTR, trend: 0 } };
    if (positionVals.length > 0) overview.position = { total: Math.round(positionVals.reduce((s, v) => s + v.value, 0) / positionVals.length * 100) / 100, trend: 0 };

    return { metrics, timeseries, overview };
  }

  // Non-time dimensions (query, page, country, device): return top items
  const items = rows.map(r => {
    const pos = r.position != null ? Math.round(r.position * 100) / 100 : null;
    return { keys: r.keys, clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.impressions > 0 ? Math.round(r.clicks / r.impressions * 10000) / 100 : 0, position: pos };
  }).sort((a, b) => b.clicks - a.clicks).slice(0, 50);

  const totalClicks = items.reduce((s, i) => s + i.clicks, 0);
  const totalImpressions = items.reduce((s, i) => s + i.impressions, 0);
  const overview = { clicks: { total: totalClicks, trend: 0 }, impressions: { total: totalImpressions, trend: 0 }, uniqueItems: { total: items.length, trend: 0 } };

  return { metrics: [], timeseries: [], overview, topItems: items };
}

// ── Main fetch ─────────────────────────────────────────────────
async function fetchInsights(query) {
  const sites = await getSites();
  const siteUrl = config.GSC_SITE_URL || (sites.length > 0 ? sites[0].siteUrl : null);

  if (!siteUrl) {
    throw Object.assign(new Error('No verified Search Console sites found. Set GSC_SITE_URL in .env or verify a site in Google Search Console.'), { code: 'GSC_NO_SITE', httpStatus: 404 });
  }

  const dimensions = (query.dimensions || 'date').split(',').map(s => s.trim());
  const { rows } = await querySearchAnalytics(siteUrl, query);
  const { since, until } = parseDateRange(query, true);

  const { metrics, timeseries, overview, topItems } = transformGSC(rows, dimensions);

  return {
    platform: 'gsc',
    meta: {
      dateRange: dateRangeMeta(since, until),
      siteUrl,
      verifiedSites: sites,
      dimensions: dimensions,
      rowCount: rows.length,
      dataPoints: timeseries.length,
      note: 'GSC data has 2-3 day delay. Recent dates may be empty.',
    },
    overview,
    timeseries,
    metrics,
    ...(topItems && { topItems }),
  };
}

module.exports = { fetchInsights, getGSCAccessToken };
