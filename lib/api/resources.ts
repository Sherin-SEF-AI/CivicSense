import { z } from 'zod'
import {
  AnalyticsOverviewSchema,
  AuditEntrySchema,
  BudgetSchema,
  CaseDetailSchema,
  CaseSummarySchema,
  DepartmentSchema,
  EvidenceSearchResultSchema,
  ForensicsBundleSchema,
  IncidentSummarySchema,
  IntelligencePackageSchema,
  InterventionOutcomeSchema,
  PlaybookSchema,
  QueryAnswerSchema,
  RiskSurfaceSchema,
  SensorSeriesSchema,
  SourceDetailSchema,
  SourceDeviceSchema,
  SystemHealthSchema,
  UserSchema,
  WarningSchema,
  ZoneSchema,
} from '@/lib/api/schemas'
import { request } from './client'
import type { IncidentFilters } from './keys'

const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable(), total: z.number() })

export const IncidentPageSchema = page(IncidentSummarySchema)
export type IncidentPage = z.infer<typeof IncidentPageSchema>

const WarningsSchema = z.object({
  items: z.array(WarningSchema),
  outcomes: z.array(InterventionOutcomeSchema),
  total: z.number(),
})

const AdminSchema = z.object({
  departments: z.array(DepartmentSchema),
  playbooks: z.array(PlaybookSchema),
  budgets: z.array(BudgetSchema),
  users: z.array(UserSchema),
  audit: z.array(AuditEntrySchema),
})
export type AdminBundle = z.infer<typeof AdminSchema>

const PullResultSchema = z.object({
  request_id: z.string(),
  incident_id: z.string(),
  kind: z.enum(['clip', 'reanalysis']),
  window: z.tuple([z.number(), z.number()]),
  source_ids: z.array(z.string()),
  state: z.literal('queued'),
  estimated_bytes: z.number(),
  estimated_cost_usd: z.number(),
  budget_remaining_usd: z.number(),
})
export type PullResult = z.infer<typeof PullResultSchema>

export const api = {
  systemHealth: (signal?: AbortSignal) => request('/system/health', SystemHealthSchema, { signal }),

  incidents: (filters: IncidentFilters, cursor: string | null, signal?: AbortSignal) =>
    request('/incidents', IncidentPageSchema, {
      signal,
      query: {
        priority: filters.priority,
        domain: filters.domain,
        zone: filters.zone,
        source_type: filters.sourceType,
        status: filters.status,
        q: filters.q || null,
        include_closed: filters.includeClosed ? '1' : null,
        cursor,
        limit: 80,
      },
    }),

  incident: (id: string, signal?: AbortSignal) =>
    request(`/incidents/${encodeURIComponent(id)}`, IncidentSummarySchema, { signal }),

  incidentPackage: (id: string, signal?: AbortSignal) =>
    request(`/incidents/${encodeURIComponent(id)}/package`, IntelligencePackageSchema, { signal }),

  incidentAction: (id: string, action: 'ack' | 'dispatch' | 'escalate' | 'resolve' | 'dismiss', reason?: string) =>
    request(`/incidents/${encodeURIComponent(id)}/${action}`, IncidentSummarySchema, {
      method: 'POST',
      body: reason === undefined ? {} : { reason },
    }),

  forensics: (incidentId: string, caseId: string | null, signal?: AbortSignal) =>
    request(`/forensics/${encodeURIComponent(incidentId)}`, ForensicsBundleSchema, {
      signal,
      query: { case_id: caseId },
    }),

  forensicsPull: (incidentId: string, body: { from: number; to: number; source_ids: string[]; kind: 'clip' | 'reanalysis' }) =>
    request(`/forensics/${encodeURIComponent(incidentId)}/pull`, PullResultSchema, { method: 'POST', body }),

  evidenceSearch: (q: string, caseId: string | null, signal?: AbortSignal) =>
    request('/evidence/search', EvidenceSearchResultSchema, {
      method: 'POST',
      body: { q, case_id: caseId },
      signal,
    }),

  cases: (q: string, signal?: AbortSignal) =>
    request('/cases', page(CaseSummarySchema), { signal, query: { q: q || null } }),

  case: (id: string, signal?: AbortSignal) =>
    request(`/cases/${encodeURIComponent(id)}`, CaseDetailSchema, { signal }),

  caseCreate: (title: string, incidentIds: string[]) =>
    request('/cases', CaseDetailSchema, { method: 'POST', body: { title, incident_ids: incidentIds } }),

  casePatch: (
    id: string,
    patch: Partial<{ legal_hold: boolean; investigation_flag: boolean; state: string; note: string }>,
  ) => request(`/cases/${encodeURIComponent(id)}`, CaseDetailSchema, { method: 'PATCH', body: patch }),

  warnings: (level: string[], domain: string[], signal?: AbortSignal) =>
    request('/warnings', WarningsSchema, { signal, query: { level, domain } }),

  risk: (domain: string | null, horizon: number, signal?: AbortSignal) =>
    request('/predict/risk', RiskSurfaceSchema, { signal, query: { domain, horizon } }),

  sources: (type: string[], state: string[], q: string, signal?: AbortSignal) =>
    request('/sources', page(SourceDeviceSchema), { signal, query: { type, state, q: q || null } }),

  source: (id: string, signal?: AbortSignal) =>
    request(`/sources/${encodeURIComponent(id)}`, SourceDetailSchema, { signal }),

  series: (id: string, from: number, to: number, buckets: number, signal?: AbortSignal) =>
    request(`/sensors/${encodeURIComponent(id)}/series`, SensorSeriesSchema, {
      signal,
      query: { from, to, buckets },
    }),

  analytics: (signal?: AbortSignal) => request('/analytics/overview', AnalyticsOverviewSchema, { signal }),

  query: (question: string) => request('/query', QueryAnswerSchema, { method: 'POST', body: { question } }),

  admin: (signal?: AbortSignal) => request('/admin', AdminSchema, { signal }),

  zones: (signal?: AbortSignal) =>
    request('/zones', z.object({ items: z.array(ZoneSchema), total: z.number() }), { signal }),
}
