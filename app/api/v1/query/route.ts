import type { NextRequest } from 'next/server'
import { badRequest, json, session } from '../_lib/handler'
import { answerQuery } from '@/lib/reasoning/query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = session(req)
  const body = (await req.json()) as { question?: string }
  if (!body.question?.trim()) return badRequest('question_required')

  try {
    return json(await answerQuery(body.question.trim(), user.name))
  } catch (error) {
    return json({ error: 'query_failed', detail: error instanceof Error ? error.message : String(error) }, 502)
  }
}
