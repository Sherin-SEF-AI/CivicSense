import { z } from 'zod'
import {
  LatLonSchema,
  PrivacyClassSchema,
  SourceTypeSchema,
  SyncQualitySchema,
} from './common'

/**
 * The Unified Observation Model. Every adapter emits these and nothing else
 * enters the platform, so the client can render a bodycam frame, a bin-fill
 * reading and a CAN signal through one code path.
 */

export const PAYLOAD_KINDS = [
  'detection_track',
  'keyframe',
  'clip',
  'audio_segment',
  'sensor_reading',
  'vehicle_signal',
  'report_text',
  'external_record',
] as const
export const PayloadKindSchema = z.enum(PAYLOAD_KINDS)
export type PayloadKind = z.infer<typeof PayloadKindSchema>

export const PoseSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  heading_deg: z.number().nullable(),
  fov_deg: z.number().nullable(),
  range_m: z.number().nullable(),
  pose_source: z.enum(['fixed_calibration', 'gnss_imu', 'phone_gnss', 'none']),
  accuracy_m: z.number(),
})
export type Pose = z.infer<typeof PoseSchema>

export const QualitySchema = z.object({
  blur: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  occlusion: z.number().min(0).max(1),
  tamper: z.boolean(),
  valid: z.boolean(),
})
export type ObservationQuality = z.infer<typeof QualitySchema>

export const ObservationSchema = z.object({
  observation_id: z.string(),
  source: z.object({
    source_id: z.string(),
    source_type: SourceTypeSchema,
    owner: z.string(),
    trust_score: z.number().min(0).max(1),
  }),
  capture: z.object({
    t_start: z.number(),
    t_end: z.number(),
    sync_quality: SyncQualitySchema,
    clock_offset_ms: z.number(),
  }),
  pose: PoseSchema,
  /** H3 cells this observation can legitimately speak about. */
  coverage_cells: z.array(z.string()),
  payload_kind: PayloadKindSchema,
  content_ref: z.string().nullable(),
  content_meta: z
    .object({
      codec: z.string(),
      width: z.number().int(),
      height: z.number().int(),
      fps: z.number(),
      duration_ms: z.number(),
      bytes: z.number().int(),
    })
    .nullable(),
  derived: z.object({
    classes: z.array(z.string()),
    counts: z.record(z.string(), z.number()),
    trigger: z.string().nullable(),
  }),
  quality: QualitySchema,
  provenance: z.object({
    hash: z.string(),
    device_signature: z.string().nullable(),
    adapter_version: z.string(),
  }),
  privacy_class: PrivacyClassSchema,
  retention_class: z.enum(['edge-30d', 'incident-2y', 'analytics-5y', 'aggregate-permanent']),
})
export type Observation = z.infer<typeof ObservationSchema>

export const SENSOR_KINDS = [
  'noise',
  'pm25',
  'pm10',
  'water-level',
  'rain',
  'bin-fill',
  'loop-count',
  'aqi',
] as const
export const SensorKindSchema = z.enum(SENSOR_KINDS)
export type SensorKind = z.infer<typeof SensorKindSchema>

export const SENSOR_UNITS: Record<SensorKind, string> = {
  noise: 'dB(A)',
  pm25: 'ug/m3',
  pm10: 'ug/m3',
  'water-level': 'cm',
  rain: 'mm/h',
  'bin-fill': '%',
  'loop-count': 'veh/min',
  aqi: 'AQI',
}

export const SensorReadingSchema = z.object({
  t: z.number(),
  v: z.number(),
})
export type SensorReading = z.infer<typeof SensorReadingSchema>

/**
 * Downsampled series. The server buckets to min/max pairs so the timeline can
 * draw one column per pixel regardless of how long the window is.
 */
export const SensorSeriesSchema = z.object({
  sensor_id: z.string(),
  kind: SensorKindSchema,
  unit: z.string(),
  from: z.number(),
  to: z.number(),
  bucket_ms: z.number(),
  /** [t, min, max] triples. */
  buckets: z.array(z.tuple([z.number(), z.number(), z.number()])),
  limit: z.number().nullable(),
  position: LatLonSchema,
  representativity_m: z.number(),
})
export type SensorSeries = z.infer<typeof SensorSeriesSchema>
