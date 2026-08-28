import type { NextRequest } from 'next/server'
import { json, session } from '../_lib/handler'
import { openPreAlerts, supersedePreAlert } from '@/lib/store/prealerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Alerts still open, for a console that connected after they were raised. */
export async function GET() {
  return json({ items: openPreAlerts() })
}

/** Manual clear, for the case where the alert was resolved off-platform. */
export async function POST(req: NextRequest) {
  session(req)
  const body = (await req.json()) as { incident_id?: string }
  if (body.incident_id) supersedePreAlert(body.incident_id)
  return json({ items: openPreAlerts() })
}
