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
      /* Null is a first class answer and the prompt says so. */
      proposed_situation: { type: ['string', 'null'], enum: [...SITUATION_KEYS, null] },
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
    maxTokens: 2048,
    messages: [
      {
        role: 'system',
        content: [
          'You examine frames from a recording uploaded to a civic monitoring console and report what is visibly present.',
          'Rules you must follow.',
          'Name only classes from the list given. If what you see has no class in that list, do not name a class for it.',
          'Most footage shows nothing worth reporting. Returning an empty class list and a null situation is the correct answer far more often than not, and is preferred to naming something you are unsure of.',
          'Propose a situation only when the frames themselves show it. Do not infer a situation from the kind of camera or from where it was recorded.',
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

  const proposed =
    result.data.proposed_situation && SITUATION_KEYS.includes(result.data.proposed_situation)
      ? result.data.proposed_situation
      : null

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
    caveats: [
      'this is a model reading sampled frames, which makes it investigative. it proposes and does not decide.',
      context.coverage,
      'the location and time of this recording are as the uploader stated them. nothing here corroborates either.',
    ],
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
