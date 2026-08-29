import 'server-only'
import { randomUUID } from 'node:crypto'
import { all, audit, get, run } from '@/lib/db'
import { registerSource, getSourceRow } from '@/lib/store/sources'
import { ingestObservation } from '@/lib/store/observations'
import { recordTrigger } from '@/lib/store/incidents'
import { SITUATION_BY_KEY } from '@/lib/config/situations'
import type { SourceType } from '@/lib/api/schemas'

/**
 * Material handed over rather than captured.
 *
 * A dashcam clip from a member of the public, a recorder export brought in on a
 * drive, an audio file from a complaint. None of it arrives with a device that
 * vouches for it, and all of it is worth looking at.
 *
 * The whole difficulty is keeping two kinds of statement apart. What the
 * platform established for itself: the bytes hash to this, the container says
 * that, these frames were examined. And what a person asserted: this was taken
 * here, at this time, by this camera. The first is evidence. The second is
 * testimony, and it is stored, labelled and never quietly promoted.
 */

export type MediaKind = 'video' | 'audio' | 'image' | 'sensor'

export interface UploadInput {
  sha256: string
  original_name: string | null
  media_type: string
  media_kind: MediaKind
  source_kind: SourceType
  source_label: string
  stated_lat: number | null
  stated_lon: number | null
  stated_captured_at: number | null
  stated_note: string
  container_captured_at: number | null
  duration_ms: number | null
  actor: string
  purpose: string
}

export interface DetectionRecord {
  classes: string[]
  confidence: number
  summary: string
  proposed_situation: string | null
  situation_confidence: number
  situation_reason: string
  frames_examined: number
  model: string
}

/**
 * The source an upload is attributed to.
 *
 * One per uploader per stated kind and place, so repeated uploads from the same
 * dashcam group together instead of scattering the fleet. It carries no
 * calibration and no capture key, which is what stops anything measured from
 * being claimed off it: no homography means metrology refuses, and no enrolled
 * key means the authenticity verdict can never read verified.
 */
export function sourceForUpload(input: {
  actor: string
  kind: SourceType
  label: string
  lat: number | null
  lon: number | null
}): string {
  const slug = input.actor.replace(/[^a-zA-Z0-9]+/g, '-').toUpperCase().slice(0, 16)
  const sourceId = `UPL-${input.kind.toUpperCase()}-${slug}`

  if (!getSourceRow(sourceId)) {
    registerSource(
      {
        source_id: sourceId,
        source_type: input.kind,
        label: input.label,
        /* Uploads without a stated position sit at the deployment centroid and
           are marked unlocated, rather than being dropped at zero, which is in
           the Gulf of Guinea and would silently join a real map. */
        lat: input.lat ?? 12.9716,
        lon: input.lon ?? 77.5946,
        heading_deg: null,
        fov_deg: null,
        range_m: null,
        stream_url: null,
        stream_kind: 'none',
        /* An uploaded file's clock is whatever the recorder's was, and nothing
           has disciplined it. D is the honest grade. */
        sync_quality: 'D',
        clock_offset_ms: 0,
        privacy_class: 'public-space',
        sensor_kind: null,
        representativity_m: null,
      },
      input.actor,
    )
    audit(
      input.actor,
      'source.registered_for_upload',
      `source:${sourceId}`,
      'created to hold uploaded material. no calibration and no capture key, so it can support no measurement and no verified signature.',
    )
  }

  return sourceId
}

export function recordUpload(input: UploadInput, detection: DetectionRecord | null, analysis: unknown): {
  upload_id: string
  observation_id: string
  detection_id: string | null
} {
  const sourceId = sourceForUpload({
    actor: input.actor,
    kind: input.source_kind,
    label: input.source_label,
    lat: input.stated_lat,
    lon: input.stated_lon,
  })

  const uploadId = `UP-${randomUUID().slice(0, 8).toUpperCase()}`

  /* The capture time, in order of how much it is worth: what the container
     itself recorded, then what the uploader said, then when it arrived. Which
     one was used is stored, because a time taken from an upload form is a
     different kind of fact from one written by a recorder. */
  const capturedAt = input.container_captured_at ?? input.stated_captured_at ?? Date.now()

  const { observation } = ingestObservation({
    source_id: sourceId,
    t_start: capturedAt,
    t_end: input.duration_ms ? capturedAt + input.duration_ms : undefined,
    lat: input.stated_lat,
    lon: input.stated_lon,
    payload_kind: input.media_kind === 'audio' ? 'audio_segment' : input.media_kind === 'video' ? 'clip' : 'keyframe',
    content_ref: input.sha256,
    content_meta: { bytes: 0, duration_ms: input.duration_ms },
    /* Classes from a model reading sampled frames. They describe what was seen,
       and they carry no trigger: an upload does not raise an incident. */
    classes: detection?.classes ?? [],
    counts: {},
    trigger: null,
    device_signature: null,
    adapter_version: 'operator-upload',
  })

  run(
    `INSERT INTO uploads (upload_id, sha256, source_id, observation_id, uploaded_by, uploaded_at, purpose,
                          original_name, media_kind, stated_lat, stated_lon, stated_captured_at, stated_note,
                          container_captured_at, duration_ms, analysis, state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uploadId, input.sha256, sourceId, observation.observation_id, input.actor, Date.now(), input.purpose,
      input.original_name, input.media_kind, input.stated_lat, input.stated_lon, input.stated_captured_at,
      input.stated_note, input.container_captured_at, input.duration_ms, JSON.stringify(analysis ?? {}),
      detection?.proposed_situation ? 'awaiting_adjudication' : 'analysed',
    ],
  )

  let detectionId: string | null = null
  if (detection) {
    detectionId = `DET-${randomUUID().slice(0, 8).toUpperCase()}`
    run(
      `INSERT INTO upload_detections (detection_id, upload_id, classes, confidence, summary,
                                      proposed_situation, situation_confidence, situation_reason,
                                      frames_examined, model)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        detectionId, uploadId, JSON.stringify(detection.classes), detection.confidence, detection.summary,
        detection.proposed_situation, detection.situation_confidence, detection.situation_reason,
        detection.frames_examined, detection.model,
      ],
    )
  }

  audit(
    input.actor,
    'upload.received',
    `upload:${uploadId}`,
    `${input.media_kind} ${input.original_name ?? 'unnamed'} as ${sourceId}, purpose: ${input.purpose}` +
      (detection?.proposed_situation ? `, proposes ${detection.proposed_situation} pending adjudication` : ''),
  )

  return { upload_id: uploadId, observation_id: observation.observation_id, detection_id: detectionId }
}

/**
 * A person ruling on what the model proposed.
 *
 * Confirming is what creates an incident, and it is the only thing that does
 * for uploaded material. The record keeps who ruled and why, so an incident
 * that began as a model's reading of eight frames can always be traced back to
 * the person who decided it was one.
 */
export function adjudicate(input: {
  detection_id: string
  decision: 'confirmed' | 'rejected'
  note: string
  actor: string
}): { incident_id: string | null; state: string } | null {
  const detection = get<{
    detection_id: string
    upload_id: string
    proposed_situation: string | null
    adjudication: string
    classes: string
  }>('SELECT * FROM upload_detections WHERE detection_id = ?', [input.detection_id])
  if (!detection) return null

  if (detection.adjudication !== 'open') {
    return { incident_id: null, state: detection.adjudication }
  }

  const upload = get<{
    upload_id: string
    source_id: string
    observation_id: string
    stated_lat: number | null
    stated_lon: number | null
    container_captured_at: number | null
    stated_captured_at: number | null
  }>('SELECT * FROM uploads WHERE upload_id = ?', [detection.upload_id])
  if (!upload) return null

  let incidentId: string | null = null

  if (input.decision === 'confirmed' && detection.proposed_situation) {
    const situation = SITUATION_BY_KEY.get(detection.proposed_situation)
    if (!situation) return null

    const source = getSourceRow(upload.source_id)
    const result = recordTrigger({
      observation_id: upload.observation_id,
      source_id: upload.source_id,
      situation_key: detection.proposed_situation,
      t: upload.container_captured_at ?? upload.stated_captured_at ?? Date.now(),
      lat: upload.stated_lat ?? source?.lat ?? 12.9716,
      lon: upload.stated_lon ?? source?.lon ?? 77.5946,
      affected: 1,
    })
    incidentId = result.incident.incident_id
  }

  run(
    `UPDATE upload_detections SET adjudication = ?, adjudicated_by = ?, adjudicated_at = ?,
            adjudication_note = ?, incident_id = ? WHERE detection_id = ?`,
    [input.decision, input.actor, Date.now(), input.note, incidentId, input.detection_id],
  )
  run('UPDATE uploads SET state = ? WHERE upload_id = ?', [input.decision, detection.upload_id])

  audit(
    input.actor,
    `upload.${input.decision}`,
    `upload:${detection.upload_id}`,
    incidentId
      ? `confirmed ${detection.proposed_situation} and opened ${incidentId}. ${input.note}`
      : `${input.decision}: ${input.note}`,
  )

  return { incident_id: incidentId, state: input.decision }
}

export interface UploadRow {
  upload_id: string
  sha256: string
  source_id: string
  uploaded_by: string
  uploaded_at: number
  purpose: string
  original_name: string | null
  media_kind: string
  stated_lat: number | null
  stated_lon: number | null
  stated_note: string
  duration_ms: number | null
  state: string
  analysis: string
}

export function listUploads(limit = 50): (UploadRow & { detection: Record<string, unknown> | null })[] {
  return all<UploadRow>('SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?', [limit]).map((row) => {
    const detection = get<Record<string, unknown>>(
      'SELECT * FROM upload_detections WHERE upload_id = ?',
      [row.upload_id],
    )
    return {
      ...row,
      detection: detection
        ? { ...detection, classes: JSON.parse(String(detection.classes ?? '[]')) as string[] }
        : null,
    }
  })
}
