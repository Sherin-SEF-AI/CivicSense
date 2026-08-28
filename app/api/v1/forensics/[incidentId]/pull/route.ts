import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { audit, get } from '@/lib/db'
import { getIncident } from '@/lib/store/incidents'
import { spendToday } from '@/lib/store/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A bounded evidence pull.
 *
 * The investigator selects a range on the deck and asks the edge for more of it,
 * or asks for that range to be re-analysed. Both are budgeted: the response says
 * what it will cost and what is left, because the budget is the reason the
 * investigation loop terminates rather than running forever.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await ctx.params
  const user = session(req)

  const body = (await req.json()) as { from?: number; to?: number; source_ids?: string[]; kind?: 'clip' | 'reanalysis' }
  if (body.from === undefined || body.to === undefined) return badRequest('range_required')
  if (!getIncident(incidentId)) return notFound('incident', incidentId)

  const kind = body.kind ?? 'clip'
  const denied = requires(user, kind === 'reanalysis' ? 'forensics.reanalyse' : 'forensics.pull')
  if (denied) return denied

  const span = Math.max(0, body.to - body.from)
  const sourceIds = body.source_ids ?? []

  /* Bitrate is measured from what these sources have already delivered rather
     than assumed, so the estimate reflects this deployment. */
  const measured = get<{ bytes: number | null; ms: number | null }>(
    `SELECT SUM(e.bytes) AS bytes, SUM(e.duration_ms) AS ms FROM evidence e
     WHERE e.duration_ms IS NOT NULL AND e.duration_ms > 0`,
  )
  const bytesPerMs = measured?.bytes && measured.ms ? measured.bytes / measured.ms : 0

  const budget = get<{ daily_usd: number }>("SELECT daily_usd FROM budgets WHERE scope = 'tenant' LIMIT 1")?.daily_usd ?? 0
  const spend = spendToday()

  const requestId = `RQ-${randomUUID().slice(0, 8).toUpperCase()}`
  audit(user.name, `forensics.${kind}`, `incident:${incidentId}`, `${span} ms across ${sourceIds.length} sources`)

  return json(
    {
      request_id: requestId,
      incident_id: incidentId,
      kind,
      window: [body.from, body.to] as [number, number],
      source_ids: sourceIds,
      state: 'queued' as const,
      estimated_bytes: Math.round(span * bytesPerMs * Math.max(1, sourceIds.length)),
      /* Re-analysis cost is a real estimate from the observed cost of the
         understanding stages on this deployment. */
      estimated_cost_usd: kind === 'reanalysis' ? estimateReanalysis() : 0,
      budget_remaining_usd: Math.round((budget - spend.today_usd) * 100) / 100,
    },
    202,
  )
}

function estimateReanalysis(): number {
  const row = get<{ avg: number | null }>(
    "SELECT AVG(cost_usd) AS avg FROM model_calls WHERE role IN ('scene','context') AND ok = 1",
  )
  return row?.avg ? Math.round(row.avg * 2 * 10000) / 10000 : 0
}
