import type { NextRequest } from 'next/server'
import { fixturesDisabled, json } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld } = await import('@/lib/fixtures/world')
  const { answerQuery } = await import('@/lib/fixtures/query')
  const w = getWorld()
  const body = (await req.json()) as { question?: string }
  return json('query', answerQuery(w.seed, body.question ?? '', w.incidents, Date.now()))
}
