import type { NextRequest } from 'next/server'
import { decodeCursor, json, list, num, session } from '../_lib/handler'
import { listIncidents } from '@/lib/store/incidents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = session(req)
  const q = req.nextUrl.searchParams

  const page = listIncidents({
    priority: list(q.get('priority')),
    domain: list(q.get('domain')),
    zone: list(q.get('zone')),
    sourceType: list(q.get('source_type')),
    status: list(q.get('status')),
    search: q.get('q') ?? undefined,
    includeClosed: q.get('include_closed') === '1',
    /* A department user is scoped to their own queue here, not in the client. */
    department: user.role === 'department' ? user.department : null,
    from: q.get('from') === null ? null : num(q.get('from'), 0),
    to: q.get('to') === null ? null : num(q.get('to'), 0),
    limit: num(q.get('limit'), 80),
    cursor: decodeCursor(q.get('cursor')),
  })

  return json({ items: page.items, next_cursor: page.nextCursor, total: page.total })
}
