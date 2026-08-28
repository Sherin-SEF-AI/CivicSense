import type { NextRequest } from 'next/server'
import { guard, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }) {
  const blocked = guard()
  if (blocked) return blocked
  const { incidentId } = await ctx.params
  const { getWorld, withMutations } = await import('@/lib/fixtures/world')
  const { buildForensics } = await import('@/lib/fixtures/forensics')
  const w = getWorld()
  const base = w.index.incidentById.get(incidentId)
  if (!base) return json('forensics-404', { error: 'not_found', incident_id: incidentId }, 404)

  const caseId = req.nextUrl.searchParams.get('case_id')
  const flag = caseId ? (w.index.caseById.get(caseId)?.investigation_flag ?? false) : false
  return json('forensics', buildForensics(w.seed, withMutations(w, base), w.sources, flag))
}
