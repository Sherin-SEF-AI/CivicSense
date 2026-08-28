import type { NextRequest } from 'next/server'
import { json, notFound, requires, session } from '../../_lib/handler'
import { deleteSource, sourceDetail } from '@/lib/store/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const detail = sourceDetail(id)
  return detail ? json(detail) : notFound('source', id)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied
  return deleteSource(id, user.name) ? json({ deleted: id }) : notFound('source', id)
}
