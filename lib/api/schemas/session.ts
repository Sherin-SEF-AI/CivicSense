import { z } from 'zod'
import { DomainSchema } from './common'

/**
 * Who is using the console, and what that lets them do.
 *
 * Capabilities are returned by the server rather than derived in the client from
 * a role string. The client uses them to hide what cannot be done; the server
 * enforces them regardless, because a hidden button is a courtesy and not a
 * control.
 */
export const CapabilitySchema = z.enum([
  'incident.acknowledge',
  'incident.dispatch',
  'incident.escalate',
  'incident.dismiss',
  'evidence.search',
  'evidence.person_search',
  'case.create',
  'case.legal_hold',
  'case.disclose',
  'forensics.pull',
  'forensics.reanalyse',
  'admin.configure',
  'analytics.bias_audit',
])
export type Capability = z.infer<typeof CapabilitySchema>

export const SessionSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['operator', 'investigator', 'department', 'admin']),
  /** Set for department users. Their queue is scoped to it, server side. */
  department: z.string().nullable(),
  department_label: z.string().nullable(),
  domains: z.array(DomainSchema),
  capabilities: z.array(CapabilitySchema),
  investigation_flag: z.boolean(),
})
export type Session = z.infer<typeof SessionSchema>

export const SavedSearchRecordSchema = z.object({
  saved_search_id: z.string(),
  name: z.string(),
  query: z.string(),
  created_at: z.number(),
  rerun_on_new_evidence: z.boolean(),
  last_run_at: z.number(),
  new_hits: z.number().int(),
})
export type SavedSearchRecord = z.infer<typeof SavedSearchRecordSchema>

export const TaskingSchema = z.object({
  tasking_id: z.string(),
  warning_id: z.string(),
  intervention_id: z.string(),
  intervention_label: z.string(),
  zone_label: z.string(),
  department: z.string(),
  assigned_source_id: z.string().nullable(),
  assigned_label: z.string().nullable(),
  eta_minutes: z.number().nullable(),
  created_at: z.number(),
  state: z.enum(['tasked', 'en-route', 'verifying', 'closed']),
})
export type Tasking = z.infer<typeof TaskingSchema>

export const CalibrationRunSchema = z.object({
  run_id: z.string(),
  source_id: z.string(),
  started_at: z.number(),
  state: z.enum(['queued', 'running', 'passed', 'moved']),
  detail: z.string(),
  residual_m: z.number().nullable(),
})
export type CalibrationRun = z.infer<typeof CalibrationRunSchema>
