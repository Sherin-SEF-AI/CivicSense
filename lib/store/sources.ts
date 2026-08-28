import 'server-only'
import { latLngToCell } from 'h3-js'
import type { SourceDetail, SourceDevice, SourceState, SyncQuality } from '@/lib/api/schemas'
import { all, audit, get, run } from '@/lib/db'
import { zoneAt } from './zones'

/**
 * The source registry.
 *
 * A source is a real device with a real address: an RTSP or HLS URL, a position,
 * and optionally a calibration. Nothing appears here that was not registered,
 * and a source contributes nothing until it sends observations.
 */

interface SourceRow {
  source_id: string
  source_type: string
  label: string
  site: string
  zone_id: string | null
  lat: number
  lon: number
  heading_deg: number | null
  fov_deg: number | null
  range_m: number | null
  stream_url: string | null
  stream_kind: string | null
  state: string
  sync_quality: string
  clock_offset_ms: number
  calibrated_at: number | null
  calibration_residual_m: number | null
  homography: string | null
  firmware: string | null
  edge_device: string | null
  privacy_class: string
  sensor_kind: string | null
  representativity_m: number | null
  owner: string | null
  registered_at: number
  last_observation_at: number | null
  attestation: number
  learned_precision: number
  quality: number
}

/** trust = attestation x calibration recency x learned precision x quality. */
function trustOf(row: SourceRow, now: number): { trust: number; components: SourceDevice['trust_components'] } {
  const ageDays = row.calibrated_at === null ? null : (now - row.calibrated_at) / 86400_000
  const calibrationRecency =
    ageDays === null ? 1 : Math.max(0.4, 1 - Math.max(0, ageDays - 30) / 180)
  const components = {
    attestation: round2(row.attestation),
    calibration_recency: round2(calibrationRecency),
    learned_precision: round2(row.learned_precision),
    quality: round2(row.quality),
  }
  const trust = round2(
    components.attestation * components.calibration_recency * components.learned_precision * components.quality,
  )
  return { trust, components }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function toDevice(row: SourceRow, now: number): SourceDevice {
  const { trust, components } = trustOf(row, now)
  const zone = row.zone_id ? zoneAt(row.lat, row.lon) : zoneAt(row.lat, row.lon)
  const trail = all<{ t: number; lat: number; lon: number; heading_deg: number | null }>(
    `SELECT t_start AS t, lat, lon, heading_deg FROM observations
     WHERE source_id = ? AND lat IS NOT NULL AND t_start > ?
     ORDER BY t_start ASC LIMIT 120`,
    [row.source_id, now - 15 * 60_000],
  )

  return {
    source_id: row.source_id,
    source_type: row.source_type as SourceDevice['source_type'],
    label: row.label,
    site: row.site,
    zone_id: zone?.zone_id ?? row.zone_id ?? 'unassigned',
    zone_label: zone?.label ?? 'outside any configured zone',
    position: { lat: row.lat, lon: row.lon },
    heading_deg: row.heading_deg,
    fov_deg: row.fov_deg,
    range_m: row.range_m,
    state: row.state as SourceState,
    uptime_7d: uptimeOf(row.source_id, now),
    sync_quality: row.sync_quality as SyncQuality,
    calibrated_at: row.calibrated_at,
    calibration_residual_m: row.calibration_residual_m,
    trust,
    trust_components: components,
    last_observation_at: row.last_observation_at ?? row.registered_at,
    firmware: row.firmware ?? 'unknown',
    edge_device: row.edge_device,
    privacy_class: row.privacy_class as SourceDevice['privacy_class'],
    sensor_kind: row.sensor_kind as SourceDevice['sensor_kind'],
    representativity_m: row.representativity_m,
    thumb_url: null,
    trail: trail.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, heading: p.heading_deg ?? 0 })),
  }
}

/** Measured from the health samples the device actually reported. */
function uptimeOf(sourceId: string, now: number): number {
  const row = get<{ avg: number | null }>(
    'SELECT AVG(uptime) AS avg FROM source_health WHERE source_id = ? AND t > ?',
    [sourceId, now - 7 * 86400_000],
  )
  return row?.avg === null || row?.avg === undefined ? 0 : Math.round(row.avg * 1000) / 1000
}

export function listSources(filters: {
  types?: string[]
  states?: string[]
  zones?: string[]
  search?: string
}): SourceDevice[] {
  const now = Date.now()
  const rows = all<SourceRow>('SELECT * FROM sources ORDER BY source_id ASC')
  return rows
    .filter((row) => {
      if (filters.types?.length && !filters.types.includes(row.source_type)) return false
      if (filters.states?.length && !filters.states.includes(row.state)) return false
      if (filters.zones?.length && !filters.zones.includes(row.zone_id ?? '')) return false
      if (filters.search) {
        const needle = filters.search.toLowerCase()
        if (!row.label.toLowerCase().includes(needle) && !row.source_id.toLowerCase().includes(needle)) return false
      }
      return true
    })
    .map((row) => toDevice(row, now))
}

export function getSource(sourceId: string): SourceDevice | null {
  const row = get<SourceRow>('SELECT * FROM sources WHERE source_id = ?', [sourceId])
  return row ? toDevice(row, Date.now()) : null
}

export function getSourceRow(sourceId: string): SourceRow | undefined {
  return get<SourceRow>('SELECT * FROM sources WHERE source_id = ?', [sourceId])
}

export function sourceDetail(sourceId: string): SourceDetail | null {
  const device = getSource(sourceId)
  if (!device) return null
  const now = Date.now()

  const health = all<{ t: number; uptime: number; fps: number; drops: number; latency_ms: number }>(
    'SELECT t, uptime, fps, drops, latency_ms FROM source_health WHERE source_id = ? AND t > ? ORDER BY t ASC',
    [sourceId, now - 24 * 3600_000],
  )
  const events = all<{ t: number; kind: string; detail: string }>(
    'SELECT t, kind, detail FROM source_events WHERE source_id = ? ORDER BY t DESC LIMIT 40',
    [sourceId],
  )
  const row = getSourceRow(sourceId)
  const homography = row?.homography ? (JSON.parse(row.homography) as { residuals?: { point: string; residual_m: number }[] }) : null

  return {
    device,
    health,
    events: events.map((e) => ({ t: e.t, kind: e.kind as SourceDetail['events'][number]['kind'], detail: e.detail })),
    homography_residuals: homography?.residuals ?? [],
  }
}

export interface SourceRegistration {
  source_id: string
  source_type: string
  label: string
  site?: string
  lat: number
  lon: number
  heading_deg?: number | null
  fov_deg?: number | null
  range_m?: number | null
  stream_url?: string | null
  stream_kind?: 'rtsp' | 'hls' | 'file' | 'none'
  sync_quality?: SyncQuality
  clock_offset_ms?: number
  firmware?: string
  edge_device?: string | null
  privacy_class?: string
  sensor_kind?: string | null
  representativity_m?: number | null
  owner?: string
}

export function registerSource(input: SourceRegistration, actor: string): SourceDevice {
  const now = Date.now()
  const zone = zoneAt(input.lat, input.lon)
  run(
    `INSERT INTO sources (
       source_id, source_type, label, site, zone_id, lat, lon, heading_deg, fov_deg, range_m,
       stream_url, stream_kind, state, sync_quality, clock_offset_ms, firmware, edge_device,
       privacy_class, sensor_kind, representativity_m, owner, registered_at, attestation,
       learned_precision, quality
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'down', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       source_type = excluded.source_type, label = excluded.label, site = excluded.site,
       zone_id = excluded.zone_id, lat = excluded.lat, lon = excluded.lon,
       heading_deg = excluded.heading_deg, fov_deg = excluded.fov_deg, range_m = excluded.range_m,
       stream_url = excluded.stream_url, stream_kind = excluded.stream_kind,
       sync_quality = excluded.sync_quality, clock_offset_ms = excluded.clock_offset_ms,
       firmware = excluded.firmware, edge_device = excluded.edge_device,
       privacy_class = excluded.privacy_class, sensor_kind = excluded.sensor_kind,
       representativity_m = excluded.representativity_m, owner = excluded.owner`,
    [
      input.source_id,
      input.source_type,
      input.label,
      input.site ?? input.label,
      zone?.zone_id ?? null,
      input.lat,
      input.lon,
      input.heading_deg ?? null,
      input.fov_deg ?? null,
      input.range_m ?? null,
      input.stream_url ?? null,
      input.stream_kind ?? 'none',
      input.sync_quality ?? 'D',
      input.clock_offset_ms ?? 0,
      input.firmware ?? null,
      input.edge_device ?? null,
      input.privacy_class ?? 'public-space',
      input.sensor_kind ?? null,
      input.representativity_m ?? null,
      input.owner ?? actor,
      now,
      /* A newly registered device has no attestation history and no learned
         precision yet. Both rise as it produces observations that survive
         review, which is what the trust model is for. */
      0.6,
      0.5,
      0.6,
    ],
  )
  run('INSERT INTO source_events (source_id, t, kind, detail) VALUES (?, ?, ?, ?)', [
    input.source_id,
    now,
    'up',
    `registered by ${actor}`,
  ])
  audit(actor, 'source.registered', `source:${input.source_id}`, `${input.source_type} at ${input.lat}, ${input.lon}`)
  return getSource(input.source_id)!
}

export function deleteSource(sourceId: string, actor: string): boolean {
  const existing = getSourceRow(sourceId)
  if (!existing) return false
  run('DELETE FROM sources WHERE source_id = ?', [sourceId])
  audit(actor, 'source.removed', `source:${sourceId}`, 'removed from the registry')
  return true
}

export function recordHealth(
  sourceId: string,
  sample: { uptime: number; fps: number; drops: number; latency_ms: number },
): void {
  const now = Date.now()
  run(
    'INSERT OR REPLACE INTO source_health (source_id, t, uptime, fps, drops, latency_ms) VALUES (?, ?, ?, ?, ?, ?)',
    [sourceId, now, sample.uptime, sample.fps, sample.drops, sample.latency_ms],
  )
  run('DELETE FROM source_health WHERE source_id = ? AND t < ?', [sourceId, now - 7 * 86400_000])
}

export function setSourceState(sourceId: string, state: SourceState, detail: string): void {
  run('UPDATE sources SET state = ? WHERE source_id = ?', [state, sourceId])
  run('INSERT INTO source_events (source_id, t, kind, detail) VALUES (?, ?, ?, ?)', [
    sourceId,
    Date.now(),
    state,
    detail,
  ])
}

export function h3For(lat: number, lon: number, resolution = 9): string {
  return latLngToCell(lat, lon, resolution)
}
