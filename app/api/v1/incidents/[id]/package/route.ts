import type { NextRequest } from 'next/server'
import { json, notFound } from '../../../_lib/handler'
import { getIncident, storedPackage } from '@/lib/store/incidents'
import { isConfigured } from '@/lib/groq/client'
import { ReasoningUnavailable, runPipeline } from '@/lib/reasoning/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The intelligence package.
 *
 * Returns the stored package when the understanding tier has already run for
 * this incident. It does not synthesise one: without a configured model the
 * answer is 503 with the reason, and the console shows that plainly.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const incident = getIncident(id)
  if (!incident) return notFound('incident', id)

  const stored = storedPackage(id)
  if (stored && req.nextUrl.searchParams.get('refresh') !== '1') return json(stored)

  /* Answered as 200 with a typed body rather than 503. This is an expected,
     handled state that the console renders, not a transport failure, and a
     non-2xx here would show up as a browser console error on a healthy page. */
  if (!isConfigured()) {
    return json({
      error: 'reasoning_unavailable' as const,
      detail:
        'GROQ_API_KEY is not set, so the understanding tier has not run for this incident. Set the key and run the pass to get an assessment.',
      incident,
    })
  }

  try {
    const result = await runPipeline(id)
    return json(result.package)
  } catch (error) {
    if (error instanceof ReasoningUnavailable) {
      return json({ error: 'reasoning_unavailable' as const, detail: error.reason, incident })
    }
    return json(
      { error: 'reasoning_failed', detail: error instanceof Error ? error.message : String(error), incident },
      502,
    )
  }
}

/** Re-runs the understanding tier over the current evidence set. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getIncident(id)) return notFound('incident', id)
  try {
    const result = await runPipeline(id)
    return json({ package: result.package, dropped_claims: result.droppedClaims, citation_validity: result.citationValidity })
  } catch (error) {
    if (error instanceof ReasoningUnavailable) return json({ error: 'reasoning_unavailable', detail: error.reason }, 503)
    return json({ error: 'reasoning_failed', detail: error instanceof Error ? error.message : String(error) }, 502)
  }
}
