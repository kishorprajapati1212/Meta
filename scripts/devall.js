#!/usr/bin/env node
/**
 * devall.js — run the whole stack with one command.
 *
 *   npm run dev:all
 *
 * Starts the Express API (PORT, default 5000) and the Pulse Vite dev server
 * (:5173) with VITE_PROXY_TARGET pointed at that local API, so the browser
 * only ever talks to one origin. This is what Project IDX previews use, and it
 * removes the two most common "API not connected" causes:
 *   • the dashboard proxying to a sleeping free-tier host instead of localhost
 *   • CORS/origin mismatch between the :5173 preview and the :5000 API
 *
 * No dependencies: child_process + a log prefix per child. Ctrl-C stops both.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 5000)
const UI_PORT = Number(process.env.UI_PORT || 5173)

const COLORS = { api: '\x1b[36m', ui: '\x1b[35m' }
const RESET = '\x1b[0m'

const children = []
let shuttingDown = false

function prefixLines(label, stream, out) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) out.write(`${COLORS[label]}[${label}]${RESET} ${line}\n`)
  })
  stream.on('end', () => {
    if (buffer) out.write(`${COLORS[label]}[${label}]${RESET} ${buffer}\n`)
  })
}

function start(label, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push({ label, child })
  prefixLines(label, child.stdout, process.stdout)
  prefixLines(label, child.stderr, process.stderr)
  child.on('error', (err) => {
    process.stderr.write(`${COLORS[label]}[${label}]${RESET} failed to start: ${err.message}\n`)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    process.stderr.write(`${COLORS[label]}[${label}]${RESET} exited (${signal || code}) — stopping the stack\n`)
    stop(code || 1)
  })
  return child
}

function stop(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 400).unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

process.stdout.write(
  `\n  API      → http://127.0.0.1:${PORT}   (dashboard at /app once built)\n` +
    `  Dashboard → http://127.0.0.1:${UI_PORT}  (proxies /api to the local API)\n` +
    `  Ctrl-C stops both.\n\n`
)

start('api', process.execPath, [path.join(ROOT, 'src', 'app.js')], ROOT, { PORT: String(PORT) })
start(
  'ui',
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev', '--', '--port', String(UI_PORT), '--host', '0.0.0.0'],
  path.join(ROOT, 'Pulse'),
  { VITE_PROXY_TARGET: `http://127.0.0.1:${PORT}`, PORT: String(PORT) }
)
