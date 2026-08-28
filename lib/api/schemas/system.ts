import { z } from 'zod'
import { DomainSchema, PriorityBandSchema } from './common'

export const ROLE_KEYS = ['scene', 'context', 'forensic', 'guard', 'audio'] as const
export const RoleKeySchema = z.enum(ROLE_KEYS)
export type RoleKey = z.infer<typeof RoleKeySchema>

export const RoleHealthSchema = z.object({
  role: RoleKeySchema,
  label: z.string(),
  state: z.enum(['green', 'amber', 'red']),
  model: z.string(),
  fallback_active: z.boolean(),
  p95_latency_ms: z.number().int(),
  error_rate: z.number().min(0).max(1),
  circuit: z.enum(['closed', 'half-open', 'open']),
})
export type RoleHealth = z.infer<typeof RoleHealthSchema>

export const SystemHealthSchema = z.object({
  t: z.number(),
  roles: z.array(RoleHealthSchema),
  edge: z.object({ up: z.number().int(), total: z.number().int(), degraded: z.number().int() }),
  spend: z.object({
    today_usd: z.number(),
    budget_usd: z.number(),
    month_usd: z.number(),
    month_budget_usd: z.number(),
    degradation_active: z.boolean(),
  }),
  incident_counts: z.record(PriorityBandSchema, z.number().int()),
  stream: z.object({ clients: z.number().int(), events_per_min: z.number() }),
})
export type SystemHealth = z.infer<typeof SystemHealthSchema>

/* -------------------------------------------------------------- analytics */

export const DepartmentPerformanceSchema = z.object({
  department: z.string(),
  label: z.string(),
  verified_closure_rate: z.number().min(0).max(1),
  sla_compliance: z.number().min(0).max(1),
  median_response_s: z.record(PriorityBandSchema, z.number()),
  open: z.number().int(),
  closed_7d: z.number().int(),
  reopened_7d: z.number().int(),
})
export type DepartmentPerformance = z.infer<typeof DepartmentPerformanceSchema>

export const TrendSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])),
})
export type TrendSeries = z.infer<typeof TrendSeriesSchema>

export const BiasAuditCellSchema = z.object({
  zone_kind: z.string(),
  hour_bucket: z.string(),
  enforcement_rate: z.number(),
  educational_rate: z.number(),
  sample: z.number().int(),
  disparity: z.number(),
  flagged: z.boolean(),
})
export type BiasAuditCell = z.infer<typeof BiasAuditCellSchema>

export const ModelOpsSchema = z.object({
  by_role: z.array(
    z.object({
      role: z.string(),
      model: z.string(),
      calls: z.number().int(),
      cost_usd: z.number(),
      cache_hit_rate: z.number().min(0).max(1),
      fallbacks: z.number().int(),
      p95_latency_ms: z.number().int(),
    }),
  ),
  batch_jobs: z.array(
    z.object({
      job_id: z.string(),
      kind: z.string(),
      submitted_at: z.number(),
      completed_at: z.number().nullable(),
      items: z.number().int(),
      cost_usd: z.number(),
      state: z.enum(['queued', 'running', 'completed', 'failed']),
    }),
  ),
  spend_series: z.array(z.tuple([z.number(), z.number()])),
})
export type ModelOps = z.infer<typeof ModelOpsSchema>

export const AnalyticsOverviewSchema = z.object({
  departments: z.array(DepartmentPerformanceSchema),
  trends: z.array(TrendSeriesSchema),
  bias: z.array(BiasAuditCellSchema),
  model_ops: ModelOpsSchema,
  by_domain: z.array(
    z.object({ domain: DomainSchema, count: z.number().int(), verified: z.number().int() }),
  ),
})
export type AnalyticsOverview = z.infer<typeof AnalyticsOverviewSchema>

/* ------------------------------------------------------------------ query */

export const QueryToolCallSchema = z.object({
  step: z.number().int(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  rows: z.number().int(),
  ms: z.number().int(),
  error: z.string().nullable(),
})
export type QueryToolCall = z.infer<typeof QueryToolCallSchema>

export const QueryAnswerSchema = z.object({
  query_id: z.string(),
  question: z.string(),
  asked_at: z.number(),
  guard: z.object({
    verdict: z.enum(['pass', 'blocked']),
    detail: z.string(),
    injection_score: z.number().min(0).max(1),
  }),
  trace: z.array(QueryToolCallSchema),
  answer: z.string(),
  citations: z.array(z.object({ incident_id: z.string(), label: z.string() })),
  table: z
    .object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
    .nullable(),
  model: z.string(),
  cost_usd: z.number(),
})
export type QueryAnswer = z.infer<typeof QueryAnswerSchema>

/* ------------------------------------------------------------------ admin */

export const DepartmentSchema = z.object({
  department: z.string(),
  label: z.string(),
  domains: z.array(DomainSchema),
  contacts: z.array(z.object({ name: z.string(), role: z.string(), channel: z.string(), target: z.string() })),
  sla_seconds: z.record(PriorityBandSchema, z.number().int()),
  escalation_to: z.string().nullable(),
})
export type Department = z.infer<typeof DepartmentSchema>

export const PlaybookSchema = z.object({
  playbook_id: z.string(),
  name: z.string(),
  domain: DomainSchema,
  min_priority: PriorityBandSchema,
  version: z.number().int(),
  updated_at: z.number(),
  steps: z.array(
    z.object({
      step_id: z.string(),
      text: z.string(),
      owner: z.string(),
      timer_s: z.number().int().nullable(),
      automatic: z.boolean(),
      approval_gate: z.boolean(),
    }),
  ),
})
export type Playbook = z.infer<typeof PlaybookSchema>

export const BudgetSchema = z.object({
  scope: z.enum(['zone', 'tenant']),
  key: z.string(),
  label: z.string(),
  daily_usd: z.number(),
  spent_today_usd: z.number(),
  monthly_usd: z.number(),
  spent_month_usd: z.number(),
  degradation: z.enum(['none', 'fewer-images', 'lower-effort', 'edge-only']),
})
export type Budget = z.infer<typeof BudgetSchema>

export const UserSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['operator', 'investigator', 'department', 'admin']),
  department: z.string().nullable(),
  investigation_flag: z.boolean(),
  last_active: z.number(),
})
export type User = z.infer<typeof UserSchema>

export const AuditEntrySchema = z.object({
  seq: z.number().int(),
  t: z.number(),
  actor: z.string(),
  action: z.string(),
  subject: z.string(),
  detail: z.string(),
  hash: z.string(),
  prev_hash: z.string(),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>
