import type { NextRequest } from 'next/server'
import { badRequest, json, session } from '../../_lib/handler'
import { getSourceRow, recordHealth } from '@/lib/store/sources'
import { ingestObservation } from '@/lib/store/observations'
import { recordTrigger } from '@/lib/store/incidents'
import { storeEvidence } from '@/lib/ingest/media'
import { SITUATION_BY_KEY } from '@/lib/config/situations'
import { publish } from '@/lib/events/bus'
import { bindPreAlert, raisePreAlert } from '@/lib/store/prealerts'
import { recordSync } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The ingest endpoint.
 *
 * An edge agent posts an observation here, optionally with the media that backs
 * it. The bytes are hashed on arrival and the hash is what the platform stores
 * and cites, so the chain of custody starts at the moment the file is received
 * rather than at the moment someone looks at it.
 *
 * Accepts multipart/form-data with a `payload` JSON part and an optional `media`
 * file part, or a plain JSON body when there is no media.
 *
 *   curl -X POST http://localhost:3111/api/v1/ingest/observation \
 *     -F 'payload={"source_id":"CAM-001","t_start":1730000000000,"payload_kind":"keyframe","classes":["car"],"trigger":"class:no_helmet","situation_key":"no-helmet"}' \
 *     -F 'media=@frame.jpg'
 */
export async function POST(req: NextRequest) {
  const user = session(req)
  const contentType = req.headers.get('content-type') ?? ''

  let payload: Record<string, unknown>
  let media: { bytes: Buffer; type: string; name: string | null } | null = null

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const raw = form.get('payload')
    if (typeof raw !== 'string') return badRequest('missing_payload', 'a JSON payload part is required')
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return badRequest('invalid_payload', 'the payload part is not valid JSON')
    }
    const file = form.get('media')
    if (file instanceof File) {
      media = {
        bytes: Buffer.from(await file.arrayBuffer()),
        type: file.type || 'application/octet-stream',
        name: file.name || null,
      }
    }
  } else {
    try {
      payload = (await req.json()) as Record<string, unknown>
    } catch {
      return badRequest('invalid_body', 'expected JSON or multipart/form-data')
    }
  }

  const sourceId = payload.source_id ? String(payload.source_id) : ''
  const source = getSourceRow(sourceId)
  if (!source) return badRequest('unknown_source', sourceId)

  const tStart = Number(payload.t_start ?? Date.now())
  if (!Number.isFinite(tStart)) return badRequest('invalid_t_start')

  /* Dispatch before understanding.

     A life-safety trigger goes out here, ahead of hashing the media and well
     ahead of any model call, because the seconds spent enriching an alert are
     seconds a crew is not moving. Everything below this line refines an alert
     that has already been sent. */
  const situationKey = payload.situation_key ? String(payload.situation_key) : null
  const situation = situationKey ? SITUATION_BY_KEY.get(situationKey) : undefined
  if (situationKey && !situation) return badRequest('unknown_situation', situationKey)

  const preAlert = situation
    ? raisePreAlert({
        situation,
        source_id: sourceId,
        detected_at: tStart,
        lat: payload.lat === undefined ? source.lat : Number(payload.lat),
        lon: payload.lon === undefined ? source.lon : Number(payload.lon),
      })
    : null

  let stored = null
  if (media) {
    stored = await storeEvidence(media.bytes, media.type, media.name, user.name, {
      source_id: sourceId,
      t_start: tStart,
      signature: payload.device_signature ? String(payload.device_signature) : null,
    })
  }

  const { observation } = ingestObservation({
    source_id: sourceId,
    t_start: tStart,
    t_end: payload.t_end === undefined ? undefined : Number(payload.t_end),
    lat: payload.lat === undefined ? null : Number(payload.lat),
    lon: payload.lon === undefined ? null : Number(payload.lon),
    heading_deg: payload.heading_deg === undefined ? null : Number(payload.heading_deg),
    payload_kind: (payload.payload_kind as never) ?? 'keyframe',
    content_ref: stored?.sha256 ?? null,
    content_meta: stored
      ? {
          codec: stored.codec,
          width: stored.width,
          height: stored.height,
          fps: stored.fps,
          duration_ms: stored.duration_ms,
          bytes: stored.bytes,
        }
      : null,
    classes: Array.isArray(payload.classes) ? (payload.classes as string[]) : [],
    counts: (payload.counts as Record<string, number>) ?? {},
    trigger: payload.trigger ? String(payload.trigger) : null,
    quality: payload.quality as never,
    device_signature: payload.device_signature ? String(payload.device_signature) : null,
    adapter_version: payload.adapter_version ? String(payload.adapter_version) : 'unknown',
  })

  recordHealth(sourceId, { uptime: 1, fps: Number(stored?.fps ?? 0), drops: 0, latency_ms: Date.now() - tStart })

  /* What this device's clock said, against when its bytes actually arrived.
     It is a weak observation, because the arrival time includes however long
     the network took, and its uncertainty says so: the transport delay is
     unknown but bounded below by zero, so the observation is centred on the
     arrival time with a sigma covering a plausible delay. Many weak
     observations across a day still pin down an offset that no single one
     could, which is the entire reason for fitting rather than correcting. */
  const arrivedAt = Date.now()
  const transitMs = Math.max(0, arrivedAt - tStart)
  if (transitMs < 30_000) {
    recordSync([
      {
        source_id: sourceId,
        t_source_ms: tStart,
        t_utc_ms: arrivedAt,
        /* Half the transit, floored: a device on the same network arriving in
           40 ms is not known to 20 ms, and one arriving in 8 s is not known
           much at all. */
        sigma_ms: Math.max(50, transitMs / 2),
        method: 'pts_anchor',
        detail: `bytes arrived ${transitMs} ms after the declared capture time`,
      },
    ])
  }

  /* A trigger is what turns an observation into an incident. Without one the
     observation is recorded and contributes to corroboration later. */
  let incidentId: string | null = null
  if (situationKey) {
    const result = recordTrigger({
      observation_id: observation.observation_id,
      source_id: sourceId,
      situation_key: situationKey,
      t: tStart,
      lat: observation.pose.lat,
      lon: observation.pose.lon,
      affected: Number(payload.affected ?? 1),
    })
    incidentId = result.incident.incident_id
    if (preAlert) bindPreAlert(preAlert.pre_alert_id, incidentId)
    publish({
      type: result.created ? 'incident.created' : 'incident.updated',
      ts: Date.now(),
      payload: result.incident,
    })
  }

  return json(
    {
      observation_id: observation.observation_id,
      incident_id: incidentId,
      pre_alert: preAlert ? { pre_alert_id: preAlert.pre_alert_id, elapsed_ms: preAlert.elapsed_ms } : null,
      evidence: stored ? { sha256: stored.sha256, bytes: stored.bytes, deduplicated: stored.deduplicated } : null,
    },
    201,
  )
}
