import 'server-only'
import { all, get } from '@/lib/db'
import { listZones } from './zones'
import type { Domain, Intervention, Warning } from '@/lib/api/schemas'

/**
 * Where a warning spreads next, and what can be done about it.
 *
 * Both halves are derived from the record, not asserted. The cascade reads the
 * zone adjacency graph and measures, from history, how often an incident of this
 * domain in one zone has been followed by one in a neighbour and how long that
 * took. A neighbour with no such history gets no cascade entry, which is the
 * difference between a prediction and a diagram.
 *
 * Interventions are drawn from a fixed catalogue and ranked by what the record
 * supports. Expected effect comes from measured outcomes of the same
 * intervention kind where they exist, and falls back to a deliberately modest
 * figure where they do not, with the rationale saying which of the two it is.
 */

/* Lag is measured, so the window has to be long enough to contain a real one. */
const CASCADE_WINDOW_MS = 6 * 3600_000
const HISTORY_MS = 90 * 86400_000

export function cascadeFor(zoneId: string, domain: Domain): Warning['cascade'] {
  const zones = listZones()
  const origin = zones.find((z) => z.zone_id === zoneId)
  if (!origin || origin.adjacency.length === 0) return []

  const from = Date.now() - HISTORY_MS

  const originIncidents = all<{ detected_at: number }>(
    'SELECT detected_at FROM incidents WHERE zone_id = ? AND domain = ? AND detected_at >= ? ORDER BY detected_at ASC',
    [zoneId, domain, from],
  )
  if (originIncidents.length < 3) return []

  const out: Warning['cascade'] = []
  for (const neighbourId of origin.adjacency) {
    const neighbour = zones.find((z) => z.zone_id === neighbourId)
    if (!neighbour) continue

    const neighbourIncidents = all<{ detected_at: number }>(
      'SELECT detected_at FROM incidents WHERE zone_id = ? AND domain = ? AND detected_at >= ? ORDER BY detected_at ASC',
      [neighbourId, domain, from],
    )
    if (neighbourIncidents.length === 0) continue

    /* For each incident at the origin, did one follow in the neighbour inside
       the window, and how long after. */
    const lags: number[] = []
    for (const incident of originIncidents) {
      const follow = neighbourIncidents.find(
        (n) => n.detected_at > incident.detected_at && n.detected_at - incident.detected_at <= CASCADE_WINDOW_MS,
      )
      if (follow) lags.push(follow.detected_at - incident.detected_at)
    }
    if (lags.length === 0) continue

    /* Attenuation is how reliably it followed, not how bad it was. */
    const attenuation = Math.round((lags.length / originIncidents.length) * 100) / 100
    const medianLag = lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)]!

    out.push({
      zone_id: neighbourId,
      zone_label: neighbour.label,
      lag_min: Math.round(medianLag / 60_000),
      attenuation: Math.min(1, attenuation),
    })
  }

  return out.sort((a, b) => b.attenuation - a.attenuation).slice(0, 6)
}

interface Candidate {
  kind: Intervention['kind']
  label: string
  cost_tier: Intervention['cost_tier']
  department: string
  domains: Domain[]
  /* What has to be true of the situation for this to be worth proposing. */
  requires: 'sensor-trend' | 'repeat-pattern' | 'always'
  base: number
}

/**
 * The intervention catalogue.
 *
 * Deployment configuration, like the situation catalogue. Nothing here is
 * generated at runtime, because an intervention a department cannot actually
 * carry out is worse than no suggestion.
 */
const CATALOGUE: readonly Candidate[] = [
  { kind: 'patrol-tasking', label: 'task a patrol to the zone for the crossing window', cost_tier: 'low', department: 'traffic-police', domains: ['traffic', 'safety', 'vehicle'], requires: 'always', base: 0.22 },
  { kind: 'signal-timing', label: 'adjust signal timing on the approach', cost_tier: 'low', department: 'traffic-police', domains: ['traffic'], requires: 'repeat-pattern', base: 0.18 },
  { kind: 'bin-deployment', label: 'place additional collection capacity', cost_tier: 'medium', department: 'solid-waste', domains: ['waste'], requires: 'repeat-pattern', base: 0.31 },
  { kind: 'barrier-placement', label: 'place a physical barrier at the entry point', cost_tier: 'medium', department: 'bbmp-engineering', domains: ['traffic', 'safety', 'infrastructure'], requires: 'repeat-pattern', base: 0.35 },
  { kind: 'awareness-point', label: 'station an awareness point during the peak hour', cost_tier: 'low', department: 'bbmp-health', domains: ['waste', 'nuisance', 'environment'], requires: 'always', base: 0.12 },
  { kind: 'infrastructure-ticket', label: 'raise an infrastructure ticket for the underlying defect', cost_tier: 'high', department: 'bbmp-engineering', domains: ['infrastructure', 'environment', 'safety'], requires: 'always', base: 0.44 },
  { kind: 'pre-positioning', label: 'pre-position a response unit before the crossing time', cost_tier: 'medium', department: 'fire-emergency', domains: ['safety', 'disaster'], requires: 'sensor-trend', base: 0.26 },
]

export function interventionsFor(input: {
  zone_id: string
  zone_label: string
  domain: Domain
  driven_by_sensor: boolean
}): Intervention[] {
  const repeats =
    get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM incidents WHERE zone_id = ? AND domain = ? AND detected_at >= ?',
      [input.zone_id, input.domain, Date.now() - 30 * 86400_000],
    )?.n ?? 0

  const applicable = CATALOGUE.filter((candidate) => {
    if (!candidate.domains.includes(input.domain)) return false
    if (candidate.requires === 'sensor-trend' && !input.driven_by_sensor) return false
    if (candidate.requires === 'repeat-pattern' && repeats < 3) return false
    return true
  })

  return applicable.map((candidate) => {
    /* Where the same kind of intervention has been applied and measured, that
       measurement is the estimate. Otherwise the catalogue figure stands, and
       the rationale says so plainly. */
    /* delta_pct is the measured change in incident rate. Only significant
       results count: an inconclusive trial is not evidence of an effect. */
    const measured = get<{ n: number; avg: number | null }>(
      `SELECT COUNT(*) AS n, AVG(ABS(delta_pct)) / 100.0 AS avg FROM interventions_applied
       WHERE kind = ? AND significant = 1`,
      [candidate.kind],
    )
    const measuredAvg = measured?.avg ?? null
    const hasMeasurement = (measured?.n ?? 0) >= 2 && measuredAvg !== null
    const effect = hasMeasurement ? Math.min(1, Math.max(0, measuredAvg)) : candidate.base

    /* Feasibility is whether the department that owns it has headroom, which is
       a real constraint and not a score. */
    const load =
      get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM incidents WHERE department = ? AND status IN (?, ?)',
        [candidate.department, 'dispatched', 'acknowledged'],
      )?.n ?? 0
    const feasibility = Math.max(0.1, Math.min(1, 1 - load / 40))

    return {
      intervention_id: `IV-${candidate.kind}-${input.zone_id}`,
      kind: candidate.kind,
      label: candidate.label,
      rationale: hasMeasurement
        ? `${measured!.n} prior applications of this measure were followed by a ${(effect * 100).toFixed(0)} percent change in the incident rate. that is the estimate here.`
        : `no application of this measure has been measured in this deployment yet, so the figure is a planning estimate and not an observed effect. ${repeats} incidents of this kind in ${input.zone_label} in the last 30 days.`,
      expected_effect: Math.round(effect * 100) / 100,
      cost_tier: candidate.cost_tier,
      feasibility: Math.round(feasibility * 100) / 100,
      department: candidate.department,
      /* Anything the platform cannot dispatch is shown but not taskable. */
      taskable: candidate.cost_tier !== 'high',
    }
  }).sort((a, b) => b.expected_effect * b.feasibility - a.expected_effect * a.feasibility)
}
