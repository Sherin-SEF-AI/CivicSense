import { z } from 'zod'

/**
 * Shared vocabulary. These enums mirror the backend's domain model exactly, so a
 * change here is a change to the API contract, not a UI detail.
 *
 * Every instant in the system is epoch milliseconds. The timeline, the master
 * clock and the fusion windows all do arithmetic on time, and ISO strings would
 * mean parsing on the hot path. Formatting to IST happens once, at the edge of
 * the render, in lib/format.
 */

export const DOMAINS = [
  'traffic',
  'waste',
  'safety',
  'nuisance',
  'infrastructure',
  'environment',
  'vehicle',
  'disaster',
] as const
export const DomainSchema = z.enum(DOMAINS)
export type Domain = z.infer<typeof DomainSchema>

/** Priority bands from the composite severity score. CSS >= 0.85 is CRITICAL. */
export const PRIORITY_BANDS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const
export const PriorityBandSchema = z.enum(PRIORITY_BANDS)
export type PriorityBand = z.infer<typeof PriorityBandSchema>

export const PRIORITY_THRESHOLDS: Record<PriorityBand, number> = {
  CRITICAL: 0.85,
  HIGH: 0.65,
  MEDIUM: 0.45,
  LOW: 0.25,
  INFO: 0,
}

export function bandForScore(score: number): PriorityBand {
  if (score >= PRIORITY_THRESHOLDS.CRITICAL) return 'CRITICAL'
  if (score >= PRIORITY_THRESHOLDS.HIGH) return 'HIGH'
  if (score >= PRIORITY_THRESHOLDS.MEDIUM) return 'MEDIUM'
  if (score >= PRIORITY_THRESHOLDS.LOW) return 'LOW'
  return 'INFO'
}

/** Clock alignment class. A under 10ms, B under 100ms, C under 1s, D unknown. */
export const SYNC_QUALITIES = ['A', 'B', 'C', 'D'] as const
export const SyncQualitySchema = z.enum(SYNC_QUALITIES)
export type SyncQuality = z.infer<typeof SyncQualitySchema>

export const SYNC_TOLERANCE_MS: Record<SyncQuality, number> = {
  A: 10,
  B: 100,
  C: 1000,
  D: Number.POSITIVE_INFINITY,
}

export const SOURCE_TYPES = [
  'cctv-fixed',
  'cctv-ptz',
  'patrol-car',
  'patrol-bike',
  'bodycam',
  'usb-cam',
  'phone',
  'drone',
  'sensor',
  'vehicle-bus',
] as const
export const SourceTypeSchema = z.enum(SOURCE_TYPES)
export type SourceType = z.infer<typeof SourceTypeSchema>

export const PRIVACY_CLASSES = [
  'public-space',
  'bodycam-sensitive',
  'consented',
  'non-personal',
  'operational',
] as const
export const PrivacyClassSchema = z.enum(PRIVACY_CLASSES)
export type PrivacyClass = z.infer<typeof PrivacyClassSchema>

export const INCIDENT_STATUSES = [
  'detected',
  'corroborated',
  'understood',
  'dispatched',
  'acknowledged',
  'resolved',
  'verified',
] as const
export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES)
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>

/** A value with the uncertainty the pipeline actually knows about. */
export const IntervalSchema = z.object({
  value: z.number(),
  lo: z.number(),
  hi: z.number(),
})
export type Interval = z.infer<typeof IntervalSchema>

export const LatLonSchema = z.object({ lat: z.number(), lon: z.number() })
export type LatLon = z.infer<typeof LatLonSchema>

/** Cursor pagination, identical in fixtures and in the real API. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
}
