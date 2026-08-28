/**
 * The one time-to-pixel transform every timeline layer shares.
 *
 * State is t0 plus msPerPx rather than t0 plus t1: keeping both ends invites
 * float drift when zoom and pan interleave, and the playhead and the ruler must
 * agree to the pixel or deep zoom looks broken.
 */
export interface View {
  t0: number
  msPerPx: number
  width: number
}

export const MIN_MS_PER_PX = 0.2

export const xOf = (v: View, t: number): number => (t - v.t0) / v.msPerPx
export const tOf = (v: View, x: number): number => v.t0 + x * v.msPerPx
export const t1Of = (v: View): number => v.t0 + v.width * v.msPerPx

export function maxMsPerPx(world: [number, number], width: number): number {
  return Math.max(MIN_MS_PER_PX, (world[1] - world[0]) / Math.max(1, width))
}

export function clampPan(v: View, world: [number, number]): View {
  const span = v.width * v.msPerPx
  const overscroll = span * 0.05
  const min = world[0] - overscroll
  const max = world[1] + overscroll - span
  return { ...v, t0: Math.min(Math.max(v.t0, min), Math.max(min, max)) }
}

export function zoomAt(v: View, px: number, factor: number, world: [number, number]): View {
  const anchor = tOf(v, px)
  const msPerPx = Math.min(maxMsPerPx(world, v.width), Math.max(MIN_MS_PER_PX, v.msPerPx * factor))
  return clampPan({ ...v, msPerPx, t0: anchor - px * msPerPx }, world)
}

export function panBy(v: View, px: number, world: [number, number]): View {
  return clampPan({ ...v, t0: v.t0 + px * v.msPerPx }, world)
}

export function fit(world: [number, number], width: number): View {
  const msPerPx = maxMsPerPx(world, width)
  return { t0: world[0], msPerPx, width }
}

export function zoomToRange(range: [number, number], width: number, world: [number, number]): View {
  const span = Math.max(40, range[1] - range[0])
  const msPerPx = Math.min(maxMsPerPx(world, width), Math.max(MIN_MS_PER_PX, span / Math.max(1, width)))
  return clampPan({ t0: range[0], msPerPx, width }, world)
}
