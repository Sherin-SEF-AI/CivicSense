import { fixturesDisabled, json } from '../../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { id } = await ctx.params
  const { getWorld, withMutations } = await import('@/lib/fixtures/world')
  const { buildPackage } = await import('@/lib/fixtures/packages')
  const w = getWorld()
  const base = w.index.incidentById.get(id)
  if (!base) return json('package-404', { error: 'not_found', incident_id: id }, 404)
  return json('package', buildPackage(w.seed, withMutations(w, base), w.sources))
}
