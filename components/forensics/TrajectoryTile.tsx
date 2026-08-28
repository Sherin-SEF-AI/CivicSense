'use client'

import { useEffect, useRef } from 'react'
import type { EntityDossier, TrackKinematics } from '@/lib/api/schemas'
import type { MasterClock } from '@/lib/playback/clock'
import { Glyph } from '@/components/glyphs'
import { fmtTime } from '@/lib/format'
import { CANVAS } from '@/lib/tokens'

/**
 * The ground-plane view.
 *
 * No camera provides the answer to where things actually moved, so the stage
 * always carries this tile. It draws to a canvas from a clock subscription and
 * interpolates between track samples, which is why it can update at sixty hertz
 * without touching React or re-tiling a map.
 */
export function TrajectoryTile({
  clock,
  tracks,
  entities,
  window: worldWindow,
  focused,
  onFocus,
}: {
  clock: MasterClock
  tracks: TrackKinematics[]
  entities: EntityDossier[]
  window: [number, number]
  focused: boolean
  onFocus: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const drawRef = useRef<((t: number) => void) | null>(null)
  const lastTRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const resize = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(host.clientWidth * dpr)
      canvas.height = Math.round(host.clientHeight * dpr)
      canvas.style.width = `${host.clientWidth}px`
      canvas.style.height = `${host.clientHeight}px`
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      /* Resizing the backing store clears it, so redraw at the current instant
         rather than waiting for a tick that will not come while paused. */
      drawRef.current?.(lastTRef.current)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const points = [
      ...tracks.flatMap((t) => t.samples.map((s) => ({ lat: s.lat, lon: s.lon }))),
      ...entities.flatMap((e) => e.path.map((p) => ({ lat: p.lat, lon: p.lon }))),
    ]
    if (points.length === 0) return

    const lons = points.map((p) => p.lon)
    const lats = points.map((p) => p.lat)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const padLon = (maxLon - minLon) * 0.25 || 0.0006
    const padLat = (maxLat - minLat) * 0.25 || 0.0006

    const project = (lon: number, lat: number, w: number, h: number) => ({
      x: ((lon - (minLon - padLon)) / (maxLon - minLon + padLon * 2)) * w,
      y: h - ((lat - (minLat - padLat)) / (maxLat - minLat + padLat * 2)) * h,
    })

    const COLORS = [CANVAS.live, CANVAS.violet, CANVAS.medium, CANVAS.ok]

    const draw = (t: number) => {
      lastTRef.current = t
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)

      /* Ground grid, so distance on this tile reads as distance rather than as
         an abstract plot. */
      ctx.strokeStyle = CANVAS.line0
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < 6; i++) {
        const x = (w / 6) * i
        const y = (h / 6) * i
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, h)
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(w, Math.round(y) + 0.5)
      }
      ctx.stroke()

      tracks.forEach((track, i) => {
        const color = COLORS[i % COLORS.length]!
        const samples = track.samples
        if (samples.length === 0) return

        ctx.strokeStyle = 'rgba(154,163,173,0.32)'
        ctx.beginPath()
        samples.forEach((s, k) => {
          const p = project(s.lon, s.lat, w, h)
          if (k === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()

        /* Travelled portion is drawn solid up to the playhead, so the tile shows
           where the entity is now and where it has already been. */
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.beginPath()
        let started = false
        for (const s of samples) {
          if (s.t > t) break
          const p = project(s.lon, s.lat, w, h)
          if (!started) {
            ctx.moveTo(p.x, p.y)
            started = true
          } else {
            ctx.lineTo(p.x, p.y)
          }
        }
        ctx.stroke()
        ctx.lineWidth = 1

        let before = samples[0]!
        let after = samples[samples.length - 1]!
        for (let k = 0; k < samples.length - 1; k++) {
          if (samples[k]!.t <= t && samples[k + 1]!.t >= t) {
            before = samples[k]!
            after = samples[k + 1]!
            break
          }
        }
        const span = Math.max(1, after.t - before.t)
        const u = Math.min(1, Math.max(0, (t - before.t) / span))
        const lon = before.lon + (after.lon - before.lon) * u
        const lat = before.lat + (after.lat - before.lat) * u
        const p = project(lon, lat, w, h)
        ctx.fillStyle = color
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6)
        ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'
        ctx.fillText(track.track_id, p.x + 7, p.y + 3)
      })

      const readout = readoutRef.current
      if (readout) {
        const text = fmtTime(t, { zone: false })
        if (readout.textContent !== text) readout.textContent = text
      }
    }

    drawRef.current = draw
    const unsubscribe = clock.subscribe(draw)
    return () => {
      drawRef.current = null
      unsubscribe()
    }
  }, [clock, tracks, entities, worldWindow])

  return (
    <button
      type="button"
      onClick={onFocus}
      className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border text-left"
      style={{
        borderColor: focused ? 'var(--live)' : 'var(--line-0)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-2)',
      }}
    >
      <header className="mono flex flex-none items-center gap-1.5 border-b border-[var(--line-0)] px-1.5 py-1 text-[11px]">
        <Glyph name="trajectory" size={12} />
        <span className="text-[var(--ink-1)]">ground plane</span>
        <span className="text-[var(--ink-3)]">{tracks.length} tracks</span>
        <span ref={readoutRef} className="ml-auto text-[var(--ink-2)]">
          --:--:--
        </span>
      </header>
      <div ref={hostRef} className="min-h-0 flex-1">
        <canvas ref={canvasRef} className="block" />
      </div>
    </button>
  )
}
