import type { NextRequest } from 'next/server'
import { json, notFound, requires, session } from '../../../_lib/handler'
import { getSourceRow } from '@/lib/store/sources'
import { audit } from '@/lib/db'
import { fis, fisConfigured, fisResolveTime, FisUnavailable } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What a reading from this source's clock means in true time, right now. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await ctx.params
  if (!getSourceRow(sourceId)) return notFound('source', sourceId)

  if (!fisConfigured()) {
    return json({
      error: 'fis_unavailable' as const,
      detail:
        'the forensic tier is not attached, so this source has no fitted clock model and its timestamps carry only the grade recorded at registration',
    })
  }

  const at = Number(req.nextUrl.searchParams.get('t') ?? Date.now())
  const resolved = await fisResolveTime(sourceId, at)
  return json(resolved ?? { error: 'fis_unavailable' as const, detail: 'the forensic tier did not answer' })
}

/**
 * Refits the clock from everything observed so far.
 *
 * Explicit rather than automatic on read, so that the model behind an answer is
 * a stored row someone can point at, rather than something recomputed slightly
 * differently each time it is asked for.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied
  if (!getSourceRow(sourceId)) return notFound('source', sourceId)

  try {
    const result = await fis<{ fitted: boolean; observations: number; segments?: unknown[]; detail: string }>(
      `/v1/timebase/${encodeURIComponent(sourceId)}/fit`,
      { user, method: 'POST', body: {} },
    )
    audit(
      user.name,
      'timebase.fitted',
      `source:${sourceId}`,
      `${result.observations} observations, ${result.segments?.length ?? 0} segment(s)`,
    )
    return json(result)
  } catch (error) {
    if (error instanceof FisUnavailable) return json({ error: 'fis_unavailable' as const, detail: error.reason })
    throw error
  }
}
