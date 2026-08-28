import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { badRequest, json, session } from '../_lib/handler'
import { all, run } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return json({
    items: all(
      'SELECT saved_search_id, name, query, created_at, rerun_on_new_evidence, last_run_at, new_hits FROM saved_searches ORDER BY created_at DESC',
    ).map((r) => {
      const row = r as { rerun_on_new_evidence: number } & Record<string, unknown>
      return { ...row, rerun_on_new_evidence: row.rerun_on_new_evidence === 1 }
    }),
  })
}

export async function POST(req: NextRequest) {
  session(req)
  const body = (await req.json()) as { name?: string; query?: string; rerun?: boolean }
  if (!body.query?.trim()) return badRequest('query_required')

  const now = Date.now()
  const record = {
    saved_search_id: `SS-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: body.name?.trim() || body.query.trim().slice(0, 64),
    query: body.query.trim(),
    created_at: now,
    rerun_on_new_evidence: body.rerun ?? true,
    last_run_at: now,
    new_hits: 0,
  }
  run(
    'INSERT INTO saved_searches (saved_search_id, name, query, created_at, rerun_on_new_evidence, last_run_at, new_hits) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [record.saved_search_id, record.name, record.query, now, record.rerun_on_new_evidence ? 1 : 0, now],
  )
  return json(record, 201)
}
