import type { NextRequest } from 'next/server'
import { fixturesDisabled, json } from '../../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['ack', 'dispatch', 'escalate', 'resolve', 'dismiss'])

/**
 * Operator mutations. These are the only nondeterministic events in the fixture
 * world: they are held in a separate mutation log and applied on top of the
 * deterministic base, so the world stays reproducible while actions still stick.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { id, action } = await ctx.params
  if (!ACTIONS.has(action)) return json('action-400', { error: 'unknown_action', action }, 400)

  const { getWorld, withMutations } = await import('@/lib/fixtures/world')
  const { getHub } = await import('@/lib/fixtures/hub')
  const w = getWorld()
  const base = w.index.incidentById.get(id)
  if (!base) return json('action-404', { error: 'not_found', incident_id: id }, 404)

  const now = Date.now()
  let body: { reason?: string } = {}
  try {
    body = (await req.json()) as { reason?: string }
  } catch {
    body = {}
  }

  switch (action) {
    case 'ack':
      w.mutations.acks.set(id, now)
      break
    case 'dispatch':
      w.mutations.dispatches.set(id, now)
      break
    case 'escalate':
      w.mutations.escalations.set(id, now)
      break
    case 'resolve':
      w.mutations.resolutions.set(id, now)
      break
    case 'dismiss':
      if (!body.reason) return json('action-422', { error: 'reason_required' }, 422)
      w.mutations.dismissals.set(id, body.reason)
      break
  }

  const updated = withMutations(w, base)
  getHub().publish({ type: 'incident.updated', ts: now, payload: updated })
  return json('action', updated)
}
