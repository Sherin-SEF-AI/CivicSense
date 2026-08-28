import type { NextRequest } from 'next/server'
import { json, notFound, requires, session } from '../../_lib/handler'
import { getCase, patchCase } from '@/lib/store/cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const detail = getCase(id)
  return detail ? json(detail) : notFound('case', id)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)

  const patch = (await req.json()) as {
    legal_hold?: boolean
    investigation_flag?: boolean
    state?: string
    note?: string
    title?: string
  }

  if (patch.legal_hold !== undefined) {
    const denied = requires(user, 'case.legal_hold')
    if (denied) return denied
  }
  if (patch.investigation_flag !== undefined) {
    /* Authorising person search is an administrator decision, and it is logged. */
    const denied = requires(user, 'admin.configure')
    if (denied) return denied
  }

  const updated = patchCase(id, patch, user.name)
  return updated ? json(updated) : notFound('case', id)
}
