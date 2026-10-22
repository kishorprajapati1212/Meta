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
 *   sparse-accounts     → accounts with no follower/pin stats at all, boards
 *                         without pin counts (what the real Pinterest + personal
 *                         LinkedIn accounts look like)
 *   cross-posted        → one post document published to both platforms, whose
 *                         document-level analytics belong to LinkedIn while the
 *                         Pinterest copy is still zero
 *   real-capture        → the ACTUAL upstream documents captured from the live
 *                         account on 2026-10-21 (scripts/fixtures/
 *                         zernio-real-capture.json): 6 Pinterest pins that are
 *                         fully synced and still report 0, next to 8 LinkedIn
 *                         posts published the same way that DO report
 *                         impressions. This is the "Pinterest shows 0" case.
 */
const express = require('express');

// The real capture. Dates are rebased from `capturedAgeDays` so the fixture
// never ages out of a date window and the tests stay meaningful next year.
const REAL = require('./fixtures/zernio-real-capture.json');

function rebase(doc) {
  const out = { ...doc };
  const ageDays = Number(doc.capturedAgeDays);
  if (Number.isFinite(ageDays)) {
    out._capturedPublishedAt = doc.publishedAt;
    out.publishedAt = new Date(Date.now() - ageDays * 86400000).toISOString();
  }
  if (Array.isArray(doc.platforms)) out.platforms = doc.platforms.map((e) => ({ ...e }));
  return out;
}

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

// What the real deployment returns: Pinterest has no pin/board/monthly-view
// stats and no follower count, and a personal LinkedIn profile reports
// followersCount 0 because LinkedIn does not publish one.
const ACCOUNTS_SPARSE = {
  pinterest: {
    _id: 'acct_pin_sparse',
    platform: 'pinterest',
    username: 'kishorprajapati1040',
    displayName: 'kishorprajapati1040',
    profileUrl: 'https://pinterest.com/kishorprajapati1040',
    followersCount: 0,
    followersLastUpdated: new Date().toISOString(),
    externalPostCount: 0,
    metadata: { accountType: 'business' },
    isActive: true,
  },
  linkedin: {
    _id: 'acct_li_sparse',
    platform: 'linkedin',
    username: 'kishor prajapati',
    displayName: 'kishor prajapati',
    profileUrl: 'https://www.linkedin.com/in/kishor-prajapati-1a3ab8437/',
    followersCount: 0,
    externalPostCount: 0,
    metadata: { accountType: 'personal' },
    isActive: true,
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
    const all =
      MODE === 'real-capture'
        ? REAL.accountsRaw
        : Object.values(MODE === 'sparse-accounts' ? ACCOUNTS_SPARSE : ACCOUNTS);
    const platform = req.query.platform;
    res.json({
      accounts: platform ? all.filter((a) => a.platform === platform) : all,
      hasAnalyticsAccess: MODE !== 'no-analytics-access' && REAL.hasAnalyticsAccess !== false,
    });
  });

  app.get('/api/v1/accounts/follower-stats', (req, res) => {
    if (MODE === 'real-capture') {
      // Verbatim from the capture: every day reports 0 followers.
      const rows = REAL.followerStats[req.query.platform] || [];
      const acct = REAL.accountsRaw.find((a) => a.platform === req.query.platform);
      return res.json({ stats: { [acct ? acct._id : 'captured']: rows } });
    }
    const table = MODE === 'sparse-accounts' ? ACCOUNTS_SPARSE : ACCOUNTS;
    const acct = table[req.query.platform];
    if (!acct) return res.json({ stats: {} });
    const rows = [];
    const base = acct.currentFollowers ?? 0;
    for (let i = 29; i >= 0; i--) rows.push({ date: dayStr(i), followers: MODE === 'sparse-accounts' ? 0 : base - i * 3 });
    res.json({ stats: { [acct._id]: rows } });
  });

  app.get('/api/v1/accounts/:id/pinterest-boards', (_req, res) => {
    if (MODE === 'boards-404') return res.status(404).json({ error: 'not found' });
    // The real account: one board, "Testing 1", and Pinterest returns no pin
    // count for it.
    if (MODE === 'real-capture') return res.json({ boards: REAL.boards });
    // Real boards arrive without per-board pin counts.
    if (MODE === 'sparse-accounts') {
      return res.json({ boards: [{ id: '1127166681679490974', name: 'Testing 1', pinCount: null, privacy: 'PUBLIC', url: null }] });
    }
    res.json({ boards: BOARDS });
  });

  app.get('/api/v1/analytics', (req, res) => {
    const rich = MODE === 'rich';

    if (MODE === 'real-capture') {
      const docs = (REAL.posts[req.query.platform] || []).map(rebase);
      return res.json({
        posts: docs,
        pagination: { pages: 1, total: docs.length },
        overview: REAL.overview[req.query.platform] || undefined,
      });
    }

    // One document, published to two platforms: the document-level `analytics`
    // block carries LinkedIn's numbers while the Pinterest copy is still zero.
    // Reading `p.analytics` for a Pinterest query would show LinkedIn's 12
    // impressions on Pinterest — the code must read `platforms[]` instead.
    if (MODE === 'cross-posted') {
      const doc = (i, when) => ({
        _id: `doc_${i}`,
        // One late-post group per piece of content: the LinkedIn and Pinterest
        // copies of the same content share it, different contents do not.
        latePostId: `late_group_${i}`,
        content: `Cross-posted update ${i} — published to LinkedIn and Pinterest at once.`,
        publishedAt: new Date(Date.now() - when * 86400000).toISOString(),
        status: 'published',
        analytics: { impressions: 12, reach: 7, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 1, engagementRate: 0 },
        platforms: [
          {
            platform: 'linkedin',
            status: 'published',
            platformPostId: `urn:li:ugcPost:75164758244100${99712 + i}`,
            accountId: 'acct_li_sparse',
            accountUsername: 'kishor prajapati',
            analytics: { impressions: 12, reach: 7, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 1, engagementRate: 0 },
          },
          {
            platform: 'pinterest',
            status: 'published',
            platformPostId: `11271666130230880${91 + i}`,
            accountId: 'acct_pin_sparse',
            accountUsername: 'kishorprajapati1040',
            analytics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0 },
          },
        ],
      });
      const docs = [doc(1, 1), doc(2, 4), doc(3, 9), doc(4, 14), doc(5, 20)];
      return res.json({ posts: docs, pagination: { pages: 1, total: docs.length } });
    }

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
  const api = {
    server,
    // port 0 → the OS picks a free one; resolve it after listening so callers
    // never collide with a mock that is already running (e.g. docker compose).
    get port() { const a = server.address(); return a ? a.port : port; },
    get url() { return `http://127.0.0.1:${api.port}/api`; },
    setMode(m) { MODE = m; },
    getMode() { return MODE; },
    close: () => new Promise((resolve) => server.close(resolve)),
    ready: () => new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve))),
  };
  return api;
}

module.exports = { createMock, ACCOUNTS, ACCOUNTS_SPARSE, BOARDS, REAL, rebase };
