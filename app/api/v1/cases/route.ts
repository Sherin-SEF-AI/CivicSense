import type { NextRequest } from 'next/server'
import { badRequest, json, requires, session } from '../_lib/handler'
import { createCase, listCases } from '@/lib/store/cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const items = listCases(req.nextUrl.searchParams.get('q') ?? '')
  return json({ items, next_cursor: null, total: items.length })
}

export async function POST(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'case.create')
  if (denied) return denied

  const body = (await req.json()) as { title?: string; incident_ids?: string[] }
  if (!body.title?.trim()) return badRequest('title_required')
  return json(createCase(body.title.trim(), body.incident_ids ?? [], user.name), 201)
}
