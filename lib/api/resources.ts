import { z } from 'zod'
import {
  HypothesisSchema,
  AnalyticsOverviewSchema,
  SessionSchema,
  SavedSearchRecordSchema,
  TaskingSchema,
  CalibrationRunSchema,
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
  audit_chain: z.object({ valid: z.boolean(), brokenAt: z.number().nullable(), entries: z.number() }),
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

/** The package endpoint answers 503 with a reason when the model is not configured. */
export const ReasoningUnavailableSchema = z.object({
  error: z.literal('reasoning_unavailable'),
  detail: z.string(),
  incident: IncidentSummarySchema,
})

export const api = {
  session: (signal?: AbortSignal) => request('/session', SessionSchema, { signal }),

  savedSearches: (signal?: AbortSignal) =>
    request('/saved-searches', z.object({ items: z.array(SavedSearchRecordSchema) }), { signal }),

  saveSearch: (name: string, query: string, rerun: boolean) =>
    request('/saved-searches', SavedSearchRecordSchema, { method: 'POST', body: { name, query, rerun } }),

  updateSavedSearch: (id: string, patch: { rerun_on_new_evidence?: boolean; name?: string }) =>
    request(`/saved-searches/${encodeURIComponent(id)}`, SavedSearchRecordSchema, { method: 'PATCH', body: patch }),

  deleteSavedSearch: (id: string) =>
    request(`/saved-searches/${encodeURIComponent(id)}`, z.object({ deleted: z.string() }), { method: 'DELETE' }),

  registerSource: (body: Record<string, unknown>) =>
    request('/sources', SourceDeviceSchema, { method: 'POST', body }),

  deleteSource: (id: string) =>
    request(`/sources/${encodeURIComponent(id)}`, z.object({ deleted: z.string() }), { method: 'DELETE' }),

  runDriftCheck: (id: string) =>
    request(`/sources/${encodeURIComponent(id)}/calibration`, CalibrationRunSchema, { method: 'POST', body: {} }),

  attachToCase: (caseId: string, body: { evidence_ids?: string[]; incident_ids?: string[] }) =>
    request(`/cases/${encodeURIComponent(caseId)}/evidence`, CaseDetailSchema, { method: 'POST', body }),

  createBundle: (caseId: string, recipientClass: string, recipient: string) =>
    request(`/cases/${encodeURIComponent(caseId)}/bundles`, CaseDetailSchema, {
      method: 'POST',
      body: { recipient_class: recipientClass, recipient },
    }),

  issueCertificate: (caseId: string, body: { issued_by: string; role: string; device_particulars: string }) =>
    request(`/cases/${encodeURIComponent(caseId)}/certificate`, CaseDetailSchema, { method: 'POST', body }),

  taskIntervention: (
    warningId: string,
    body: { intervention_id: string; intervention_label: string; zone_label: string; department: string; lat: number; lon: number },
  ) => request(`/warnings/${encodeURIComponent(warningId)}/task`, TaskingSchema, { method: 'POST', body }),

  hypotheses: (incidentId: string, signal?: AbortSignal) =>
    request(
      `/incidents/${encodeURIComponent(incidentId)}/hypotheses`,
      z.object({ items: z.array(HypothesisSchema), reasoning_available: z.boolean() }),
      { signal },
    ),

  generateHypotheses: (incidentId: string) =>
    request(
      `/incidents/${encodeURIComponent(incidentId)}/hypotheses`,
      z.object({ items: z.array(HypothesisSchema), reasoning_available: z.boolean() }),
      { method: 'POST', body: {} },
    ),

  pullHypothesisRequest: (requestId: string) =>
    request(`/hypotheses/requests/${encodeURIComponent(requestId)}`, HypothesisSchema, { method: 'POST', body: {} }),

  updateZone: (body: { zone_id: string; kind?: string; sensitivity?: number; label?: string }) =>
    request('/zones', ZoneSchema, { method: 'PATCH', body }),

  updatePlaybook: (id: string, body: Record<string, unknown>) =>
    request(`/admin/playbooks/${encodeURIComponent(id)}`, PlaybookSchema, { method: 'PATCH', body }),

  refreshPackage: (id: string) =>
    request(`/incidents/${encodeURIComponent(id)}/package`, z.object({
      package: IntelligencePackageSchema,
      dropped_claims: z.number(),
      citation_validity: z.number(),
    }), { method: 'POST', body: {} }),

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

  /* Answers either a package or an explicit unavailability, never a fabricated
     package. The caller renders whichever came back. */
  incidentPackage: (id: string, signal?: AbortSignal) =>
    request(
      `/incidents/${encodeURIComponent(id)}/package`,
      z.union([IntelligencePackageSchema, ReasoningUnavailableSchema]),
      { signal },
    ),

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
