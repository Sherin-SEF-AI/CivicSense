import type { NextRequest } from 'next/server'
import { badRequest, json, session } from '../../_lib/handler'
import { audit } from '@/lib/db'
import { fis, FisUnavailable } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Runs a measurement operator and records that it ran.
 *
 * A measurement taken during an investigation is part of the record whether or
 * not anyone keeps the answer, so the request is audited with the digest of the
 * parameters that produced it. Two people marking the same frame differently get
 * two different digests, which is what makes a disputed number traceable back to
 * the marks behind it.
 */
export async function POST(req: NextRequest) {
  const user = session(req)

  const body = (await req.json().catch(() => null)) as {
    operator?: string
    version?: string
    params?: Record<string, unknown>
    incident_id?: string
    source_id?: string
  } | null

  if (!body?.operator || !body.params) return badRequest('operator_and_params_required')

  try {
    const result = await fis<Record<string, unknown>>('/v1/measure', {
      user,
      method: 'POST',
      body,
    })

    audit(
      user.name,
      'measurement.taken',
      body.incident_id ? `incident:${body.incident_id}` : `source:${body.source_id ?? 'unattached'}`,
      `${String(result.operator)} params ${String(result.params_digest ?? 'refused').slice(0, 16)}`,
    )

    return json(result)
  } catch (error) {
    if (error instanceof FisUnavailable) {
      return json({ error: 'fis_unavailable' as const, detail: error.reason })
    }
    throw error
  }
}
