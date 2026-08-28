import type { NextRequest } from 'next/server'
import { fixturesDisabled, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { id } = await ctx.params
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const found = w.index.caseById.get(id)
  if (!found) return json('case-404', { error: 'not_found', case_id: id }, 404)
  return json('case', found)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { id } = await ctx.params
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  const found = w.index.caseById.get(id)
  if (!found) return json('case-404', { error: 'not_found', case_id: id }, 404)
  const patch = (await req.json()) as Partial<{
    legal_hold: boolean
    investigation_flag: boolean
    state: typeof found.state
    note: string
  }>
  if (patch.legal_hold !== undefined) found.legal_hold = patch.legal_hold
  if (patch.investigation_flag !== undefined) found.investigation_flag = patch.investigation_flag
  if (patch.state !== undefined) found.state = patch.state
  if (patch.note) {
    found.notes = [
      ...found.notes,
      { note_id: `NOTE-${Date.now()}`, t: Date.now(), author: 'S. Srambickal', text: patch.note, evidence_ids: [] },
    ]
  }
  found.updated_at = Date.now()
  return json('case-patch', found)
}
