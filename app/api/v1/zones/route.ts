import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../_lib/handler'
import { listZones, updateZoneProfile } from '@/lib/store/zones'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const items = listZones()
  return json({ items, total: items.length })
}

/** Zone kind and sensitivity drive the severity weight profile. */
export async function PATCH(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const body = (await req.json()) as { zone_id?: string; kind?: string; sensitivity?: number; label?: string }
  if (!body.zone_id) return badRequest('zone_id_required')
  if (body.sensitivity !== undefined && (body.sensitivity < 0 || body.sensitivity > 1)) {
    return badRequest('sensitivity_out_of_range', 'sensitivity is bounded 0 to 1')
  }

  const updated = updateZoneProfile(body.zone_id, body)
  return updated ? json(updated) : notFound('zone', body.zone_id)
}
