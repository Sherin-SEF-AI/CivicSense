import type { NextRequest } from 'next/server'
import { badRequest, json, list, requires, session } from '../_lib/handler'
import { listSources, registerSource } from '@/lib/store/sources'
import { publish } from '@/lib/events/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const items = listSources({
    types: list(q.get('type')),
    states: list(q.get('state')),
    zones: list(q.get('zone')),
    search: q.get('q') ?? undefined,
  })
  return json({ items, next_cursor: null, total: items.length })
}

/**
 * Registers a real device.
 *
 * A source is an address the platform can reach: an RTSP or HLS URL for a
 * camera, or nothing at all for a sensor that pushes to the ingest endpoint. It
 * starts down and contributes nothing until it sends its first observation.
 */
export async function POST(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const body = (await req.json()) as Record<string, unknown>
  const required = ['source_id', 'source_type', 'label', 'lat', 'lon']
  for (const key of required) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      return badRequest('missing_field', key)
    }
  }
  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return badRequest('invalid_position')

  const device = registerSource(
    {
      source_id: String(body.source_id),
      source_type: String(body.source_type),
      label: String(body.label),
      site: body.site ? String(body.site) : undefined,
      lat,
      lon,
      heading_deg: body.heading_deg === undefined ? null : Number(body.heading_deg),
      fov_deg: body.fov_deg === undefined ? null : Number(body.fov_deg),
      range_m: body.range_m === undefined ? null : Number(body.range_m),
      stream_url: body.stream_url ? String(body.stream_url) : null,
      stream_kind: body.stream_kind as 'rtsp' | 'hls' | 'file' | 'none' | undefined,
      sync_quality: body.sync_quality as 'A' | 'B' | 'C' | 'D' | undefined,
      clock_offset_ms: body.clock_offset_ms === undefined ? 0 : Number(body.clock_offset_ms),
      firmware: body.firmware ? String(body.firmware) : undefined,
      privacy_class: body.privacy_class ? String(body.privacy_class) : undefined,
      sensor_kind: body.sensor_kind ? String(body.sensor_kind) : null,
      representativity_m: body.representativity_m === undefined ? null : Number(body.representativity_m),
    },
    user.name,
  )

  publish({
    type: 'source.health',
    ts: Date.now(),
    payload: { source_id: device.source_id, state: device.state, trust: device.trust, last_observation_at: device.last_observation_at },
  })
  return json(device, 201)
}
