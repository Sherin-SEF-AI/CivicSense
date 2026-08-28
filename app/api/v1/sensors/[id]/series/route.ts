import type { NextRequest } from 'next/server'
import { guard, json, num } from '../../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guard()
  if (blocked) return blocked
  const { id } = await ctx.params
  const { getWorld } = await import('@/lib/fixtures/world')
  const { seriesFor } = await import('@/lib/fixtures/sensors')
  const w = getWorld()
  const device = w.index.sourceById.get(id)
  if (!device || device.source_type !== 'sensor') {
    return json('series-404', { error: 'not_found', sensor_id: id }, 404)
  }
  const now = Date.now()
  const q = req.nextUrl.searchParams
  const from = num(q.get('from'), now - 6 * 3600_000)
  const to = num(q.get('to'), now)
  const buckets = Math.min(2000, Math.max(50, num(q.get('buckets'), 800)))
  return json('series', seriesFor(w.seed, device, from, to, buckets))
}
