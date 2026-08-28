import type { NextRequest } from 'next/server'
import { fixturesDisabled, json, list } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const q = req.nextUrl.searchParams
  const levels = new Set(list(q.get('level')))
  const domains = new Set(list(q.get('domain')))
  const horizon = q.get('horizon')
  const items = w.warnings.filter((x) => {
    if (levels.size > 0 && !levels.has(x.level)) return false
    if (domains.size > 0 && !domains.has(x.domain)) return false
    if (horizon && String(x.horizon_h) !== horizon) return false
    return true
  }).map((x) => (w.mutations.warningAcks.has(x.warning_id) ? { ...x, acknowledged: true } : x))
  return json('warnings', { items, outcomes: w.outcomes, total: items.length })
}
