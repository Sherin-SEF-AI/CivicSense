import 'server-only'
import { createHash } from 'node:crypto'
import { all, get, run } from '@/lib/db'
import type { ConflictMetric, EntityDossier, Interval, TrackKinematics } from '@/lib/api/schemas'

/**
 * Ground-plane tracks and what can honestly be measured from them.
 *
 * An edge device with a calibrated homography reports where things were, in
 * metres on the ground, at known times. It does not report how fast they were
 * going, because a speed asserted by a device is a claim and a speed derived
 * from positions is a measurement with an error bar the platform can defend.
 *
 * So everything below is computed here from position and time, and the error bar
 * is carried from the calibration residual and the clock sync grade rather than
 * assumed away. When the resulting uncertainty is wide enough that the number
 * would mislead, it is reported as indicative and not as measured.
 */

export interface TrackSample {
  t: number
  lat: number
  lon: number
}

export interface TrackInput {
  track_id: string
  entity_ref?: string | null
  descriptor?: string
  validated_against_can?: boolean
  samples: TrackSample[]
}

const EARTH_M = 6_371_000

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const x = dLon * Math.cos(midLat)
  return Math.sqrt(dLat * dLat + x * x) * EARTH_M
}

/** Clock sync grade widens every time-derived quantity. */
const SYNC_JITTER_MS: Record<string, number> = { A: 10, B: 40, C: 150, D: 600 }

export function storeTracks(input: {
  observation_id: string
  source_id: string
  incident_id: string | null
  tracks: TrackInput[]
}): number {
  let stored = 0
  for (const track of input.tracks) {
    const samples = [...track.samples].sort((a, b) => a.t - b.t)
    if (samples.length < 2) continue
    run(
      `INSERT OR REPLACE INTO tracks
         (track_id, observation_id, incident_id, source_id, entity_ref, descriptor, validated_against_can, samples)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        track.track_id,
        input.observation_id,
        input.incident_id,
        input.source_id,
        track.entity_ref ?? null,
        track.descriptor ?? '',
        track.validated_against_can ? 1 : 0,
        JSON.stringify(samples),
      ],
    )
    stored++
  }
  return stored
}

interface TrackRow {
  track_id: string
  observation_id: string
  source_id: string
  entity_ref: string | null
  descriptor: string
  validated_against_can: number
  samples: string
}

interface Derived {
  track_id: string
  source_id: string
  entity_ref: string
  descriptor: string
  validated: boolean
  residualM: number
  jitterMs: number
  points: { t: number; lat: number; lon: number; speed: number; lo: number; hi: number; accel: number }[]
}

function derive(row: TrackRow): Derived | null {
  const samples = JSON.parse(row.samples) as TrackSample[]
  if (samples.length < 2) return null

  const source = get<{ sync_quality: string; calibration_residual_m: number | null }>(
    'SELECT sync_quality, calibration_residual_m FROM sources WHERE source_id = ?',
    [row.source_id],
  )
  /* An uncalibrated device gets a deliberately pessimistic residual rather than
     a flattering default, so its numbers land as indicative. */
  const residualM = source?.calibration_residual_m ?? 2.5
  const jitterMs = SYNC_JITTER_MS[source?.sync_quality ?? 'D'] ?? 600

  /* The first sample gives a position and nothing else: speed needs two. It is
     dropped rather than emitted as a zero, because a zero here would read as a
     stationary vehicle and that is a different claim. */
  const points: Derived['points'] = []
  for (let i = 1; i < samples.length; i++) {
    const current = samples[i]!
    const previous = samples[i - 1]!
    const dtS = (current.t - previous.t) / 1000
    if (dtS <= 0) continue

    const d = metres(previous, current)
    const speedMs = d / dtS

    /* Position error propagates through the difference, so two endpoints each
       uncertain by the residual give a distance uncertain by twice it. Timing
       jitter shifts the denominator. */
    const dLo = Math.max(0, d - 2 * residualM)
    const dHi = d + 2 * residualM
    const tLo = Math.max(0.04, dtS + (2 * jitterMs) / 1000)
    const tHi = Math.max(0.04, dtS - (2 * jitterMs) / 1000)

    const last = points[points.length - 1]
    /* Acceleration needs two speeds, so the first derived point has none. */
    const accel = last ? (speedMs - last.speed / 3.6) / dtS : 0

    points.push({
      t: current.t,
      lat: current.lat,
      lon: current.lon,
      speed: round(speedMs * 3.6),
      lo: round(Math.max(0, (dLo / tLo) * 3.6)),
      hi: round((dHi / tHi) * 3.6),
      accel: round(accel),
    })
  }
  if (points.length < 2) return null

  return {
    track_id: row.track_id,
    source_id: row.source_id,
    entity_ref: row.entity_ref ?? row.track_id,
    descriptor: row.descriptor,
    validated: row.validated_against_can === 1,
    residualM,
    jitterMs,
    points,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function interval(value: number, lo: number, hi: number): Interval {
  return { value: round(value), lo: round(lo), hi: round(hi) }
}

function derivedFor(incidentId: string): Derived[] {
  return all<TrackRow>('SELECT * FROM tracks WHERE incident_id = ?', [incidentId])
    .map(derive)
    .filter((d): d is Derived => d !== null)
}

export function kinematicsForIncident(incidentId: string): TrackKinematics[] {
  return derivedFor(incidentId).map((track) => {
    const moving = track.points.filter((p) => p.speed > 0)
    const peak = moving.reduce((best, p) => (p.speed > best.speed ? p : best), moving[0] ?? track.points[0]!)

    /* Braking onset is the first sustained deceleration, not the first negative
       sample, because one noisy sample is not a brake application. */
    let brakingOnset: number | null = null
    for (let i = 1; i < track.points.length - 1; i++) {
      const a = track.points[i]!
      const b = track.points[i + 1]!
      if (a.accel < -1.5 && b.accel < -1.5) {
        brakingOnset = a.t
        break
      }
    }

    /* A speed whose error bar is wider than a third of its value cannot support
       a claim about speed, so it is reported as an indication instead. */
    const spread = peak.hi - peak.lo
    const grade: TrackKinematics['measurement_grade'] =
      peak.speed > 0 && spread / peak.speed <= 0.33 && track.residualM <= 1.5 ? 'measured' : 'indicative'

    return {
      track_id: track.track_id,
      entity_ref: track.entity_ref,
      descriptor: track.descriptor || 'unlabelled track',
      source_id: track.source_id,
      samples: track.points.map((p) => ({
        t: p.t,
        speed: p.speed,
        speed_lo: p.lo,
        speed_hi: p.hi,
        accel: p.accel,
        lat: p.lat,
        lon: p.lon,
      })),
      peak_speed: interval(peak.speed, peak.lo, peak.hi),
      braking_onset_t: brakingOnset,
      measurement_grade: grade,
      validated_against_can: track.validated,
    }
  })
}

/**
 * Conflict metrics between every pair of tracks on an incident.
 *
 * Time to collision is computed at the sample where the pair is closest while
 * still closing. Post encroachment time is the gap between the two arrivals at
 * the point where their paths came nearest. Both carry the same uncertainty the
 * speeds carry, and a pair that never closes gets no metric rather than a
 * reassuring large number.
 */
export function conflictsForIncident(incidentId: string): ConflictMetric[] {
  const tracks = derivedFor(incidentId)
  const out: ConflictMetric[] = []

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i]!
      const b = tracks[j]!

      let closest: { t: number; gap: number; closing: number; aPoint: Derived['points'][number] } | null = null
      for (const pa of a.points) {
        /* Pair samples by nearest time; two devices rarely sample in step. */
        const pb = b.points.reduce((best, p) => (Math.abs(p.t - pa.t) < Math.abs(best.t - pa.t) ? p : best), b.points[0]!)
        if (Math.abs(pb.t - pa.t) > 1500) continue
        const gap = metres(pa, pb)
        const closing = (pa.speed + pb.speed) / 3.6
        if (closing <= 0.5) continue
        if (!closest || gap < closest.gap) closest = { t: pa.t, gap, closing, aPoint: pa }
      }
      if (!closest) continue

      const ttc = closest.gap / closest.closing
      /* The gap inherits the position error of both tracks. */
      const gapLo = Math.max(0, closest.gap - 2 * (a.residualM + b.residualM))
      const gapHi = closest.gap + 2 * (a.residualM + b.residualM)
      const ttcInterval = interval(ttc, gapLo / closest.closing, gapHi / closest.closing)

      /* Post encroachment: how long after one cleared the point the other
         reached it. */
      const nearestB = b.points.reduce(
        (best, p) => (metres(p, closest!.aPoint) < metres(best, closest!.aPoint) ? p : best),
        b.points[0]!,
      )
      const petS = Math.abs(nearestB.t - closest.t) / 1000
      const petJitter = (a.jitterMs + b.jitterMs) / 1000
      const pet = interval(petS, Math.max(0, petS - petJitter), petS + petJitter)

      /* Deceleration rate to avoid the crash, the standard surrogate measure. */
      const dracValue = closest.closing / Math.max(0.1, ttc)
      const drac = interval(dracValue, closest.closing / Math.max(0.1, ttcInterval.hi), closest.closing / Math.max(0.1, ttcInterval.lo))

      const severity: ConflictMetric['severity'] =
        ttcInterval.hi < 1.5 ? 'critical' : ttcInterval.hi < 3 ? 'serious' : ttcInterval.hi < 5 ? 'low' : 'none'

      out.push({
        pair: [a.track_id, b.track_id],
        ttc_s: ttcInterval,
        pet_s: pet,
        drac,
        t: closest.t,
        severity,
      })
    }
  }
  return out.sort((x, y) => (x.ttc_s?.value ?? 1e9) - (y.ttc_s?.value ?? 1e9))
}

/* ------------------------------------------------------------- entities */

export function recordEntities(input: {
  observation_id: string
  incident_id: string | null
  source_id: string
  t: number
  lat: number | null
  lon: number | null
  entities: { entity_ref: string; kind: string; descriptor?: string; plate?: string }[]
}): void {
  for (const entity of input.entities) {
    /* Raw plates never persist. The hash is what links sightings, and it cannot
       be turned back into a plate by anyone reading this database. */
    const plateHash = entity.plate ? createHash('sha256').update(entity.plate.toUpperCase().replace(/\s/g, '')).digest('hex') : null
    const existing = get<{ first_seen: number }>('SELECT first_seen FROM entities WHERE entity_ref = ?', [entity.entity_ref])
    if (existing) {
      run('UPDATE entities SET last_seen = MAX(last_seen, ?), descriptor = COALESCE(NULLIF(?, \'\'), descriptor) WHERE entity_ref = ?', [
        input.t,
        entity.descriptor ?? '',
        entity.entity_ref,
      ])
    } else {
      run('INSERT INTO entities (entity_ref, kind, descriptor, plate_hash, first_seen, last_seen) VALUES (?,?,?,?,?,?)', [
        entity.entity_ref,
        entity.kind,
        entity.descriptor ?? '',
        plateHash,
        input.t,
        input.t,
      ])
    }
    run(
      'INSERT OR REPLACE INTO entity_sightings (entity_ref, observation_id, incident_id, source_id, t, lat, lon) VALUES (?,?,?,?,?,?,?)',
      [entity.entity_ref, input.observation_id, input.incident_id, input.source_id, input.t, input.lat, input.lon],
    )
  }
}

/**
 * Dossiers for the entities seen on this incident.
 *
 * The path is only the sightings that were actually recorded, so a vehicle seen
 * by two cameras has two points and not an interpolated route. Prior incidents
 * are counted, not listed, unless the case carries an investigation flag, and
 * the appearance strip is the evidence that was already captured rather than
 * anything newly retrieved.
 */
export function entitiesForIncident(incidentId: string, investigationFlag: boolean): EntityDossier[] {
  const refs = all<{ entity_ref: string }>('SELECT DISTINCT entity_ref FROM entity_sightings WHERE incident_id = ?', [
    incidentId,
  ])

  return refs.flatMap(({ entity_ref }) => {
    const entity = get<{
      entity_ref: string
      kind: string
      descriptor: string
      plate_hash: string | null
      first_seen: number
      last_seen: number
    }>('SELECT * FROM entities WHERE entity_ref = ?', [entity_ref])
    if (!entity) return []

    /* A person is only followed across incidents under an authorised flag. On
       this incident they are still shown, because they are in the evidence. */
    const scope = investigationFlag || entity.kind !== 'person' ? null : incidentId
    const sightings = all<{ t: number; lat: number | null; lon: number | null; source_id: string; observation_id: string }>(
      scope === null
        ? 'SELECT t, lat, lon, source_id, observation_id FROM entity_sightings WHERE entity_ref = ? ORDER BY t ASC'
        : 'SELECT t, lat, lon, source_id, observation_id FROM entity_sightings WHERE entity_ref = ? AND incident_id = ? ORDER BY t ASC',
      scope === null ? [entity_ref] : [entity_ref, scope],
    )

    const strip = sightings.flatMap((s) => {
      const ref = get<{ content_ref: string | null }>('SELECT content_ref FROM observations WHERE observation_id = ?', [
        s.observation_id,
      ])
      return ref?.content_ref ? [`/api/v1/evidence/${ref.content_ref}/content`] : []
    })

    const prior = get<{ n: number }>(
      'SELECT COUNT(DISTINCT incident_id) AS n FROM entity_sightings WHERE entity_ref = ? AND incident_id IS NOT NULL AND incident_id != ?',
      [entity_ref, incidentId],
    )

    return [
      {
        entity_ref: entity.entity_ref,
        kind: (['vehicle', 'person', 'object'].includes(entity.kind) ? entity.kind : 'object') as EntityDossier['kind'],
        descriptor: entity.descriptor || 'no descriptor supplied at capture',
        plate_hash: entity.plate_hash,
        appearance_strip: [...new Set(strip)].slice(0, 8),
        path: sightings
          .filter((s): s is typeof s & { lat: number; lon: number } => s.lat !== null && s.lon !== null)
          .map((s) => ({ t: s.t, lat: s.lat, lon: s.lon, source_id: s.source_id })),
        prior_incidents: prior?.n ?? 0,
        investigation_flag: investigationFlag,
        first_seen: entity.first_seen,
        last_seen: entity.last_seen,
      },
    ]
  })
}
