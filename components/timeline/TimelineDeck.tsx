'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlaybackSource, SensorSeries, TimelineEventTick } from '@/lib/api/schemas'
import type { MasterClock } from '@/lib/playback/clock'
import { buildPyramid } from '@/lib/timeline/pyramid'
import { drawDeck, LANE_H, RULER_H, probeHits, type Hit, type Lane } from '@/lib/timeline/draw'
import { clampPan, fit, panBy, tOf, xOf, zoomAt, zoomToRange, type View } from '@/lib/timeline/transform'
import { SourceGlyph, SyncGrade } from '@/components/primitives/indicators'
import { fmtDuration, fmtTime } from '@/lib/format'
import { useTransport } from '@/lib/playback/store'

const GUTTER_W = 148

/**
 * The timeline deck.
 *
 * Three layers chosen by how often each changes, not by what each contains.
 * Lane content is canvas because it is static under playback. The playhead is a
 * single DOM node moved by transform, because it is the only thing that moves at
 * sixty frames and putting it on the canvas would force a full repaint every
 * frame. The gutter is DOM because it needs focus, labels and hit targets.
 *
 * Follow mode is paged rather than continuous: when the playhead crosses 85 per
 * cent of the viewport the domain jumps by most of a window in one step. A
 * continuous recentre would dirty the canvas on every frame, and a hard jump
 * reads as deliberate rather than as drift.
 */
export function TimelineDeck({
  clock,
  sources,
  ticks,
  series,
  window: worldWindow,
  onSeek,
}: {
  clock: MasterClock
  sources: PlaybackSource[]
  ticks: TimelineEventTick[]
  series: Record<string, SensorSeries>
  window: [number, number]
  onSeek: (t: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const hitsRef = useRef<Hit[][]>([])
  const viewRef = useRef<View>({ t0: worldWindow[0], msPerPx: 200, width: 800 })
  const dirtyRef = useRef(true)
  const rafRef = useRef<number | null>(null)
  const followRef = useRef(true)

  const [tooltip, setTooltip] = useState<{ x: number; y: number; hit: Hit } | null>(null)
  const [, forceRender] = useState(0)
  const selection = useTransport((s) => s.selection)
  const setSelection = useTransport((s) => s.setSelection)

  const lanes = useMemo<Lane[]>(
    () =>
      sources.map((source) => {
        const s = series[source.source_id]
        return {
          id: source.source_id,
          kind: source.tile_kind === 'scope' ? 'sensor' : source.segments.length > 0 ? 'video' : 'event',
          label: source.label,
          source,
          pyramid: s ? buildPyramid(s.buckets, s.bucket_ms) : undefined,
          unit: s?.unit,
          limit: s?.limit ?? null,
        }
      }),
    [sources, series],
  )

  const height = RULER_H + lanes.length * LANE_H

  const scheduleDraw = useCallback(() => {
    dirtyRef.current = true
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      hitsRef.current = drawDeck(ctx, viewRef.current, lanes, ticks, height, selection)
    })
  }, [lanes, ticks, height, selection])

  /* Backing store follows both size and device pixel ratio, so moving the window
     to a different monitor does not leave a blurred canvas behind. */
  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const resize = () => {
      const width = Math.max(120, host.clientWidth - GUTTER_W)
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      const previous = viewRef.current
      viewRef.current =
        previous.width <= 1 ? fit(worldWindow, width) : clampPan({ ...previous, width }, worldWindow)
      scheduleDraw()
      forceRender((n) => n + 1)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mq.addEventListener('change', resize)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', resize)
    }
  }, [height, worldWindow, scheduleDraw])

  useEffect(() => {
    scheduleDraw()
  }, [scheduleDraw, selection])

  /* Sixty hertz work: one transform write and one text write, nothing else. */
  useEffect(() => {
    return clock.subscribe((t) => {
      const view = viewRef.current
      const x = xOf(view, t)
      const node = playheadRef.current
      if (node) {
        node.style.transform = `translate3d(${Math.round(x)}px,0,0)`
        node.style.visibility = x < 0 || x > view.width ? 'hidden' : 'visible'
      }
      const readout = readoutRef.current
      if (readout) {
        const text = fmtTime(t)
        if (readout.textContent !== text) readout.textContent = text
      }
      if (followRef.current && (x > view.width * 0.85 || x < 0)) {
        viewRef.current = clampPan({ ...view, t0: t - view.width * view.msPerPx * 0.15 }, worldWindow)
        scheduleDraw()
      }
    })
  }, [clock, worldWindow, scheduleDraw])

  const pointerRef = useRef<{
    mode: 'scrub' | 'marquee' | 'select' | null
    startX: number
    startT: number
  }>({ mode: null, startX: 0, startT: 0 })

  const localX = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return clientX - (rect?.left ?? 0)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const x = localX(e.clientX)
    const rect = canvasRef.current?.getBoundingClientRect()
    const y = e.clientY - (rect?.top ?? 0)
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = tOf(viewRef.current, x)

    if (y < RULER_H) {
      followRef.current = false
      pointerRef.current = { mode: 'scrub', startX: x, startT: t }
      onSeek(t)
      return
    }
    pointerRef.current = { mode: e.shiftKey ? 'select' : 'marquee', startX: x, startT: t }
    if (e.shiftKey) setSelection([t, t])
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const x = localX(e.clientX)
    const rect = canvasRef.current?.getBoundingClientRect()
    const y = e.clientY - (rect?.top ?? 0)
    const state = pointerRef.current

    if (state.mode === 'scrub') {
      onSeek(tOf(viewRef.current, x))
      return
    }
    if (state.mode === 'select') {
      const t = tOf(viewRef.current, x)
      setSelection([Math.min(state.startT, t), Math.max(state.startT, t)])
      return
    }
    if (state.mode === 'marquee') return

    const hit = probeHits(hitsRef.current, x, y)
    setTooltip(hit ? { x, y, hit } : null)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const state = pointerRef.current
    const x = localX(e.clientX)
    if (state.mode === 'marquee' && Math.abs(x - state.startX) > 6) {
      const a = Math.min(state.startT, tOf(viewRef.current, x))
      const b = Math.max(state.startT, tOf(viewRef.current, x))
      viewRef.current = zoomToRange([a, b], viewRef.current.width, worldWindow)
      followRef.current = false
      scheduleDraw()
    } else if (state.mode === 'marquee') {
      onSeek(tOf(viewRef.current, x))
    }
    pointerRef.current = { mode: null, startX: 0, startT: 0 }
  }

  const onWheel = (e: React.WheelEvent) => {
    const x = localX(e.clientX)
    followRef.current = false
    if (e.shiftKey) {
      viewRef.current = panBy(viewRef.current, e.deltaY, worldWindow)
    } else {
      viewRef.current = zoomAt(viewRef.current, x, Math.exp(e.deltaY * 0.002), worldWindow)
    }
    scheduleDraw()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const view = viewRef.current
      if (e.key === '[') {
        viewRef.current = zoomAt(view, view.width / 2, 1.6, worldWindow)
      } else if (e.key === ']') {
        viewRef.current = zoomAt(view, view.width / 2, 1 / 1.6, worldWindow)
      } else if (e.key === 'F') {
        viewRef.current = fit(worldWindow, view.width)
        followRef.current = true
      } else if (e.key === 'z' && selection) {
        viewRef.current = zoomToRange(selection, view.width, worldWindow)
      } else {
        return
      }
      e.preventDefault()
      scheduleDraw()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [worldWindow, selection, scheduleDraw])

  const view = viewRef.current

  return (
    <div ref={hostRef} className="relative flex min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-1)]">
      <div className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] px-2 py-1">
        <span className="overline">deck</span>
        <span ref={readoutRef} className="mono text-[12.5px] text-[var(--ink-0)]">
          {fmtTime(worldWindow[0])}
        </span>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          window {fmtDuration(view.width * view.msPerPx)} · {view.msPerPx.toFixed(1)} ms/px
        </span>
        {selection ? (
          <span className="mono flex items-center gap-2 text-[11px]" style={{ color: 'var(--live)' }}>
            range {fmtDuration(selection[1] - selection[0])}
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="step border border-[var(--line-1)] px-1 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
              style={{ borderRadius: 'var(--radius-chip)' }}
            >
              clear
            </button>
          </span>
        ) : null}
        <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">
          drag to zoom · shift-drag to select · wheel to zoom · [ ] zoom · F fit · z to selection
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-y-auto">
        <div className="flex-none border-r border-[var(--line-0)]" style={{ width: GUTTER_W }}>
          <div style={{ height: RULER_H }} className="border-b border-[var(--line-0)] bg-[var(--bg-1)]" />
          {lanes.map((lane, i) => (
            <div
              key={lane.id}
              className="flex items-center gap-1.5 border-b border-[var(--line-0)] px-2"
              style={{ height: LANE_H, background: i % 2 === 0 ? 'var(--bg-1)' : 'var(--bg-2)' }}
            >
              <span className="text-[var(--ink-2)]">
                <SourceGlyph type={lane.source.source_type} size={12} />
              </span>
              <span className="mono truncate text-[11px] text-[var(--ink-1)]" title={lane.label}>
                {lane.source.source_id}
              </span>
              <span className="ml-auto">
                <SyncGrade grade={lane.source.sync_quality} />
              </span>
            </div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className="block cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setTooltip(null)}
            onWheel={onWheel}
            role="img"
            aria-label="source coverage timeline"
          />
          <div
            ref={playheadRef}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px"
            style={{ background: 'var(--live)', left: 0, willChange: 'transform' }}
          >
            <span className="absolute top-0 -left-[3px] h-2 w-[7px]" style={{ background: 'var(--live)' }} />
          </div>

          {tooltip ? (
            <div
              className="pointer-events-none absolute z-10 border border-[var(--line-1)] bg-[var(--bg-1)] px-2 py-1"
              style={{
                left: Math.min(tooltip.x + 10, view.width - 240),
                top: tooltip.y + 12,
                borderRadius: 'var(--radius-chip)',
                boxShadow: 'var(--overlay-shadow)',
              }}
            >
              <p className="text-[12.5px] text-[var(--ink-0)]">{tooltip.hit.label}</p>
              <p className="mono text-[11px] text-[var(--ink-2)]">{fmtTime(tooltip.hit.t)}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
