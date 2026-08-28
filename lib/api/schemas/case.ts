import { z } from 'zod'

export const CASE_STATES = ['open', 'active', 'review', 'disclosed', 'closed'] as const
export const CaseStateSchema = z.enum(CASE_STATES)
export type CaseState = z.infer<typeof CaseStateSchema>

export const RECIPIENT_CLASSES = ['court', 'department', 'insurer', 'public'] as const
export const RecipientClassSchema = z.enum(RECIPIENT_CLASSES)
export type RecipientClass = z.infer<typeof RecipientClassSchema>

export const CaseNoteSchema = z.object({
  note_id: z.string(),
  t: z.number(),
  author: z.string(),
  text: z.string(),
  evidence_ids: z.array(z.string()),
})
export type CaseNote = z.infer<typeof CaseNoteSchema>

export const CaseTaskSchema = z.object({
  task_id: z.string(),
  text: z.string(),
  owner: z.string(),
  due_at: z.number().nullable(),
  state: z.enum(['open', 'done', 'blocked']),
})
export type CaseTask = z.infer<typeof CaseTaskSchema>

export const DisclosureBundleSchema = z.object({
  bundle_id: z.string(),
  recipient_class: RecipientClassSchema,
  recipient: z.string(),
  created_at: z.number(),
  evidence_ids: z.array(z.string()),
  redaction_preset: z.string(),
  redactions: z.array(
    z.object({ evidence_id: z.string(), what: z.string(), why: z.string(), hash_after: z.string() }),
  ),
  manifest_hash: z.string(),
  certificate_issued: z.boolean(),
})
export type DisclosureBundle = z.infer<typeof DisclosureBundleSchema>

export const CaseSummarySchema = z.object({
  case_id: z.string(),
  reference: z.string(),
  title: z.string(),
  state: CaseStateSchema,
  opened_at: z.number(),
  owner: z.string(),
  incident_count: z.number().int(),
  evidence_count: z.number().int(),
  evidence_bytes: z.number().int(),
  legal_hold: z.boolean(),
  investigation_flag: z.boolean(),
  updated_at: z.number(),
})
export type CaseSummary = z.infer<typeof CaseSummarySchema>

export const CaseDetailSchema = CaseSummarySchema.extend({
  incident_ids: z.array(z.string()),
  evidence_ids: z.array(z.string()),
  notes: z.array(CaseNoteSchema),
  tasks: z.array(CaseTaskSchema),
  bundles: z.array(DisclosureBundleSchema),
  exports: z.array(
    z.object({
      export_id: z.string(),
      t: z.number(),
      actor: z.string(),
      kind: z.enum(['offline-html', 'pdf', 'disclosure', 'csv']),
      recipient: z.string(),
      manifest_hash: z.string(),
    }),
  ),
  certificate: z
    .object({
      /** Bharatiya Sakshya Adhiniyam 2023 Section 63 electronic-record certificate. */
      issued_at: z.number(),
      issued_by: z.string(),
      role: z.string(),
      device_particulars: z.string(),
      hash_method: z.string(),
      counsel_reviewed: z.boolean(),
    })
    .nullable(),
})
export type CaseDetail = z.infer<typeof CaseDetailSchema>
