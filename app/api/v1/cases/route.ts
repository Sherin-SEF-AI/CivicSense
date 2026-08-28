import type { NextRequest } from 'next/server'
import { guard, json } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = guard()
  if (blocked) return blocked
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const search = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  const items = w.cases
    .filter((c) => !search || c.title.toLowerCase().includes(search) || c.reference.toLowerCase().includes(search))
    .map(({ incident_ids: _i, evidence_ids: _e, notes: _n, tasks: _t, bundles: _b, exports: _x, certificate: _c, ...summary }) => summary)
  return json('cases', { items, next_cursor: null, total: items.length })
}

export async function POST(req: NextRequest) {
  const blocked = guard()
  if (blocked) return blocked
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const body = (await req.json()) as { title?: string; incident_ids?: string[] }
  const now = Date.now()
  const created = {
    case_id: `CASE-${String(w.cases.length + 1).padStart(3, '0')}`,
    reference: `CS/2026/${1200 + w.cases.length * 7}`,
    title: body.title ?? 'untitled case',
    state: 'open' as const,
    opened_at: now,
    owner: 'S. Srambickal',
    incident_count: body.incident_ids?.length ?? 0,
    evidence_count: 0,
    evidence_bytes: 0,
    legal_hold: false,
    investigation_flag: false,
    updated_at: now,
    incident_ids: body.incident_ids ?? [],
    evidence_ids: [],
    notes: [],
    tasks: [],
    bundles: [],
    exports: [],
    certificate: null,
  }
  w.cases.unshift(created)
  w.index.caseById.set(created.case_id, created)
  return json('case-create', created, 201)
}
