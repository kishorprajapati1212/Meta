/**
 * build-worldmap.mjs — generates Pulse/src/assets/worldMap.js
 *
 * Turns Natural Earth 110m country boundaries (TopoJSON) into simplified SVG
 * paths keyed by ISO 3166-1 alpha-2, so the dashboard can draw a real
 * choropleth with ZERO runtime dependencies and no network access.
 *
 *   node scripts/build-worldmap.mjs
 *
 * Sources (downloaded once into /tmp, or pass local paths):
 *   https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
 *   https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/slim-2/slim-2.json
 *
 * Pipeline: topojson arc decode → Miller cylindrical projection →
 *           Douglas–Peucker simplification → path strings + centroids.
 *
 * The output is committed to the repo; you only re-run this if you want a
 * different resolution or tolerance.
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'Pulse', 'src', 'assets', 'worldMap.js')

const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const ISO_URL =
  'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/slim-2/slim-2.json'

const WIDTH = 1000
const TOLERANCE = 0.55 // projected units; higher = fewer points, coarser coastlines
const LAT_CLIP = [-57, 84] // drop the Antarctic slab and the empty far north

// ── fetch ────────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'pulse-worldmap-builder' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location).then(resolve, reject)
        }
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`))
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      .on('error', reject)
  })
}

// ── topojson → lon/lat rings ─────────────────────────────────────────────────
function decodeArcs(topo) {
  const { scale, translate } = topo.transform
  return topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  })
}

function arcToRing(arcs, indices) {
  const ring = []
  for (const idx of indices) {
    const rev = idx < 0
    const arc = arcs[rev ? ~idx : idx]
    const pts = rev ? [...arc].reverse() : arc
    // Skip the duplicated seam point between consecutive arcs.
    for (let i = ring.length ? 1 : 0; i < pts.length; i++) ring.push(pts[i])
  }
  return ring
}

function geometryToPolygons(geom, arcs) {
  if (geom.type === 'Polygon') return geom.arcs.map((ring) => arcToRing(arcs, ring))
  if (geom.type === 'MultiPolygon') return geom.arcs.flat().map((ring) => arcToRing(arcs, ring))
  return []
}

// ── antimeridian splitting ───────────────────────────────────────────────────
// Natural Earth carries Fiji, Russia and Chukotka as single rings whose
// longitude jumps from +179 to -179. Projected naively that is a band across
// the whole map, so split each ring at lon ±180 exactly like d3-geo does.
function splitAtAntimeridian(ring) {
  const out = []
  let cur = []
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i]
    if (i > 0) {
      const prevLon = ring[i - 1][0]
      const d = lon - prevLon
      if (Math.abs(d) > 180) {
        // Crossing: interpolate the latitude where the segment meets ±180.
        const prevLat = ring[i - 1][1]
        const sign = d > 0 ? -1 : 1 // heading west→east across -180? or the reverse
        const fromLon = prevLon
        const t = (sign * 180 - fromLon) / (d > 0 ? d - 360 : d + 360)
        const crossLat = prevLat + t * (lat - prevLat)
        cur.push([sign * 180, crossLat])
        out.push(cur)
        cur = [[-sign * 180, crossLat]]
      }
    }
    cur.push([lon, lat])
  }
  if (cur.length) out.push(cur)
  // A ring that never crossed is returned whole.
  return out.length === 1 && out[0].length === ring.length ? [ring] : out
}

// ── Miller cylindrical projection ────────────────────────────────────────────
// Nicer than plate carrée for a dashboard: compresses the empty polar bands
// without the area distortion of Mercator.
const R = Math.PI / 180
function projectRaw(lon, lat) {
  const clamped = Math.max(LAT_CLIP[0], Math.min(LAT_CLIP[1], lat))
  const x = lon * R
  const y = (1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * clamped * R))) / 0.8
  return [x, y]
}

const X_MIN = -180 * R
const X_MAX = 180 * R
const [Y_MIN_RAW, Y_MAX_RAW] = [projectRaw(0, LAT_CLIP[0])[1], projectRaw(0, LAT_CLIP[1])[1]]
const SPAN_X = X_MAX - X_MIN
const SPAN_Y = Y_MAX_RAW - Y_MIN_RAW
const HEIGHT = Math.round((WIDTH * SPAN_Y) / SPAN_X)

function project(lon, lat) {
  const [x, y] = projectRaw(lon, lat)
  return [((x - X_MIN) / SPAN_X) * WIDTH, ((Y_MAX_RAW - y) / SPAN_Y) * HEIGHT]
}

// ── simplification ───────────────────────────────────────────────────────────
function perpDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts
  let maxD = -1
  let index = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) {
      maxD = d
      index = i
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]]
  const left = douglasPeucker(pts.slice(0, index + 1), tol)
  const right = douglasPeucker(pts.slice(index), tol)
  return left.concat(right.slice(1))
}

const r1 = (n) => Math.round(n * 10) / 10

function ringToPath(pts) {
  if (pts.length < 3) return ''
  const s = douglasPeucker(pts, TOLERANCE)
  if (s.length < 3) return ''
  return (
    `M${r1(s[0][0])} ${r1(s[0][1])}` +
    s.slice(1).map((p) => `L${r1(p[0])} ${r1(p[1])}`).join('') +
    'Z'
  )
}

function ringArea(pts) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  }
  return Math.abs(a / 2)
}

function centroid(rings) {
  // Area-weighted centroid of the projected rings: lands inside the largest
  // landmass, which is what a label/bubble anchor needs.
  let cx = 0
  let cy = 0
  let total = 0
  for (const ring of rings) {
    if (ring.length < 3) continue
    let a = 0
    let x = 0
    let y = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
      a += cross
      x += (ring[j][0] + ring[i][0]) * cross
      y += (ring[j][1] + ring[i][1]) * cross
    }
    if (!a) continue
    const area = Math.abs(a / 2)
    cx += (x / (3 * a)) * area
    cy += (y / (3 * a)) * area
    total += area
  }
  if (!total) return null
  return [cx / total, cy / total, total]
}

// ── main ─────────────────────────────────────────────────────────────────────
const topo = JSON.parse(await get(TOPO_URL))
const iso = JSON.parse(await get(ISO_URL))

const numericToAlpha = new Map(iso.map((c) => [String(Number(c['country-code'])), c['alpha-2']]))
const nameToAlpha = new Map(iso.map((c) => [c.name.toLowerCase(), c['alpha-2']]))
// A few boundaries Natural Earth carries without a numeric ISO id.
const EXTRA = { kosovo: 'XK', somaliland: null, 'n. cyprus': 'CY' }

const arcs = decodeArcs(topo)
const out = []
let skipped = []

for (const geom of topo.objects.countries.geometries) {
  const name = geom.properties?.name || ''
  let id = numericToAlpha.get(String(Number(geom.id))) || null
  if (!id) id = nameToAlpha.get(name.toLowerCase()) || null
  if (!id) id = EXTRA[name.toLowerCase()] || null

  const polygons = geometryToPolygons(geom, arcs)
  const projected = polygons
    .flatMap((ring) => splitAtAntimeridian(ring))
    .map((ring) => ring.map(([lon, lat]) => project(lon, lat)))
    .filter((ring) => {
      if (ring.length < 3) return false
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const [x, y] of ring) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      // Drop specks and any leftover zero-height clipped band.
      if (maxY - minY < 1.5) return false
      return ringArea(ring) > 4
    })

  if (!projected.length) continue
  const d = projected.map(ringToPath).filter(Boolean).join('')
  if (!d) continue

  const c = centroid(projected)
  const entry = {
    id: id || null,
    name,
    d,
    ...(c ? { cx: r1(c[0]), cy: r1(c[1]), area: Math.round(c[2]) } : {}),
  }
  if (!id) skipped.push(name)
  out.push(entry)
}

out.sort((a, b) => (b.area || 0) - (a.area || 0))

const body = `/**
 * worldMap.js — GENERATED FILE. Do not edit by hand.
 * Regenerate with: node scripts/build-worldmap.mjs
 *
 * Natural Earth 110m country boundaries, Miller cylindrical projection,
 * Douglas–Peucker simplified (tolerance ${TOLERANCE}). Keyed by ISO 3166-1
 * alpha-2 so it lines up with the country codes returned by the YouTube
 * Analytics API, Instagram insights and Google Search Console.
 *
 * ${out.length} countries · viewBox 0 0 ${WIDTH} ${HEIGHT}
 */
export const WORLD_VIEWBOX = '0 0 ${WIDTH} ${HEIGHT}'
export const WORLD_WIDTH = ${WIDTH}
export const WORLD_HEIGHT = ${HEIGHT}

/** Project [lon, lat] into the same space as the paths. */
export function projectLonLat(lon, lat) {
  const R = Math.PI / 180
  const clamped = Math.max(${LAT_CLIP[0]}, Math.min(${LAT_CLIP[1]}, lat))
  const x = lon * R
  const y = (1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * clamped * R))) / 0.8
  const X_MIN = ${X_MIN}
  const SPAN_X = ${SPAN_X}
  const Y_MAX = ${Y_MAX_RAW}
  const SPAN_Y = ${SPAN_Y}
  return [((x - X_MIN) / SPAN_X) * ${WIDTH}, ((Y_MAX - y) / SPAN_Y) * ${HEIGHT}]
}

export const COUNTRIES = ${JSON.stringify(out)}

export const COUNTRY_INDEX = Object.fromEntries(
  COUNTRIES.filter((c) => c.id).map((c) => [c.id, c])
)
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, body)

const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`✓ wrote ${path.relative(process.cwd(), OUT)}`)
console.log(`  ${out.length} countries · viewBox ${WIDTH}×${HEIGHT} · ${kb} KB`)
console.log(`  mapped: ${out.filter((c) => c.id).length} · unmapped: ${skipped.length}${skipped.length ? ' → ' + skipped.join(', ') : ''}`)
