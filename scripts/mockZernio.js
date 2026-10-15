/**
 * scripts/mockZernio.js — a local stand-in for the Zernio API.
 *
 * Shared by the backend self-test and the fixture generator so both exercise
 * exactly the same upstream behaviour. `setMode()` switches between the
 * situations we care about:
 *
 *   zero-analytics      → 3 pins exist but every metric is 0 (the real bug)
 *   rich                → full metrics on every post
 *   accounts-500        → /v1/accounts fails upstream
 *   boards-404          → the boards endpoint does not exist on this plan
 *   no-analytics-access → hasAnalyticsAccess:false
 */
const express = require('express');

const ACCOUNTS = {
  pinterest: {
    _id: 'acct_pin_1',
    platform: 'pinterest',
    username: 'kishor.pins',
    displayName: 'Kishor Pins',
    profilePicture: 'https://example.com/pin-avatar.jpg',
    currentFollowers: 1284,
    externalPostCount: 7,
    analyticsLastSyncedAt: new Date().toISOString(),
    isActive: true,
    accountStats: { pinCount: 342, boardCount: 18, monthlyViews: 96400 },
  },
  linkedin: {
    _id: 'acct_li_1',
    platform: 'linkedin',
    username: 'kishor-prajapati',
    displayName: 'Kishor Prajapati',
    currentFollowers: 512,
    externalPostCount: 2,
    analyticsLastSyncedAt: new Date().toISOString(),
    accountStats: {},
  },
};

const BOARDS = [
  { id: 'b1', name: 'UI Design', pinCount: 84, privacy: 'PUBLIC' },
  { id: 'b2', name: 'Dev Setup', pinCount: 51, privacy: 'PUBLIC' },
  { id: 'b3', name: 'Inspiration', pinCount: 207, privacy: 'PUBLIC' },
];

function dayStr(offset) {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

function createMock({ port = 4987, mode = 'zero-analytics' } = {}) {
  let MODE = mode;
  const app = express();
  app.use(express.json());

  app.get('/api/v1/accounts', (req, res) => {
    if (MODE === 'accounts-500') return res.status(500).json({ error: 'upstream boom' });
    const all = Object.values(ACCOUNTS);
    const platform = req.query.platform;
    res.json({
      accounts: platform ? all.filter((a) => a.platform === platform) : all,
      hasAnalyticsAccess: MODE !== 'no-analytics-access',
    });
  });

  app.get('/api/v1/accounts/follower-stats', (req, res) => {
    const acct = ACCOUNTS[req.query.platform];
    if (!acct) return res.json({ stats: {} });
    const rows = [];
    for (let i = 29; i >= 0; i--) rows.push({ date: dayStr(i), followers: acct.currentFollowers - i * 3 });
    res.json({ stats: { [acct._id]: rows } });
  });

  app.get('/api/v1/accounts/:id/pinterest-boards', (_req, res) => {
    if (MODE === 'boards-404') return res.status(404).json({ error: 'not found' });
    res.json({ boards: BOARDS });
  });

  app.get('/api/v1/analytics', (req, res) => {
    const rich = MODE === 'rich';
    if (req.query.platform === 'linkedin') {
      return res.json({
        posts: [
          {
            postId: 'li_post_1',
            platform: 'linkedin',
            content: 'Shipped a cross-platform analytics dashboard this week — 6 APIs, one view.',
            publishedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
            platformPostUrl: 'https://linkedin.com/feed/update/urn:li:share:1',
            mediaType: 'text',
            status: 'published',
            isExternal: false,
            syncStatus: 'synced',
            analytics: rich
              ? { impressions: 5420, reach: 3200, likes: 156, comments: 23, shares: 12, clicks: 88, engagementRate: 3.52 }
              : { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 },
          },
        ],
        pagination: { pages: 1, total: 1 },
      });
    }

    const pins = [0, 6, 18].map((offset, i) => ({
      postId: `pin_${i + 1}`,
      platform: 'pinterest',
      content: `Pin ${i + 1} — design inspiration board`,
      title: `Pin ${i + 1}`,
      publishedAt: new Date(Date.now() - offset * 86400000).toISOString(),
      platformPostUrl: `https://pinterest.com/pin/${1000 + i}`,
      thumbnailUrl: `https://example.com/pin-${i + 1}.jpg`,
      mediaType: i === 1 ? 'video' : 'image',
      status: 'published',
      isExternal: i === 2,
      syncStatus: i === 2 ? 'pending' : 'synced',
      boardName: BOARDS[i % BOARDS.length].name,
      analytics: rich
        ? {
            impressions: [12400, 8200, 3100][i],
            clicks: [240, 130, 42][i],
            saves: [88, 41, 12][i],
            outboundClicks: [61, 22, 9][i],
            views: [0, 320, 0][i],
            engagementRate: [2.9, 3.4, 1.7][i],
          }
        : { impressions: 0, clicks: 0, saves: 0, views: 0 },
    }));
    res.json({ posts: pins, pagination: { pages: 1, total: pins.length } });
  });

  app.post('/api/v1/posts/sync-external', (_req, res) => res.json({ ok: true, queued: true }));
  app.post('/api/v1/analytics/sync-external-posts', (_req, res) => res.json({ ok: true }));

  const server = app.listen(port, '127.0.0.1');
  return {
    server,
    url: `http://127.0.0.1:${port}/api`,
    setMode(m) { MODE = m; },
    getMode() { return MODE; },
    close: () => new Promise((resolve) => server.close(resolve)),
    ready: () => new Promise((resolve) => server.once('listening', resolve)),
  };
}

module.exports = { createMock, ACCOUNTS, BOARDS };
