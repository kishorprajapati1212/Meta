import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-server API proxy for /api.
 *
 * Target order:
 *   1. VITE_PROXY_TARGET (explicit override)
 *   2. the API on this machine — http://127.0.0.1:$PORT (default 5000). This is
 *      what Project IDX and `npm run dev:all` use, and it never cold-starts.
 *   3. if nothing answers locally, the request is transparently forwarded to
 *      VITE_FALLBACK_API (the deployed Render service) instead of failing.
 *   4. if that is unreachable too, the proxy answers with a well-formed JSON
 *      error so the dashboard shows a readable notice rather than a 502/500
 *      HTML page or a blank screen.
 *
 * Implemented as a middleware (not `server.proxy`) because Vite's own proxy
 * error handler ends the response with a bare 500 before a `proxy.on('error')`
 * listener can write anything useful.
 *
 * `base: './'` keeps the production build portable: served by Express at /app,
 * by a static host at /, or opened from disk.
 */
const LOCAL_TARGET = (process.env.VITE_PROXY_TARGET || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(/\/$/, '')
const FALLBACK_TARGET = (process.env.VITE_FALLBACK_API || 'https://meta-ptze.onrender.com').replace(/\/$/, '')
const PROXY_TIMEOUT = Number(process.env.VITE_PROXY_TIMEOUT || 120000)

/** JSON body in the same envelope the API uses (src/utils/response.js). */
const unreachable = (detail) => ({
  success: false,
  error: {
    message: 'The analytics API is not reachable from the dev server.',
    hint: 'Start the backend (`npm run dev:all` from the repo root, or `npm start` on port 5000), or set VITE_PROXY_TARGET to a running API.',
    detail,
  },
})

const sendJson = (res, status, body) => {
  if (res.headersSent || res.writableEnded) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error', reject)
  })

async function proxyOnce(target, req, body) {
  const headers = { accept: 'application/json', 'user-agent': 'pulse-dev-proxy' }
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
  const upstream = await fetch(`${target}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(PROXY_TIMEOUT),
  })
  const payload = Buffer.from(await upstream.arrayBuffer())
  const res = req.__res
  if (res.headersSent || res.writableEnded) return
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  })
  res.end(payload)
}

/** Vite plugin: serve /api from the local backend, else the deployed one. */
function apiProxy() {
  return {
    name: 'pulse-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api')) return next()
        req.originalUrl = req.originalUrl || req.url
        req.__res = res
        let body
        try {
          body = await readBody(req)
        } catch {
          body = undefined
        }
        try {
          await proxyOnce(LOCAL_TARGET, req, body)
          return
        } catch (localErr) {
          if (res.headersSent || res.writableEnded) return
          if (!FALLBACK_TARGET || FALLBACK_TARGET === LOCAL_TARGET) {
            sendJson(res, 503, unreachable(`${LOCAL_TARGET} did not answer (${localErr?.message || localErr}).`))
            return
          }
          try {
            await proxyOnce(FALLBACK_TARGET, req, body)
            return
          } catch (remoteErr) {
            sendJson(res, 503, unreachable(`Neither ${LOCAL_TARGET} nor ${FALLBACK_TARGET} answered (${remoteErr?.message || remoteErr}).`))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), apiProxy()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true, // required for tunneled previews (Project IDX, Codespaces)
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Recharts is ~590 kB on its own; splitting it keeps the app shell fast
        // and lets the chart chunk be cached independently.
        manualChunks(id) {
          // Only split what is genuinely independent. Bucketing "everything
          // else" into a vendor chunk creates a circular chunk with recharts
          // (recharts → lodash → vendor → recharts).
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
})
