import 'server-only'
import type { Zone } from '@/lib/api/schemas'
import { all, get, run } from '@/lib/db'

/**
 * Zones.
 *
 * Boundaries come from the real ward polygons in the OpenStreetMap extract, and
 * are imported once by scripts/bootstrap.ts. The kind and the sensitivity index
 * are deployment configuration: a city decides that a hospital approach weighs
 * more than a residential lane, and the severity function reads it from here.
 */

interface ZoneRow {
  zone_id: string
  label: string
  kind: string
  sensitivity: number
  polygon: string
  centroid_lat: number
  centroid_lon: number
  osm_id: number | null
}

let cache: { rows: ZoneRow[]; rings: [number, number][][] } | null = null

function load(): { rows: ZoneRow[]; rings: [number, number][][] } {
  if (cache) return cache
  const rows = all<ZoneRow>('SELECT * FROM zones ORDER BY zone_id ASC')
  cache = { rows, rings: rows.map((r) => JSON.parse(r.polygon) as [number, number][]) }
  return cache
}

export function invalidateZoneCache(): void {
  cache = null
}

function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > lat !== b[1] > lat && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

export function zoneAt(lat: number, lon: number): ZoneRow | null {
  const { rows, rings } = load()
  for (let i = 0; i < rows.length; i++) {
    if (pointInRing(lon, lat, rings[i]!)) return rows[i]!
  }
  return null
}

export function listZones(): Zone[] {
  const { rows } = load()
  return rows.map((row) => ({
    zone_id: row.zone_id,
    label: row.label,
    kind: row.kind as Zone['kind'],
    sensitivity: row.sensitivity,
    polygon: JSON.parse(row.polygon) as [number, number][],
    centroid: { lat: row.centroid_lat, lon: row.centroid_lon },
    adjacency: adjacencyOf(row),
  }))
}

/** Zones sharing a boundary point are adjacent, which is what cascade needs. */
function adjacencyOf(row: ZoneRow): string[] {
  const { rows, rings } = load()
  const index = rows.findIndex((r) => r.zone_id === row.zone_id)
  const ring = rings[index]
  if (!ring) return []
  const keys = new Set(ring.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`))
  const neighbours: string[] = []
  rings.forEach((other, i) => {
    if (i === index) return
    if (other.some((p) => keys.has(`${p[0].toFixed(4)},${p[1].toFixed(4)}`))) {
      neighbours.push(rows[i]!.zone_id)
    }
  })
  return neighbours
}

export function upsertZone(zone: {
  zone_id: string
  label: string
  kind: string
  sensitivity: number
  polygon: [number, number][]
  osm_id?: number | null
}): void {
  const lats = zone.polygon.map((p) => p[1])
  const lons = zone.polygon.map((p) => p[0])
  const centroidLat = lats.reduce((s, v) => s + v, 0) / Math.max(1, lats.length)
  const centroidLon = lons.reduce((s, v) => s + v, 0) / Math.max(1, lons.length)
  run(
    `INSERT INTO zones (zone_id, label, kind, sensitivity, polygon, centroid_lat, centroid_lon, osm_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(zone_id) DO UPDATE SET
       label = excluded.label, kind = excluded.kind, sensitivity = excluded.sensitivity,
       polygon = excluded.polygon, centroid_lat = excluded.centroid_lat,
       centroid_lon = excluded.centroid_lon, osm_id = excluded.osm_id`,
    [
      zone.zone_id,
      zone.label,
      zone.kind,
      zone.sensitivity,
      JSON.stringify(zone.polygon),
      centroidLat,
      centroidLon,
      zone.osm_id ?? null,
    ],
  )
  invalidateZoneCache()
}

export function updateZoneProfile(zoneId: string, patch: { kind?: string; sensitivity?: number; label?: string }): Zone | null {
  const existing = get<ZoneRow>('SELECT * FROM zones WHERE zone_id = ?', [zoneId])
  if (!existing) return null
  run('UPDATE zones SET kind = ?, sensitivity = ?, label = ? WHERE zone_id = ?', [
    patch.kind ?? existing.kind,
    patch.sensitivity ?? existing.sensitivity,
    patch.label ?? existing.label,
    zoneId,
  ])
  invalidateZoneCache()
  return listZones().find((z) => z.zone_id === zoneId) ?? null
}

export function zoneCount(): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM zones')?.c ?? 0
}
