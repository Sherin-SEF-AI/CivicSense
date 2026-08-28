import type { NextRequest } from 'next/server'
import type { EvidenceItem, EvidenceSearchResult } from '@/lib/api/schemas'
import { guard, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Search over the evidence corpus. Person search is refused unless the caller
 * presents a case with an investigation flag, which is the governance rule the
 * enhancement spec puts on F10 and not something the client is trusted to hide.
 */
export async function POST(req: NextRequest) {
  const blocked = guard()
  if (blocked) return blocked
  const started = Date.now()
  const { getWorld } = await import('@/lib/fixtures/world')
  const { evidenceForIncident, parseQuery, scoreItem } = await import('@/lib/fixtures/evidence')
  const w = getWorld()
  const body = (await req.json()) as { q?: string; case_id?: string | null; limit?: number }
  const question = body.q ?? ''
  const now = Date.now()
  const parsed = parseQuery(question, now)

  const activeCase = body.case_id ? w.index.caseById.get(body.case_id) : undefined
  const investigationFlag = activeCase?.investigation_flag ?? false

  if (parsed.requires_person_search && !investigationFlag) {
    const empty: EvidenceSearchResult = {
      parsed,
      items: [],
      next_cursor: null,
      total: 0,
      blocked_reason:
        'person search requires an authorised investigation flag on the active case. attach a case with the flag set, or search by vehicle attributes instead.',
      took_ms: Date.now() - started,
    }
    return json('evidence-blocked', empty)
  }

  const limit = Math.min(300, Math.max(10, body.limit ?? 120))
  const pool: EvidenceItem[] = []
  const scan = w.incidents.slice(0, 700)
  for (const incident of scan) {
    if (parsed.from !== null && incident.detected_at < parsed.from) continue
    if (parsed.to !== null && incident.detected_at > parsed.to) continue
    for (const item of evidenceForIncident(w.seed, incident, w.sources)) {
      if (!investigationFlag && item.contains_person && parsed.requires_person_search) continue
      pool.push(item)
    }
    if (pool.length > 2400) break
  }

  const scored = pool
    .map((item) => ({ ...item, similarity: scoreItem(item, parsed) }))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit)

  const result: EvidenceSearchResult = {
    parsed,
    items: scored,
    next_cursor: null,
    total: pool.length,
    blocked_reason: null,
    took_ms: Date.now() - started,
  }
  return json('evidence-search', result)
}
