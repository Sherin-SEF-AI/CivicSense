import type { PlaybackSource, TimelineEventTick } from '@/lib/api/schemas'
import { chooseStep, firstTickAtOrAfter, minorStep, tickLabel } from './ticks'
import { levelFor, type Pyramid } from './pyramid'
import { xOf, type View } from './transform'
import { CANVAS } from '@/lib/tokens'

export const RULER_H = 24
export const LANE_H = 34

export interface Lane {
  id: string
  kind: 'video' | 'sensor' | 'event'
  label: string
  source: PlaybackSource
  pyramid?: Pyramid
  unit?: string
  limit?: number | null
}

export interface Hit {
  x0: number
  x1: number
  laneIndex: number
  kind: 'segment' | 'event'
  label: string
  t: number
  evidenceId: string | null
}

const COLORS = {
  ruler: CANVAS.ink2,
  grid: CANVAS.line0,
  block: CANVAS.deckBlock,
  blockEdge: CANVAS.line1,
  sensor: CANVAS.live,
  sensorFill: CANVAS.liveFill,
  limit: CANVAS.high,
  event: CANVAS.medium,
  laneBg: CANVAS.bg1,
  laneAlt: CANVAS.deckLaneAlt,
}

/** Built once at module scope: creating a pattern per draw is a hidden cost. */
let hatch: CanvasPattern | null = null
function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatch) return hatch
  const tile = document.createElement('canvas')
  tile.width = 8
  tile.height = 8
  const tctx = tile.getContext('2d')
  if (!tctx) return null
  tctx.strokeStyle = 'rgba(90,101,112,0.28)'
  tctx.lineWidth = 1
  tctx.beginPath()
  tctx.moveTo(-2, 10)
  tctx.lineTo(10, -2)
  tctx.moveTo(2, 14)
  tctx.lineTo(14, 2)
  tctx.stroke()
  hatch = ctx.createPattern(tile, 'repeat')
  return hatch
}

export function drawDeck(
  ctx: CanvasRenderingContext2D,
  view: View,
  lanes: Lane[],
  ticks: TimelineEventTick[],
  height: number,
  selection: [number, number] | null,
): Hit[][] {
  const width = view.width
  ctx.clearRect(0, 0, width, height)
  const hits: Hit[][] = lanes.map(() => [])

  /* Ruler */
  const { step, precision } = chooseStep(view.msPerPx)
  const minor = minorStep(step)
  ctx.fillStyle = COLORS.laneBg
  ctx.fillRect(0, 0, width, RULER_H)

  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let t = firstTickAtOrAfter(view.t0, minor); xOf(view, t) < width; t += minor) {
    const x = Math.round(xOf(view, t)) + 0.5
    if (x < 0) continue
    ctx.moveTo(x, RULER_H - 5)
    ctx.lineTo(x, RULER_H)
  }
  ctx.stroke()

  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  ctx.beginPath()
  for (let t = firstTickAtOrAfter(view.t0, step); xOf(view, t) < width; t += step) {
    const x = Math.round(xOf(view, t)) + 0.5
    if (x < -40) continue
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.fillStyle = COLORS.ruler
    ctx.fillText(tickLabel(t, precision), x + 4, RULER_H / 2)
  }
  ctx.strokeStyle = COLORS.grid
  ctx.stroke()

  /* Selected range sits behind the lanes so it never hides a block. */
  if (selection) {
    const x0 = xOf(view, selection[0])
    const x1 = xOf(view, selection[1])
    ctx.fillStyle = 'rgba(88,166,255,0.10)'
    ctx.fillRect(x0, RULER_H, x1 - x0, height - RULER_H)
    ctx.strokeStyle = COLORS.sensor
    ctx.beginPath()
    ctx.moveTo(Math.round(x0) + 0.5, RULER_H)
    ctx.lineTo(Math.round(x0) + 0.5, height)
    ctx.moveTo(Math.round(x1) + 0.5, RULER_H)
    ctx.lineTo(Math.round(x1) + 0.5, height)
    ctx.stroke()
  }

  lanes.forEach((lane, i) => {
    const y = RULER_H + i * LANE_H
    if (y > height) return
    ctx.fillStyle = i % 2 === 0 ? COLORS.laneBg : COLORS.laneAlt
    ctx.fillRect(0, y, width, LANE_H)
    ctx.strokeStyle = COLORS.grid
    ctx.beginPath()
    ctx.moveTo(0, y + LANE_H - 0.5)
    ctx.lineTo(width, y + LANE_H - 0.5)
    ctx.stroke()

    if (lane.kind === 'video') {
      drawVideoLane(ctx, view, lane, y, hits[i]!, i)
    } else if (lane.kind === 'sensor') {
      drawSensorLane(ctx, view, lane, y)
    }
  })

  /* Event ticks are drawn last so they sit above lane content. */
  const laneIndexById = new Map(lanes.map((l, i) => [l.source.source_id, i]))
  for (const tick of ticks) {
    const laneIndex = laneIndexById.get(tick.source_id)
    if (laneIndex === undefined) continue
    const x = xOf(view, tick.t)
    if (x < -8 || x > width + 8) continue
    const y = RULER_H + laneIndex * LANE_H
    ctx.fillStyle = COLORS.event
    ctx.beginPath()
    ctx.moveTo(x, y + 5)
    ctx.lineTo(x + 4, y + 10)
    ctx.lineTo(x, y + 15)
    ctx.lineTo(x - 4, y + 10)
    ctx.closePath()
    ctx.fill()
    hits[laneIndex]!.push({
      x0: x - 5,
      x1: x + 5,
      laneIndex,
      kind: 'event',
      label: tick.label,
      t: tick.t,
      evidenceId: tick.evidence_id,
    })
  }

  for (const list of hits) list.sort((a, b) => a.x0 - b.x0)
  return hits
}

function drawVideoLane(
  ctx: CanvasRenderingContext2D,
  view: View,
  lane: Lane,
  y: number,
  hits: Hit[],
  laneIndex: number,
) {
  const top = y + 7
  const h = LANE_H - 15
  const segments = lane.source.segments
  const offset = lane.source.clock_offset_ms

  /* Gaps are hatched, which is what makes an absence legible rather than an
     empty stretch the eye slides over. */
  const pattern = hatchPattern(ctx)
  if (pattern && segments.length > 0) {
    const first = segments[0]!.t_start + offset
    const last = segments[segments.length - 1]!.t_end + offset
    ctx.save()
    ctx.beginPath()
    ctx.rect(xOf(view, first), top, xOf(view, last) - xOf(view, first), h)
    ctx.clip()
    ctx.fillStyle = pattern
    ctx.fillRect(xOf(view, first), top, xOf(view, last) - xOf(view, first), h)
    ctx.restore()
  }

  for (const seg of segments) {
    const x0 = xOf(view, seg.t_start + offset)
    const x1 = xOf(view, seg.t_end + offset)
    if (x1 < -4 || x0 > view.width + 4) continue
    const w = Math.max(2, x1 - x0)
    ctx.fillStyle = COLORS.block
    ctx.fillRect(x0, top, w, h)
    ctx.strokeStyle = COLORS.blockEdge
    ctx.strokeRect(Math.round(x0) + 0.5, top + 0.5, Math.round(w) - 1, h - 1)
    hits.push({
      x0,
      x1,
      laneIndex,
      kind: 'segment',
      label: `${lane.source.label} clip, ${(seg.t_end - seg.t_start) / 1000}s at ${seg.fps}fps`,
      t: seg.t_start + offset,
      evidenceId: null,
    })
  }
}

function drawSensorLane(ctx: CanvasRenderingContext2D, view: View, lane: Lane, y: number) {
  const pyramid = lane.pyramid
  if (!pyramid || pyramid.levels.length === 0) return
  const level = levelFor(pyramid, view.msPerPx)
  if (!level) return

  const top = y + 4
  const h = LANE_H - 9
  const [lo, hi] = pyramid.range
  const span = Math.max(1e-6, hi - lo)
  const yOf = (v: number) => top + h - ((v - lo) / span) * h

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, y, view.width, LANE_H)
  ctx.clip()

  if (lane.limit !== undefined && lane.limit !== null && lane.limit >= lo && lane.limit <= hi) {
    ctx.strokeStyle = COLORS.limit
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    const ly = Math.round(yOf(lane.limit)) + 0.5
    ctx.moveTo(0, ly)
    ctx.lineTo(view.width, ly)
    ctx.stroke()
    ctx.setLineDash([])
  }

  /* One column per pixel: the draw is O(viewport width), not O(series length). */
  const path = new Path2D()
  const fill = new Path2D()
  let started = false
  for (let px = 0; px <= view.width; px++) {
    const t = view.t0 + px * view.msPerPx
    const index = Math.floor((t - level.t0) / level.bucketMs)
    if (index < 0 || index >= level.min.length) continue
    const minY = yOf(level.min[index]!)
    const maxY = yOf(level.max[index]!)
    fill.moveTo(px + 0.5, minY)
    fill.lineTo(px + 0.5, maxY)
    if (!started) {
      path.moveTo(px + 0.5, maxY)
      started = true
    } else {
      path.lineTo(px + 0.5, maxY)
    }
  }
  ctx.strokeStyle = COLORS.sensorFill
  ctx.lineWidth = 1
  ctx.stroke(fill)
  ctx.strokeStyle = COLORS.sensor
  ctx.stroke(path)
  ctx.restore()
}

export function probeHits(hits: Hit[][], x: number, y: number): Hit | null {
  const laneIndex = Math.floor((y - RULER_H) / LANE_H)
  const lane = hits[laneIndex]
  if (!lane) return null
  let best: Hit | null = null
  let bestDistance = Infinity
  for (const hit of lane) {
    if (x < hit.x0 - 4 || x > hit.x1 + 4) continue
    const center = (hit.x0 + hit.x1) / 2
    const distance = Math.abs(center - x)
    if (distance < bestDistance) {
      bestDistance = distance
      best = hit
    }
  }
  return best
}
