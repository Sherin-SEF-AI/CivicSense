import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { attachEvidence, attachIncidents } from '@/lib/store/cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'case.create')
  if (denied) return denied

  const body = (await req.json()) as { evidence_ids?: string[]; incident_ids?: string[] }
  const shas = body.evidence_ids ?? []
  const incidents = body.incident_ids ?? []
  if (shas.length === 0 && incidents.length === 0) return badRequest('nothing_to_attach')

  let detail = shas.length > 0 ? attachEvidence(id, shas, user.name) : null
  if (incidents.length > 0) detail = attachIncidents(id, incidents, user.name)
  return detail ? json(detail) : notFound('case', id)
}
