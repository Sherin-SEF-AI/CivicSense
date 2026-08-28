/**
 * Extracts the Bengaluru basemap from a real OpenStreetMap extract.
 *
 * Input is the Geofabrik southern-zone PBF, which is the actual OSM planet data
 * for the region. Nothing here is drawn or invented: every road, lake, park and
 * ward boundary written to public/basemap is the real geometry, clipped to the
 * pilot bbox and simplified for size.
 *
 * Two passes over the file. The first keeps the coordinates of nodes inside the
 * bbox and builds the tagged ways from them; the second resolves the member ways
 * of boundary relations, which appear after the ways that make them up.
 *
 * Data (c) OpenStreetMap contributors, ODbL.
 */
import parseOSM from 'osm-pbf-parser'
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PBF = process.argv[2] ?? '.osm-cache/southern-zone.osm.pbf'
const OUT = join(process.cwd(), 'public', 'basemap')

const BBOX = { south: 12.83, west: 77.45, north: 13.11, east: 77.78 }
const inBox = (lat, lon) => lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary'])
const MINOR = new Set(['tertiary', 'unclassified'])

const round = (n) => Math.round(n * 1e5) / 1e5

function perpendicular(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
  const c = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + c * dx), p[1] - (a[1] + c * dy))
}

function simplify(points, tolerance) {
  if (points.length < 3) return points
  const stack = [[0, points.length - 1]]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  while (stack.length > 0) {
    const [start, end] = stack.pop()
    let maxDistance = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const d = perpendicular(points[i], points[start], points[end])
      if (d > maxDistance) {
        maxDistance = d
        index = i
      }
    }
    if (maxDistance > tolerance && index > 0) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

async function stream(handler) {
  await new Promise((resolve, reject) => {
    const parser = parseOSM()
    createReadStream(PBF)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) handler(item)
      })
      .on('end', resolve)
      .on('error', reject)
  })
}

const nodes = new Map()
const majorWays = []
const minorWays = []
const waterWays = []
const greenWays = []
const relations = []
const neededWayIds = new Set()

function geometryOf(refs) {
  const line = []
  for (const ref of refs) {
    const p = nodes.get(ref)
    if (!p) return null
    line.push(p)
  }
  return line.length >= 2 ? line : null
}

function closedRing(line) {
  if (line.length < 4) return null
  const first = line[0]
  const last = line[line.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? line : [...line, first]
}

console.log(`pass 1 over ${PBF}`)
let seenNodes = 0
await stream((item) => {
  if (item.type === 'node') {
    seenNodes++
    if (inBox(item.lat, item.lon)) nodes.set(item.id, [round(item.lon), round(item.lat)])
    if (seenNodes % 10_000_000 === 0) console.log(`  ${(seenNodes / 1e6).toFixed(0)}M nodes read, ${nodes.size} kept`)
    return
  }
  if (item.type === 'way') {
    const tags = item.tags ?? {}
    const line = geometryOf(item.refs ?? [])
    if (!line) return
    if (MAJOR.has(tags.highway)) majorWays.push({ id: item.id, tags, line })
    else if (MINOR.has(tags.highway)) minorWays.push({ id: item.id, tags, line })
    else if (tags.natural === 'water' || tags.landuse === 'reservoir') waterWays.push({ id: item.id, tags, line })
    else if (tags.leisure === 'park' || tags.landuse === 'forest') greenWays.push({ id: item.id, tags, line })
    return
  }
  if (item.type === 'relation') {
    const tags = item.tags ?? {}
    if (tags.boundary === 'administrative' && (tags.admin_level === '9' || tags.admin_level === '10')) {
      const members = (item.members ?? []).filter((m) => m.type === 'way')
      if (members.length === 0) return
      relations.push({ id: item.id, tags, members })
      /* osm-pbf-parser names the member reference `id`, not `ref`. */
      for (const m of members) neededWayIds.add(m.id)
    }
  }
})
console.log(`  kept ${nodes.size} nodes in bbox`)
console.log(`  ways: ${majorWays.length} major, ${minorWays.length} minor, ${waterWays.length} water, ${greenWays.length} green`)
console.log(`  ${relations.length} ward relations referencing ${neededWayIds.size} ways`)

const memberGeometry = new Map()
if (neededWayIds.size > 0) {
  console.log('pass 2 resolving ward member ways')
  await stream((item) => {
    if (item.type !== 'way') return
    if (!neededWayIds.has(item.id)) return
    const line = geometryOf(item.refs ?? [])
    if (line) memberGeometry.set(item.id, line)
  })
  console.log(`  resolved ${memberGeometry.size} member ways`)
}

function ringsFrom(members) {
  const pool = members.map((m) => memberGeometry.get(m.id)).filter(Boolean).map((l) => [...l])
  const rings = []
  const same = (a, b) => a[0] === b[0] && a[1] === b[1]
  while (pool.length > 0) {
    let ring = pool.shift()
    let extended = true
    while (extended) {
      extended = false
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        const head = ring[0]
        const tail = ring[ring.length - 1]
        if (same(tail, c[0])) ring = [...ring, ...c.slice(1)]
        else if (same(tail, c[c.length - 1])) ring = [...ring, ...c.slice(0, -1).reverse()]
        else if (same(head, c[c.length - 1])) ring = [...c.slice(0, -1), ...ring]
        else if (same(head, c[0])) ring = [...c.slice(1).reverse(), ...ring]
        else continue
        pool.splice(i, 1)
        extended = true
        break
      }
    }
    const closed = closedRing(ring)
    if (closed) rings.push(closed)
  }
  return rings.sort((a, b) => b.length - a.length)
}

const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties })
const collection = (features) => ({ type: 'FeatureCollection', features })

const majorFeatures = majorWays.map((w) =>
  feature(
    { type: 'LineString', coordinates: simplify(w.line, 0.00004) },
    {
      osm_id: w.id,
      name: w.tags.name ?? w.tags.ref ?? null,
      highway: w.tags.highway,
      klass: w.tags.highway === 'motorway' || w.tags.highway === 'trunk' ? 'ring' : 'arterial',
      lanes: w.tags.lanes ? Number(w.tags.lanes) : null,
      maxspeed: w.tags.maxspeed ?? null,
      oneway: w.tags.oneway === 'yes',
    },
  ),
)

const minorFeatures = minorWays.map((w) =>
  feature(
    { type: 'LineString', coordinates: simplify(w.line, 0.00008) },
    { osm_id: w.id, name: w.tags.name ?? null, highway: w.tags.highway, klass: 'minor' },
  ),
)

const polygonFeatures = (ways, tolerance) =>
  ways
    .map((w) => {
      const ring = closedRing(simplify(w.line, tolerance))
      return ring ? feature({ type: 'Polygon', coordinates: [ring] }, { osm_id: w.id, name: w.tags.name ?? null }) : null
    })
    .filter(Boolean)

const wardFeatures = relations
  .map((r) => {
    const rings = ringsFrom(r.members)
    if (rings.length === 0) return null
    const outer = simplify(rings[0], 0.00008)
    if (outer.length < 4) return null
    const centroidLon = outer.reduce((s, p) => s + p[0], 0) / outer.length
    const centroidLat = outer.reduce((s, p) => s + p[1], 0) / outer.length
    if (!inBox(centroidLat, centroidLon)) return null
    return feature(
      { type: 'Polygon', coordinates: [closedRing(outer) ?? outer] },
      {
        osm_id: r.id,
        zone_id: r.tags.ref ? `W${r.tags.ref}` : `W${r.id}`,
        label: r.tags.name ?? `ward ${r.tags.ref ?? r.id}`,
        admin_level: r.tags.admin_level ?? null,
      },
    )
  })
  .filter(Boolean)

mkdirSync(OUT, { recursive: true })
const files = {
  'roads_major.geojson': collection(majorFeatures),
  'roads_minor.geojson': collection(minorFeatures),
  'water.geojson': collection(polygonFeatures(waterWays, 0.00004)),
  'green.geojson': collection(polygonFeatures(greenWays, 0.00006)),
  'zones.geojson': collection(wardFeatures),
}
for (const [name, data] of Object.entries(files)) {
  const json = JSON.stringify(data)
  writeFileSync(join(OUT, name), json)
  console.log(`${name.padEnd(22)} ${String(data.features.length).padStart(6)} features  ${(json.length / 1024 / 1024).toFixed(2)} MB`)
}
writeFileSync(
  join(OUT, 'ATTRIBUTION.txt'),
  'Basemap geometry extracted from OpenStreetMap.\nSource: Geofabrik southern-zone extract, clipped to the Bengaluru pilot area.\nData (c) OpenStreetMap contributors, licensed under the Open Database License (ODbL).\nhttps://www.openstreetmap.org/copyright\n',
)
