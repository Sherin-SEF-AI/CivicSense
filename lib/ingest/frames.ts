import 'server-only'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Pulling still frames out of an uploaded recording.
 *
 * A model cannot look at a video, so anything that examines the content of one
 * has to choose which moments to look at. That choice is part of the analysis
 * and it is recorded: an operator reading a detection needs to know it came
 * from eight frames spread across a four minute clip rather than from the whole
 * of it, because a thing that happened between two sampled frames was not
 * looked at and the absence of a detection is not evidence of absence.
 *
 * Sampling is even across the duration rather than at scene changes. Scene
 * change selection biases toward moments that differ from their neighbours,
 * which is exactly the sample an examiner would have to discount.
 */

export interface ExtractedFrame {
  index: number
  at_ms: number
  bytes: Buffer
}

export interface Extraction {
  frames: ExtractedFrame[]
  duration_ms: number | null
  sampled_every_ms: number | null
  coverage: string
}

/**
 * How wide a frame is when it goes to a model.
 *
 * A dashcam frame is 2304 by 1296, and eight of those base64 encoded exceed
 * what the endpoint accepts: on real footage every request failed with a 400
 * while the synthetic 320 by 240 clips in the test corpus passed, so the limit
 * was invisible until real material arrived. The examination is of a reduced
 * frame and the report says so, because a model that could not resolve a number
 * plate at this width should not be assumed to have tried.
 */
export const EXAMINATION_WIDTH = 1024

export async function extractFrames(
  path: string,
  durationMs: number | null,
  maximum = 8,
): Promise<Extraction> {
  const dir = await mkdtemp(join(tmpdir(), 'civicsense-frames-'))
  try {
    /* A still image is its own single frame. */
    if (durationMs === null || durationMs <= 0) {
      const bytes = await readFile(path)
      return {
        frames: [{ index: 0, at_ms: 0, bytes }],
        duration_ms: null,
        sampled_every_ms: null,
        coverage: 'a single image, examined whole',
      }
    }

    const count = Math.max(1, Math.min(maximum, Math.ceil(durationMs / 4000)))
    const every = durationMs / count

    /* Seeking per frame rather than a decimating filter: fps=1/n drifts on a
       variable frame rate source, and a stated timestamp per frame is what
       makes the sample defensible. */
    const frames: ExtractedFrame[] = []
    for (let i = 0; i < count; i++) {
      const atMs = Math.floor(every * i + every / 2)
      const out = join(dir, `f${String(i).padStart(3, '0')}.jpg`)
      try {
        await exec('ffmpeg', [
          '-v', 'error', '-ss', (atMs / 1000).toFixed(3), '-i', path,
          '-frames:v', '1',
          /* Even width, and a full range pixel format: the mjpeg encoder
             refuses the full range source these cameras produce otherwise. */
          '-vf', `scale='min(${EXAMINATION_WIDTH},iw)':-2`,
          '-pix_fmt', 'yuvj420p', '-q:v', '5', '-y', out,
        ])
        frames.push({ index: i, at_ms: atMs, bytes: await readFile(out) })
      } catch {
        /* A frame that will not decode is skipped and the gap is visible in the
           indices, rather than the whole extraction failing. */
      }
    }

    return {
      frames,
      duration_ms: durationMs,
      sampled_every_ms: Math.round(every),
      coverage:
        `${frames.length} frame(s) sampled evenly across ${(durationMs / 1000).toFixed(1)} s, ` +
        `one about every ${(every / 1000).toFixed(1)} s, examined at up to ${EXAMINATION_WIDTH} px wide. ` +
        'anything between them was not looked at, and detail below that width was not resolvable.',
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Extracts the audio track as 16 kHz mono wav, which is what transcription wants. */
export async function extractAudio(path: string): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'civicsense-audio-'))
  try {
    const out = join(dir, 'audio.wav')
    await exec('ffmpeg', [
      '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'pcm_s16le', '-y', out,
    ])
    const files = await readdir(dir)
    return files.includes('audio.wav') ? await readFile(out) : null
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
