import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { json, notFound, requires, session } from '../../../_lib/handler'
import { get, run } from '@/lib/db'
import { getSourceRow } from '@/lib/store/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Queues a calibration drift check.
 *
 * The check itself runs on the edge device, which compares the current frame
 * against its reference and reports back. This records the request and the run
 * state; the result arrives as a source event when the device answers.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const source = getSourceRow(id)
  if (!source) return notFound('source', id)

  const runId = `CAL-${randomUUID().slice(0, 8).toUpperCase()}`
  const now = Date.now()
  run('INSERT INTO calibration_runs (run_id, source_id, started_at, state, detail, residual_m) VALUES (?, ?, ?, ?, ?, ?)', [
    runId,
    id,
    now,
    'queued',
    source.stream_url
      ? `drift check requested against ${source.stream_url}`
      : 'drift check requested, this source has no stream configured so the device must report the result',
    null,
  ])
  run('INSERT INTO source_events (source_id, t, kind, detail) VALUES (?, ?, ?, ?)', [
    id,
    now,
    'calibration',
    `drift check queued by ${user.name}`,
  ])

  return json(
    {
      run_id: runId,
      source_id: id,
      started_at: now,
      state: 'queued' as const,
      detail: get<{ detail: string }>('SELECT detail FROM calibration_runs WHERE run_id = ?', [runId])?.detail ?? '',
      residual_m: null,
    },
    202,
  )
}
