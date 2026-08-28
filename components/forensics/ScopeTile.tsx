'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlaybackSource, SensorSeries } from '@/lib/api/schemas'
import type { MasterClock } from '@/lib/playback/clock'
import { ScopeChart } from '@/components/data/ScopeChart'
import { SourceGlyph } from '@/components/primitives/indicators'
import { fmtTime } from '@/lib/format'
import { CANVAS } from '@/lib/tokens'

/**
 * The sensor scope.
 *
 * The cursor follows the master clock through uPlot's own cursor API, which is a
 * cheap partial redraw. Rescaling the axis continuously would force a full
 * replot every frame, so the window is paged: it jumps by most of a window when
 * the playhead leaves the visible band.
 */
export function ScopeTile({
  source,
  series,
  clock,
  focused,
  onFocus,
}: {
  source: PlaybackSource
  series: SensorSeries | undefined
  clock: MasterClock
  focused: boolean
  onFocus: () => void
}) {
  const [cursorTime, setCursorTime] = useState<number | null>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const lastRef = useRef(0)

  useEffect(() => {
    return clock.subscribe((t) => {
      /* Four hertz into React is enough for a cursor; the readout below is
         written directly and stays at frame rate. */
      if (t - lastRef.current > 250 || t < lastRef.current) {
        lastRef.current = t
        setCursorTime(t)
      }
      const readout = readoutRef.current
      if (!readout || !series) return
      const index = Math.floor((t - series.from) / Math.max(1, series.bucket_ms))
      const bucket = series.buckets[Math.min(Math.max(0, index), series.buckets.length - 1)]
      if (!bucket) return
      const value = ((bucket[1] + bucket[2]) / 2).toFixed(1)
      const text = `${value} ${series.unit}`
      if (readout.textContent !== text) readout.textContent = text
    })
  }, [clock, series])

  if (!series) {
    return (
      <div
        className="flex min-h-0 min-w-0 items-center justify-center border"
        style={{ borderColor: 'var(--line-0)', borderRadius: 'var(--radius-card)', background: 'var(--bg-2)' }}
      >
        <span className="mono text-[11px] text-[var(--ink-3)]">series unavailable for {source.source_id}</span>
      </div>
    )
  }

  const x = series.buckets.map((b) => b[0])
  const values = series.buckets.map((b) => (b[1] + b[2]) / 2)
  const lo = series.buckets.map((b) => b[1])
  const hi = series.buckets.map((b) => b[2])

  return (
    <button
      type="button"
      onClick={onFocus}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border text-left"
      style={{
        borderColor: focused ? 'var(--live)' : 'var(--line-0)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-2)',
      }}
    >
      <header className="mono flex flex-none items-center gap-1.5 border-b border-[var(--line-0)] px-1.5 py-1 text-[11px]">
        <SourceGlyph type={source.source_type} size={12} />
        <span className="text-[var(--ink-1)]">{source.source_id}</span>
        <span className="text-[var(--ink-3)]">{series.kind}</span>
        <span ref={readoutRef} className="ml-auto text-[var(--ink-0)]">
          --
        </span>
      </header>
      <div className="min-h-0 flex-1 px-1 pt-1">
        <ScopeChart
          x={x}
          series={[
            {
              label: series.kind,
              color: CANVAS.live,
              fill: CANVAS.liveFill,
              values,
              band: { lo, hi },
              unit: series.unit,
            },
          ]}
          height={140}
          limit={series.limit}
          limitLabel={series.limit === null ? undefined : `limit ${series.limit} ${series.unit}`}
          cursorTime={cursorTime}
        />
      </div>
      <footer className="mono flex-none px-1.5 pb-1 text-[11px] text-[var(--ink-3)]">
        representativity {series.representativity_m} m · window {fmtTime(series.from, { ms: false })} to{' '}
        {fmtTime(series.to, { ms: false })}
      </footer>
    </button>
  )
}
