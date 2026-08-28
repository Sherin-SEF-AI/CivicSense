import 'server-only'
import type { Domain, Intervention, InterventionOutcome, Warning, WarningLevel } from '@/lib/api/schemas'
import { latLngToCell } from 'h3-js'
import { HOTSPOTS, ZONE_SEEDS } from '@/lib/geo/bengaluru'
import { chance, gauss, intRange, mulberry32, pick, range, subSeed, ulid, weighted } from './rng'

const LEVELS: readonly (readonly [WarningLevel, number])[] = [
  ['WATCH', 40],
  ['ADVISORY', 30],
  ['WARNING', 20],
  ['CRITICAL', 10],
]

const HEADLINES: Record<Domain, readonly string[]> = {
  traffic: [
    'queue growth on the approach exceeds the weekday baseline',
    'signal cycle failure projected to spill back into the junction',
  ],
  waste: [
    'bin fill rate against collection schedule projects overflow',
    'missed collection pattern repeating on this route',
  ],
  safety: [
    'crowd growth rate above the Saturday baseline at this gate',
    'night corridor risk rising with two lights out',
  ],
  nuisance: ['noise Leq trending toward the zone limit for this hour'],
  infrastructure: ['pothole growth on this stretch projected to reach severity threshold'],
  environment: ['PM2.5 trend projects exceedance within the horizon'],
  vehicle: ['emergency corridor congestion projected during the evening peak'],
  disaster: [
    'rain accumulation against known drain blockage projects water logging',
    'water level trend approaching the flood threshold',
  ],
}

const INDICATORS: Record<Domain, readonly (readonly [string, string, string])[]> = {
  traffic: [
    ['queue_len', 'queue length', 'm'],
    ['flow_ratio', 'flow vs baseline', 'x'],
    ['signal_state', 'signal cycle', 's'],
  ],
  waste: [
    ['bin_fill', 'bin fill', '%'],
    ['collection_gap', 'collection gap', 'h'],
    ['truck_adherence', 'route adherence', '%'],
  ],
  safety: [
    ['crowd_growth', 'crowd growth rate', 'x'],
    ['exit_blocked', 'exits occupied', 'n'],
    ['light_outage', 'lights out', 'n'],
  ],
  nuisance: [
    ['leq', 'Leq 10 min', 'dB(A)'],
    ['limit_margin', 'margin to limit', 'dB(A)'],
  ],
  infrastructure: [
    ['defect_area', 'defect area', 'm2'],
    ['rain_7d', 'rain last 7d', 'mm'],
  ],
  environment: [
    ['pm25', 'PM2.5', 'ug/m3'],
    ['wind', 'wind speed', 'm/s'],
    ['burn_events', 'burn detections', 'n'],
  ],
  vehicle: [
    ['ambulance_eta', 'ambulance ETA', 'min'],
    ['lane_occupancy', 'lane occupancy', '%'],
  ],
  disaster: [
    ['rain_rate', 'rain rate', 'mm/h'],
    ['water_level', 'water level', 'cm'],
    ['drain_state', 'drain blockage', '%'],
  ],
}

const INTERVENTIONS: readonly {
  kind: Intervention['kind']
  label: string
  department: string
  cost: Intervention['cost_tier']
}[] = [
  { kind: 'patrol-tasking', label: 'task the nearest patrol to verify on site', department: 'traffic-police', cost: 'low' },
  { kind: 'signal-timing', label: 'request a signal timing change for the peak window', department: 'traffic-police', cost: 'low' },
  { kind: 'bin-deployment', label: 'deploy an additional bin and schedule an extra pickup', department: 'sanitation', cost: 'medium' },
  { kind: 'barrier-placement', label: 'place barriers to protect the pedestrian desire line', department: 'pwd', cost: 'medium' },
  { kind: 'awareness-point', label: 'set an awareness point during dispersal hours', department: 'city-police', cost: 'low' },
  { kind: 'infrastructure-ticket', label: 'raise an infrastructure ticket with measured quantities', department: 'pwd', cost: 'high' },
  { kind: 'pre-positioning', label: 'pre-position a water tanker and a pump crew', department: 'disaster-cell', cost: 'high' },
]

const DOMAINS: readonly Domain[] = [
  'traffic',
  'waste',
  'safety',
  'nuisance',
  'infrastructure',
  'environment',
  'vehicle',
  'disaster',
]

export function buildWarnings({ seed, now }: { seed: number; now: number }): Warning[] {
  const out: Warning[] = []
  for (let i = 0; i < 26; i++) {
    const rnd = mulberry32(subSeed(seed, 'warning', i))
    const level = weighted(rnd, LEVELS)
    const domain = pick(rnd, DOMAINS)
    const zone = ZONE_SEEDS[i % ZONE_SEEDS.length]!
    const horizon = pick(rnd, [1, 6, 24] as const)
    const issued = now - intRange(rnd, 1, 180) * 60_000
    const crossing = now + intRange(rnd, 4, horizon * 60) * 60_000

    const indicatorDefs = INDICATORS[domain]
    const indicators = indicatorDefs.map(([key, label, unit]) => ({
      key,
      label,
      value: `${Math.round(range(rnd, 8, 240) * 10) / 10} ${unit}`,
      weight: Math.round(range(rnd, 0.15, 0.9) * 100) / 100,
      trend: pick(rnd, ['rising', 'falling', 'flat'] as const),
    }))

    const cascadeCount = intRange(rnd, 0, 3)
    const cascade = Array.from({ length: cascadeCount }, (_, k) => {
      const z = ZONE_SEEDS[(i + k + 1) % ZONE_SEEDS.length]!
      return {
        zone_id: z.id,
        zone_label: z.label,
        lag_min: intRange(rnd, 8, 90),
        attenuation: Math.round(range(rnd, 0.2, 0.8) * 100) / 100,
      }
    })

    const interventionCount = intRange(rnd, 1, 3)
    const interventions: Intervention[] = Array.from({ length: interventionCount }, (_, k) => {
      const def = INTERVENTIONS[(i + k * 3) % INTERVENTIONS.length]!
      return {
        intervention_id: `INT-${i}-${k}`,
        kind: def.kind,
        label: def.label,
        rationale: `${indicators[0]?.label ?? 'the leading indicator'} is ${indicators[0]?.trend ?? 'rising'} and the projected crossing falls inside the ${horizon} hour horizon.`,
        expected_effect: Math.round(range(rnd, 0.12, 0.62) * 100) / 100,
        cost_tier: def.cost,
        feasibility: Math.round(range(rnd, 0.4, 0.98) * 100) / 100,
        department: def.department,
        taskable: def.kind === 'patrol-tasking',
      }
    })

    out.push({
      warning_id: ulid(rnd, issued),
      level,
      domain,
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat: zone.center[1], lon: zone.center[0] },
      h3: latLngToCell(zone.center[1], zone.center[0], 8),
      headline: pick(rnd, HEADLINES[domain]),
      issued_at: issued,
      horizon_h: horizon,
      crossing_at: crossing,
      confidence: Math.round(range(rnd, 0.52, 0.94) * 100) / 100,
      indicators,
      cascade,
      interventions,
      acknowledged: chance(rnd, 0.3),
    })
  }
  out.sort((a, b) => a.crossing_at - b.crossing_at)
  return out
}

export function buildOutcomes({ seed, now }: { seed: number; now: number }): InterventionOutcome[] {
  return Array.from({ length: 9 }, (_, i) => {
    const rnd = mulberry32(subSeed(seed, 'outcome', i))
    const def = INTERVENTIONS[i % INTERVENTIONS.length]!
    const zone = ZONE_SEEDS[(i * 3) % ZONE_SEEDS.length]!
    const before = Math.round(range(rnd, 3, 26) * 10) / 10
    const delta = gauss(rnd, -0.24, 0.18)
    const after = Math.round(Math.max(0.2, before * (1 + delta)) * 10) / 10
    const pct = Math.round(((after - before) / before) * 1000) / 10
    const halfWidth = Math.abs(pct) * range(rnd, 0.25, 0.7)
    return {
      outcome_id: `OUT-${String(i + 1).padStart(3, '0')}`,
      intervention_label: def.label,
      zone_label: zone.label,
      domain: pick(rnd, DOMAINS),
      applied_at: now - intRange(rnd, 12, 90) * 86400_000,
      before_rate: before,
      after_rate: after,
      delta_pct: pct,
      ci_lo: Math.round((pct - halfWidth) * 10) / 10,
      ci_hi: Math.round((pct + halfWidth) * 10) / 10,
      control_zones: intRange(rnd, 2, 6),
      significant: Math.abs(pct) > halfWidth,
    }
  })
}

/**
 * The risk surface.
 *
 * Real H3 cells at resolution 8, not a square grid wearing an H3 identifier.
 * The intensity is sampled from the hotspot field so the surface has the shape a
 * city's incident history produces rather than uniform noise.
 */
export function buildRisk(
  seed: number,
  now: number,
  domain: Domain | null,
  horizon: 1 | 6 | 24,
): {
  domain: Domain | null
  horizon_h: 1 | 6 | 24
  generated_at: number
  resolution: number
  cells: { h3: string; risk: number; baseline: number; projected: number; domain: Domain }[]
} {
  const RESOLUTION = 8
  const seen = new Map<string, { lon: number; lat: number }>()
  const cols = 60
  const rows = 46
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const lon = 77.45 + (x + 0.5) * (0.33 / cols)
      const lat = 12.83 + (y + 0.5) * (0.28 / rows)
      const cell = latLngToCell(lat, lon, RESOLUTION)
      if (!seen.has(cell)) seen.set(cell, { lon, lat })
    }
  }

  const cells: { h3: string; risk: number; baseline: number; projected: number; domain: Domain }[] = []
  let index = 0
  for (const [cell, centre] of seen) {
    const rnd = mulberry32(subSeed(seed, `risk-${domain ?? 'all'}-${horizon}`, index++))
    let field = 0
    for (const [hx, hy, w] of HOTSPOTS) {
      const d = Math.hypot(centre.lon - hx, centre.lat - hy)
      field += w * Math.exp(-(d * d) / 0.0006)
    }
    const baseline = Math.min(1, field * 0.6 + rnd() * 0.1)
    if (baseline < 0.08) continue
    const growth = 1 + (horizon / 24) * (rnd() - 0.35) * 0.9
    const projected = Math.min(1, baseline * growth)
    cells.push({
      h3: cell,
      risk: Math.round(projected * 1000) / 1000,
      baseline: Math.round(baseline * 1000) / 1000,
      projected: Math.round(projected * 1000) / 1000,
      domain: domain ?? DOMAINS[index % DOMAINS.length]!,
    })
  }
  return { domain, horizon_h: horizon, generated_at: now, resolution: RESOLUTION, cells }
}
