import type { Zone } from '@/lib/api/schemas'
import { guard, json } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = guard()
  if (blocked) return blocked
  const { ZONE_SEEDS } = await import('@/lib/geo/bengaluru')
  const { zonePolygon, subSeed } = await import('@/lib/geo/build')
  const { WORLD_SEED } = await import('@/lib/fixtures/world')

  const items: Zone[] = ZONE_SEEDS.map((z, i) => ({
    zone_id: z.id,
    label: z.label,
    kind: z.kind,
    sensitivity: z.sensitivity,
    polygon: zonePolygon(z.center[0], z.center[1], z.radius, subSeed(WORLD_SEED, 'zone', i)),
    centroid: { lat: z.center[1], lon: z.center[0] },
    adjacency: ZONE_SEEDS.filter(
      (o) => o.id !== z.id && Math.hypot(o.center[0] - z.center[0], o.center[1] - z.center[1]) < 0.05,
    ).map((o) => o.id),
  }))
  return json('zones', { items, total: items.length })
}
