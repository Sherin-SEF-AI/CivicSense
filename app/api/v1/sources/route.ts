import type { NextRequest } from 'next/server'
import { fixturesDisabled, json, list } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const q = req.nextUrl.searchParams
  const types = new Set(list(q.get('type')))
  const states = new Set(list(q.get('state')))
  const zones = new Set(list(q.get('zone')))
  const search = (q.get('q') ?? '').trim().toLowerCase()

  /* last_observation_at is a live field. The world only advances it for vehicles
     on the ticker, so healthy sources are refreshed here rather than appearing
     to have gone quiet for as long as the server has been running. */
  const now = Date.now()
  for (const source of w.sources) {
    if (source.state === 'up') {
      source.last_observation_at = now - ((source.source_id.charCodeAt(4) * 137) % 9000)
    } else if (source.state === 'degraded') {
      source.last_observation_at = now - 20_000 - ((source.source_id.charCodeAt(4) * 911) % 90_000)
    }
  }

  const items = w.sources.filter((s) => {
    if (types.size > 0 && !types.has(s.source_type)) return false
    if (states.size > 0 && !states.has(s.state)) return false
    if (zones.size > 0 && !zones.has(s.zone_id)) return false
    if (search && !s.label.toLowerCase().includes(search) && !s.source_id.toLowerCase().includes(search)) return false
    return true
  })
  return json('sources', { items, next_cursor: null, total: items.length })
}
