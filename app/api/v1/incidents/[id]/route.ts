import { fixturesDisabled, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { id } = await ctx.params
  const { getWorld, withMutations } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const base = w.index.incidentById.get(id)
  if (!base) return json('incident-404', { error: 'not_found', incident_id: id }, 404)
  return json('incident', withMutations(w, base))
}
