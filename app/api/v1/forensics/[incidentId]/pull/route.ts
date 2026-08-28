import type { NextRequest } from 'next/server'
import { guard, json } from '../../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A bounded evidence pull: the investigator selects a range on the deck and asks
 * for more from the edge ring buffer, or for that range to be re-analysed. The
 * response reports what the request cost, because the budget is the reason the
 * investigation loop terminates.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }) {
  const blocked = guard()
  if (blocked) return blocked
  const { incidentId } = await ctx.params
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  if (!w.index.incidentById.get(incidentId)) {
    return json('pull-404', { error: 'not_found', incident_id: incidentId }, 404)
  }
  const body = (await req.json()) as { from: number; to: number; source_ids?: string[]; kind?: 'clip' | 'reanalysis' }
  const span = Math.max(0, body.to - body.from)
  const sources = body.source_ids ?? []
  const kind = body.kind ?? 'clip'
  return json('pull', {
    request_id: `RQ-${Date.now()}`,
    incident_id: incidentId,
    kind,
    window: [body.from, body.to],
    source_ids: sources,
    state: 'queued' as const,
    estimated_bytes: Math.round((span / 1000) * 380_000 * Math.max(1, sources.length)),
    estimated_cost_usd: kind === 'reanalysis' ? Math.round(((span / 60_000) * 0.014 + 0.006) * 10000) / 10000 : 0,
    budget_remaining_usd: Math.round((w.spend.budget_usd - w.spend.today_usd) * 100) / 100,
  })
}
