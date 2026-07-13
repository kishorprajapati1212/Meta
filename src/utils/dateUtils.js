const config = require('../config');

function parseDateRange(query = {}) {
  const now = Math.floor(Date.now() / 1000);

  if (query.since || query.until) {
    const since = query.since ? Math.floor(new Date(query.since).getTime() / 1000) : now - 30 * 86400;
    const until = query.until ? Math.floor(new Date(query.until).getTime() / 1000) : now;
    return clipToAccountAge(since, until);
  }

  const preset = query.date_preset || 'last_30d';
  const days = { today: 1, yesterday: 1, last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 }[preset] || 30;
  return clipToAccountAge(now - days * 86400, now);
}

function clipToAccountAge(since, until) {
  if (!config.ACCOUNT_CREATED) return { since, until };
  const accountStart = Math.floor(new Date(config.ACCOUNT_CREATED).getTime() / 1000);
  return { since: Math.max(since, accountStart), until };
}

function toDateStr(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function dateRangeMeta(since, until) {
  return { from: toDateStr(since), to: toDateStr(until) };
}

module.exports = { parseDateRange, toDateStr, dateRangeMeta };
