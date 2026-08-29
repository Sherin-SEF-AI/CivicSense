import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { audit, get, run } from '@/lib/db'
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

/**
 * The device reporting back.
 *
 * This closes the loop the POST above opens. The device sends the homography it
 * solved and the residual error of that solution in metres, and until it does
 * the source cannot contribute a ground-plane measurement to anything.
 *
 * The residual is stored as reported and never improved on. Every speed and
 * every conflict metric derived from this source carries it, so a device that
 * reports an honest 3 metres produces indicative figures and a device that
 * reports a dishonest 0.1 produces confident ones. That is the reason the
 * residual is written into the audit trail alongside who supplied it.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const source = getSourceRow(id)
  if (!source) return notFound('source', id)

  const body = (await req.json()) as {
    run_id?: string
    homography?: { matrix?: number[] }
    residual_m?: number
    overlay?: { x: number; y: number; scale: number; layout: string } | null
  }

  const matrix = body.homography?.matrix
  if (!Array.isArray(matrix) || matrix.length !== 9 || matrix.some((n) => !Number.isFinite(n))) {
    return badRequest('invalid_homography', 'expected a nine element ground-plane matrix of finite numbers')
  }
  const residual = Number(body.residual_m)
  if (!Number.isFinite(residual) || residual < 0) {
    return badRequest('invalid_residual', 'the solution residual in metres is required and cannot be negative')
  }

  const now = Date.now()

  /* Where the recorder burns its clock. Optional, and its absence has a stated
     consequence: without it the recorder's own clock cannot be read, and frames
     removed from a quiet scene are not detectable from the picture alone. */
  if (body.overlay !== undefined) {
    if (body.overlay === null) {
      run('UPDATE sources SET overlay = NULL WHERE source_id = ?', [id])
    } else {
      const { x, y, scale, layout } = body.overlay
      if (![x, y, scale].every((v) => Number.isInteger(v) && v >= 0)) {
        return badRequest('invalid_overlay', 'x, y and scale are non negative integers in pixels')
      }
      if (!/^[#\-: ]+$/.test(layout)) {
        return badRequest(
          'invalid_overlay_layout',
          'the layout marks digit cells with # and gives separators literally, for example ####-##-## ##:##:##',
        )
      }
      run('UPDATE sources SET overlay = ? WHERE source_id = ?', [JSON.stringify({ x, y, scale, layout }), id])
    }
  }

  run('UPDATE sources SET homography = ?, calibration_residual_m = ?, calibrated_at = ? WHERE source_id = ?', [
    JSON.stringify({ matrix }),
    residual,
    now,
    id,
  ])
  if (body.run_id) {
    run('UPDATE calibration_runs SET state = ?, residual_m = ?, detail = ? WHERE run_id = ? AND source_id = ?', [
      'complete',
      residual,
      `solved with a residual of ${residual.toFixed(2)} m`,
      body.run_id,
      id,
    ])
  }
  run('INSERT INTO source_events (source_id, t, kind, detail) VALUES (?, ?, ?, ?)', [
    id,
    now,
    'calibration',
    `homography reported with a residual of ${residual.toFixed(2)} m`,
  ])
  audit(user.name, 'source.calibrated', `source:${id}`, `residual ${residual.toFixed(2)} m`)

  return json({
    source_id: id,
    calibrated_at: now,
    residual_m: residual,
    /* Anything above this and the platform will only ever call a derived speed
       indicative, which is worth saying at the moment of calibration. */
    measurement_capable: residual <= 1.5,
    overlay_recorded: body.overlay !== undefined && body.overlay !== null,
    clock_readable:
      body.overlay !== undefined && body.overlay !== null
        ? 'the recorder clock can be read from the picture, so a gap in the recording is detectable'
        : 'no overlay position is recorded, so the recorder clock cannot be read and frames removed from a quiet scene would not be detectable',
  })
}
