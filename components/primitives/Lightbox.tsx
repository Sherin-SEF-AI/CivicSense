'use client'

import { useCallback, useEffect, useState } from 'react'
import { Glyph } from '@/components/glyphs'
import { fmtTime } from '@/lib/format'

export interface LightboxItem {
  id: string
  label: string
  t: number
  url: string
  annotations: { x: number; y: number; w: number; h: number; label: string; track_id: string | null }[]
}

/**
 * Full-frame evidence view with the annotation overlay toggle.
 *
 * The overlay is off by default and clearly labelled when on, because an
 * annotated frame is a derived view and an investigator has to be able to see
 * the original without leaving the tool.
 */
export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: LightboxItem[]
  index: number
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const [overlay, setOverlay] = useState(false)
  const item = items[index]

  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      onIndex((index + delta + items.length) % items.length)
    },
    [index, items.length, onIndex],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'o') setOverlay((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  if (!item) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`evidence ${item.label}`}
      className="fixed inset-0 z-50 flex flex-col bg-[rgba(8,9,11,0.94)]"
    >
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] px-3 py-2">
        <span className="text-[13px] text-[var(--ink-0)]">{item.label}</span>
        <span className="mono text-[12.5px] text-[var(--ink-2)]">{fmtTime(item.t)}</span>
        <span className="mono text-[11px] text-[var(--ink-3)]">{item.id}</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-pressed={overlay}
            onClick={() => setOverlay((v) => !v)}
            title="toggle annotation overlay (o)"
            className="mono step flex items-center gap-1.5 border px-2 py-1 text-[12.5px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: overlay ? 'var(--live)' : 'var(--line-1)',
              color: overlay ? 'var(--live)' : 'var(--ink-1)',
            }}
          >
            <Glyph name="redaction" size={12} />
            overlay {overlay ? 'on' : 'off'}
          </button>
          <span className="mono text-[11px] text-[var(--ink-2)]">
            {index + 1}/{items.length}
          </span>
          <button type="button" onClick={onClose} aria-label="close" title="close (esc)" className="step text-[var(--ink-1)] hover:text-[var(--ink-0)]">
            <Glyph name="close" size={16} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="previous"
          className="step absolute left-2 z-10 p-2 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name="chevron-e" size={20} style={{ transform: 'rotate(180deg)' }} />
        </button>

        <div className="relative max-h-full max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.label} className="max-h-[calc(100vh-140px)] max-w-full object-contain" />
          {overlay ? (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              {item.annotations.map((a, i) => (
                <g key={i}>
                  <rect
                    x={a.x}
                    y={a.y}
                    width={a.w}
                    height={a.h}
                    fill="none"
                    stroke="var(--live)"
                    strokeWidth={0.0016}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>
          ) : null}
          {overlay ? (
            <div className="pointer-events-none absolute inset-0">
              {item.annotations.map((a, i) => (
                <span
                  key={i}
                  className="mono absolute bg-[rgba(8,9,11,0.8)] px-1 text-[11px]"
                  style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: 'translateY(-100%)', color: 'var(--live)' }}
                >
                  {a.label}
                  {a.track_id ? ` ${a.track_id}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="next"
          className="step absolute right-2 z-10 p-2 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name="chevron-e" size={20} />
        </button>
      </div>

      {overlay ? (
        <footer className="mono flex-none border-t border-[var(--line-0)] px-3 py-1.5 text-[11px] text-[var(--medium)]">
          annotated view, derived from the original. the unannotated frame is the evidence of record.
        </footer>
      ) : null}
    </div>
  )
}
