import type { SourceDetail } from '@/lib/api/schemas'
import { guard, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guard()
  if (blocked) return blocked
  const { id } = await ctx.params
  const { getWorld } = await import('@/lib/fixtures/world')
  const { mulberry32, subSeed, intRange, range, pick } = await import('@/lib/fixtures/rng')
  const w = getWorld()
  const device = w.index.sourceById.get(id)
  if (!device) return json('source-404', { error: 'not_found', source_id: id }, 404)

  const rnd = mulberry32(subSeed(w.seed, 'sourcedetail', id.length + id.charCodeAt(4)))
  const now = Date.now()
  const health = Array.from({ length: 96 }, (_, i) => {
    const t = now - (95 - i) * 15 * 60_000
    const dip = device.state === 'up' ? 1 : i > 70 ? 0.4 : 0.95
    return {
      t,
      uptime: Math.round(Math.min(1, dip * range(rnd, 0.94, 1)) * 1000) / 1000,
      fps: Math.round(range(rnd, 22, 25.2) * 10) / 10,
      drops: Math.round(range(rnd, 0, 6)),
      latency_ms: Math.round(range(rnd, 40, 260)),
    }
  })

  const detail: SourceDetail = {
    device,
    health,
    events: Array.from({ length: intRange(rnd, 3, 9) }, () => ({
      t: now - intRange(rnd, 1, 240) * 3600_000,
      kind: pick(rnd, ['up', 'down', 'degraded', 'calibration', 'ota', 'tamper', 'moved'] as const),
      detail: pick(rnd, [
        'stream reconnected after a network drop',
        'frame rate below threshold for 4 minutes',
        'calibration drift check passed, residuals within tolerance',
        'model package rolled out and verified',
        'camera moved: reference feature match below threshold',
        'store and forward queue drained after connectivity returned',
      ]),
    })).sort((a, b) => b.t - a.t),
    homography_residuals:
      device.calibration_residual_m === null
        ? []
        : Array.from({ length: 4 }, (_, i) => ({
            point: `GCP-${i + 1}`,
            residual_m: Math.round(range(rnd, 0.02, device.calibration_residual_m! * 1.6) * 100) / 100,
          })),
  }
  return json('source-detail', detail)
}
