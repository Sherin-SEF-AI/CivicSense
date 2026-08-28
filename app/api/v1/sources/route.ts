import type { NextRequest } from 'next/server'
import { guard, json, list } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = guard()
  if (blocked) return blocked
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const q = req.nextUrl.searchParams
  const types = new Set(list(q.get('type')))
  const states = new Set(list(q.get('state')))
  const zones = new Set(list(q.get('zone')))
  const search = (q.get('q') ?? '').trim().toLowerCase()

  const items = w.sources.filter((s) => {
    if (types.size > 0 && !types.has(s.source_type)) return false
    if (states.size > 0 && !states.has(s.state)) return false
    if (zones.size > 0 && !zones.has(s.zone_id)) return false
    if (search && !s.label.toLowerCase().includes(search) && !s.source_id.toLowerCase().includes(search)) return false
    return true
  })
  return json('sources', { items, next_cursor: null, total: items.length })
}
