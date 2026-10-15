import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev server proxies /api to the analytics backend so the browser only ever
 * talks to one origin (no CORS, works inside sandboxed previews/iframes).
 *
 *   VITE_PROXY_TARGET=http://localhost:5000 npm run dev   → local API
 *   npm run dev                                           → deployed API
 *
 * `base: './'` makes the production build portable: it can be served from the
 * Express backend at /app, from a static host at /, or opened from disk.
 */
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'https://meta-ptze.onrender.com'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': { target: PROXY_TARGET, changeOrigin: true, secure: false, timeout: 120000 },
    },
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
