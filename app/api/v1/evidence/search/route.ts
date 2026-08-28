import type { NextRequest } from 'next/server'
import { json, requires, session } from '../../_lib/handler'
import { get } from '@/lib/db'
import { searchEvidence } from '@/lib/store/evidence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'evidence.search')
  if (denied) return denied

  const body = (await req.json()) as { q?: string; case_id?: string | null; limit?: number }

  /* The flag lives on the case, and the server reads it rather than trusting a
     claim from the client. */
  const flagged =
    body.case_id !== undefined && body.case_id !== null
      ? (get<{ investigation_flag: number }>('SELECT investigation_flag FROM cases WHERE case_id = ?', [body.case_id])
          ?.investigation_flag ?? 0) === 1
      : false

  return json(searchEvidence(body.q ?? '', flagged && user.capabilities.includes('evidence.person_search'), body.limit ?? 120))
}
