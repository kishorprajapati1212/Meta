const config = require('../config');
function parseDateRange(query = {}, skipClip = false) {
  const now = Math.floor(Date.now() / 1000);
  let since, until;
  if (query.since || query.until) {
    since = query.since ? Math.floor(new Date(query.since).getTime() / 1000) : now - 30 * 86400;
    until = query.until ? Math.floor(new Date(query.until).getTime() / 1000) : now;
  } else {
    const preset = query.date_preset || 'last_30d';
    if (preset === 'all_time' || preset === 'lifetime') {
      // Whole account history. Upstreams cap the window themselves
      // (Zernio 366d, GSC 16 months), so this is simply "as far back as we can".
      since = config.ACCOUNT_CREATED ? Math.floor(new Date(config.ACCOUNT_CREATED).getTime() / 1000) : now - 365 * 86400;
      until = now;
      return { since, until };
    }
    const days = { today: 1, yesterday: 1, last_7d: 7, last_14d: 14, last_30d: 30, last_60d: 60, last_90d: 90, last_120d: 120, last_180d: 180, last_365d: 365 }[preset] || 30;
    since = now - days * 86400; until = now;
  }
  if (!skipClip && config.ACCOUNT_CREATED) {
    const acct = Math.floor(new Date(config.ACCOUNT_CREATED).getTime() / 1000);
    since = Math.max(since, acct);
  }
  return { since, until };
}
function toDateStr(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }
function dateRangeMeta(s, u) { return { from: toDateStr(s), to: toDateStr(u) }; }
module.exports = { parseDateRange, toDateStr, dateRangeMeta };
