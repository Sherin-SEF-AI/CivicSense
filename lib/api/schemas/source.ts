import { z } from 'zod'
import { LatLonSchema, PrivacyClassSchema, SourceTypeSchema, SyncQualitySchema } from './common'
import { SensorKindSchema } from './observation'

export const SOURCE_STATES = ['up', 'degraded', 'down', 'maintenance'] as const
export const SourceStateSchema = z.enum(SOURCE_STATES)
export type SourceState = z.infer<typeof SourceStateSchema>

export const SourceDeviceSchema = z.object({
  source_id: z.string(),
  source_type: SourceTypeSchema,
  label: z.string(),
  site: z.string(),
  zone_id: z.string(),
  zone_label: z.string(),
  position: LatLonSchema,
  heading_deg: z.number().nullable(),
  fov_deg: z.number().nullable(),
  range_m: z.number().nullable(),
  state: SourceStateSchema,
  uptime_7d: z.number().min(0).max(1),
  sync_quality: SyncQualitySchema,
  calibrated_at: z.number().nullable(),
  calibration_residual_m: z.number().nullable(),
  trust: z.number().min(0).max(1),
  trust_components: z.object({
    attestation: z.number().min(0).max(1),
    calibration_recency: z.number().min(0).max(1),
    learned_precision: z.number().min(0).max(1),
    quality: z.number().min(0).max(1),
  }),
  last_observation_at: z.number(),
  firmware: z.string(),
  edge_device: z.string().nullable(),
  privacy_class: PrivacyClassSchema,
  sensor_kind: SensorKindSchema.nullable(),
  representativity_m: z.number().nullable(),
  thumb_url: z.string().nullable(),
  /** Vehicle sources report a live pose and a recent trail. */
  trail: z.array(z.object({ t: z.number(), lat: z.number(), lon: z.number(), heading: z.number() })),
})
export type SourceDevice = z.infer<typeof SourceDeviceSchema>

export const SourceHealthPointSchema = z.object({
  t: z.number(),
  uptime: z.number().min(0).max(1),
  fps: z.number(),
  drops: z.number(),
  latency_ms: z.number(),
})
export type SourceHealthPoint = z.infer<typeof SourceHealthPointSchema>

export const SourceDetailSchema = z.object({
  device: SourceDeviceSchema,
  health: z.array(SourceHealthPointSchema),
  events: z.array(
    z.object({
      t: z.number(),
      kind: z.enum(['up', 'down', 'degraded', 'calibration', 'ota', 'tamper', 'moved']),
      detail: z.string(),
    }),
  ),
  homography_residuals: z.array(z.object({ point: z.string(), residual_m: z.number() })),
})
export type SourceDetail = z.infer<typeof SourceDetailSchema>

export const ZoneSchema = z.object({
  zone_id: z.string(),
  label: z.string(),
  kind: z.enum([
    'school',
    'hospital',
    'market',
    'residential',
    'industrial',
    'religious',
    'transit-hub',
    'highway',
  ]),
  sensitivity: z.number().min(0).max(1),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  centroid: LatLonSchema,
  adjacency: z.array(z.string()),
})
export type Zone = z.infer<typeof ZoneSchema>
