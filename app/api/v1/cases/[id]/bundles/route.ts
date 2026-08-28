import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { RECIPIENT_CLASSES } from '@/lib/api/schemas/case'
import { createBundle } from '@/lib/store/cases'
import type { RecipientClass } from '@/lib/api/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'case.disclose')
  if (denied) return denied

  const body = (await req.json()) as { recipient_class?: string; recipient?: string }
  if (!body.recipient_class || !(RECIPIENT_CLASSES as readonly string[]).includes(body.recipient_class)) {
    return badRequest('invalid_recipient_class', RECIPIENT_CLASSES.join(', '))
  }
  if (!body.recipient?.trim()) return badRequest('recipient_required')

  const detail = createBundle(id, body.recipient_class as RecipientClass, body.recipient.trim(), user.name)
  return detail ? json(detail, 201) : notFound('case', id)
}
