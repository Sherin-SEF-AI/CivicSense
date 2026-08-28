'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlaybackSource } from '@/lib/api/schemas'
import type { MasterClock } from '@/lib/playback/clock'
import { coverageAt } from '@/lib/playback/coverage'
import { VideoSlave } from '@/lib/playback/videoSlave'
import { useTransport } from '@/lib/playback/store'
import { SourceGlyph, SyncGrade } from '@/components/primitives/indicators'
import { Glyph } from '@/components/glyphs'
import { fmtDuration, fmtTime } from '@/lib/format'

/**
 * One synchronized video tile.
 *
 * The tile subscribes to the clock outside React and drives its own element, so
 * nothing here re-renders during playback. React only sees the discrete state:
 * which segment is loaded, whether there is coverage, and the drift badge.
 */
export function VideoTile({
  source,
  clock,
  focused,
  onFocus,
  onMeasure,
}: {
  source: PlaybackSource
  clock: MasterClock
  focused: boolean
  onFocus: () => void
  onMeasure?: (measurement: { distanceM: number; uncertaintyM: number } | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const slaveRef = useRef<VideoSlave | null>(null)
  const overlayRef = useRef<HTMLSpanElement>(null)
  const [coverage, setCoverage] = useState<'covered' | 'gap' | 'before' | 'after' | 'none'>('none')
  const [gapText, setGapText] = useState('')
  const drift = useTransport((s) => s.drift[source.source_id] ?? 0)
  const desynced = useTransport((s) => s.desynced[source.source_id] ?? false)
  const reportDrift = useTransport((s) => s.reportDrift)
  const markDesynced = useTransport((s) => s.markDesynced)
  const measuring = useTransport((s) => s.measuring)
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const slave = new VideoSlave(video, source, {
      onDrift: (ms) => reportDrift(source.source_id, ms),
      onDesync: (value) => markDesynced(source.source_id, value),
      onSegmentChange: () => undefined,
    })
    slaveRef.current = slave
    return () => {
      slaveRef.current = null
    }
  }, [source, reportDrift, markDesynced])

  useEffect(() => {
    return clock.subscribe((t) => {
      const slave = slaveRef.current
      const state = useTransport.getState()
      slave?.tick(t, state.playing, state.rate)

      const cover = coverageAt(source, t)
      setCoverage((prev) => (prev === cover.state ? prev : cover.state))
      if (cover.state === 'gap') {
        setGapText(`gap ${fmtDuration(cover.nextStart - cover.prevEnd)}, next at ${fmtTime(cover.nextStart, { ms: false })}`)
      } else if (cover.state === 'before') {
        setGapText(`starts ${fmtTime(cover.nextStart, { ms: false })}`)
      } else if (cover.state === 'after') {
        setGapText(`ended ${fmtTime(cover.prevEnd, { ms: false })}`)
      }

      const overlay = overlayRef.current
      if (overlay) {
        const text = fmtTime(t - source.clock_offset_ms, { zone: false })
        if (overlay.textContent !== text) overlay.textContent = text
      }
    })
  }, [clock, source])

  const measurement = (() => {
    if (measurePoints.length < 2 || !source.homography) return null
    const [a, b] = measurePoints as [{ x: number; y: number }, { x: number; y: number }]
    /* Ground distance through the stored homography. The uncertainty is carried
       from the calibration residual, which is why a measurement is reported as
       an interval and demoted to indicative when it is wide. */
    const h = source.homography
    const project = (p: { x: number; y: number }) => {
      const w = h[6]! * p.x + h[7]! * p.y + h[8]!
      return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w }
    }
    const pa = project(a)
    const pb = project(b)
    const distanceM = Math.hypot(pb.x - pa.x, pb.y - pa.y) / 8
    const uncertaintyM = (source.calibration_residual_m ?? 0.4) * 2.2
    return { distanceM, uncertaintyM }
  })()

  useEffect(() => {
    onMeasure?.(measurement)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurement?.distanceM])

  const driftLabel = Math.abs(drift) < 1 ? '0 ms' : `${drift > 0 ? '+' : ''}${drift.toFixed(0)} ms`

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
        <SourceGlyph type={source.source_type} size={12} />
        <span className="text-[var(--ink-1)]">{source.source_id}</span>
        <SyncGrade grade={source.sync_quality} />
        <span
          title={`measured drift against the master clock, offset ${source.clock_offset_ms} ms`}
          style={{ color: desynced ? 'var(--critical)' : Math.abs(drift) > 120 ? 'var(--medium)' : 'var(--ink-3)' }}
        >
          {desynced ? 'desynced' : driftLabel}
        </span>
        <span ref={overlayRef} className="ml-auto text-[var(--ink-2)]">
          --:--:--.---
        </span>
      </header>

      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          style={{ visibility: coverage === 'covered' ? 'visible' : 'hidden' }}
          playsInline
          muted
          preload="auto"
        />

        {coverage !== 'covered' ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1"
            style={{ background: 'var(--bg-1)' }}
          >
            <span className="text-[var(--ink-3)]">
              <Glyph name="tampered" size={16} />
            </span>
            <span className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
              no coverage
            </span>
            <span className="mono text-[11px] text-[var(--ink-3)]">{gapText}</span>
          </div>
        ) : null}

        {measuring && source.homography ? (
          <div
            className="absolute inset-0 cursor-crosshair"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
              setMeasurePoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]))
            }}
          >
            <svg className="pointer-events-none h-full w-full">
              {measurePoints.map((p, i) => (
                <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="none" stroke="var(--live)" />
              ))}
              {measurePoints.length === 2 ? (
                <line
                  x1={measurePoints[0]!.x}
                  y1={measurePoints[0]!.y}
                  x2={measurePoints[1]!.x}
                  y2={measurePoints[1]!.y}
                  stroke="var(--live)"
                  strokeDasharray="3 3"
                />
              ) : null}
            </svg>
            {measurement ? (
              <span
                className="mono absolute bottom-1 left-1 bg-[rgba(8,9,11,0.82)] px-1 text-[11px]"
                style={{ color: measurement.uncertaintyM > 1.2 ? 'var(--medium)' : 'var(--live)' }}
              >
                {measurement.distanceM.toFixed(1)} m ± {measurement.uncertaintyM.toFixed(1)} m ·{' '}
                {measurement.uncertaintyM > 1.2 ? 'indicative' : 'measured'}
              </span>
            ) : (
              <span className="mono absolute bottom-1 left-1 bg-[rgba(8,9,11,0.82)] px-1 text-[11px] text-[var(--ink-2)]">
                click two ground points
              </span>
            )}
          </div>
        ) : null}
      </div>
    </button>
  )
}
