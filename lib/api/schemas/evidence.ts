import { z } from 'zod'
import { DomainSchema, LatLonSchema, SourceTypeSchema } from './common'

export const EvidenceItemSchema = z.object({
  evidence_id: z.string(),
  observation_id: z.string(),
  incident_id: z.string().nullable(),
  source_id: z.string(),
  source_type: SourceTypeSchema,
  t: z.number(),
  position: LatLonSchema,
  zone_label: z.string(),
  kind: z.enum(['keyframe', 'crop', 'clip']),
  thumb_url: z.string(),
  full_url: z.string(),
  preview_clip_url: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  /** Structured attributes the edge and the VLM agreed on. */
  attributes: z.object({
    classes: z.array(z.string()),
    colour: z.string().nullable(),
    vehicle_type: z.string().nullable(),
    tags: z.array(z.string()),
  }),
  similarity: z.number().min(0).max(1).nullable(),
  hash: z.string(),
  authenticity: z.enum(['verified', 'consistent', 'inconsistent', 'unverifiable']),
  contains_person: z.boolean(),
})
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>

/**
 * The parsed structured query. It is shown back to the operator as editable
 * chips before anything runs, so nobody is surprised by what the agent decided
 * a sentence meant.
 */
export const ParsedQuerySchema = z.object({
  text: z.string(),
  from: z.number().nullable(),
  to: z.number().nullable(),
  zone_ids: z.array(z.string()),
  domains: z.array(DomainSchema),
  source_types: z.array(SourceTypeSchema),
  classes: z.array(z.string()),
  colour: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  free_terms: z.array(z.string()),
  requires_person_search: z.boolean(),
  model: z.string(),
})
export type ParsedQuery = z.infer<typeof ParsedQuerySchema>

export const EvidenceSearchResultSchema = z.object({
  parsed: ParsedQuerySchema,
  items: z.array(EvidenceItemSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int(),
  /** Set when the query needed person search and the case has no flag. */
  blocked_reason: z.string().nullable(),
  took_ms: z.number().int(),
})
export type EvidenceSearchResult = z.infer<typeof EvidenceSearchResultSchema>

export const SavedSearchSchema = z.object({
  saved_search_id: z.string(),
  name: z.string(),
  query: z.string(),
  created_at: z.number(),
  rerun_on_new_evidence: z.boolean(),
  last_run_at: z.number(),
  new_hits: z.number().int(),
})
export type SavedSearch = z.infer<typeof SavedSearchSchema>
