import 'server-only'
import type { SensorKind, SensorSeries, SourceDevice } from '@/lib/api/schemas'
import { SENSOR_UNITS } from '@/lib/api/schemas/observation'
import { subSeed, valueNoise } from './rng'

/**
 * Sensor series are a pure function of time rather than stored points.
 *
 * Sixty sources at 1Hz over a day is five million samples, which is both slow to
 * generate and pointless to hold: any window at any resolution can be computed
 * on demand, is identical across requests, and costs only what is returned.
 */

const PROFILE: Record<SensorKind, { base: number; diurnal: number; ripple: number; noise: number; limit: number | null }> = {
  noise: { base: 58, diurnal: 9, ripple: 3.5, noise: 4, limit: 65 },
  pm25: { base: 44, diurnal: 18, ripple: 5, noise: 8, limit: 60 },
  pm10: { base: 82, diurnal: 30, ripple: 9, noise: 14, limit: 100 },
  'water-level': { base: 14, diurnal: 5, ripple: 2, noise: 3, limit: 45 },
  rain: { base: 1.2, diurnal: 2.4, ripple: 1.6, noise: 1.4, limit: 12 },
  'bin-fill': { base: 55, diurnal: 34, ripple: 4, noise: 5, limit: 90 },
  'loop-count': { base: 28, diurnal: 22, ripple: 8, noise: 6, limit: null },
  aqi: { base: 118, diurnal: 42, ripple: 12, noise: 18, limit: 200 },
}

const IST_OFFSET_MS = 5.5 * 3600_000
const TAU = Math.PI * 2

export function valueAt(seriesSeed: number, kind: SensorKind, t: number): number {
  const p = PROFILE[kind]
  const h = ((t + IST_OFFSET_MS) % 86400_000) / 3600_000
  const phase = (seriesSeed % 1000) / 1000
  const diurnal = Math.sin((TAU * (h - 4)) / 24 + phase * 0.8)
  const ripple = Math.sin((TAU * h) / 0.25 + phase * TAU)
  const noise = valueNoise(seriesSeed, t / 30_000) - 0.5
  const v = p.base + diurnal * p.diurnal + ripple * p.ripple + noise * p.noise * 2
  return Math.round(Math.max(0, v) * 10) / 10
}

/**
 * Downsamples to min/max buckets, which is exactly what the timeline's sparkline
 * renderer consumes: one column per pixel, independent of window length.
 */
export function seriesFor(
  seed: number,
  device: SourceDevice,
  from: number,
  to: number,
  maxBuckets = 800,
): SensorSeries {
  const kind = device.sensor_kind ?? 'noise'
  const seriesSeed = subSeed(seed, 'series', device.source_id.charCodeAt(4) + device.source_id.length)
  const span = Math.max(1000, to - from)
  const bucketMs = Math.max(1000, Math.ceil(span / maxBuckets))
  const buckets: [number, number, number][] = []
  const sampleStep = Math.max(1000, Math.floor(bucketMs / 8))
  for (let b = from; b < to; b += bucketMs) {
    let lo = Infinity
    let hi = -Infinity
    for (let t = b; t < Math.min(b + bucketMs, to); t += sampleStep) {
      const v = valueAt(seriesSeed, kind, t)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (lo === Infinity) {
      const v = valueAt(seriesSeed, kind, b)
      lo = v
      hi = v
    }
    buckets.push([b, lo, hi])
  }
  return {
    sensor_id: device.source_id,
    kind,
    unit: SENSOR_UNITS[kind],
    from,
    to,
    bucket_ms: bucketMs,
    buckets,
    limit: PROFILE[kind].limit,
    position: device.position,
    representativity_m: device.representativity_m ?? 100,
  }
}
