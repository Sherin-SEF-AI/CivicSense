import { z } from 'zod'
import {
  DomainSchema,
  IncidentStatusSchema,
  IntervalSchema,
  LatLonSchema,
  PriorityBandSchema,
  SourceTypeSchema,
  SyncQualitySchema,
} from './common'

/**
 * An evidence citation. Every observation-level claim the reasoning layer makes
 * carries these, and the client renders them as chips that open the underlying
 * item. A claim whose ids do not resolve is a validation failure upstream, and
 * the package quality block reports the rate.
 */
export const ClaimSchema = z.object({
  text: z.string(),
  evidence_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})
export type Claim = z.infer<typeof ClaimSchema>

export const IncidentSummarySchema = z.object({
  incident_id: z.string(),
  title: z.string(),
  domain: DomainSchema,
  status: IncidentStatusSchema,
  priority: PriorityBandSchema,
  /** Composite severity score with the interval the pipeline actually knows. */
  css: IntervalSchema,
  zone_id: z.string(),
  zone_label: z.string(),
  position: LatLonSchema,
  h3: z.string(),
  detected_at: z.number(),
  updated_at: z.number(),
  source_count: z.number().int().nonnegative(),
  source_types: z.array(SourceTypeSchema),
  sync_quality: SyncQualitySchema,
  corroboration: z.number().min(0).max(1),
  acknowledged: z.boolean(),
  /** Present once routed. Null while the package is still being assembled. */
  department: z.string().nullable(),
  sla_due_at: z.number().nullable(),
  /** Set when an operator dismissed it; the reason feeds the learning loop. */
  dismissed_reason: z.string().nullable(),
})
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>

/* ------------------------------------------------------------------ package */

export const SceneUnderstandingSchema = z.object({
  summary: z.string(),
  /** Actors are described by behaviour and appearance, never by identity. */
  actors: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(['vehicle', 'person', 'animal', 'object']),
      descriptor: z.string(),
      evidence_ids: z.array(z.string()),
    }),
  ),
  violation_assessment: ClaimSchema.nullable(),
  hazards: z.array(ClaimSchema),
  intent_hypotheses: z.array(ClaimSchema),
  trigger_agreement: z.boolean(),
  model: z.string(),
})
export type SceneUnderstanding = z.infer<typeof SceneUnderstandingSchema>

export const ContextAssessmentSchema = z.object({
  normalcy: z.number().min(0).max(1),
  contributing_factors: z.array(ClaimSchema),
  causal_chain: z.array(z.string()),
  what_happens_next: ClaimSchema,
  permitted_activity: z.boolean(),
  disposition: z.enum([
    'enforcement',
    'operations',
    'infrastructure',
    'educational',
    'monitor',
    'no-action',
  ]),
  needs_human_review: z.boolean(),
  /** Bounded 0 to 1 amplifiers. Severity arithmetic happens in code, not here. */
  amplifiers: z.record(z.string(), z.number().min(0).max(1)),
  model: z.string(),
})
export type ContextAssessment = z.infer<typeof ContextAssessmentSchema>

export const SEVERITY_COMPONENTS = [
  'inherent',
  'contextual',
  'temporal',
  'population',
  'escalation',
  'infrastructure',
] as const
export type SeverityComponent = (typeof SEVERITY_COMPONENTS)[number]

export const SeverityBreakdownSchema = z.object({
  score: z.number().min(0).max(1),
  band: PriorityBandSchema,
  zone_profile: z.string(),
  components: z.array(
    z.object({
      key: z.enum(SEVERITY_COMPONENTS),
      label: z.string(),
      raw: z.number().min(0).max(1),
      weight: z.number().min(0).max(1),
      contribution: z.number(),
      note: z.string(),
    }),
  ),
})
export type SeverityBreakdown = z.infer<typeof SeverityBreakdownSchema>

export const LegalMappingSchema = z.object({
  statute: z.string(),
  section: z.string(),
  title: z.string(),
  confidence: z.number().min(0).max(1),
  justification: z.string(),
  /** Until counsel signs off, the package renders these as reference only. */
  counsel_verified: z.boolean(),
  source_reference: z.string(),
})
export type LegalMapping = z.infer<typeof LegalMappingSchema>

export const RoutingSchema = z.object({
  department: z.string(),
  department_label: z.string(),
  action_line: z.string(),
  sla_seconds: z.number().int(),
  dispatched_at: z.number().nullable(),
  sla_due_at: z.number().nullable(),
  acknowledged_at: z.number().nullable(),
  channels: z.array(
    z.object({
      channel: z.enum(['whatsapp', 'sms', 'email', 'push', 'voice', 'cad']),
      target: z.string(),
      sent_at: z.number().nullable(),
      delivered_at: z.number().nullable(),
      acknowledged_at: z.number().nullable(),
    }),
  ),
  escalation_level: z.number().int().min(0),
})
export type Routing = z.infer<typeof RoutingSchema>

export const ModelTraceRowSchema = z.object({
  role: z.string(),
  model: z.string(),
  tier: z.enum(['on_demand', 'auto', 'flex', 'batch']),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number(),
  latency_ms: z.number().int(),
  cached: z.boolean(),
  fallback_from: z.string().nullable(),
})
export type ModelTraceRow = z.infer<typeof ModelTraceRowSchema>

export const PackageQualitySchema = z.object({
  /** Fraction of the incident window observed by any source. */
  coverage: z.number().min(0).max(1),
  sync_grade: SyncQualitySchema,
  calibration_uncertainty_m: z.number(),
  identity_confidence: z.number().min(0).max(1),
  citation_validity: z.number().min(0).max(1),
  authenticity: z.object({
    verified: z.number().int(),
    consistent: z.number().int(),
    inconsistent: z.number().int(),
    unverifiable: z.number().int(),
  }),
  admissibility: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      state: z.enum(['met', 'partial', 'unmet', 'not-applicable']),
      standard: z.string(),
      note: z.string(),
    }),
  ),
})
export type PackageQuality = z.infer<typeof PackageQualitySchema>

export const GuardVerdictSchema = z.object({
  verdict: z.enum(['pass', 'redacted', 'blocked']),
  policy_version: z.string(),
  findings: z.array(z.object({ rule: z.string(), detail: z.string() })),
  redactions: z.array(z.string()),
  model: z.string(),
})
export type GuardVerdict = z.infer<typeof GuardVerdictSchema>

export const EvidenceBoardTileSchema = z.object({
  observation_id: z.string(),
  source_id: z.string(),
  source_type: SourceTypeSchema,
  label: z.string(),
  t: z.number(),
  thumb_url: z.string(),
  full_url: z.string(),
  kind: z.enum(['keyframe', 'storyboard', 'clip']),
  annotations: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      label: z.string(),
      track_id: z.string().nullable(),
    }),
  ),
})
export type EvidenceBoardTile = z.infer<typeof EvidenceBoardTileSchema>

export const CausalGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(['event', 'state', 'condition', 'outcome']),
      t: z.number().nullable(),
      evidence_ids: z.array(z.string()),
      root_cause_class: z
        .enum(['infrastructure', 'behavioural', 'environmental', 'regulatory', 'systemic'])
        .nullable(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_ids: z.array(z.string()),
      counterfactual: z.boolean(),
    }),
  ),
  root_causes: z.array(
    z.object({
      node_id: z.string(),
      label: z.string(),
      class: z.enum(['infrastructure', 'behavioural', 'environmental', 'regulatory', 'systemic']),
      rank: z.number().int(),
      share: z.number().min(0).max(1),
    }),
  ),
})
export type CausalGraph = z.infer<typeof CausalGraphSchema>

export const IntelligencePackageSchema = z.object({
  incident: IncidentSummarySchema,
  board: z.array(EvidenceBoardTileSchema),
  scene: SceneUnderstandingSchema,
  context: ContextAssessmentSchema,
  severity: SeverityBreakdownSchema,
  legal: z.array(LegalMappingSchema),
  routing: RoutingSchema.nullable(),
  guard: GuardVerdictSchema,
  /* The why-graph, derived from the causal chain the context pass stated. */
  causal: CausalGraphSchema.optional(),
  model_trace: z.array(ModelTraceRowSchema),
  quality: PackageQualitySchema,
  observation_ids: z.array(z.string()),
})
export type IntelligencePackage = z.infer<typeof IntelligencePackageSchema>
