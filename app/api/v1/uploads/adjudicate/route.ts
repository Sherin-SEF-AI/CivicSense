import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../_lib/handler'
import { adjudicate } from '@/lib/store/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A person ruling on what a model proposed.
 *
 * This is the only path by which uploaded material becomes an incident. The
 * capability required is the one for opening an incident, not the one for
 * uploading, because those are different acts with different consequences and
 * the person who hands a file over is often not the person who should decide
 * what it means.
 */
export async function POST(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'incident.acknowledge')
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as {
    detection_id?: string
    decision?: string
    note?: string
  } | null

  if (!body?.detection_id) return badRequest('detection_id_required')
  if (body.decision !== 'confirmed' && body.decision !== 'rejected') {
    return badRequest('decision_required', 'confirmed or rejected')
  }
  const note = (body.note ?? '').trim()
  if (note.length < 10) {
    /* An adjudication with no reasoning is a click. The record has to carry why
       a person decided a model's reading of eight frames was, or was not, an
       incident. */
    return badRequest('note_required', 'say briefly why, so the record carries the reasoning and not just the outcome')
  }

  const result = adjudicate({ detection_id: body.detection_id, decision: body.decision, note, actor: user.name })
  if (!result) return notFound('detection', body.detection_id)

  return json({
    ...result,
    note:
      result.incident_id !== null
        ? 'an incident was opened. it began as a model reading sampled frames and is attributed to the person who confirmed it.'
        : 'recorded. no incident was opened.',
  })
}
