/**
 * prefs.js — tiny persisted-preferences helper (localStorage, SSR/private safe).
 */
const PREFIX = 'pulse.'

export function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage unavailable — prefs simply won't persist */
  }
}

export function removePref(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export const PREF_KEYS = {
  range: 'range',
  sample: 'sampleMode',
  view: 'activeView',
  sidebar: 'sidebarCollapsed',
  gscDim: 'gscDimension',
  metricByPlatform: 'metricSelection',
  // Who the content is written for. Changes the growth diagnosis, the
  // channel ranking and the advice — institutions is the education default.
  audience: 'audienceTarget',
  // Whether the growth diagnosis shows its detail (funnel, zero reasons,
  // actions). Collapsed by default so the metrics stay the first thing on a
  // channel page — the numbers are the product, the advice is one click away.
}
