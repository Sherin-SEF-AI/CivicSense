import type { NextRequest } from 'next/server'
import { json, notFound } from '../../_lib/handler'
import { get, run } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!get('SELECT 1 FROM saved_searches WHERE saved_search_id = ?', [id])) return notFound('saved search', id)
  const patch = (await req.json()) as { rerun_on_new_evidence?: boolean; name?: string }
  if (patch.rerun_on_new_evidence !== undefined) {
    run('UPDATE saved_searches SET rerun_on_new_evidence = ? WHERE saved_search_id = ?', [
      patch.rerun_on_new_evidence ? 1 : 0,
      id,
    ])
  }
  if (patch.name !== undefined) run('UPDATE saved_searches SET name = ? WHERE saved_search_id = ?', [patch.name, id])
  const row = get<Record<string, unknown> & { rerun_on_new_evidence: number }>(
    'SELECT * FROM saved_searches WHERE saved_search_id = ?',
    [id],
  )!
  return json({ ...row, rerun_on_new_evidence: row.rerun_on_new_evidence === 1 })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!get('SELECT 1 FROM saved_searches WHERE saved_search_id = ?', [id])) return notFound('saved search', id)
  run('DELETE FROM saved_searches WHERE saved_search_id = ?', [id])
  return json({ deleted: id })
}
