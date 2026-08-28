import { z } from 'zod'
import { IntervalSchema, SourceTypeSchema, SyncQualitySchema } from './common'
import { CausalGraphSchema } from './incident'
import { SensorKindSchema } from './observation'

/** One entry on the reconstructed timeline. Nothing appears without citations. */
export const TimelineEntrySchema = z.object({
  entry_id: z.string(),
  t: z.number(),
  lane: z.enum(['backward', 'anchor', 'forward', 'lateral']),
  source_id: z.string(),
  source_type: SourceTypeSchema,
  text: z.string(),
  evidence_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>

/* --------------------------------------------------------------- playback */

export const MediaSegmentSchema = z.object({
  /** Master-clock instants, already corrected for the source clock offset. */
  t_start: z.number(),
  t_end: z.number(),
  fps: z.number(),
  uri: z.string(),
  kind: z.enum(['mp4', 'hls']),
})
export type MediaSegment = z.infer<typeof MediaSegmentSchema>

export const PlaybackSourceSchema = z.object({
  source_id: z.string(),
  label: z.string(),
  source_type: SourceTypeSchema,
  tile_kind: z.enum(['video', 'map', 'scope']),
  sync_quality: SyncQualitySchema,
  clock_offset_ms: z.number(),
  segments: z.array(MediaSegmentSchema),
  /** Set for scope tiles. */
  sensor_kind: SensorKindSchema.nullable(),
  /** Ground-plane homography, row-major 3x3, when the camera is calibrated. */
  homography: z.array(z.number()).nullable(),
  calibration_residual_m: z.number().nullable(),
})
export type PlaybackSource = z.infer<typeof PlaybackSourceSchema>

export const TimelineEventTickSchema = z.object({
  t: z.number(),
  source_id: z.string(),
  kind: z.enum(['trigger', 'audio', 'sensor-threshold', 'arrival', 'annotation']),
  label: z.string(),
  evidence_id: z.string().nullable(),
})
export type TimelineEventTick = z.infer<typeof TimelineEventTickSchema>

/* -------------------------------------------------------------- kinematics */

export const TrackKinematicsSchema = z.object({
  track_id: z.string(),
  entity_ref: z.string(),
  descriptor: z.string(),
  source_id: z.string(),
  /** Sampled ground-plane state. Speed in km/h, accel in m/s2. */
  samples: z.array(
    z.object({
      t: z.number(),
      speed: z.number(),
      speed_lo: z.number(),
      speed_hi: z.number(),
      accel: z.number(),
      lat: z.number(),
      lon: z.number(),
    }),
  ),
  peak_speed: IntervalSchema,
  braking_onset_t: z.number().nullable(),
  /** Widened uncertainty demotes a measurement to an indication. */
  measurement_grade: z.enum(['measured', 'indicative']),
  validated_against_can: z.boolean(),
})
export type TrackKinematics = z.infer<typeof TrackKinematicsSchema>

export const ConflictMetricSchema = z.object({
  pair: z.tuple([z.string(), z.string()]),
  ttc_s: IntervalSchema.nullable(),
  pet_s: IntervalSchema.nullable(),
  drac: IntervalSchema.nullable(),
  t: z.number(),
  severity: z.enum(['none', 'low', 'serious', 'critical']),
})
export type ConflictMetric = z.infer<typeof ConflictMetricSchema>

/* The causal graph lives with the package schema, which also carries it. */
export { CausalGraphSchema, type CausalGraph } from './incident'

/* -------------------------------------------------------------- hypotheses */

export const HypothesisSchema = z.object({
  hypothesis_id: z.string(),
  statement: z.string(),
  prior: z.number().min(0).max(1),
  posterior: z.number().min(0).max(1),
  status: z.enum(['open', 'supported', 'refuted', 'budget-exhausted']),
  requests: z.array(
    z.object({
      request_id: z.string(),
      what: z.string(),
      source_id: z.string(),
      window: z.tuple([z.number(), z.number()]),
      state: z.enum(['queued', 'pulled', 'returned', 'unavailable']),
      delta: z.number().nullable(),
    }),
  ),
  evidence_ids: z.array(z.string()),
})
export type Hypothesis = z.infer<typeof HypothesisSchema>

/* ------------------------------------------------------------ authenticity */

export const AuthenticityReportSchema = z.object({
  evidence_id: z.string(),
  verdict: z.enum(['verified', 'consistent', 'inconsistent', 'unverifiable']),
  tests: z.array(
    z.object({
      test: z.string(),
      result: z.enum(['pass', 'fail', 'inconclusive']),
      detail: z.string(),
      standard: z.string().nullable(),
    }),
  ),
  hash: z.string(),
  device_signature: z.string().nullable(),
})
export type AuthenticityReport = z.infer<typeof AuthenticityReportSchema>

export const CustodyEntrySchema = z.object({
  t: z.number(),
  actor: z.string(),
  role: z.string(),
  action: z.enum(['capture', 'ingest', 'access', 'export', 'derive', 'hold', 'verify']),
  purpose: z.string(),
  hash_after: z.string(),
})
export type CustodyEntry = z.infer<typeof CustodyEntrySchema>

export const CustodyRecordSchema = z.object({
  evidence_id: z.string(),
  capture_signature: z.string(),
  chain: z.array(CustodyEntrySchema),
  hash_chain_valid: z.boolean(),
})
export type CustodyRecord = z.infer<typeof CustodyRecordSchema>

/* ----------------------------------------------------------------- entities */

export const EntityDossierSchema = z.object({
  entity_ref: z.string(),
  kind: z.enum(['vehicle', 'person', 'object']),
  descriptor: z.string(),
  /** Vehicles carry a hashed plate. Raw plates never leave the incident vault. */
  plate_hash: z.string().nullable(),
  appearance_strip: z.array(z.string()),
  path: z.array(z.object({ t: z.number(), lat: z.number(), lon: z.number(), source_id: z.string() })),
  prior_incidents: z.number().int(),
  investigation_flag: z.boolean(),
  first_seen: z.number(),
  last_seen: z.number(),
})
export type EntityDossier = z.infer<typeof EntityDossierSchema>

/* ------------------------------------------------------------- the bundle */

export const EvidenceTreeNodeSchema = z.object({
  evidence_id: z.string(),
  source_id: z.string(),
  source_type: SourceTypeSchema,
  label: z.string(),
  kind: z.enum(['keyframe', 'clip', 'audio', 'transcript', 'reading', 'report', 'record']),
  t_start: z.number(),
  t_end: z.number(),
  hash: z.string(),
  authenticity: z.enum(['verified', 'consistent', 'inconsistent', 'unverifiable']),
  bytes: z.number().int(),
  thumb_url: z.string().nullable(),
})
export type EvidenceTreeNode = z.infer<typeof EvidenceTreeNodeSchema>

export const ForensicsBundleSchema = z.object({
  incident_id: z.string(),
  window: z.tuple([z.number(), z.number()]),
  tree: z.array(EvidenceTreeNodeSchema),
  playback: z.array(PlaybackSourceSchema),
  ticks: z.array(TimelineEventTickSchema),
  timeline: z.array(TimelineEntrySchema),
  kinematics: z.array(TrackKinematicsSchema),
  conflicts: z.array(ConflictMetricSchema),
  causal: CausalGraphSchema,
  hypotheses: z.array(HypothesisSchema),
  authenticity: z.array(AuthenticityReportSchema),
  entities: z.array(EntityDossierSchema),
  investigation_flag: z.boolean(),
})
export type ForensicsBundle = z.infer<typeof ForensicsBundleSchema>
