import 'server-only'
import { cellToLatLng, latLngToCell } from 'h3-js'
import type { Domain, InterventionOutcome, RiskCell, Warning } from '@/lib/api/schemas'
import { all, get } from '@/lib/db'

/**
 * Prediction from observed history.
 *
 * Risk is incident density per H3 cell over a trailing window, projected forward
 * by the trend between the two halves of that window. It is a rate, not a model
 * output, and it is empty until there is history to compute it from.
 *
 * Warnings are raised by deterministic leading indicators: a sensor trending
 * toward its configured limit, or a situation repeating in a zone faster than it
 * did in the preceding period. Nothing is invented to fill the board.
 */

const RESOLUTION = 8

export function riskSurface(domain: Domain | null, horizonH: 1 | 6 | 24): RiskCell[] {
  const now = Date.now()
  /* The lookback scales with the horizon: a one hour projection reads the last
     day, a one day projection reads the last month. */
  const lookback = horizonH === 1 ? 86400_000 : horizonH === 6 ? 7 * 86400_000 : 30 * 86400_000
  const from = now - lookback
  const mid = now - lookback / 2

  const rows = all<{ lat: number; lon: number; detected_at: number; domain: string }>(
    `SELECT lat, lon, detected_at, domain FROM incidents
     WHERE detected_at >= ? ${domain ? 'AND domain = ?' : ''}`,
    domain ? [from, domain] : [from],
  )
  if (rows.length === 0) return []

  const cells = new Map<string, { early: number; late: number; domain: string }>()
  for (const row of rows) {
    const cell = latLngToCell(row.lat, row.lon, RESOLUTION)
    const entry = cells.get(cell) ?? { early: 0, late: 0, domain: row.domain }
    if (row.detected_at < mid) entry.early += 1
    else entry.late += 1
    cells.set(cell, entry)
  }

  const max = Math.max(...[...cells.values()].map((c) => c.early + c.late))
  return [...cells.entries()].map(([h3, counts]) => {
    const total = counts.early + counts.late
    const baseline = Math.round((total / max) * 1000) / 1000
    /* Projection is the observed trend between halves, clamped. A cell with more
       recent incidents than earlier ones projects higher. */
    const trend = counts.early === 0 ? (counts.late > 0 ? 1.5 : 1) : counts.late / counts.early
    const projected = Math.min(1, Math.round(baseline * Math.max(0.4, Math.min(2, trend)) * 1000) / 1000)
    return { h3, risk: projected, baseline, projected, domain: counts.domain as Domain }
  })
}

interface SensorRow {
  source_id: string
  label: string
  sensor_kind: string | null
  zone_id: string | null
  lat: number
  lon: number
}

/** dB(A) and particulate limits that carry a statutory threshold. */
const LIMITS: Record<string, { limit: number; unit: string; domain: Domain; headline: string }> = {
  noise: { limit: 55, unit: 'dB(A)', domain: 'nuisance', headline: 'noise trending toward the zone limit' },
  pm25: { limit: 60, unit: 'ug/m3', domain: 'environment', headline: 'particulate trending toward the daily standard' },
  pm10: { limit: 100, unit: 'ug/m3', domain: 'environment', headline: 'particulate trending toward the daily standard' },
  'water-level': { limit: 45, unit: 'cm', domain: 'disaster', headline: 'water level trending toward the flood threshold' },
  'bin-fill': { limit: 90, unit: '%', domain: 'waste', headline: 'bin fill trending toward overflow' },
  aqi: { limit: 200, unit: 'AQI', domain: 'environment', headline: 'air quality trending toward the poor band' },
}

export function computeWarnings(horizonH: 1 | 6 | 24): Warning[] {
  const now = Date.now()
  const horizonMs = horizonH * 3600_000
  const warnings: Warning[] = []

  const sensors = all<SensorRow>(
    `SELECT source_id, label, sensor_kind, zone_id, lat, lon FROM sources WHERE source_type = 'sensor' AND sensor_kind IS NOT NULL`,
  )

  for (const sensor of sensors) {
    const profile = sensor.sensor_kind ? LIMITS[sensor.sensor_kind] : undefined
    if (!profile) continue

    /* Linear fit over the trailing window, projected to the horizon. Two points
       is not a trend, so a short series raises nothing. */
    const readings = all<{ t: number; value: number }>(
      'SELECT t, value FROM sensor_readings WHERE source_id = ? AND t > ? ORDER BY t ASC',
      [sensor.source_id, now - Math.max(horizonMs, 3600_000) * 2],
    )
    if (readings.length < 12) continue

    const n = readings.length
    const meanT = readings.reduce((s, r) => s + r.t, 0) / n
    const meanV = readings.reduce((s, r) => s + r.value, 0) / n
    let num = 0
    let den = 0
    for (const r of readings) {
      num += (r.t - meanT) * (r.value - meanV)
      den += (r.t - meanT) ** 2
    }
    if (den === 0) continue
    const slope = num / den
    const latest = readings[n - 1]!
    const projected = latest.value + slope * horizonMs
    if (slope <= 0 || projected < profile.limit) continue

    const crossingAt = latest.t + (profile.limit - latest.value) / slope
    if (crossingAt <= now || crossingAt > now + horizonMs) continue

    const residual = readings.reduce((s, r) => s + (r.value - (meanV + slope * (r.t - meanT))) ** 2, 0) / n
    const spread = Math.sqrt(residual)
    const confidence = Math.max(0.2, Math.min(0.95, 1 - spread / Math.max(1, profile.limit)))
    const margin = Math.round((profile.limit - latest.value) * 10) / 10

    const zone = sensor.zone_id
      ? get<{ label: string }>('SELECT label FROM zones WHERE zone_id = ?', [sensor.zone_id])
      : undefined

    const level: Warning['level'] =
      crossingAt - now < horizonMs * 0.25 ? 'CRITICAL' : crossingAt - now < horizonMs * 0.5 ? 'WARNING' : crossingAt - now < horizonMs * 0.75 ? 'ADVISORY' : 'WATCH'

    warnings.push({
      warning_id: `WRN-${sensor.source_id}-${horizonH}`,
      level,
      domain: profile.domain,
      zone_id: sensor.zone_id ?? 'unassigned',
      zone_label: zone?.label ?? 'outside any configured zone',
      position: { lat: sensor.lat, lon: sensor.lon },
      h3: latLngToCell(sensor.lat, sensor.lon, RESOLUTION),
      headline: `${profile.headline} at ${sensor.label}`,
      issued_at: now,
      horizon_h: horizonH,
      crossing_at: Math.round(crossingAt),
      confidence: Math.round(confidence * 100) / 100,
      indicators: [
        {
          key: 'current',
          label: 'current reading',
          value: `${latest.value.toFixed(1)} ${profile.unit}`,
          weight: 1,
          trend: slope > 0 ? 'rising' : 'falling',
        },
        {
          key: 'slope',
          label: 'rate of change',
          value: `${(slope * 3600_000).toFixed(2)} ${profile.unit}/h`,
          weight: 0.8,
          trend: 'rising',
        },
        {
          key: 'margin',
          label: 'margin to limit',
          value: `${margin} ${profile.unit}`,
          weight: 0.6,
          trend: 'falling',
        },
        { key: 'samples', label: 'samples in window', value: String(n), weight: 0.3, trend: 'flat' },
      ],
      cascade: [],
      interventions: [],
      acknowledged: false,
    })
  }

  return warnings.sort((a, b) => a.crossing_at - b.crossing_at)
}

/**
 * Difference in differences for an intervention that has been applied.
 *
 * Reads the taskings table for interventions with an applied date, compares the
 * incident rate in the affected zone before and after against zones that were
 * not treated, and reports the interval. Empty until an intervention has been
 * applied and enough time has passed to measure it.
 */
export function interventionOutcomes(): InterventionOutcome[] {
  const now = Date.now()
  const window = 14 * 86400_000

  const taskings = all<{
    tasking_id: string
    intervention_label: string
    zone_label: string
    created_at: number
    department: string
  }>(`SELECT tasking_id, intervention_label, zone_label, created_at, department FROM taskings WHERE created_at < ?`, [
    now - window,
  ])

  return taskings.flatMap((tasking) => {
    const zone = get<{ zone_id: string; kind: string }>('SELECT zone_id, kind FROM zones WHERE label = ?', [tasking.zone_label])
    if (!zone) return []

    const rate = (zoneId: string, from: number, to: number) =>
      (get<{ c: number }>('SELECT COUNT(*) AS c FROM incidents WHERE zone_id = ? AND detected_at >= ? AND detected_at < ?', [
        zoneId,
        from,
        to,
      ])?.c ?? 0) /
      ((to - from) / (7 * 86400_000))

    const before = rate(zone.zone_id, tasking.created_at - window, tasking.created_at)
    const after = rate(zone.zone_id, tasking.created_at, tasking.created_at + window)

    const controls = all<{ zone_id: string }>('SELECT zone_id FROM zones WHERE kind = ? AND zone_id != ? LIMIT 8', [
      zone.kind,
      zone.zone_id,
    ])
    if (controls.length === 0) return []

    const controlBefore = controls.map((c) => rate(c.zone_id, tasking.created_at - window, tasking.created_at))
    const controlAfter = controls.map((c) => rate(c.zone_id, tasking.created_at, tasking.created_at + window))
    const controlDelta =
      controlAfter.reduce((s, v) => s + v, 0) / controls.length - controlBefore.reduce((s, v) => s + v, 0) / controls.length

    const treatedDelta = after - before
    const did = treatedDelta - controlDelta
    const deltaPct = before === 0 ? 0 : Math.round((did / before) * 1000) / 10

    /* Interval from the spread across control zones, which is the only
       uncertainty the data actually supports. */
    const controlDeltas = controlAfter.map((v, i) => v - controlBefore[i]!)
    const mean = controlDeltas.reduce((s, v) => s + v, 0) / controlDeltas.length
    const variance = controlDeltas.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, controlDeltas.length - 1)
    const stderr = Math.sqrt(variance / controlDeltas.length)
    const halfWidth = before === 0 ? 0 : Math.round(((1.96 * stderr) / before) * 1000) / 10

    return [
      {
        outcome_id: tasking.tasking_id,
        intervention_label: tasking.intervention_label,
        zone_label: tasking.zone_label,
        domain: 'traffic' as Domain,
        applied_at: tasking.created_at,
        before_rate: Math.round(before * 10) / 10,
        after_rate: Math.round(after * 10) / 10,
        delta_pct: deltaPct,
        ci_lo: Math.round((deltaPct - halfWidth) * 10) / 10,
        ci_hi: Math.round((deltaPct + halfWidth) * 10) / 10,
        control_zones: controls.length,
        significant: Math.abs(deltaPct) > halfWidth && halfWidth > 0,
      },
    ]
  })
}

export function cellCentre(h3: string): { lat: number; lon: number } {
  const [lat, lon] = cellToLatLng(h3)
  return { lat, lon }
}
