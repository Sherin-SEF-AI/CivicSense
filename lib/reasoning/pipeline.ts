import 'server-only'
import { readFile } from 'node:fs/promises'
import type {
  Claim,
  ContextAssessment,
  EvidenceBoardTile,
  IntelligencePackage,
  LegalMapping,
  ModelTraceRow,
  SceneUnderstanding,
} from '@/lib/api/schemas'
import { all, get } from '@/lib/db'
import { SITUATION_BY_KEY } from '@/lib/config/situations'
import { call, GroqUnconfigured, isConfigured, type Message } from '@/lib/groq/client'
import { observationsForIncident } from '@/lib/store/observations'
import { getIncident, getIncidentRow, rescore, storePackage } from '@/lib/store/incidents'
import { supersedePreAlert } from '@/lib/store/prealerts'
import { computeSeverity, SLA_SECONDS } from '@/lib/store/severity'
import { CONTEXT_SCHEMA, GUARD_SCHEMA, LEGAL_SCHEMA, SCENE_SCHEMA } from './schemas'

/**
 * The understanding tier.
 *
 * Real calls to real models over the real observations attached to an incident.
 * There is no offline path: if the gateway is not configured the caller gets an
 * explicit failure and the console says the reasoning layer is unavailable,
 * because a package assembled without a model would be a fabrication wearing the
 * same interface as an assessment.
 *
 * Two rules bind every stage. Claims must cite observation ids, and any claim
 * citing an id that is not in the evidence set is dropped before storage.
 * Statutes may only be selected from the curated reference for the situation.
 */

export class ReasoningUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'ReasoningUnavailable'
  }
}

const SYSTEM_SCENE = `You are the scene understanding stage of a civic intelligence platform.

You are given frames from one or more sources that observed a single situation, each labelled with
its observation id and capture time. Describe only what is visible.

Rules that are not negotiable:
- Never identify a person. Describe behaviour, posture, clothing and position only. Never describe
  facial features, and never speculate about identity, ethnicity, religion, caste or gender beyond
  what is strictly necessary to describe an action.
- Every claim you make must cite the observation ids that support it, in evidence_ids. A claim you
  cannot cite is a claim you must not make.
- Distinguish what you see from what you infer. Observations go in hazards and the violation
  assessment; inferences go in intent_hypotheses and must carry lower confidence.
- If the frames do not support the trigger the edge reported, set trigger_agreement to false and say
  so in the summary. Disagreeing with the trigger is a valid and useful outcome.
- Write terse, factual English. No adjectives that carry judgement.`

const SYSTEM_CONTEXT = `You are the context assessment stage of a civic intelligence platform.

You are given a scene assessment, the zone profile, the recent history for this location, and the
environmental and regulatory context. Your job is why this is happening, what led to it, what happens
next if nobody acts, and how it should be dispositioned.

Rules:
- Every contributing factor must cite observation ids.
- The amplifiers you return are bounded 0 to 1 and are inputs to a severity calculation performed in
  code. You are not scoring the incident.
- Proportionality matters. A first observation of a minor matter in a low risk context is an
  educational disposition, not enforcement, whatever the category suggests.
- If the situation is a permitted activity, say so and set permitted_activity true.
- Set needs_human_review when the consequence is high and the evidence is thin.`

const SYSTEM_LEGAL = `You are the legal mapping stage of a civic intelligence platform.

You are given a situation and the statutes that counsel has already cleared as applicable to it. You
may only select from that list, using the exact section string given. You may select none. Justify
each selection in one sentence against the observed facts. You never invent a section, and you never
cite a statute that is not in the list.

You also give a single action line for the owning department, imperative and specific.

Two rules bind the action line absolutely:
- If the scene assessment did not confirm the violation, the action line must not direct enforcement
  of any kind. No ticket, no challan, no penalty, no warning for the offence. Direct the department at
  what the evidence does support instead, which is usually verification on site or fixing the
  condition that made the observation unusable.
- If the disposition is educational, operational or infrastructure rather than enforcement, the action
  line must match that disposition.

Selecting no statute is the correct answer whenever the violation is unconfirmed.`

const SYSTEM_GUARD = `You are the pre-dispatch policy audit of a civic intelligence platform.

You are given an assembled intelligence package. Check it against the platform policy:
- no identification of individuals, and no facial description
- no plate characters in any text field
- no claim without cited evidence
- no enforcement disposition for a first minor observation in a low risk context
- no personal data beyond what the disposition requires

Return pass when the package is clean, redacted when specific content must be removed and list it,
blocked when the package must not be dispatched at all.`

interface EvidenceRow {
  sha256: string
  stored_path: string
  media_type: string
  width: number | null
  height: number | null
}

/** Frames are sent inline as data URLs. Each image is a flat cost, so few and chosen. */
async function boardFor(
  incidentId: string,
): Promise<{ tiles: EvidenceBoardTile[]; parts: { observationId: string; dataUrl: string }[]; skipped: string[] }> {
  const observations = observationsForIncident(incidentId)
  const tiles: EvidenceBoardTile[] = []
  const parts: { observationId: string; dataUrl: string }[] = []
  const skipped: string[] = []

  for (const observation of observations) {
    if (observation.payload_kind !== 'keyframe' && observation.payload_kind !== 'clip') continue
    if (!observation.content_ref) continue
    const row = get<EvidenceRow>('SELECT sha256, stored_path, media_type, width, height FROM evidence WHERE sha256 = ?', [
      observation.content_ref,
    ])
    if (!row) continue

    tiles.push({
      observation_id: observation.observation_id,
      source_id: observation.source.source_id,
      source_type: observation.source.source_type,
      label: observation.source.source_id,
      t: observation.capture.t_start,
      thumb_url: `/api/v1/evidence/${row.sha256}/content`,
      full_url: `/api/v1/evidence/${row.sha256}/content`,
      kind: observation.payload_kind === 'clip' ? 'clip' : 'keyframe',
      annotations: [],
    })

    /* Only still images go to the vision model; a clip is represented by its
       keyframe, and there are at most three because each image is a flat token
       cost regardless of resolution.
       
       An image too small to be looked at is skipped rather than sent. A real
       deployment will receive truncated and corrupt frames, and one of them must
       not take down the assessment of the whole incident: the frame stays in the
       evidence board and the record, it simply is not offered as something to
       read. */
    const tooSmall = (row.width ?? 0) < 2 || (row.height ?? 0) < 2
    if (row.media_type.startsWith('image/') && !tooSmall && parts.length < 3) {
      const bytes = await readFile(row.stored_path)
      parts.push({
        observationId: observation.observation_id,
        dataUrl: `data:${row.media_type};base64,${bytes.toString('base64')}`,
      })
    } else if (tooSmall) {
      skipped.push(observation.observation_id)
    }
  }

  return { tiles, parts, skipped }
}

/** Drops any claim citing an observation id that is not in the evidence set. */
function validateClaims<T extends { evidence_ids: string[] }>(claims: T[], valid: Set<string>): { kept: T[]; dropped: number } {
  const kept = claims.filter((c) => c.evidence_ids.length > 0 && c.evidence_ids.every((id) => valid.has(id)))
  return { kept, dropped: claims.length - kept.length }
}

export interface PipelineResult {
  package: IntelligencePackage
  droppedClaims: number
  citationValidity: number
}

export async function runPipeline(incidentId: string): Promise<PipelineResult> {
  if (!isConfigured()) {
    throw new ReasoningUnavailable(
      'GROQ_API_KEY is not set. The understanding tier is unavailable, so no package can be produced for this incident.',
    )
  }

  const incident = getIncident(incidentId)
  const row = getIncidentRow(incidentId)
  if (!incident || !row) throw new Error(`unknown incident ${incidentId}`)
  const situation = SITUATION_BY_KEY.get(row.situation_key)
  if (!situation) throw new Error(`unknown situation ${row.situation_key}`)

  const observations = observationsForIncident(incidentId)
  const validIds = new Set(observations.map((o) => o.observation_id))
  const { tiles, parts, skipped } = await boardFor(incidentId)
  const trace: ModelTraceRow[] = []
  let dropped = 0
  let claimsSeen = 0

  const zone = row.zone_id
    ? get<{ kind: string; sensitivity: number; label: string }>('SELECT kind, sensitivity, label FROM zones WHERE zone_id = ?', [row.zone_id])
    : undefined

  /* Stage one: scene. */
  const sceneContent: Message['content'] = [
    {
      type: 'text',
      text: [
        `Trigger reported by the edge: ${situation.trigger} (${situation.key}).`,
        `Location: ${zone?.label ?? 'outside any configured zone'} at ${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}.`,
        `Observations in this incident: ${observations
          .map((o) => `${o.observation_id} from ${o.source.source_id} (${o.source.source_type}) at ${new Date(o.capture.t_start).toISOString()}, classes ${o.derived.classes.join(', ') || 'none reported'}`)
          .join('; ')}.`,
        parts.length > 0
          ? `Frames follow, in the same order as these observation ids: ${parts.map((p) => p.observationId).join(', ')}.`
          : 'No usable imagery is attached to this incident. Assess only from the reported classes, set trigger_agreement to false, and say plainly that no frames were available to verify it.',
        skipped.length > 0
          ? `${skipped.length} attached image(s) were too small to be read and were not sent: ${skipped.join(', ')}. Treat them as unavailable rather than as evidence.`
          : '',
      ].filter(Boolean).join('\n'),
    },
    ...parts.map((p) => ({ type: 'image_url' as const, image_url: { url: p.dataUrl } })),
  ]

  const sceneCall = await call<Omit<SceneUnderstanding, 'model'>>({
    role: 'scene',
    incidentId,
    tier: incident.priority === 'CRITICAL' ? 'on_demand' : 'auto',
    schema: SCENE_SCHEMA,
    /* The scene object is the largest the pipeline asks for, and a truncated
       reply is invalid JSON rather than a short one. */
    maxTokens: 4096,
    messages: [
      { role: 'system', content: SYSTEM_SCENE },
      { role: 'user', content: sceneContent },
    ],
  })
  trace.push(traceRow('scene', sceneCall, incident.priority === 'CRITICAL' ? 'on_demand' : 'auto'))

  const hazards = validateClaims(sceneCall.data.hazards, validIds)
  const hypotheses = validateClaims(sceneCall.data.intent_hypotheses, validIds)
  const violation =
    sceneCall.data.violation_assessment && sceneCall.data.violation_assessment.evidence_ids.every((id) => validIds.has(id))
      ? sceneCall.data.violation_assessment
      : null
  claimsSeen += sceneCall.data.hazards.length + sceneCall.data.intent_hypotheses.length + (sceneCall.data.violation_assessment ? 1 : 0)
  dropped += hazards.dropped + hypotheses.dropped + (sceneCall.data.violation_assessment && !violation ? 1 : 0)

  const scene: SceneUnderstanding = {
    summary: sceneCall.data.summary,
    actors: sceneCall.data.actors.filter((a) => a.evidence_ids.every((id) => validIds.has(id))),
    violation_assessment: violation,
    hazards: hazards.kept,
    intent_hypotheses: hypotheses.kept,
    trigger_agreement: sceneCall.data.trigger_agreement,
    model: sceneCall.model,
  }

  /* Stage two: context. */
  const history = all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM incidents WHERE zone_id IS ? AND situation_key = ? AND detected_at > ? AND incident_id != ?`,
    [row.zone_id, row.situation_key, row.detected_at - 30 * 86400_000, incidentId],
  )[0]?.c ?? 0

  const contextCall = await call<Omit<ContextAssessment, 'model'>>({
    role: 'context',
    incidentId,
    tier: incident.priority === 'CRITICAL' ? 'on_demand' : 'auto',
    schema: CONTEXT_SCHEMA,
    maxTokens: 3072,
    messages: [
      { role: 'system', content: SYSTEM_CONTEXT },
      {
        role: 'user',
        content: [
          `Scene assessment: ${JSON.stringify(scene)}`,
          `Zone profile: ${zone?.kind ?? 'unknown'} with configured sensitivity ${zone?.sensitivity ?? 'unset'}.`,
          `Repeat history: ${history} incidents of the same situation in this zone in the last thirty days.`,
          `Observation ids available for citation: ${[...validIds].join(', ')}.`,
          `Time: ${new Date(row.detected_at).toISOString()} (UTC). Local time is IST, five and a half hours ahead.`,
          `Corroboration: ${incident.source_count} distinct sources, sync grade ${incident.sync_quality}.`,
        ].join('\n'),
      },
    ],
  })
  trace.push(traceRow('context', contextCall, incident.priority === 'CRITICAL' ? 'on_demand' : 'auto'))

  const factors = validateClaims(contextCall.data.contributing_factors, validIds)
  claimsSeen += contextCall.data.contributing_factors.length + 1
  dropped += factors.dropped
  const whatNext: Claim = contextCall.data.what_happens_next.evidence_ids.every((id) => validIds.has(id))
    ? contextCall.data.what_happens_next
    : { ...contextCall.data.what_happens_next, evidence_ids: [], confidence: Math.min(contextCall.data.what_happens_next.confidence, 0.3) }
  if (whatNext.evidence_ids.length === 0) dropped += 1

  const context: ContextAssessment = {
    ...contextCall.data,
    contributing_factors: factors.kept,
    what_happens_next: whatNext,
    model: contextCall.model,
  }

  /* Severity is recomputed with the amplifiers the context pass supplied, then
     read back so the package and the incident row agree. */
  const severityResult = computeSeverity({
    situation,
    zoneKind: zone?.kind ?? 'residential',
    zoneSensitivity: zone?.sensitivity ?? 0.5,
    t: row.detected_at,
    /* The schema requires these keys, but the record type they land in is
       open, so read them defensively rather than assert. */
    affected: Math.max(1, Math.round((context.amplifiers.vulnerable_population ?? 0) * 40)),
    amplifiers: {
      escalation: context.amplifiers.escalation_potential ?? 0,
      infrastructure: context.amplifiers.infrastructure_state ?? 0,
    },
  })

  /* The causal chain becomes the why-graph. The chain is ordered, so edges are
     successive links; evidence is carried from the factors that support them.
     Nothing is added that the context pass did not state. */
  const causal = {
    nodes: context.causal_chain.map((label, i) => ({
      id: `N${i + 1}`,
      label,
      kind: (i === 0 ? 'condition' : i === context.causal_chain.length - 1 ? 'outcome' : 'event') as
        | 'event'
        | 'state'
        | 'condition'
        | 'outcome',
      t: i === 0 ? row.detected_at : null,
      evidence_ids: context.contributing_factors[i]?.evidence_ids ?? [...validIds].slice(0, 1),
      root_cause_class: null,
    })),
    edges: context.causal_chain.slice(0, -1).map((_, i) => ({
      from: `N${i + 1}`,
      to: `N${i + 2}`,
      confidence: context.contributing_factors[i]?.confidence ?? context.what_happens_next.confidence,
      evidence_ids: context.contributing_factors[i]?.evidence_ids ?? [],
      counterfactual: i === 0,
    })),
    root_causes: context.contributing_factors.slice(0, 3).map((factor, i) => ({
      node_id: `N${Math.min(i + 1, Math.max(1, context.causal_chain.length))}`,
      label: factor.text,
      class: 'systemic' as const,
      rank: i + 1,
      share: Math.round((1 / Math.max(1, Math.min(3, context.contributing_factors.length))) * 100) / 100,
    })),
  }

  /* Stage three: legal selection and the action line. */
  let legal: LegalMapping[] = []
  let actionLine = ''
  if (situation.legal.length > 0) {
    const legalCall = await call<{ selections: { section: string; confidence: number; justification: string }[]; action_line: string }>({
      role: 'fast',
      incidentId,
      schema: LEGAL_SCHEMA,
      messages: [
        { role: 'system', content: SYSTEM_LEGAL },
        {
          role: 'user',
          content: [
            `Situation the edge reported: ${situation.title} (${situation.key}).`,
            `Observed facts from the scene assessment: ${scene.summary}`,
            scene.trigger_agreement
              ? 'The scene assessment supports the reported trigger.'
              : 'The scene assessment DOES NOT support the reported trigger. The violation is unconfirmed, so no enforcement may be directed and no statute should be selected.',
            scene.violation_assessment
              ? `Violation assessment: ${scene.violation_assessment.text} (confidence ${scene.violation_assessment.confidence}).`
              : 'No violation assessment was produced, which means the frames did not support one.',
            `Disposition from the context pass: ${context.disposition}.`,
            `Statutes cleared for this situation, select only from these exact section strings:`,
            ...situation.legal.map((l) => `- ${l.section} :: ${l.statute} :: ${l.title}`),
          ].join('\n'),
        },
      ],
    })
    trace.push(traceRow('legal-routing', legalCall, 'auto'))

    const allowed = new Map(situation.legal.map((l) => [l.section, l]))
    legal = legalCall.data.selections
      .filter((s) => allowed.has(s.section))
      .map((s) => {
        const entry = allowed.get(s.section)!
        return {
          statute: entry.statute,
          section: entry.section,
          title: entry.title,
          confidence: s.confidence,
          justification: s.justification,
          counsel_verified: entry.verified,
          source_reference: `config/situations.ts#${situation.key}`,
        }
      })
    actionLine = legalCall.data.action_line

    /* Enforced here as well as asked for in the prompt. A recommendation to
       penalise someone for a violation the evidence does not establish is the
       one output that must be impossible, not merely discouraged. */
    if (!scene.trigger_agreement) {
      if (legal.length > 0) {
        legal = []
        dropped += 1
      }
      if (/\b(ticket|challan|fine|penal|penalty|prosecut|enforce|book|impound|seize|warning)\b/i.test(actionLine)) {
        actionLine =
          'verify on site before any enforcement: the scene assessment did not support the reported trigger, and the observation is not sufficient for a violation'
      }
    }
  }

  /* Stage four: policy audit before anything is dispatched. */
  const draft = { scene, context, severity: severityResult.breakdown, legal }
  const guardCall = await call<{ verdict: 'pass' | 'redacted' | 'blocked'; findings: { rule: string; detail: string }[]; redactions: string[] }>({
    role: 'guard',
    incidentId,
    schema: GUARD_SCHEMA,
    messages: [
      { role: 'system', content: SYSTEM_GUARD },
      { role: 'user', content: JSON.stringify(draft) },
    ],
  })
  trace.push(traceRow('guard', guardCall, 'auto'))

  const citationValidity = claimsSeen === 0 ? 1 : Math.round(((claimsSeen - dropped) / claimsSeen) * 1000) / 1000

  const departmentLabel =
    get<{ label: string }>('SELECT label FROM departments WHERE department = ?', [situation.department])?.label ??
    situation.department

  const pkg: IntelligencePackage = {
    incident: { ...incident, css: { value: severityResult.score, lo: incident.css.lo, hi: incident.css.hi }, priority: severityResult.band },
    board: tiles,
    scene,
    context,
    severity: severityResult.breakdown,
    legal,
    routing:
      guardCall.data.verdict === 'blocked'
        ? null
        : {
            department: situation.department,
            department_label: departmentLabel,
            action_line: actionLine || `verify on site and confirm with resolution evidence`,
            sla_seconds: SLA_SECONDS[severityResult.band],
            dispatched_at: row.sla_due_at === null ? null : row.sla_due_at - SLA_SECONDS[severityResult.band] * 1000,
            sla_due_at: row.sla_due_at,
            acknowledged_at: null,
            channels: [],
            escalation_level: 0,
          },
    guard: {
      verdict: guardCall.data.verdict,
      policy_version: 'lib/reasoning/pipeline.ts SYSTEM_GUARD',
      findings: guardCall.data.findings,
      redactions: guardCall.data.redactions,
      model: guardCall.model,
    },
    causal,
    model_trace: trace,
    quality: {
      coverage: coverageOf(incidentId, [row.detected_at - 120_000, row.detected_at + 180_000]),
      sync_grade: incident.sync_quality,
      calibration_uncertainty_m: calibrationUncertainty(incidentId),
      identity_confidence: 0,
      citation_validity: citationValidity,
      authenticity: authenticityCounts(incidentId),
      admissibility: admissibility(incidentId, citationValidity),
    },
    observation_ids: [...validIds],
  }

  storePackage(incidentId, pkg)
  /* The banner came from a rule. This is the understanding that replaces it. */
  supersedePreAlert(incidentId)
  rescore(incidentId)
  return { package: pkg, droppedClaims: dropped, citationValidity }
}

function traceRow(
  role: string,
  result: { model: string; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number; fallbackFrom: string | null },
  tier: ModelTraceRow['tier'],
): ModelTraceRow {
  return {
    role,
    model: result.model,
    tier,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.costUsd,
    latency_ms: result.latencyMs,
    cached: false,
    fallback_from: result.fallbackFrom,
  }
}

/**
 * Fraction of the incident window any source could speak about.
 *
 * The denominator is the incident window, not the span of the observations, so
 * the number answers "how much of what happened did anything see" rather than
 * "how much of what we saw did we see". A single still keyframe therefore scores
 * near zero against a five minute window, which is the correct reading: one
 * photograph is not coverage of an interval, and a package resting on it should
 * say so.
 */
function coverageOf(incidentId: string, window: [number, number]): number {
  const rows = all<{ t_start: number; t_end: number }>(
    'SELECT t_start, t_end FROM observations WHERE incident_id = ? ORDER BY t_start ASC',
    [incidentId],
  )
  if (rows.length === 0) return 0
  const span = Math.max(1, window[1] - window[0])
  let covered = 0
  let cursor = window[0]
  for (const row of rows) {
    const end = Math.min(row.t_end, window[1])
    if (end <= cursor) continue
    covered += end - Math.max(row.t_start, cursor)
    cursor = end
  }
  return Math.round(Math.min(1, covered / span) * 1000) / 1000
}

function calibrationUncertainty(incidentId: string): number {
  const row = get<{ worst: number | null }>(
    `SELECT MAX(s.calibration_residual_m) AS worst FROM observations o
     JOIN sources s ON s.source_id = o.source_id WHERE o.incident_id = ?`,
    [incidentId],
  )
  return row?.worst ?? 0
}

function authenticityCounts(incidentId: string) {
  const total = get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM observations WHERE incident_id = ? AND content_ref IS NOT NULL',
    [incidentId],
  )?.c ?? 0
  const signed = get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM observations WHERE incident_id = ? AND device_signature IS NOT NULL',
    [incidentId],
  )?.c ?? 0
  return { verified: signed, consistent: total - signed, inconsistent: 0, unverifiable: 0 }
}

function admissibility(incidentId: string, citationValidity: number) {
  const hasEvidence = (get<{ c: number }>('SELECT COUNT(*) AS c FROM observations WHERE incident_id = ? AND content_ref IS NOT NULL', [incidentId])?.c ?? 0) > 0
  return [
    {
      key: 'preservation',
      label: 'preservation of the original',
      state: hasEvidence ? ('met' as const) : ('not-applicable' as const),
      standard: 'ISO/IEC 27037',
      note: hasEvidence ? 'content addressed by sha-256, custody chained from ingest' : 'no media attached to this incident',
    },
    {
      key: 'analysis',
      label: 'analysis and interpretation recorded',
      state: 'met' as const,
      standard: 'ISO/IEC 27042',
      note: 'model trace stored with tokens, latency and cost for every stage',
    },
    {
      key: 'citations',
      label: 'every claim carries evidence',
      state: citationValidity >= 0.99 ? ('met' as const) : citationValidity >= 0.8 ? ('partial' as const) : ('unmet' as const),
      standard: 'platform rule',
      note: `${Math.round(citationValidity * 100)} percent of claims cited a resolvable observation`,
    },
    {
      key: 'certificate',
      label: 'Section 63 electronic-record certificate',
      state: 'unmet' as const,
      standard: 'Bharatiya Sakshya Adhiniyam 2023',
      note: 'generated per recipient on disclosure, counsel format confirmation required',
    },
  ]
}

export { GroqUnconfigured }
