import type { NextRequest } from 'next/server'
import type { IncidentSummary } from '@/lib/api/schemas'
import { decodeCursor, encodeCursor, fixturesDisabled, json, list, num } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld, liveIncidents } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const q = req.nextUrl.searchParams

  const priorities = new Set(list(q.get('priority')))
  const domains = new Set(list(q.get('domain')))
  const zones = new Set(list(q.get('zone')))
  const sourceTypes = new Set(list(q.get('source_type')))
  const statuses = new Set(list(q.get('status')))
  const from = q.get('from') === null ? null : num(q.get('from'), 0)
  const to = q.get('to') === null ? null : num(q.get('to'), 0)
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(200, Math.max(1, num(q.get('limit'), 60)))
  const includeClosed = q.get('include_closed') === '1'

  const matches = (i: IncidentSummary): boolean => {
    if (i.dismissed_reason !== null && !includeClosed) return false
    if (!includeClosed && (i.status === 'resolved' || i.status === 'verified')) return false
    if (priorities.size > 0 && !priorities.has(i.priority)) return false
    if (domains.size > 0 && !domains.has(i.domain)) return false
    if (zones.size > 0 && !zones.has(i.zone_id)) return false
    if (statuses.size > 0 && !statuses.has(i.status)) return false
    if (sourceTypes.size > 0 && !i.source_types.some((s) => sourceTypes.has(s))) return false
    if (from !== null && i.detected_at < from) return false
    if (to !== null && i.detected_at > to) return false
    if (search && !i.title.toLowerCase().includes(search) && !i.incident_id.toLowerCase().includes(search)) return false
    return true
  }

  const all = liveIncidents(w).filter(matches)
  const cursor = decodeCursor(q.get('cursor'))
  const start = cursor === null ? 0 : all.findIndex((i) => i.detected_at < cursor.t || (i.detected_at === cursor.t && i.incident_id < cursor.id))
  const from_ = start < 0 ? all.length : start
  const items = all.slice(from_, from_ + limit)
  const last = items[items.length - 1]

  return json('incidents', {
    items,
    next_cursor: from_ + limit < all.length && last ? encodeCursor(last.detected_at, last.incident_id) : null,
    total: all.length,
  })
}
