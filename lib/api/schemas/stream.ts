import { z } from 'zod'
import { DomainSchema, LatLonSchema, PriorityBandSchema } from './common'
import { IncidentSummarySchema } from './incident'
import { WarningSchema } from './predict'
import { SourceStateSchema } from './source'

/**
 * Everything that arrives over the single SSE connection.
 *
 * The wire carries both a named SSE `event:` field and a `type` field in the
 * JSON. The name lets a consumer attach a targeted listener; the redundant type
 * makes the payload a self-describing discriminated union, which is what the
 * router below dispatches on.
 */

export const PreAlertSchema = z.object({
  pre_alert_id: z.string(),
  incident_id: z.string().nullable(),
  domain: DomainSchema,
  trigger: z.string(),
  headline: z.string(),
  position: LatLonSchema,
  zone_label: z.string(),
  detected_at: z.number(),
  /** Milliseconds from trigger to this alert leaving the edge. */
  elapsed_ms: z.number().int(),
  corroborating_sources: z.number().int(),
  superseded_by_package: z.boolean(),
})
export type PreAlert = z.infer<typeof PreAlertSchema>

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('incident.created'), ts: z.number(), payload: IncidentSummarySchema }),
  z.object({ type: z.literal('incident.updated'), ts: z.number(), payload: IncidentSummarySchema }),
  z.object({ type: z.literal('pre_alert.raised'), ts: z.number(), payload: PreAlertSchema }),
  z.object({ type: z.literal('pre_alert.cleared'), ts: z.number(), payload: z.object({ pre_alert_id: z.string() }) }),
  z.object({ type: z.literal('warning.raised'), ts: z.number(), payload: WarningSchema }),
  z.object({
    type: z.literal('source.health'),
    ts: z.number(),
    payload: z.object({
      source_id: z.string(),
      state: SourceStateSchema,
      trust: z.number(),
      last_observation_at: z.number(),
    }),
  }),
  z.object({
    type: z.literal('patrol.position'),
    ts: z.number(),
    payload: z.object({
      source_id: z.string(),
      lat: z.number(),
      lon: z.number(),
      heading: z.number(),
      speed_kmh: z.number(),
    }),
  }),
  z.object({
    type: z.literal('spend.tick'),
    ts: z.number(),
    payload: z.object({ today_usd: z.number(), budget_usd: z.number(), month_usd: z.number() }),
  }),
  z.object({
    type: z.literal('counts'),
    ts: z.number(),
    payload: z.record(PriorityBandSchema, z.number().int()),
  }),
])
export type StreamEvent = z.infer<typeof StreamEventSchema>
export type StreamEventType = StreamEvent['type']

/** Topics a client can subscribe to, so a screen only pays for what it renders. */
export const STREAM_TOPICS = [
  'incident',
  'pre_alert',
  'warning',
  'source',
  'patrol',
  'spend',
] as const
export type StreamTopic = (typeof STREAM_TOPICS)[number]

export const TOPIC_OF: Record<StreamEventType, StreamTopic> = {
  'incident.created': 'incident',
  'incident.updated': 'incident',
  'pre_alert.raised': 'pre_alert',
  'pre_alert.cleared': 'pre_alert',
  'warning.raised': 'warning',
  'source.health': 'source',
  'patrol.position': 'patrol',
  'spend.tick': 'spend',
  counts: 'incident',
}
