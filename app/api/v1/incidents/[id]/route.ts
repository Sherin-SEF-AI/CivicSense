import { json, notFound } from '../../_lib/handler'
import { getIncident } from '@/lib/store/incidents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const incident = getIncident(id)
  return incident ? json(incident) : notFound('incident', id)
}
