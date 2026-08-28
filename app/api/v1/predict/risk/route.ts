import type { NextRequest } from 'next/server'
import { json, num } from '../../_lib/handler'
import { DomainSchema } from '@/lib/api/schemas/common'
import { riskSurface } from '@/lib/store/predict'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const parsed = DomainSchema.safeParse(q.get('domain'))
  const domain = parsed.success ? parsed.data : null
  const h = num(q.get('horizon'), 6)
  const horizon = h === 1 || h === 6 || h === 24 ? (h as 1 | 6 | 24) : 6

  return json({
    domain,
    horizon_h: horizon,
    generated_at: Date.now(),
    resolution: 8,
    cells: riskSurface(domain, horizon),
  })
}
