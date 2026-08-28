'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { fmtClock } from '@/lib/format'
import { CANVAS } from '@/lib/tokens'

export interface ScopeSeries {
  label: string
  color: string
  /** Parallel to x. A null gap renders as a break, not as a zero. */
  values: (number | null)[]
  /** Optional band drawn behind the line, for stated uncertainty. */
  band?: { lo: (number | null)[]; hi: (number | null)[] }
  /** Literal fill for the band. Canvas cannot read a CSS variable. */
  fill?: string
  unit?: string
}

/**
 * uPlot wrapper with the product's axes: monospace labels, hairline grid, no
 * chart junk. A readout follows the cursor, because in an operations tool the
 * question is almost always "what was the value at this instant" rather than
 * "what is the general shape".
 */
export function ScopeChart({
  x,
  series,
  height = 140,
  limit,
  limitLabel,
  cursorTime,
  onCursorTime,
  yRange,
}: {
  x: number[]
  series: ScopeSeries[]
  height?: number
  limit?: number | null
  limitLabel?: string
  cursorTime?: number | null
  onCursorTime?: (t: number | null) => void
  yRange?: [number, number]
}) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const onCursor = useRef(onCursorTime)
  onCursor.current = onCursorTime

  useEffect(() => {
    const node = host.current
    if (!node) return

    const data: uPlot.AlignedData = [
      x,
      ...series.flatMap((s) => (s.band ? [s.band.lo, s.band.hi, s.values] : [s.values])),
    ] as unknown as uPlot.AlignedData

    const seriesOpts: uPlot.Series[] = [{}]
    for (const s of series) {
      if (s.band) {
        seriesOpts.push(
          { stroke: 'transparent', fill: s.fill ?? CANVAS.liveFill, points: { show: false }, label: `${s.label} lo` },
          { stroke: 'transparent', fill: s.fill ?? CANVAS.liveFill, points: { show: false }, label: `${s.label} hi` },
        )
      }
      seriesOpts.push({
        label: s.label,
        stroke: s.color,
        width: 1,
        points: { show: false },
        value: (_u, v) => (v === null ? '--' : `${v.toFixed(1)}${s.unit ? ` ${s.unit}` : ''}`),
      })
    }

    const instance = new uPlot(
      {
        width: node.clientWidth || 320,
        height,
        padding: [8, 8, 0, 0],
        cursor: {
          y: false,
          drag: { x: false, y: false },
          points: { show: false },
        },
        legend: { show: false },
        scales: {
          x: { time: false },
          y: yRange ? { range: yRange } : {},
        },
        axes: [
          {
            stroke: CANVAS.ink2,
            grid: { stroke: CANVAS.line0, width: 1 },
            ticks: { stroke: CANVAS.line0, width: 1 },
            font: '11px "IBM Plex Mono", monospace',
            /* Precision follows the visible span: clock times repeat and stop
               meaning anything once a chart covers more than a day. */
            values: (u, splits) => {
              const span = (splits[splits.length - 1] ?? 0) - (splits[0] ?? 0)
              const precision = span > 48 * 3600_000 ? 'd' : span > 2 * 3600_000 ? 'h' : 'm'
              void u
              return splits.map((t) => fmtClock(t, precision))
            },
            size: 24,
          },
          {
            stroke: CANVAS.ink2,
            grid: { stroke: CANVAS.line0, width: 1 },
            ticks: { show: false },
            font: '11px "IBM Plex Mono", monospace',
            size: 44,
          },
        ],
        series: seriesOpts,
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx
              onCursor.current?.(idx === null || idx === undefined ? null : (u.data[0]?.[idx] as number))
            },
          ],
          draw: [
            (u) => {
              if (limit === undefined || limit === null) return
              const ctx = u.ctx
              const yPos = u.valToPos(limit, 'y', true)
              ctx.save()
              ctx.strokeStyle = CANVAS.high
              ctx.setLineDash([4, 3])
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(u.bbox.left, yPos)
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos)
              ctx.stroke()
              ctx.restore()
            },
          ],
        },
      },
      data,
      node,
    )
    plot.current = instance

    const ro = new ResizeObserver(() => {
      instance.setSize({ width: node.clientWidth || 320, height })
    })
    ro.observe(node)

    return () => {
      ro.disconnect()
      instance.destroy()
      plot.current = null
    }
  }, [x, series, height, limit, yRange])

  /* Driving the cursor from outside is how the scope tile follows the master
     clock without a React render per frame. */
  useEffect(() => {
    const instance = plot.current
    if (!instance || cursorTime === undefined || cursorTime === null) return
    const left = instance.valToPos(cursorTime, 'x')
    instance.setCursor({ left, top: 0 }, false)
  }, [cursorTime])

  return (
    <div className="relative w-full">
      <div ref={host} className="w-full" />
      {limitLabel && limit !== undefined && limit !== null ? (
        <span className="mono pointer-events-none absolute top-1 right-2 text-[11px] text-[var(--high)]">{limitLabel}</span>
      ) : null}
    </div>
  )
}
