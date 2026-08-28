import type { NextRequest } from 'next/server'
import { json, session } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return json(session(req))
}
