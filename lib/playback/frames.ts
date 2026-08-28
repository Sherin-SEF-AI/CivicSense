import type { MediaSegment } from '@/lib/api/schemas'

/**
 * Frame stepping.
 *
 * The half-frame offset is load bearing. Seeking to a frame boundary is
 * ambiguous: float error puts you on either side of it and different decoders
 * disagree. Seeking to the midpoint of the target frame's presentation interval
 * is unambiguous everywhere.
 */
export function frameIndexAt(tMedia: number, segment: MediaSegment): number {
  return Math.floor(((tMedia - segment.t_start) * segment.fps) / 1000)
}

export function stepFrame(tMedia: number, segment: MediaSegment, direction: 1 | -1): number {
  const index = frameIndexAt(tMedia, segment)
  const next = Math.max(0, index + direction)
  return segment.t_start + ((next + 0.5) * 1000) / segment.fps
}

export function frameDurationMs(fps: number): number {
  return 1000 / fps
}

export const PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4, 8] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

/** Above 4x the browser stops honouring playbackRate, so tiles scrub by seeking. */
export const SEEK_SCRUB_ABOVE = 4
