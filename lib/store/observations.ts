import 'server-only'
import { randomUUID } from 'node:crypto'
import { gridDisk, latLngToCell } from 'h3-js'
import type { Observation, PayloadKind, SyncQuality } from '@/lib/api/schemas'
import { all, get, run, tx } from '@/lib/db'
import { getSourceRow, setSourceState } from './sources'

/**
 * Observation ingest and fusion.
 *
 * Every adapter writes here and nothing else enters the platform. Association is
 * deterministic: observations land in the same incident when they share an H3
 * neighbourhood, fall inside a fusion window widened by the worse of their two
 * sync qualities, and agree on domain. No model is involved in deciding that two
 * things are the same event.
 */

export interface IngestInput {
  source_id: string
  t_start: number
  t_end?: number
  lat?: number | null
  lon?: number | null
  heading_deg?: number | null
  fov_deg?: number | null
  range_m?: number | null
  pose_source?: Observation['pose']['pose_source']
  accuracy_m?: number
  payload_kind: PayloadKind
  content_ref?: string | null
  content_meta?: Record<string, unknown> | null
  classes?: string[]
  counts?: Record<string, number>
  trigger?: string | null
  quality?: { blur: number; exposure: number; occlusion: number; tamper: boolean; valid: boolean }
  device_signature?: string | null
  adapter_version?: string
}

/** Fusion window by sync quality, widened for the worse of the pair. */
const FUSION_WINDOW_MS: Record<SyncQuality, number> = { A: 30_000, B: 45_000, C: 90_000, D: 300_000 }

export function ingestObservation(input: IngestInput): { observation: Observation; incident_id: string | null } {
  const source = getSourceRow(input.source_id)
  if (!source) throw new Error(`unknown source ${input.source_id}`)

  const now = Date.now()
  const observationId = `OBS-${input.source_id}-${randomUUID().slice(0, 12)}`
  const lat = input.lat ?? source.lat
  const lon = input.lon ?? source.lon
  const h3 = latLngToCell(lat, lon, 9)
  const tEnd = input.t_end ?? input.t_start

  const quality = input.quality ?? { blur: 0, exposure: 0, occlusion: 0, tamper: false, valid: true }

  tx(() => {
    run(
      `INSERT INTO observations (
         observation_id, source_id, t_start, t_end, sync_quality, clock_offset_ms,
         lat, lon, heading_deg, fov_deg, range_m, pose_source, accuracy_m, h3,
         payload_kind, content_ref, content_meta, derived, quality,
         privacy_class, retention_class, device_signature, adapter_version, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        observationId,
        input.source_id,
        input.t_start,
        tEnd,
        source.sync_quality,
        source.clock_offset_ms,
        lat,
        lon,
        input.heading_deg ?? source.heading_deg,
        input.fov_deg ?? source.fov_deg,
        input.range_m ?? source.range_m,
        input.pose_source ?? (source.source_type.startsWith('patrol') ? 'gnss_imu' : 'fixed_calibration'),
        input.accuracy_m ?? 0,
        h3,
        input.payload_kind,
        input.content_ref ?? null,
        input.content_meta ? JSON.stringify(input.content_meta) : null,
        JSON.stringify({ classes: input.classes ?? [], counts: input.counts ?? {}, trigger: input.trigger ?? null }),
        JSON.stringify(quality),
        source.privacy_class,
        'incident-2y',
        input.device_signature ?? null,
        input.adapter_version ?? 'unknown',
        now,
      ],
    )
    run('UPDATE sources SET last_observation_at = ? WHERE source_id = ?', [input.t_start, input.source_id])
  })

  if (source.state !== 'up') setSourceState(input.source_id, 'up', 'observation received')

  return { observation: readObservation(observationId)!, incident_id: null }
}

export function attachToIncident(observationId: string, incidentId: string): void {
  run('UPDATE observations SET incident_id = ? WHERE observation_id = ?', [incidentId, observationId])
}

/**
 * Finds an open incident this observation belongs to.
 *
 * Spatial overlap is an H3 neighbourhood at resolution 9, which is roughly a
 * 200 metre disc, and temporal proximity is the fusion window for the worse of
 * the two sync qualities. Anything outside both is a separate event.
 */
export function findCandidateIncident(
  h3: string,
  t: number,
  domain: string,
  syncQuality: SyncQuality,
): string | null {
  const neighbourhood = gridDisk(h3, 1)
  const window = FUSION_WINDOW_MS[syncQuality]
  const row = get<{ incident_id: string }>(
    `SELECT incident_id FROM incidents
     WHERE domain = ?
       AND status NOT IN ('resolved', 'verified')
       AND dismissed_reason IS NULL
       AND ABS(detected_at - ?) <= ?
       AND h3 IN (${neighbourhood.map(() => '?').join(',')})
     ORDER BY ABS(detected_at - ?) ASC LIMIT 1`,
    [domain, t, window, ...neighbourhood, t],
  )
  return row?.incident_id ?? null
}

interface ObservationRow {
  observation_id: string
  source_id: string
  t_start: number
  t_end: number
  sync_quality: string
  clock_offset_ms: number
  lat: number | null
  lon: number | null
  heading_deg: number | null
  fov_deg: number | null
  range_m: number | null
  pose_source: string
  accuracy_m: number
  h3: string | null
  payload_kind: string
  content_ref: string | null
  content_meta: string | null
  derived: string | null
  quality: string | null
  privacy_class: string
  retention_class: string
  device_signature: string | null
  adapter_version: string
  incident_id: string | null
}

function toObservation(row: ObservationRow): Observation {
  const source = getSourceRow(row.source_id)
  const derived = row.derived ? (JSON.parse(row.derived) as { classes: string[]; counts: Record<string, number>; trigger: string | null }) : { classes: [], counts: {}, trigger: null }
  const quality = row.quality
    ? (JSON.parse(row.quality) as { blur: number; exposure: number; occlusion: number; tamper: boolean; valid: boolean })
    : { blur: 0, exposure: 0, occlusion: 0, tamper: false, valid: true }
  const meta = row.content_meta ? (JSON.parse(row.content_meta) as Record<string, unknown>) : null

  return {
    observation_id: row.observation_id,
    source: {
      source_id: row.source_id,
      source_type: (source?.source_type ?? 'cctv-fixed') as Observation['source']['source_type'],
      owner: source?.owner ?? 'unknown',
      trust_score: 0,
    },
    capture: {
      t_start: row.t_start,
      t_end: row.t_end,
      sync_quality: row.sync_quality as SyncQuality,
      clock_offset_ms: row.clock_offset_ms,
    },
    pose: {
      lat: row.lat ?? 0,
      lon: row.lon ?? 0,
      heading_deg: row.heading_deg,
      fov_deg: row.fov_deg,
      range_m: row.range_m,
      pose_source: row.pose_source as Observation['pose']['pose_source'],
      accuracy_m: row.accuracy_m,
    },
    coverage_cells: row.h3 ? [row.h3] : [],
    payload_kind: row.payload_kind as PayloadKind,
    content_ref: row.content_ref,
    content_meta:
      meta === null
        ? null
        : {
            codec: String(meta.codec ?? 'unknown'),
            width: Number(meta.width ?? 0),
            height: Number(meta.height ?? 0),
            fps: Number(meta.fps ?? 0),
            duration_ms: Number(meta.duration_ms ?? 0),
            bytes: Number(meta.bytes ?? 0),
          },
    derived,
    quality: { blur: quality.blur, exposure: quality.exposure, occlusion: quality.occlusion, tamper: quality.tamper, valid: quality.valid },
    provenance: {
      hash: row.content_ref ?? '',
      device_signature: row.device_signature,
      adapter_version: row.adapter_version,
    },
    privacy_class: row.privacy_class as Observation['privacy_class'],
    retention_class: row.retention_class as Observation['retention_class'],
  }
}

export function readObservation(observationId: string): Observation | null {
  const row = get<ObservationRow>('SELECT * FROM observations WHERE observation_id = ?', [observationId])
  return row ? toObservation(row) : null
}

export function observationsForIncident(incidentId: string): Observation[] {
  return all<ObservationRow>('SELECT * FROM observations WHERE incident_id = ? ORDER BY t_start ASC', [incidentId]).map(
    toObservation,
  )
}

export function recentObservations(limit = 100): Observation[] {
  return all<ObservationRow>('SELECT * FROM observations ORDER BY t_start DESC LIMIT ?', [limit]).map(toObservation)
}

export function observationCount(): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM observations')?.c ?? 0
}

export function ingestSensorReading(sourceId: string, t: number, value: number, unit: string, valid = true): void {
  const source = getSourceRow(sourceId)
  if (!source) throw new Error(`unknown source ${sourceId}`)
  run('INSERT OR REPLACE INTO sensor_readings (source_id, t, value, unit, valid) VALUES (?, ?, ?, ?, ?)', [
    sourceId,
    t,
    value,
    unit,
    valid ? 1 : 0,
  ])
  run('UPDATE sources SET last_observation_at = ? WHERE source_id = ?', [t, sourceId])
  if (source.state !== 'up') setSourceState(sourceId, 'up', 'sensor reading received')
}

/** Min and max buckets, the shape the timeline and the scope both consume. */
export function sensorSeries(
  sourceId: string,
  from: number,
  to: number,
  maxBuckets: number,
): { buckets: [number, number, number][]; unit: string; bucketMs: number } {
  const rows = all<{ t: number; value: number; unit: string }>(
    'SELECT t, value, unit FROM sensor_readings WHERE source_id = ? AND t BETWEEN ? AND ? ORDER BY t ASC',
    [sourceId, from, to],
  )
  if (rows.length === 0) return { buckets: [], unit: '', bucketMs: 0 }

  const bucketMs = Math.max(1000, Math.ceil((to - from) / maxBuckets))
  const buckets = new Map<number, { lo: number; hi: number }>()
  for (const row of rows) {
    const key = Math.floor((row.t - from) / bucketMs) * bucketMs + from
    const existing = buckets.get(key)
    if (!existing) buckets.set(key, { lo: row.value, hi: row.value })
    else {
      existing.lo = Math.min(existing.lo, row.value)
      existing.hi = Math.max(existing.hi, row.value)
    }
  }
  return {
    buckets: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, v.lo, v.hi]),
    unit: rows[0]!.unit,
    bucketMs,
  }
}
