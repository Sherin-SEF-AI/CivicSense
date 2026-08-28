import type { NextRequest } from 'next/server'
import { json, notFound, requires, session } from '../../../_lib/handler'
import { pullRequest } from '@/lib/store/hypotheses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Pulls the retrieval and moves the posteriors by what came back. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'forensics.reanalyse')
  if (denied) return denied

  const updated = pullRequest(requestId, user.name)
  return updated ? json(updated) : notFound('retrieval request', requestId)
}
