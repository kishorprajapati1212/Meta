/**
 * mockUpstreamServer.js — runs the mock Meta Graph / Google upstream standalone.
 *
 *   node scripts/mockUpstreamServer.js                 # port 4988
 *   MOCK_UPSTREAM_PORT=4988 node scripts/mockUpstreamServer.js
 *
 * Used by docker-compose.mock.yml so the whole stack — all six platforms — can
 * be exercised end to end with no real credentials and no network access.
 * Point the API at it with:
 *
 *   FB_API_BASE=http://mock-upstream:4988/graph
 *   GOOGLE_TOKEN_URL=http://mock-upstream:4988/token
 *   YOUTUBE_ANALYTICS_URL=http://mock-upstream:4988/yt/v2/reports
 *   YOUTUBE_DATA_API_URL=http://mock-upstream:4988/youtube/v3
 *   GSC_API_BASE=http://mock-upstream:4988/webmasters/v3
 */
const { createMockUpstream } = require('./mockUpstream');

const port = Number(process.env.MOCK_UPSTREAM_PORT || 4988);

async function main() {
  const up = createMockUpstream({ port });
  await up.ready();
  console.log(`mock upstream listening on :${port}`);
  console.log('  /graph/<version>/…      Meta Graph (Facebook + Instagram)');
  console.log('  /token                  Google OAuth refresh');
  console.log('  /yt/v2/reports          YouTube Analytics');
  console.log('  /youtube/v3/…           YouTube Data API');
  console.log('  /webmasters/v3/…        Google Search Console');
  const log = process.env.MOCK_UPSTREAM_LOG === 'true';
  if (log) {
    setInterval(() => {
      const last = up.requests.slice(-5);
      for (const r of last) console.log(`  ← ${r.method} ${r.path}`);
    }, 5000).unref();
  }
  const shutdown = async () => {
    await up.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('mock upstream failed to start:', e.message);
  process.exit(1);
});
