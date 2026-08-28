import type { NextRequest } from 'next/server'
import { badRequest, json, session } from '../../_lib/handler'
import { getSourceRow } from '@/lib/store/sources'
import { readObservation } from '@/lib/store/observations'
import { recordEntities, storeTracks, type TrackInput } from '@/lib/store/tracks'
import { audit, get } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ground-plane tracks from a calibrated device.
 *
 * The device sends where things were, in latitude and longitude on the ground
 * plane, at times on its own clock. It does not send speeds. The platform
 * derives those, because a derived speed carries an error bar traceable to the
 * device's calibration residual and a reported one does not.
 *
 *   curl -X POST http://localhost:3111/api/v1/ingest/track \
 *     -H 'content-type: application/json' -d '{
 *       "observation_id":"OBS-CAM-001-...",
 *       "tracks":[{"track_id":"T1","descriptor":"white hatchback",
 *         "samples":[{"t":1730000000000,"lat":12.97,"lon":77.59}]}],
 *       "entities":[{"entity_ref":"VEH-1","kind":"vehicle","descriptor":"white hatchback"}]
 *     }'
 */
export async function POST(req: NextRequest) {
  const user = session(req)

  let body: {
    observation_id?: string
    tracks?: TrackInput[]
    entities?: { entity_ref: string; kind: string; descriptor?: string; plate?: string }[]
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return badRequest('invalid_body', 'expected JSON')
  }

  if (!body.observation_id) return badRequest('observation_id_required')
  const observation = readObservation(body.observation_id)
  if (!observation) return badRequest('unknown_observation', body.observation_id)

  const source = getSourceRow(observation.source.source_id)
  if (!source) return badRequest('unknown_source', observation.source.source_id)

  /* Tracks from a device with no homography are positions the platform cannot
     stand behind. They are refused rather than stored and later disclaimed. */
  if (!source.homography && (body.tracks?.length ?? 0) > 0) {
    return badRequest(
      'source_not_calibrated',
      `${source.source_id} has no homography, so ground-plane positions from it cannot be measured against`,
    )
  }

  const incidentId =
    get<{ incident_id: string | null }>('SELECT incident_id FROM observations WHERE observation_id = ?', [
      observation.observation_id,
    ])?.incident_id ?? null
  const stored = body.tracks ? storeTracks({
    observation_id: observation.observation_id,
    source_id: observation.source.source_id,
    incident_id: incidentId,
    tracks: body.tracks,
  }) : 0

  if (body.entities && body.entities.length > 0) {
    recordEntities({
      observation_id: observation.observation_id,
      incident_id: incidentId,
      source_id: observation.source.source_id,
      t: observation.capture.t_start,
      lat: observation.pose.lat,
      lon: observation.pose.lon,
      entities: body.entities,
    })
  }

  audit(user.name, 'tracks.ingested', `observation:${observation.observation_id}`, `${stored} tracks`)
  return json({ tracks_stored: stored, entities: body.entities?.length ?? 0, incident_id: incidentId }, 201)
}
