import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { setCertificate } from '@/lib/store/cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'case.disclose')
  if (denied) return denied

  const body = (await req.json()) as { issued_by?: string; role?: string; device_particulars?: string }
  if (!body.issued_by?.trim()) return badRequest('issued_by_required')

  const detail = setCertificate(
    id,
    {
      issued_by: body.issued_by.trim(),
      role: body.role?.trim() || 'person in charge of the computer output',
      device_particulars: body.device_particulars?.trim() || '',
    },
    user.name,
  )
  return detail ? json(detail, 201) : notFound('case', id)
}
