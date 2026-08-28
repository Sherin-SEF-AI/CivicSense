import type { NextRequest } from 'next/server'
import type { Domain } from '@/lib/api/schemas'
import { DomainSchema } from '@/lib/api/schemas/common'
import { guard, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = guard()
  if (blocked) return blocked
  const { getWorld } = await import('@/lib/fixtures/world')
  const { buildRisk } = await import('@/lib/fixtures/predict')
  const w = getWorld()
  const q = req.nextUrl.searchParams
  const parsed = DomainSchema.safeParse(q.get('domain'))
  const domain: Domain | null = parsed.success ? parsed.data : null
  const h = Number(q.get('horizon') ?? 6)
  const horizon = h === 1 || h === 6 || h === 24 ? (h as 1 | 6 | 24) : 6
  return json('risk', buildRisk(w.seed, Date.now(), domain, horizon))
}
