import type { NextRequest } from 'next/server'
import { json, notFound, num } from '../../../_lib/handler'
import { getSourceRow } from '@/lib/store/sources'
import { sensorSeries } from '@/lib/store/observations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIMITS: Record<string, number> = {
  noise: 55,
  pm25: 60,
  pm10: 100,
  'water-level': 45,
  'bin-fill': 90,
  aqi: 200,
  rain: 12,
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const source = getSourceRow(id)
  if (!source || source.source_type !== 'sensor') return notFound('sensor', id)

  const now = Date.now()
  const q = req.nextUrl.searchParams
  const from = num(q.get('from'), now - 6 * 3600_000)
  const to = num(q.get('to'), now)
  const buckets = Math.min(2000, Math.max(50, num(q.get('buckets'), 800)))

  const series = sensorSeries(id, from, to, buckets)
  const kind = source.sensor_kind ?? 'noise'

  return json({
    sensor_id: id,
    kind,
    unit: series.unit || '',
    from,
    to,
    bucket_ms: series.bucketMs,
    buckets: series.buckets,
    limit: LIMITS[kind] ?? null,
    position: { lat: source.lat, lon: source.lon },
    representativity_m: source.representativity_m ?? 100,
  })
}
