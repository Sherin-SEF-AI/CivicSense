import type { MediaSegment, PlaybackSource } from '@/lib/api/schemas'

/**
 * Coverage lookup.
 *
 * A tile with no media at time T renders a labelled gap rather than a frozen
 * last frame, because a frozen frame is a lie about what was observed. This is
 * also what makes the coverage score on the package mean something: the operator
 * can see the hole it came from.
 */

export type Coverage =
  | { state: 'covered'; segment: MediaSegment; index: number; localSec: number }
  | { state: 'gap'; prevEnd: number; nextStart: number }
  | { state: 'before'; nextStart: number }
  | { state: 'after'; prevEnd: number }
  | { state: 'none' }

/** Master time to media time for a source, applying its measured clock offset. */
export function mediaTimeOf(source: PlaybackSource, tMaster: number): number {
  return tMaster - source.clock_offset_ms
}

export function coverageAt(source: PlaybackSource, tMaster: number): Coverage {
  const segments = source.segments
  if (segments.length === 0) return { state: 'none' }
  const t = mediaTimeOf(source, tMaster)

  let lo = 0
  let hi = segments.length - 1
  let candidate = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const seg = segments[mid]!
    if (t < seg.t_start) {
      hi = mid - 1
    } else if (t >= seg.t_end) {
      candidate = mid
      lo = mid + 1
    } else {
      return { state: 'covered', segment: seg, index: mid, localSec: (t - seg.t_start) / 1000 }
    }
  }

  const first = segments[0]!
  const last = segments[segments.length - 1]!
  if (t < first.t_start) return { state: 'before', nextStart: first.t_start }
  if (t >= last.t_end) return { state: 'after', prevEnd: last.t_end }
  const prev = segments[candidate]
  const next = segments[candidate + 1]
  return { state: 'gap', prevEnd: prev?.t_end ?? first.t_start, nextStart: next?.t_start ?? last.t_end }
}

/** The next segment boundary in a direction, for the n and p keys. */
export function nextBoundary(source: PlaybackSource, tMaster: number, direction: 1 | -1): number | null {
  const t = mediaTimeOf(source, tMaster)
  const points = source.segments.flatMap((s) => [s.t_start, s.t_end]).sort((a, b) => a - b)
  if (direction === 1) {
    const found = points.find((p) => p > t + 1)
    return found === undefined ? null : found + source.clock_offset_ms
  }
  const before = points.filter((p) => p < t - 1)
  const found = before[before.length - 1]
  return found === undefined ? null : found + source.clock_offset_ms
}

/** Fraction of the window any source could speak about, which is the coverage score. */
export function windowCoverage(sources: PlaybackSource[], window: [number, number]): number {
  const [start, end] = window
  const span = Math.max(1, end - start)
  const intervals: [number, number][] = []
  for (const source of sources) {
    for (const seg of source.segments) {
      const a = Math.max(start, seg.t_start + source.clock_offset_ms)
      const b = Math.min(end, seg.t_end + source.clock_offset_ms)
      if (b > a) intervals.push([a, b])
    }
  }
  intervals.sort((x, y) => x[0] - y[0])
  let covered = 0
  let cursorEnd = start
  for (const [a, b] of intervals) {
    if (b <= cursorEnd) continue
    covered += b - Math.max(a, cursorEnd)
    cursorEnd = b
  }
  return Math.min(1, covered / span)
}
