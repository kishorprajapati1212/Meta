/**
 * csv.js — client-side CSV/JSON export for whatever table is on screen.
 */

function escapeCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }))
  const header = cols.map((c) => escapeCell(c.label || c.key)).join(',')
  const body = rows.map((r) => cols.map((c) => escapeCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))
  return [header, ...body].join('\n')
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function exportCSV(filename, rows, columns) {
  download(filename.endsWith('.csv') ? filename : `${filename}.csv`, toCSV(rows, columns))
}

export function exportJSON(filename, data) {
  download(filename.endsWith('.json') ? filename : `${filename}.json`, JSON.stringify(data, null, 2), 'application/json')
}

export async function copyJSON(data) {
  const text = JSON.stringify(data, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
