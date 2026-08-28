import type { NextRequest } from 'next/server'
import { json, notFound } from '../../_lib/handler'
import { get } from '@/lib/db'
import { buildForensics } from '@/lib/store/forensics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await ctx.params
  const caseId = req.nextUrl.searchParams.get('case_id')
  const flagged =
    caseId !== null
      ? (get<{ investigation_flag: number }>('SELECT investigation_flag FROM cases WHERE case_id = ?', [caseId])
          ?.investigation_flag ?? 0) === 1
      : false

  const bundle = await buildForensics(incidentId, flagged)
  return bundle ? json(bundle) : notFound('incident', incidentId)
}
