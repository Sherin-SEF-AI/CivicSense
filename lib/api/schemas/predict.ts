import { z } from 'zod'
import { DomainSchema, LatLonSchema } from './common'

export const WARNING_LEVELS = ['WATCH', 'ADVISORY', 'WARNING', 'CRITICAL'] as const
export const WarningLevelSchema = z.enum(WARNING_LEVELS)
export type WarningLevel = z.infer<typeof WarningLevelSchema>

export const WARNING_LEVEL_RANK: Record<WarningLevel, number> = {
  WATCH: 1,
  ADVISORY: 2,
  WARNING: 3,
  CRITICAL: 4,
}

export const InterventionSchema = z.object({
  intervention_id: z.string(),
  kind: z.enum([
    'patrol-tasking',
    'signal-timing',
    'bin-deployment',
    'barrier-placement',
    'awareness-point',
    'infrastructure-ticket',
    'pre-positioning',
  ]),
  label: z.string(),
  rationale: z.string(),
  expected_effect: z.number().min(0).max(1),
  cost_tier: z.enum(['low', 'medium', 'high']),
  feasibility: z.number().min(0).max(1),
  department: z.string(),
  taskable: z.boolean(),
})
export type Intervention = z.infer<typeof InterventionSchema>

export const WarningSchema = z.object({
  warning_id: z.string(),
  level: WarningLevelSchema,
  domain: DomainSchema,
  zone_id: z.string(),
  zone_label: z.string(),
  position: LatLonSchema,
  h3: z.string(),
  headline: z.string(),
  issued_at: z.number(),
  horizon_h: z.union([z.literal(1), z.literal(6), z.literal(24)]),
  /** When the projected trajectory crosses the threshold. */
  crossing_at: z.number(),
  confidence: z.number().min(0).max(1),
  indicators: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
      weight: z.number().min(0).max(1),
      trend: z.enum(['rising', 'falling', 'flat']),
    }),
  ),
  cascade: z.array(
    z.object({
      zone_id: z.string(),
      zone_label: z.string(),
      lag_min: z.number(),
      attenuation: z.number().min(0).max(1),
    }),
  ),
  interventions: z.array(InterventionSchema),
  acknowledged: z.boolean(),
})
export type Warning = z.infer<typeof WarningSchema>

export const RiskCellSchema = z.object({
  h3: z.string(),
  risk: z.number().min(0).max(1),
  baseline: z.number(),
  projected: z.number(),
  domain: DomainSchema,
})
export type RiskCell = z.infer<typeof RiskCellSchema>

export const RiskSurfaceSchema = z.object({
  domain: DomainSchema.nullable(),
  horizon_h: z.union([z.literal(1), z.literal(6), z.literal(24)]),
  generated_at: z.number(),
  resolution: z.number().int(),
  cells: z.array(RiskCellSchema),
})
export type RiskSurface = z.infer<typeof RiskSurfaceSchema>

/** Difference-in-differences result for a completed intervention. */
export const InterventionOutcomeSchema = z.object({
  outcome_id: z.string(),
  intervention_label: z.string(),
  zone_label: z.string(),
  domain: DomainSchema,
  applied_at: z.number(),
  before_rate: z.number(),
  after_rate: z.number(),
  delta_pct: z.number(),
  ci_lo: z.number(),
  ci_hi: z.number(),
  control_zones: z.number().int(),
  significant: z.boolean(),
})
export type InterventionOutcome = z.infer<typeof InterventionOutcomeSchema>
