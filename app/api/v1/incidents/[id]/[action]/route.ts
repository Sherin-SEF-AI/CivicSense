import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { applyAction, type IncidentAction } from '@/lib/store/incidents'
import { publish } from '@/lib/events/bus'
import type { Capability } from '@/lib/api/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAPABILITY: Record<IncidentAction, Capability> = {
  ack: 'incident.acknowledge',
  dispatch: 'incident.dispatch',
  escalate: 'incident.escalate',
  resolve: 'incident.acknowledge',
  dismiss: 'incident.dismiss',
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params
  if (!(action in CAPABILITY)) return badRequest('unknown_action', action)

  const user = session(req)
  const denied = requires(user, CAPABILITY[action as IncidentAction])
  if (denied) return denied

  let body: { reason?: string } = {}
  try {
    body = (await req.json()) as { reason?: string }
  } catch {
    body = {}
  }
  if (action === 'dismiss' && !body.reason) {
    return badRequest('reason_required', 'a dismissal reason feeds the trigger thresholds and is required')
  }

  const updated = applyAction(id, action as IncidentAction, user.name, body.reason)
  if (!updated) return notFound('incident', id)

  publish({ type: 'incident.updated', ts: Date.now(), payload: updated })
  return json(updated)
}
