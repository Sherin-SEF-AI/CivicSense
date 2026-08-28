'use client'

import { useEffect, useRef, useState } from 'react'
import type { MasterClock } from '@/lib/playback/clock'
import { Glyph } from '@/components/glyphs'
import { KeyHint } from '@/components/primitives/chips'
import { PLAYBACK_RATES, type PlaybackRate } from '@/lib/playback/frames'
import { useTransport } from '@/lib/playback/store'
import { fmtTime, fmtTransport } from '@/lib/format'

/** Transport controls. The clock readout writes itself, never through React. */
export function TransportBar({
  clock,
  window: worldWindow,
  focusedLabel,
  focusedFps,
  onStep,
  onBoundary,
}: {
  clock: MasterClock
  window: [number, number]
  focusedLabel: string
  focusedFps: number | null
  onStep: (direction: 1 | -1) => void
  onBoundary: (direction: 1 | -1) => void
}) {
  const readoutRef = useRef<HTMLSpanElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const [playing, setPlaying] = useState(false)
  const rate = useTransport((s) => s.rate)
  const setRate = useTransport((s) => s.setRate)
  const setPlayingState = useTransport((s) => s.setPlaying)

  useEffect(() => {
    const sync = () => {
      setPlaying(clock.isPlaying())
      setPlayingState(clock.isPlaying())
    }
    sync()
    return clock.subscribeTransport(sync)
  }, [clock, setPlayingState])

  useEffect(() => {
    return clock.subscribe((t) => {
      const readout = readoutRef.current
      if (readout) {
        const text = fmtTime(t)
        if (readout.textContent !== text) readout.textContent = text
      }
      const elapsed = elapsedRef.current
      if (elapsed) {
        const text = fmtTransport(t - worldWindow[0])
        if (elapsed.textContent !== text) elapsed.textContent = text
      }
    })
  }, [clock, worldWindow])

  return (
    <div className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-1.5">
      <button
        type="button"
        onClick={() => clock.toggle()}
        title={playing ? 'pause (space)' : 'play (space)'}
        aria-label={playing ? 'pause' : 'play'}
        className="step flex h-6 w-6 items-center justify-center border border-[var(--line-1)] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
        style={{ borderRadius: 'var(--radius-chip)' }}
      >
        <Glyph name={playing ? 'scrubber' : 'clip'} size={12} />
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onStep(-1)}
          title="previous frame (,)"
          aria-label="previous frame"
          className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          ,
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          title="next frame (.)"
          aria-label="next frame"
          className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          .
        </button>
      </div>

      <span className="mono flex items-baseline gap-2">
        <span ref={readoutRef} className="text-[13px] text-[var(--ink-0)]">
          {fmtTime(worldWindow[0])}
        </span>
        <span ref={elapsedRef} className="text-[11px] text-[var(--ink-2)]">
          00:00:00.000
        </span>
      </span>

      <div className="flex items-center gap-0.5" role="group" aria-label="playback rate">
        {PLAYBACK_RATES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={rate === r}
            onClick={() => {
              setRate(r as PlaybackRate)
              clock.setRate(r)
            }}
            className="mono step border px-1 py-0.5 text-[11px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: rate === r ? 'var(--live)' : 'var(--line-0)',
              color: rate === r ? 'var(--live)' : 'var(--ink-2)',
            }}
          >
            {r}x
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onBoundary(-1)}
          title="previous segment boundary (p)"
          className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          prev seg
        </button>
        <button
          type="button"
          onClick={() => onBoundary(1)}
          title="next segment boundary (n)"
          className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          next seg
        </button>
      </div>

      <span className="mono ml-auto flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
        stepping {focusedLabel}
        {focusedFps === null ? (
          <span style={{ color: 'var(--medium)' }}>no frame rate on the focused tile</span>
        ) : (
          <span>{focusedFps} fps</span>
        )}
        <KeyHint keys="space" />
        <KeyHint keys=", ." />
      </span>
    </div>
  )
}
