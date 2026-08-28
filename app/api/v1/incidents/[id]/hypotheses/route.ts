import type { NextRequest } from 'next/server'
import { json, notFound, requires, session } from '../../../_lib/handler'
import { getIncidentRow } from '@/lib/store/incidents'
import { generateHypotheses, hypothesesForIncident } from '@/lib/store/hypotheses'
import { isConfigured } from '@/lib/groq/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getIncidentRow(id)) return notFound('incident', id)
  return json({ items: hypothesesForIncident(id), reasoning_available: isConfigured() })
}

/** Generating costs a reasoning call, so it is explicit rather than automatic. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'forensics.reanalyse')
  if (denied) return denied
  if (!getIncidentRow(id)) return notFound('incident', id)

  const items = await generateHypotheses(id, user.name)
  return json({ items, reasoning_available: isConfigured() })
}
