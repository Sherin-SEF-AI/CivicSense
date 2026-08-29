import 'server-only'
import { call, isConfigured } from '@/lib/groq/client'
import { SITUATIONS } from '@/lib/config/situations'
import type { ExtractedFrame } from '@/lib/ingest/frames'

/**
 * What is in an uploaded recording.
 *
 * An edge device arrives with its own detections. An uploaded file does not, so
 * something has to look at it, and the only thing available is a model. That
 * makes every finding here investigative rather than evidentiary, and the
 * distinction is enforced rather than described: a detection never becomes an
 * incident on its own. It proposes, a person disposes.
 *
 * Two constraints keep it useful. The model may only name classes and
 * situations from the deployment's own catalogue, so it cannot invent a
 * category that no department owns and no statute covers. And it is asked what
 * it can see rather than what it expects: the prompt states that most footage
 * shows nothing worth reporting, because a detector that finds something in
 * every clip is not a detector.
 */

export interface Detection {
  classes: string[]
  confidence: number
  frames_examined: number
  summary: string
  proposed_situation: string | null
  situation_confidence: number
  situation_reason: string
  model: string
  cost_usd: number
  caveats: string[]
}

export class DetectionUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'DetectionUnavailable'
  }
}

/**
 * How many images one request may carry.
 *
 * The vision model accepts three and refuses a fourth. It says so plainly, and
 * the failure had been reaching this code as a bare 400 that looked like a
 * transient: on real dashcam footage every upload reported the clip as
 * unexamined while a two frame test passed, which made it look like flakiness
 * rather than a limit. Frames are batched instead of discarded, because looking
 * at less of a recording is not the same as respecting a request limit.
 */
const MAX_IMAGES_PER_REQUEST = 3

const CLASSES = [...new Set(SITUATIONS.flatMap((s) => s.classes))].sort()
const SITUATION_KEYS = SITUATIONS.map((s) => s.key)

const SCHEMA = {
  name: 'upload_detection',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['classes', 'confidence', 'summary', 'proposed_situation', 'situation_confidence', 'situation_reason'],
    properties: {
      classes: { type: 'array', items: { type: 'string', enum: CLASSES } },
      confidence: { type: 'number' },
      summary: { type: 'string' },
      /* "none" rather than null, and a plain string rather than a nullable
         enum. The constrained decoder that produces this JSON cannot satisfy a
         type union with an enum containing null: it returned an empty
         generation and a json_validate_failed on every real clip while the
         synthetic corpus passed, because the synthetic clips never had enough
         in them for the model to reach that field. The value is checked against
         the catalogue in code below, which is where it had to be checked
         anyway. */
      proposed_situation: { type: 'string' },
      situation_confidence: { type: 'number' },
      situation_reason: { type: 'string' },
    },
  },
}

export async function detect(
  frames: ExtractedFrame[],
  context: { kind: string; coverage: string; whereStated: string },
): Promise<Detection> {
  if (!isConfigured()) {
    throw new DetectionUnavailable(
      'GROQ_API_KEY is not set, so nothing can look at this upload. it is stored and hashed, and no detection is claimed.',
    )
  }
  if (frames.length === 0) {
    throw new DetectionUnavailable('no frame could be decoded from this file, so there was nothing to examine')
  }

  /* A model rejects an image under two pixels a side and would fail the whole
     call on one bad frame. */
  const usable = frames.filter((f) => f.bytes.byteLength > 512)
  if (usable.length === 0) {
    throw new DetectionUnavailable('every extracted frame was too small to examine')
  }

  const batches: ExtractedFrame[][] = []
  for (let i = 0; i < usable.length; i += MAX_IMAGES_PER_REQUEST) {
    batches.push(usable.slice(i, i + MAX_IMAGES_PER_REQUEST))
  }

  /* In sequence, and each batch retried on its own.
     
     The vision model rejects its own structured output intermittently. Bisecting
     the schema showed nothing structurally wrong with it: the same request
     succeeds and fails on repetition. With three batches per clip, an
     all-or-nothing detection failed most of the time for a reason that had
     nothing to do with the footage. Retrying per batch, and reporting what the
     surviving batches saw, means a flaky call costs coverage rather than the
     whole examination. How much coverage it cost is stated. */
  const parts: Detection[] = []
  let framesExamined = 0
  let batchesLost = 0

  for (const batch of batches) {
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        parts.push(await examine(batch, context))
        framesExamined += batch.length
        done = true
      } catch {
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)))
      }
    }
    if (!done) batchesLost++
  }

  if (parts.length === 0) {
    throw new DetectionUnavailable(
      `the vision model did not return a usable answer for any of the ${batches.length} batch(es) of frames from this file`,
    )
  }

  return merge(parts, framesExamined, batches.length, batchesLost, usable.length, context)
}

/**
 * Merges what several batches saw into one finding.
 *
 * Classes are the union: a thing seen in any batch was in the recording. The
 * proposed situation is the strongest single proposal rather than a vote,
 * because a situation visible in one part of a clip and not another is still
 * something that happened, and averaging it away would lose it. Confidence is
 * the confidence of the batch that proposed it, not of the whole.
 */
function merge(
  parts: Detection[],
  frameCount: number,
  batchCount: number,
  batchesLost: number,
  framesOffered: number,
  context: { coverage: string },
): Detection {
  const proposals = parts.filter((p) => p.proposed_situation !== null)
  const strongest = proposals.sort((a, b) => b.situation_confidence - a.situation_confidence)[0] ?? null

  return {
    classes: [...new Set(parts.flatMap((p) => p.classes))].sort(),
    confidence: parts.length ? Math.max(...parts.map((p) => p.confidence)) : 0,
    frames_examined: frameCount,
    summary: parts.map((p) => p.summary).filter(Boolean).join(' '),
    proposed_situation: strongest?.proposed_situation ?? null,
    situation_confidence: strongest?.situation_confidence ?? 0,
    situation_reason: strongest?.situation_reason ?? 'no part of the sampled footage supported a situation',
    model: parts[0]?.model ?? 'unknown',
    cost_usd: parts.reduce((sum, p) => sum + p.cost_usd, 0),
    caveats: [
      'this is a model reading sampled frames, which makes it investigative. it proposes and does not decide.',
      `${context.coverage} examined in ${batchCount} request(s) of at most ${MAX_IMAGES_PER_REQUEST} frames, ` +
        'so no single look covered the whole clip.' +
        (batchesLost > 0
          ? ` ${batchesLost} of those request(s) failed, so ${frameCount} of ${framesOffered} sampled frames were examined ` +
            'and the rest were not looked at at all.'
          : ''),
      'the location and time of this recording are as the uploader stated them. nothing here corroborates either.',
    ],
  }
}

async function examine(
  usable: ExtractedFrame[],
  context: { kind: string; coverage: string; whereStated: string },
): Promise<Detection> {
  const result = await call<{
    classes: string[]
    confidence: number
    summary: string
    proposed_situation: string | null
    situation_confidence: number
    situation_reason: string
  }>({
    role: 'scene',
    schema: SCHEMA,
    /* A busy street produces a long summary, and a truncated response is not
       valid json. */
    maxTokens: 3072,
    messages: [
      {
        role: 'system',
        content: [
          'You examine frames from a recording uploaded to a civic monitoring console and report what is visibly present.',
          'Rules you must follow.',
          'Name only classes from the list given. If what you see has no class in that list, do not name a class for it.',
          'Most footage shows nothing worth reporting. Returning an empty class list and a null situation is the correct answer far more often than not, and is preferred to naming something you are unsure of.',
          'Propose a situation only when the frames themselves show it. Do not infer a situation from the kind of camera or from where it was recorded.',
        'If no situation in the list applies, set proposed_situation to the exact string "none". That is the ordinary answer.',
          'You are looking at a few sampled frames, not the whole recording. Anything between them you did not see, so do not describe events you did not observe.',
          'Confidence is how sure you are from these frames alone, not how plausible the situation is in general.',
          'Write in plain sentences. Do not use em-dashes.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Source kind as stated by the uploader: ${context.kind}.`,
              `Location as stated by the uploader: ${context.whereStated}.`,
              `Sampling: ${context.coverage}`,
              '',
              `Classes you may name: ${CLASSES.join(', ')}`,
              `Situations you may propose: ${SITUATION_KEYS.join(', ')}`,
            ].join('\n'),
          },
          ...usable.map((frame) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/jpeg;base64,${frame.bytes.toString('base64')}` },
          })),
        ] as never,
      },
    ],
  })

  const claimed = (result.data.proposed_situation ?? '').trim()
  const proposed = SITUATION_KEYS.includes(claimed) ? claimed : null

  return {
    classes: result.data.classes.filter((c) => CLASSES.includes(c)),
    confidence: clamp(result.data.confidence),
    frames_examined: usable.length,
    summary: result.data.summary,
    proposed_situation: proposed,
    situation_confidence: clamp(result.data.situation_confidence),
    situation_reason: result.data.situation_reason,
    model: result.model,
    cost_usd: result.costUsd,
    caveats: [],
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
