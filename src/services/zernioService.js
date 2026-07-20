const axios = require('axios'); const config = require('../config');
const { parseDateRange, dateRangeMeta, toDateStr } = require('../utils/dateUtils');
const ZB = config.ZERNIO_BASE_URL; const AUTH = { headers: { Authorization: 'Bearer ' + config.ZERNIO_API_KEY } };
const syncCache = {};

async function zGet(url, params = {}) { return (await axios.get(ZB + url, { ...AUTH, params })).data; }

async function autoSync(platform, accountId) {
  if (!accountId) return null;
  const now = Date.now();
  if (now - (syncCache[platform] || 0) < 5 * 60 * 1000) return { skipped: true };
  syncCache[platform] = now;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await zGet('/v1/analytics', { platform, accountId, fromDate: weekAgo, toDate: today, limit: 1, source: 'all' });
    try { await axios.post(ZB + '/v1/analytics/sync-external-posts', { accountId }, { headers: { ...AUTH.headers, 'Content-Type': 'application/json' } }); } catch (e) {}
    return { synced: true };
  } catch (e) { return { synced: false, error: e.response?.data?.error || e.message }; }
}

async function getAccounts(platform) {
  try { const d = await zGet('/v1/accounts', { limit: 50 }); return { accounts: (d.accounts || []).filter(a => !platform || a.platform === platform), hasAnalyticsAccess: d.hasAnalyticsAccess }; }
  catch (e) { return { accounts: [], hasAnalyticsAccess: false }; }
}

async function getFollowerStats(platform) {
  try { return await zGet('/v1/accounts/follower-stats', { platform, limit: 100 }); }
  catch (e) { return { stats: {} }; }
}

async function getPostAnalytics(platform, query) {
  const { since, until } = parseDateRange(query, true);
  const fromDate = toDateStr(since); const toDate = toDateStr(until);
  const allPosts = []; let page = 1, totalPages = 1;
  while (page <= totalPages && page <= 15) {
    try {
      const data = await zGet('/v1/analytics', { platform, fromDate, toDate, limit: 100, page, source: 'all', sortBy: 'date', order: 'desc' });
      (data.posts || []).forEach(p => allPosts.push(p));
      totalPages = data.pagination?.pages || 0; page++;
      if (!(data.posts || []).length) break;
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { if (e.response?.status === 402 || e.response?.status === 401) throw e; break; }
  }
  const seen = new Set();
  return allPosts.filter(p => { const id = p.postId || p.latePostId || p.platformPostUrl || ''; if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

function buildAccount(a, platform) {
  if (!a) return null;
  return { zernioAccountId: a._id, platform: a.platform, username: a.username || '', displayName: a.displayName || '', profilePicture: a.profilePicture || null, followers: a.currentFollowers || a.followersCount || 0, lastSyncedAt: a.analyticsLastSyncedAt || a.lastUpdated || null, isActive: a.isActive !== false, externalPostCount: a.externalPostCount || 0, pinCount: a.accountStats?.pinCount ?? 0, boardCount: a.accountStats?.boardCount ?? 0, monthlyViews: a.accountStats?.monthlyViews ?? null };
}

function buildPosts(posts, compact) {
  if (!posts.length) return { totals: {}, daily: [], list: [], avgER: 0, pb: {}, top: [] };
  const totals = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, sends: 0, clicks: 0, views: 0, follows: 0 };
  const ers = [], daily = {}, list = [], pb = {};
  for (const p of posts) {
    const a = p.analytics || {}, pf = p.platform || 'unknown';
    totals.impressions += a.impressions || 0; totals.reach += a.reach || 0; totals.likes += a.likes || 0; totals.comments += a.comments || 0;
    totals.shares += a.shares || 0; totals.saves += a.saves || 0; totals.clicks += a.clicks || 0; totals.views += a.views || 0;
    if (a.follows) totals.follows += a.follows; if (a.engagementRate != null) ers.push(a.engagementRate);
    if (!pb[pf]) pb[pf] = { posts: 0, impressions: 0, likes: 0, comments: 0 }; pb[pf].posts++; pb[pf].impressions += a.impressions || 0; pb[pf].likes += a.likes || 0; pb[pf].comments += a.comments || 0;
    const d = (p.publishedAt || p.scheduledFor || '').slice(0, 10);
    if (d) { if (!daily[d]) daily[d] = { date: d, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, postCount: 0 }; daily[d].impressions += a.impressions || 0; daily[d].reach += a.reach || 0; daily[d].likes += a.likes || 0; daily[d].comments += a.comments || 0; daily[d].shares += a.shares || 0; daily[d].saves += a.saves || 0; daily[d].clicks += a.clicks || 0; daily[d].views += a.views || 0; daily[d].postCount++; }
    list.push({ postId: p.postId || p.latePostId || '', content: (p.content || '').slice(0, 300), publishedAt: p.publishedAt || p.scheduledFor || null, platformUrl: p.platformPostUrl || '', mediaType: p.mediaType || 'text', thumbnailUrl: p.thumbnailUrl || '', status: p.status || 'unknown', platform: pf, isExternal: p.isExternal || false, analytics: { impressions: a.impressions || 0, reach: a.reach || 0, likes: a.likes || 0, comments: a.comments || 0, shares: a.shares || 0, saves: a.saves || 0, sends: a.sends || 0, clicks: a.clicks || 0, views: a.views || 0, engagementRate: a.engagementRate || 0 } });
  }
  const avgER = ers.length ? Math.round(ers.reduce((a, b) => a + b, 0) / ers.length * 100) / 100 : 0;
  const top = [...list].sort((a, b) => (b.analytics.impressions || 0) - (a.analytics.impressions || 0)).slice(0, 5);
  let tsRows = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  if (compact) tsRows = tsRows.filter(r => Object.values(r).some(v => typeof v === 'number' && v > 0));
  return { totals, daily: tsRows, list, avgER, pb, top };
}

function buildOverview(totals, avgER, account) {
  const o = {}; const add = (k, v) => { if (v > 0) o[k] = { total: v, trend: 0 }; };
  add('impressions', totals.impressions); add('reach', totals.reach); add('likes', totals.likes); add('comments', totals.comments);
  add('shares', totals.shares); add('saves', totals.saves); add('clicks', totals.clicks); add('views', totals.views);
  if (avgER > 0) o.engagementRate = { total: avgER, trend: 0 };
  if (account?.followers > 0) o.followers = { total: account.followers, trend: 0 };
  if (account?.pinCount > 0) o.pins = { total: account.pinCount, trend: 0 };
  if (account?.monthlyViews) o.monthlyViews = { total: account.monthlyViews, trend: 0 };
  return o;
}

async function fetchPlatform(platform, query) {
  try {
    const { since, until } = parseDateRange(query, true);
    const { accounts, hasAnalyticsAccess } = await getAccounts(platform);
    const account = buildAccount(accounts.find(a => a.platform === platform), platform);
    const accountId = account?.zernioAccountId || '';
    try { if (accountId) await autoSync(platform, accountId); } catch (e) {}
    const [fsData, posts] = await Promise.all([getFollowerStats(platform).catch(() => ({ stats: {} })), getPostAnalytics(platform, query).catch(() => [])]);
    const compact = query.compact === 'true' || query.compact === '1';
    const { totals, daily, list, avgER, pb, top } = buildPosts(posts, compact);
    const fpts = (fsData.stats || {})[accountId] || [];
    for (const fp of fpts) {
      const d = fp.date.slice(0, 10); const ex = daily.find(r => r.date === d);
      if (ex) ex.followers = fp.followers;
      else daily.push({ date: d, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, postCount: 0, followers: fp.followers });
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));
    const overview = buildOverview(totals, avgER, account);
    const ft = fpts.map((p, i) => ({ date: p.date.slice(0, 10), followers: p.followers, growth: i > 0 ? p.followers - fpts[i - 1].followers : 0 }));
    const notices = [];
    if (!posts.length) notices.push(platform === 'linkedin' ? 'No posts through Zernio yet.' : 'No pins through Zernio yet.');
    return { meta: { dateRange: dateRangeMeta(since, until), source: 'Zernio', hasAnalyticsAccess: hasAnalyticsAccess !== false, postCount: posts.length, totalDataPoints: daily.length, account }, overview, timeseries: daily, topPosts: top, posts: list, totals, avgEngagementRate: avgER, platformBreakdown: pb, followerTimeseries: ft, notice: notices.length ? notices.join(' ') : undefined };
  } catch (e) {
    console.error('[Zernio ' + platform + '] Error:', e.message);
    const { since, until } = parseDateRange(query, true);
    return { meta: { dateRange: dateRangeMeta(since, until), source: 'Zernio', hasAnalyticsAccess: false, postCount: 0, totalDataPoints: 0, account: null }, overview: {}, timeseries: [], topPosts: [], posts: [], totals: {}, avgEngagementRate: 0, platformBreakdown: {}, followerTimeseries: [], notice: platform + ' error: ' + e.message };
  }
}

async function fetchLinkedIn(query) { return fetchPlatform('linkedin', query); }
async function fetchPinterest(query) { return fetchPlatform('pinterest', query); }
module.exports = { fetchLinkedIn, fetchPinterest };
