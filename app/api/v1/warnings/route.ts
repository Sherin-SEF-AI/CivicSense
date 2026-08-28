import type { NextRequest } from 'next/server'
import { json, list, num } from '../_lib/handler'
import { computeWarnings, interventionOutcomes } from '@/lib/store/predict'
import { all } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const horizonParam = num(q.get('horizon'), 6)
  const horizon = horizonParam === 1 || horizonParam === 6 || horizonParam === 24 ? (horizonParam as 1 | 6 | 24) : 6

  const levels = new Set(list(q.get('level')))
  const domains = new Set(list(q.get('domain')))

  const acknowledged = new Set(
    all<{ warning_id: string }>('SELECT warning_id FROM warnings WHERE acknowledged = 1').map((r) => r.warning_id),
  )

  const items = computeWarnings(horizon)
    .filter((w) => (levels.size === 0 || levels.has(w.level)) && (domains.size === 0 || domains.has(w.domain)))
    .map((w) => (acknowledged.has(w.warning_id) ? { ...w, acknowledged: true } : w))

  return json({ items, outcomes: interventionOutcomes(), total: items.length })
}
