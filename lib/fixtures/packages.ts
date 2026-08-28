import 'server-only'
import type {
  ContextAssessment,
  Domain,
  EvidenceBoardTile,
  IncidentSummary,
  IntelligencePackage,
  ModelTraceRow,
  SourceDevice,
  SourceType,
} from '@/lib/api/schemas'
import type { SEVERITY_COMPONENTS } from '@/lib/api/schemas/incident'
import { DEPARTMENTS } from './catalog'
import { chainFor, factorsFor } from './causal'

const DEPT_LABEL = new Map<string, string>(DEPARTMENTS.map((d) => [d.department, d.label]))
import { istHour, severityOf, situationOf, SLA_SECONDS } from './incidents'
import { chance, hex, intRange, mulberry32, pick, range, subSeed, ulid } from './rng'
import { ZONE_SEEDS } from '@/lib/geo/bengaluru'

/**
 * Builds the full intelligence package for one incident, deterministically from
 * the incident id. Nothing is stored: the package is a pure function of the
 * world seed and the incident, so a reload reproduces it exactly and a bug
 * report can name an id.
 */

const SEVERITY_LABELS: Record<(typeof SEVERITY_COMPONENTS)[number], string> = {
  inherent: 'inherent severity',
  contextual: 'contextual amplifiers',
  temporal: 'temporal urgency',
  population: 'affected population',
  escalation: 'escalation potential',
  infrastructure: 'infrastructure risk',
}

const MODELS = {
  scene: 'qwen/qwen3.8-27b',
  sceneFallback: 'qwen/qwen3.6-27b',
  context: 'openai/gpt-oss-120b',
  fast: 'openai/gpt-oss-20b',
  guard: 'openai/gpt-oss-safeguard-20b',
} as const

const HAZARD_DESCRIPTORS: Partial<Record<Domain, readonly string[]>> = {
  disaster: [
    'flame front along the roadside waste pile, smoke drifting across the carriageway',
    'standing water across both lanes, kerb line submerged against the reference post',
    'tree leaning over the footpath with the root plate lifted',
  ],
  environment: [
    'smoke column from a burning pile beside the compound wall',
    'uncovered material on an open tipper, spillage visible on the carriageway',
  ],
  infrastructure: [
    'open manhole with no barricade, cover displaced onto the footpath',
    'cable hanging below head height across the pedestrian route',
    'pothole cluster in the nearside wheel track',
  ],
  nuisance: [
    'loudspeaker array facing the residential frontage',
    'hoarding frame fixed to the footpath railing without a permit plate',
  ],
}

const ACTOR_DESCRIPTORS: Record<string, readonly string[]> = {
  vehicle: [
    'white light commercial vehicle, tarpaulin over the load bed',
    'dark hatchback, damaged left rear quarter',
    'yellow-plate autorickshaw with a roof rack',
    'two-wheeler with a pillion, no headgear on either occupant',
    'articulated goods vehicle occupying two lanes',
  ],
  person: [
    'adult in a dark full-sleeve shirt, carrying a sack',
    'adult in high-visibility vest, standing in the carriageway',
    'group of four moving against the pedestrian flow',
    'adult seated on the kerb adjacent to the bin cluster',
  ],
  animal: ['three cattle grazing on the median', 'stray dog pack near the footpath edge'],
  object: [
    'construction debris pile against the compound wall',
    'bagged waste placed beside the bin, not inside it',
    'unsecured hoarding frame leaning over the footpath',
  ],
}

const NEXT_STEPS = [
  'without intervention this pattern continues through the peak and the queue spills into the junction',
  'the accumulation at this spot will reach the carriageway edge before the next scheduled collection',
  'the exposure window closes when dispersal ends, roughly forty minutes from now',
  'repeat observations at this location have preceded a reported collision twice in the last ninety days',
]

function thumbFor(kind: SourceType, n: number): string {
  const family =
    kind === 'bodycam' ? 'bodycam' : kind === 'patrol-car' || kind === 'patrol-bike' ? 'patrol' : kind === 'sensor' ? 'sensor' : 'cam'
  return `/media/frames/${family}-${(n % 6) + 1}.jpg`
}

export function buildPackage(
  seed: number,
  incident: IncidentSummary,
  sources: SourceDevice[],
): IntelligencePackage {
  const situation = situationOf(incident)
  const idSeed = subSeed(seed, 'package', hashString(incident.incident_id))
  const rnd = mulberry32(idSeed)
  const zone = ZONE_SEEDS.find((z) => z.id === incident.zone_id) ?? ZONE_SEEDS[0]!

  /* Pick the sources that plausibly saw this: nearest devices of the right types. */
  const nearby = sources
    .filter((s) => incident.source_types.includes(s.source_type))
    .map((s) => ({ s, d: Math.hypot(s.position.lon - incident.position.lon, s.position.lat - incident.position.lat) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(1, incident.source_count))
    .map((x) => x.s)

  const contributing = sources.length > 0 && nearby.length > 0 ? nearby : sources.slice(0, 1)

  const observationIds = contributing.flatMap((s, i) =>
    Array.from({ length: intRange(rnd, 1, 3) }, (_, k) => `OBS-${s.source_id}-${ulid(rnd, incident.detected_at + i * 1000 + k).slice(-8)}`),
  )

  const board: EvidenceBoardTile[] = contributing.slice(0, 3).map((s, i) => ({
    observation_id: observationIds[i] ?? observationIds[0]!,
    source_id: s.source_id,
    source_type: s.source_type,
    label: s.label,
    t: incident.detected_at + i * intRange(rnd, 500, 4000),
    thumb_url: thumbFor(s.source_type, i + hashString(incident.incident_id)),
    full_url: thumbFor(s.source_type, i + hashString(incident.incident_id)),
    kind: i === 0 ? 'storyboard' : 'keyframe',
    annotations: Array.from({ length: intRange(rnd, 1, 3) }, (_, k) => ({
      x: Math.round(range(rnd, 0.08, 0.6) * 1000) / 1000,
      y: Math.round(range(rnd, 0.15, 0.62) * 1000) / 1000,
      w: Math.round(range(rnd, 0.08, 0.28) * 1000) / 1000,
      h: Math.round(range(rnd, 0.1, 0.3) * 1000) / 1000,
      label: situation.classes[k % situation.classes.length]!,
      track_id: `T${intRange(rnd, 100, 999)}`,
    })),
  }))

  const actorKind = situation.classes.includes('person')
    ? 'person'
    : situation.classes.includes('cattle')
      ? 'animal'
      : situation.classes.some((c) => ['car', 'lcv', 'motorcycle', 'bus', 'truck', 'ambulance'].includes(c))
        ? 'vehicle'
        : 'object'

  const actors = Array.from({ length: intRange(rnd, 1, 3) }, (_, i) => ({
    ref: `E-${hex(rnd, 6)}`,
    kind: (i === 0 ? actorKind : pick(rnd, ['vehicle', 'person', 'object'] as const)) as
      | 'vehicle'
      | 'person'
      | 'animal'
      | 'object',
    descriptor:
      i === 0 && HAZARD_DESCRIPTORS[incident.domain]
        ? pick(rnd, HAZARD_DESCRIPTORS[incident.domain]!)
        : pick(rnd, ACTOR_DESCRIPTORS[i === 0 ? actorKind : 'vehicle'] ?? ACTOR_DESCRIPTORS.vehicle!),
    evidence_ids: [observationIds[i % observationIds.length]!],
  }))

  const hour = istHour(incident.detected_at)
  const hourLabel = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`

  const scene = {
    summary: `${situation.title} observed at ${hourLabel} on ${zone.label}, corroborated by ${contributing.length} source${contributing.length === 1 ? '' : 's'}. ${actors[0]?.descriptor ?? ''}.`,
    actors,
    violation_assessment:
      situation.legal.length > 0
        ? {
            text: `the observed behaviour matches ${situation.title} as defined for enforcement purposes, and the frames support it across ${Math.min(2, contributing.length)} views`,
            evidence_ids: observationIds.slice(0, 2),
            confidence: Math.round(range(rnd, 0.62, 0.94) * 100) / 100,
          }
        : null,
    hazards: [
      {
        text: `${situation.title} at this location places ${intRange(rnd, 2, 40)} people in the exposure area during this window`,
        evidence_ids: [observationIds[0]!],
        confidence: Math.round(range(rnd, 0.5, 0.88) * 100) / 100,
      },
    ],
    intent_hypotheses: chance(rnd, 0.55)
      ? [
          {
            text: pick(rnd, [
              'the vehicle appears to have stopped deliberately rather than broken down, based on the departure trajectory',
              'the movement pattern is consistent with avoiding the enforcement point upstream',
              'the placement is consistent with routine disposal rather than a single event',
            ]),
            evidence_ids: observationIds.slice(0, 2),
            confidence: Math.round(range(rnd, 0.35, 0.66) * 100) / 100,
          },
        ]
      : [],
    trigger_agreement: chance(rnd, 0.86),
    model: chance(rnd, 0.88) ? MODELS.scene : MODELS.sceneFallback,
  }

  const factorPool = [...factorsFor(situation.key)]
  const contributingFactors = Array.from({ length: intRange(rnd, 1, 3) }, () => {
    const index = Math.floor(rnd() * factorPool.length)
    const [text] = factorPool.splice(index, 1)
    return {
      text: text ?? factorsFor(situation.key)[0]!,
      evidence_ids: [pick(rnd, observationIds)],
      confidence: Math.round(range(rnd, 0.55, 0.92) * 100) / 100,
    }
  })

  const disposition: ContextAssessment['disposition'] =
    situation.life_safety
      ? 'enforcement'
      : incident.priority === 'INFO' || incident.priority === 'LOW'
        ? 'educational'
        : pick(rnd, ['enforcement', 'operations', 'infrastructure', 'monitor'] as const)

  const context = {
    normalcy: Math.round(range(rnd, 0.08, 0.72) * 100) / 100,
    contributing_factors: contributingFactors,
    causal_chain: chainFor(situation.key, incident.domain).map((step) => step.label),
    what_happens_next: {
      text: pick(rnd, NEXT_STEPS),
      evidence_ids: [observationIds[0]!],
      confidence: Math.round(range(rnd, 0.44, 0.79) * 100) / 100,
    },
    permitted_activity: chance(rnd, 0.08),
    disposition,
    needs_human_review: chance(rnd, incident.priority === 'CRITICAL' ? 0.35 : 0.12),
    amplifiers: {
      repeat_location: Math.round(range(rnd, 0, 1) * 100) / 100,
      vulnerable_population: Math.round(range(rnd, 0, 1) * 100) / 100,
      time_of_day: Math.round(range(rnd, 0, 1) * 100) / 100,
      infrastructure_state: Math.round(range(rnd, 0, 1) * 100) / 100,
    },
    model: MODELS.context,
  }

  const affected = intRange(rnd, 1, 60)
  const { components } = severityOf(
    situation,
    zone.sensitivity,
    hour,
    affected,
    context.amplifiers.infrastructure_state,
    context.amplifiers.repeat_location,
  )

  const severity = {
    score: incident.css.value,
    band: incident.priority,
    zone_profile: `${zone.kind} weight profile`,
    components: components.map((c) => ({
      key: c.key as (typeof SEVERITY_COMPONENTS)[number],
      label: SEVERITY_LABELS[c.key as (typeof SEVERITY_COMPONENTS)[number]],
      raw: Math.round(c.raw * 1000) / 1000,
      weight: c.weight,
      contribution: Math.round(c.raw * c.weight * 1000) / 1000,
      note:
        c.key === 'population'
          ? `${affected} people in the exposure area`
          : c.key === 'contextual'
            ? `${zone.kind} zone, sensitivity ${zone.sensitivity}`
            : c.key === 'temporal'
              ? `${hourLabel} IST`
              : c.key === 'inherent'
                ? `${situation.title} base severity`
                : c.key === 'escalation'
                  ? 'bounded amplifier from the context pass'
                  : 'infrastructure state from the asset registry',
    })),
  }

  const legal = situation.legal.map((l) => ({
    statute: l.statute,
    section: l.section,
    title: l.title,
    confidence: Math.round(range(rnd, 0.6, 0.96) * 100) / 100,
    justification: `selected from the curated reference because the observed behaviour matches ${l.title.toLowerCase()} and the evidence supports it across ${Math.min(2, contributing.length)} views`,
    counsel_verified: l.verified,
    source_reference: `legal_reference.yaml#${l.statute.replace(/\s+/g, '-').toLowerCase()}/${l.section}`,
  }))

  const routed = incident.department !== null
  const dispatchedAt = routed ? incident.detected_at + intRange(rnd, 8, 180) * 1000 : null
  const routing = routed
    ? {
        department: incident.department!,
        department_label: DEPT_LABEL.get(incident.department!) ?? incident.department!,
        action_line: pick(rnd, [
          'place an enforcement point on this corridor for the evening peak',
          'clear the accumulation and reinstate the missed stop on the route',
          'raise an infrastructure ticket with the measured quantities attached',
          'verify on site and confirm with a resolution photo',
        ]),
        sla_seconds: SLA_SECONDS[incident.priority],
        dispatched_at: dispatchedAt,
        sla_due_at: incident.sla_due_at,
        acknowledged_at: incident.acknowledged ? (dispatchedAt ?? incident.detected_at) + intRange(rnd, 20, 900) * 1000 : null,
        channels: (['whatsapp', 'sms', 'push'] as const).slice(0, intRange(rnd, 1, 3)).map((channel) => ({
          channel,
          target: `${DEPT_LABEL.get(incident.department!) ?? ''} control room`,
          sent_at: dispatchedAt,
          delivered_at: dispatchedAt === null ? null : dispatchedAt + intRange(rnd, 500, 6000),
          acknowledged_at: incident.acknowledged && dispatchedAt !== null ? dispatchedAt + intRange(rnd, 20, 900) * 1000 : null,
        })),
        escalation_level: incident.priority === 'CRITICAL' && !incident.acknowledged ? intRange(rnd, 0, 2) : 0,
      }
    : null

  const trace: ModelTraceRow[] = [
    {
      role: 'scene',
      model: scene.model,
      tier: incident.priority === 'CRITICAL' ? 'on_demand' : 'auto',
      tokens_in: intRange(rnd, 6200, 9400),
      tokens_out: intRange(rnd, 800, 1600),
      cost_usd: Math.round(range(rnd, 0.004, 0.008) * 10000) / 10000,
      latency_ms: intRange(rnd, 900, 3800),
      cached: chance(rnd, 0.55),
      fallback_from: scene.model === MODELS.sceneFallback ? MODELS.scene : null,
    },
    {
      role: 'context',
      model: MODELS.context,
      tier: incident.priority === 'CRITICAL' ? 'on_demand' : 'auto',
      tokens_in: intRange(rnd, 4200, 6400),
      tokens_out: intRange(rnd, 1000, 1900),
      cost_usd: Math.round(range(rnd, 0.002, 0.005) * 10000) / 10000,
      latency_ms: intRange(rnd, 700, 2600),
      cached: chance(rnd, 0.7),
      fallback_from: null,
    },
    {
      role: 'legal-routing',
      model: MODELS.fast,
      tier: 'auto',
      tokens_in: intRange(rnd, 1600, 2600),
      tokens_out: intRange(rnd, 300, 700),
      cost_usd: Math.round(range(rnd, 0.0003, 0.0009) * 10000) / 10000,
      latency_ms: intRange(rnd, 180, 700),
      cached: chance(rnd, 0.8),
      fallback_from: null,
    },
    {
      role: 'guard',
      model: MODELS.guard,
      tier: 'auto',
      tokens_in: intRange(rnd, 2400, 3600),
      tokens_out: intRange(rnd, 150, 400),
      cost_usd: Math.round(range(rnd, 0.0004, 0.001) * 10000) / 10000,
      latency_ms: intRange(rnd, 150, 600),
      cached: false,
      fallback_from: null,
    },
  ]

  const inconsistent = chance(rnd, 0.12) ? 1 : 0
  const quality = {
    coverage: Math.round(range(rnd, 0.42, 0.98) * 100) / 100,
    sync_grade: incident.sync_quality,
    calibration_uncertainty_m: Math.round(range(rnd, 0.1, 1.8) * 100) / 100,
    identity_confidence: Math.round(range(rnd, 0.3, 0.95) * 100) / 100,
    citation_validity: Math.round(range(rnd, 0.9, 1) * 1000) / 1000,
    authenticity: {
      verified: contributing.length,
      consistent: intRange(rnd, 0, 3),
      inconsistent,
      unverifiable: intRange(rnd, 0, 1),
    },
    admissibility: [
      { key: 'preservation', label: 'preservation of the original', state: 'met' as const, standard: 'ISO/IEC 27037', note: 'hash at capture, content-addressed vault, custody log complete' },
      { key: 'analysis', label: 'analysis and interpretation recorded', state: 'met' as const, standard: 'ISO/IEC 27042', note: 'uncertainty stated on every measurement' },
      {
        key: 'authentication',
        label: 'image authentication',
        state: inconsistent > 0 ? ('partial' as const) : ('met' as const),
        standard: 'ASTM E2825, SWGDE',
        note: inconsistent > 0 ? 'one item inconsistent, quarantined for human review' : 'continuity and metadata checks passed',
      },
      {
        key: 'certificate',
        label: 'Section 63 electronic-record certificate',
        state: chance(rnd, 0.4) ? ('met' as const) : ('unmet' as const),
        standard: 'Bharatiya Sakshya Adhiniyam 2023',
        note: 'generated on export, counsel format confirmation pending per state',
      },
      {
        key: 'investigation',
        label: 'investigation principles',
        state: 'met' as const,
        standard: 'ISO/IEC 27043',
        note: 'case workflow, hypothesis ledger and disclosure tracking in place',
      },
    ],
  }

  const guard = {
    verdict: (inconsistent > 0 ? 'redacted' : chance(rnd, 0.94) ? 'pass' : 'redacted') as 'pass' | 'redacted' | 'blocked',
    policy_version: 'safeguard_policy.md@2026-08-14',
    findings:
      inconsistent > 0
        ? [{ rule: 'evidence.quarantine', detail: 'an item with an inconsistent authenticity verdict was withheld from the automatic disposition' }]
        : [],
    redactions: inconsistent > 0 ? ['bystander faces in tile 2'] : [],
    model: MODELS.guard,
  }

  return {
    incident,
    board,
    scene,
    context,
    severity,
    legal,
    routing,
    guard,
    model_trace: trace,
    quality,
    observation_ids: observationIds,
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) % 100000
}
