import type { NextRequest } from 'next/server'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { badRequest, json, session } from '../_lib/handler'
import { probe, storeEvidence } from '@/lib/ingest/media'
import { extractAudio, extractFrames } from '@/lib/ingest/frames'
import { detect, DetectionUnavailable } from '@/lib/ingest/detect'
import { listUploads, recordUpload, sourceForUpload, type MediaKind } from '@/lib/store/uploads'
import { ingestSensorReading } from '@/lib/store/observations'
import { SOURCE_TYPES, type SourceType } from '@/lib/api/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 512 * 1024 * 1024

export async function GET() {
  return json({ items: listUploads() })
}

/**
 * Material handed over rather than captured.
 *
 * A dashcam clip, a recorder export on a drive, an audio complaint, a column of
 * sensor readings. The bytes are hashed and put under custody exactly as an
 * edge capture would be, and then everything that follows is careful about one
 * distinction: what the platform established for itself, and what the person
 * handing it over asserted.
 *
 * The file's own container metadata is evidence of a sort. The location and
 * time typed into a form are testimony. Both are kept, labelled differently,
 * and the second is never quietly promoted into the first.
 *
 * Nothing here opens an incident. A model reading sampled frames proposes, and
 * a person disposes.
 */
export async function POST(req: NextRequest) {
  const user = session(req)

  const form = await req.formData().catch(() => null)
  if (!form) return badRequest('multipart_required', 'post the file and its details as multipart form data')

  const file = form.get('file')
  if (!(file instanceof File)) return badRequest('file_required')
  if (file.size > MAX_BYTES) return badRequest('too_large', `the limit is ${MAX_BYTES} bytes`)
  if (file.size === 0) return badRequest('file_empty')

  const purpose = String(form.get('purpose') ?? '').trim()
  if (purpose.length < 8) {
    /* Custody records why an object was handled. A blank reason makes the chain
       formally complete and useless. */
    return badRequest('purpose_required', 'state why this material is being brought in, in a few words')
  }

  const kindRaw = String(form.get('source_kind') ?? 'phone')
  if (!SOURCE_TYPES.includes(kindRaw as SourceType)) return badRequest('unknown_source_kind', kindRaw)
  const sourceKind = kindRaw as SourceType

  const statedLat = numberOrNull(form.get('lat'))
  const statedLon = numberOrNull(form.get('lon'))
  const statedCapturedAt = numberOrNull(form.get('captured_at'))
  const statedNote = String(form.get('note') ?? '').trim()
  const label = String(form.get('label') ?? '').trim() || `${sourceKind} uploads by ${user.name}`

  const bytes = Buffer.from(await file.arrayBuffer())
  const mediaType = file.type || 'application/octet-stream'
  const mediaKind = classify(mediaType, file.name)

  /* Sensor data is a column of numbers, not a recording. It goes to the sensor
     path, which already knows what a reading is. */
  if (mediaKind === 'sensor') {
    return handleSensor(bytes, form, user.name, label, statedLat, statedLon)
  }

  const stored = await storeEvidence(bytes, mediaType, file.name || null, user.name)

  /* Probing needs a path. The stored object is the one to read, so the analysis
     is of the bytes that were kept rather than of a copy. */
  const meta = await probe(stored.stored_path)

  const analysis: Record<string, unknown> = {
    container: {
      codec: meta.codec,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      duration_ms: meta.duration_ms,
      captured_at: meta.captured_at,
    },
    provenance: {
      device_signature: null,
      note:
        'this object was handed over rather than captured by an enrolled device. it carries no capture signature, ' +
        'so its authenticity verdict can never read verified, and the source it is attributed to has no calibration, ' +
        'so nothing can be measured from it.',
    },
  }

  let detection = null
  if (mediaKind === 'video' || mediaKind === 'image') {
    const extraction = await extractFrames(stored.stored_path, meta.duration_ms ?? null)
    analysis.sampling = extraction.coverage
    /* The vision model intermittently rejects its own structured output, so a
       single failure is not the same as nothing being there. Three attempts,
       and if all fail the clip is recorded as unexamined rather than as empty:
       those are different findings and only one of them is about the footage. */
    for (let attempt = 0; attempt < 3 && detection === null; attempt++) {
      try {
        const found = await detect(extraction.frames, {
          kind: sourceKind,
          coverage: extraction.coverage,
          whereStated: statedLat !== null && statedLon !== null ? `${statedLat}, ${statedLon}` : 'not stated',
        })
        detection = found
        analysis.detection = found
      } catch (error) {
        if (error instanceof DetectionUnavailable) {
          analysis.detection_unavailable = error.reason
          break
        }
        analysis.detection_unavailable =
          `the vision model did not return a usable answer after ${attempt + 1} attempt(s): ${String(error).slice(0, 160)}. ` +
          'this clip was not examined, which is not the same as nothing being in it.'
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      }
    }
  }

  if (mediaKind === 'audio' || mediaKind === 'video') {
    const transcript = await transcribe(stored.stored_path, mediaKind)
    if (transcript) analysis.transcript = transcript
  }

  const recorded = recordUpload(
    {
      sha256: stored.sha256,
      original_name: file.name || null,
      media_type: mediaType,
      media_kind: mediaKind,
      source_kind: sourceKind,
      source_label: label,
      stated_lat: statedLat,
      stated_lon: statedLon,
      stated_captured_at: statedCapturedAt,
      stated_note: statedNote,
      container_captured_at: meta.captured_at ?? null,
      duration_ms: meta.duration_ms ?? null,
      actor: user.name,
      purpose,
    },
    detection,
    analysis,
  )

  return json(
    {
      ...recorded,
      sha256: stored.sha256,
      deduplicated: stored.deduplicated,
      media_kind: mediaKind,
      analysis,
      needs_adjudication: Boolean(detection?.proposed_situation),
      note: detection?.proposed_situation
        ? 'a situation was proposed from sampled frames. it is not an incident until a person confirms it.'
        : 'stored and examined. nothing was proposed, which is the usual and correct outcome.',
    },
    201,
  )
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function classify(mediaType: string, name: string): MediaKind {
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('image/')) return 'image'
  if (/\.(csv|tsv|json|ndjson)$/i.test(name) || mediaType.includes('csv') || mediaType.includes('json')) {
    return 'sensor'
  }
  /* Unlabelled bytes from a recorder are usually a video stream. Treating them
     as one is a guess, and a guess that fails simply produces no frames. */
  return /\.(dav|264|265|h264|hevc|bin|mp4|avi|mkv|mov)$/i.test(name) ? 'video' : 'sensor'
}

/** Whisper through the configured audio role, if one is available. */
async function transcribe(path: string, kind: MediaKind): Promise<Record<string, unknown> | null> {
  const { isConfigured, apiKey, ROLES } = await import('@/lib/groq/client')
  if (!isConfigured()) return null

  const audio = kind === 'audio' ? await import('node:fs/promises').then((fs) => fs.readFile(path)) : await extractAudio(path)
  if (!audio || audio.byteLength < 1024) return null

  const scratch = join(tmpdir(), `civicsense-tx-${randomUUID()}.wav`)
  try {
    await writeFile(scratch, audio)
    const body = new FormData()
    body.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav')
    body.append('model', ROLES.audio.primary)
    body.append('response_format', 'verbose_json')
    body.append('timestamp_granularities[]', 'segment')
    /* Ask for segment detail so the model's own confidence is available. */
    body.append('temperature', '0')

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey()}` },
      body,
    })
    if (!response.ok) return { unavailable: `transcription answered ${response.status}` }

    const parsed = (await response.json()) as {
      text?: string
      language?: string
      segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[]
    }

    /* Whisper invents speech from noise, and dashcam audio is almost entirely
       engine and road noise. On this footage it produced "Thank you" and "I'm
       going to go to the next video" from a clip whose only sound was a car.
       An invented transcript attached to a piece of evidence is the exact thing
       this system exists to prevent, so the model's own confidence is used to
       throw those segments away rather than passing them on.

       no_speech_prob is the model's estimate that a segment contains no speech
       at all. avg_logprob near zero means it was confident in the tokens it
       chose; a strongly negative value means it was guessing. */
    const segments = Array.isArray(parsed.segments) ? parsed.segments : []
    /* Whisper's stock hallucinations on noise are short, confident and
       generic: "Thank you", "I'm going to go to the next video". They survive a
       no_speech_prob test because the model genuinely believes them, so a
       segment must also be long enough to be worth reporting. A real utterance
       that short adds nothing to a record either. */
    const kept = segments.filter((segment) => {
      const text = (segment.text ?? '').trim()
      if (text.length < 16) return false
      return (segment.no_speech_prob ?? 1) < 0.5 && (segment.avg_logprob ?? -10) > -0.8
    })
    const discarded = segments.length - kept.length
    const text = kept.map((segment) => (segment.text ?? '').trim()).join(' ').trim()

    if (text === '') {
      return {
        text: '',
        language: parsed.language ?? 'unknown',
        segments: 0,
        no_speech: true,
        discarded_segments: discarded,
        detail:
          segments.length === 0
            ? 'the audio track carried nothing the transcriber recognised as speech'
            : `every one of the ${segments.length} segment(s) the transcriber produced was discarded as too short or too ` +
              'uncertain to be speech, which is what engine and road noise looks like to a speech model. nothing is ' +
              'reported rather than reporting what it guessed.',
      }
    }

    return {
      text,
      language: parsed.language ?? 'unknown',
      segments: kept.length,
      discarded_segments: discarded,
      no_speech: false,
      caveat:
        'a machine transcript is investigative. contested passages are transcribed by a person before they are relied on.' +
        (discarded > 0
          ? ` ${discarded} segment(s) were discarded because the model itself rated them as probably not speech.`
          : ''),
    }
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) }
  } finally {
    await unlink(scratch).catch(() => undefined)
  }
}

/** A column of readings, which is a different kind of thing from a recording. */
async function handleSensor(
  bytes: Buffer,
  form: FormData,
  actor: string,
  label: string,
  lat: number | null,
  lon: number | null,
) {
  const sensorKind = String(form.get('sensor_kind') ?? '').trim()
  if (!sensorKind) {
    return badRequest('sensor_kind_required', 'say what is being measured, for example noise, pm25 or water-level')
  }
  const unit = String(form.get('unit') ?? '').trim() || 'unknown'

  const text = bytes.toString('utf8')
  const readings = parseReadings(text)
  if (readings.length === 0) {
    return badRequest(
      'no_readings',
      'expected csv with a time column and a value column, or json objects carrying t and value',
    )
  }

  const sourceId = sourceForUpload({ actor, kind: 'sensor', label: label || `${sensorKind} uploads`, lat, lon })
  for (const reading of readings) ingestSensorReading(sourceId, reading.t, reading.value, unit, true)

  return json(
    {
      source_id: sourceId,
      readings: readings.length,
      sensor_kind: sensorKind,
      unit,
      from: readings[0]!.t,
      to: readings[readings.length - 1]!.t,
      note: 'readings are stored against an uploaded source. they carry no calibration record, so they support a trend and not a compliance measurement.',
    },
    201,
  )
}

function parseReadings(text: string): { t: number; value: number }[] {
  const out: { t: number; value: number }[] = []
  const trimmed = text.trim()

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const record = row as Record<string, unknown>
        const t = toTime(record.t ?? record.time ?? record.timestamp)
        const value = Number(record.value ?? record.v ?? record.reading)
        if (t !== null && Number.isFinite(value)) out.push({ t, value })
      }
      return out.sort((a, b) => a.t - b.t)
    } catch {
      return []
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const parts = line.split(/[,;\t]/).map((p) => p.trim())
    if (parts.length < 2) continue
    const t = toTime(parts[0])
    const value = Number(parts[1])
    if (t !== null && Number.isFinite(value)) out.push({ t, value })
  }
  return out.sort((a, b) => a.t - b.t)
}

function toTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    /* Seconds and milliseconds are both common in exported logs. */
    return value > 1e11 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber) && value.trim() !== '') return asNumber > 1e11 ? asNumber : asNumber * 1000
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}
