import 'server-only'
import type { IncidentStatus, IncidentSummary, PriorityBand, SourceType } from '@/lib/api/schemas'
import { bandForScore } from '@/lib/api/schemas/common'
import { HOTSPOTS, ZONE_SEEDS } from '@/lib/geo/bengaluru'
import { latLngToCell } from 'h3-js'
import { pointInRing, sampleAlong, zonePolygon, type Position } from '@/lib/geo/build'
import { SITUATIONS, type SituationType } from './catalog'
import { chance, diurnal, gauss, intRange, mulberry32, pick, range, subSeed, ulid, weighted } from './rng'

export const SLA_SECONDS: Record<PriorityBand, number> = {
  CRITICAL: 300,
  HIGH: 1800,
  MEDIUM: 7200,
  LOW: 28800,
  INFO: 86400,
}

const IST_OFFSET_MS = 5.5 * 3600_000

export function istHour(t: number): number {
  return ((t + IST_OFFSET_MS) % 86400_000) / 3600_000
}

/** Zone polygons, computed once, used for point-in-polygon assignment. */
export function zoneRings(seed: number): { id: string; label: string; ring: Position[]; sensitivity: number; kind: string }[] {
  return ZONE_SEEDS.map((z, i) => ({
    id: z.id,
    label: z.label,
    kind: z.kind,
    sensitivity: z.sensitivity,
    ring: zonePolygon(z.center[0], z.center[1], z.radius, subSeed(seed, 'zone', i)),
  }))
}

function zoneAt(rings: ReturnType<typeof zoneRings>, lon: number, lat: number) {
  for (const z of rings) if (pointInRing(lon, lat, z.ring)) return z
  let best = rings[0]!
  let bestD = Infinity
  for (const z of rings) {
    const seed = ZONE_SEEDS.find((s) => s.id === z.id)!
    const d = Math.hypot(seed.center[0] - lon, seed.center[1] - lat)
    if (d < bestD) {
      bestD = d
      best = z
    }
  }
  return best
}

/**
 * Severity arithmetic, done the way the spec requires: the model supplies bounded
 * amplifiers, everything else is code. Keeping it here means the fixture world
 * and the client agree on what a CSS of 0.78 is made of.
 */
export function severityOf(
  s: SituationType,
  zoneSensitivity: number,
  hour: number,
  affected: number,
  escalation: number,
  infraRisk: number,
): { score: number; components: { key: string; raw: number; weight: number }[] } {
  const temporal = hour >= 7 && hour <= 10 ? 0.8 : hour >= 17 && hour <= 21 ? 0.9 : hour >= 23 || hour <= 5 ? 0.55 : 0.4
  const population = Math.min(1, affected / 40)
  const components = [
    { key: 'inherent', raw: s.inherent, weight: 0.34 },
    { key: 'contextual', raw: zoneSensitivity, weight: 0.2 },
    { key: 'temporal', raw: temporal, weight: 0.12 },
    { key: 'population', raw: population, weight: 0.14 },
    { key: 'escalation', raw: escalation, weight: 0.12 },
    { key: 'infrastructure', raw: infraRisk, weight: 0.08 },
  ]
  const score = components.reduce((sum, c) => sum + c.raw * c.weight, 0)
  return { score: Math.min(0.99, Math.round(score * 1000) / 1000), components }
}

const SOURCE_MIX: Record<string, readonly (readonly [SourceType, number])[]> = {
  traffic: [['cctv-fixed', 60], ['cctv-ptz', 15], ['patrol-car', 15], ['phone', 10]],
  safety: [['cctv-fixed', 45], ['bodycam', 20], ['patrol-car', 20], ['drone', 5], ['phone', 10]],
  waste: [['cctv-fixed', 40], ['patrol-car', 25], ['sensor', 25], ['phone', 10]],
  nuisance: [['sensor', 45], ['cctv-fixed', 35], ['usb-cam', 20]],
  infrastructure: [['patrol-car', 45], ['phone', 30], ['cctv-fixed', 25]],
  environment: [['sensor', 55], ['cctv-fixed', 30], ['patrol-car', 15]],
  vehicle: [['cctv-fixed', 50], ['patrol-car', 30], ['vehicle-bus', 20]],
  disaster: [['sensor', 40], ['cctv-fixed', 30], ['drone', 10], ['vehicle-bus', 20]],
}

function statusFor(rnd: () => number, ageMs: number, priority: PriorityBand): IncidentStatus {
  const min = ageMs / 60_000
  if (min < 0.5) return 'detected'
  if (min < 1.5) return chance(rnd, 0.6) ? 'corroborated' : 'detected'
  if (min < 4) return chance(rnd, 0.7) ? 'understood' : 'corroborated'
  if (min < 12) return chance(rnd, 0.75) ? 'dispatched' : 'understood'
  if (min < 45) return chance(rnd, 0.7) ? 'acknowledged' : 'dispatched'
  if (priority === 'INFO' || priority === 'LOW') {
    return chance(rnd, 0.55) ? 'resolved' : 'acknowledged'
  }
  if (min < 240) return chance(rnd, 0.6) ? 'resolved' : 'acknowledged'
  return chance(rnd, 0.72) ? 'verified' : 'resolved'
}

interface Args {
  seed: number
  now: number
  count: number
  lines: Position[][]
}

/**
 * Incident times are a thinned non-homogeneous Poisson process over the last
 * seven days, so the feed has the commute peaks and the small-hours lull a real
 * city has. Positions land on corridors most of the time and around hotspot
 * centroids the rest, which is what stops the map looking like uniform noise.
 */
export function buildIncidents({ seed, now, count, lines }: Args): IncidentSummary[] {
  const rings = zoneRings(seed)
  const windowMs = 7 * 86400_000
  const out: IncidentSummary[] = []

  for (let i = 0; i < count; i++) {
    const rnd = mulberry32(subSeed(seed, 'incident', i))

    /* Rejection-sample a time under the diurnal intensity curve. */
    let t = now - windowMs * rnd()
    for (let tries = 0; tries < 12; tries++) {
      const cand = now - windowMs * rnd()
      if (rnd() < diurnal(istHour(cand)) / 2.1) {
        t = cand
        break
      }
    }
    /* Bias a slice of the set into the last twenty minutes so the live feed is populated. */
    if (i % 11 === 0) t = now - range(rnd, 0, 20 * 60_000)

    const situation = pick(rnd, SITUATIONS)
    let lon: number
    let lat: number
    if (chance(rnd, 0.7)) {
      const line = lines[Math.floor(rnd() * lines.length)]!
      const p = sampleAlong(line, rnd())
      lon = p[0] + gauss(rnd, 0, 0.0004)
      lat = p[1] + gauss(rnd, 0, 0.0004)
    } else {
      const h = weighted(
        rnd,
        HOTSPOTS.map((hs) => [hs, hs[2]] as const),
      )
      lon = h[0] + gauss(rnd, 0, 0.006)
      lat = h[1] + gauss(rnd, 0, 0.006)
    }

    const zone = zoneAt(rings, lon, lat)
    const hour = istHour(t)
    /* Life-safety situations draw larger affected populations and higher
       escalation potential, which is what lets a fire or a collapse actually
       reach the CRITICAL band while a spitting observation cannot. */
    const affected = Math.max(
      1,
      Math.round(situation.life_safety ? gauss(rnd, 34, 18) : gauss(rnd, 7, 6)),
    )
    const escalation = situation.life_safety ? range(rnd, 0.45, 0.98) : range(rnd, 0.05, 0.55)
    const infraRisk = situation.life_safety ? range(rnd, 0.25, 0.9) : range(rnd, 0.03, 0.7)
    const { score } = severityOf(situation, zone.sensitivity, hour, affected, escalation, infraRisk)
    const priority = bandForScore(score)
    const spread = range(rnd, 0.03, 0.09)

    const mix = SOURCE_MIX[situation.domain] ?? SOURCE_MIX.traffic!
    const sourceCount = intRange(rnd, 1, situation.life_safety ? 5 : 4)
    const types = new Set<SourceType>()
    for (let k = 0; k < sourceCount; k++) types.add(weighted(rnd, mix))

    const status = statusFor(rnd, now - t, priority)
    const routed = status !== 'detected' && status !== 'corroborated'
    const slaSeconds = SLA_SECONDS[priority]
    const dispatchedAt = routed ? t + intRange(rnd, 8, 180) * 1000 : null
    const acknowledged = ['acknowledged', 'resolved', 'verified'].includes(status)

    out.push({
      incident_id: ulid(rnd, t),
      title: `${situation.title}, ${zone.label}`,
      domain: situation.domain,
      status,
      priority,
      css: {
        value: score,
        lo: Math.max(0, Math.round((score - spread) * 1000) / 1000),
        hi: Math.min(1, Math.round((score + spread) * 1000) / 1000),
      },
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 },
      h3: latLngToCell(lat, lon, 9),
      detected_at: Math.round(t),
      updated_at: Math.round(t + intRange(rnd, 5, 900) * 1000),
      source_count: types.size,
      source_types: [...types],
      sync_quality: weighted(rnd, [
        ['A', 40],
        ['B', 38],
        ['C', 17],
        ['D', 5],
      ]),
      corroboration: Math.round(Math.min(1, types.size / 4 + range(rnd, -0.1, 0.25)) * 100) / 100,
      acknowledged,
      department: routed ? situation.department : null,
      sla_due_at: dispatchedAt === null ? null : dispatchedAt + slaSeconds * 1000,
      dismissed_reason: null,
    })
  }

  out.sort((a, b) => b.detected_at - a.detected_at)
  return out
}

/** The situation type behind an incident, recovered from its title. */
export function situationOf(incident: IncidentSummary): SituationType {
  const head = incident.title.split(', ')[0]
  return SITUATIONS.find((s) => s.title === head) ?? SITUATIONS[0]!
}
