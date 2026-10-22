/**
 * mockServer.js — runs the shared mock Zernio as a standalone container entry.
 *
 *   node scripts/mockServer.js            # port 4987, mode from MOCK_MODE
 *   MOCK_MODE=rich node scripts/mockServer.js
 *
 * Used by `docker compose --profile mock up` so the whole stack can be
 * exercised end-to-end with no real credentials and no network access.
 */
const { createMock } = require('./mockZernio')

const port = Number(process.env.MOCK_PORT || 4987)
const mode = process.env.MOCK_MODE || 'rich'

async function main() {
  const mock = await createMock({ port, mode })
  await mock.ready()
  console.log(`mock Zernio listening on :${port} (mode: ${mock.getMode()})`)
  console.log('modes: zero-analytics | rich | accounts-500 | boards-404 | no-analytics-access | sparse-accounts | cross-posted | real-capture')
  process.on('SIGTERM', async () => {
    await mock.close()
    process.exit(0)
  })
}

main().catch((e) => {
  console.error('mock server failed:', e)
  process.exit(1)
})
