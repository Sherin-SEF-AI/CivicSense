'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Glyph, type GlyphName } from '@/components/glyphs'
import type { IncidentStatus } from '@/lib/api/schemas'
import { INCIDENT_STATUSES } from '@/lib/api/schemas/common'
import { fmtScore } from '@/lib/format'

export function MetricTile({
  label,
  value,
  unit,
  delta,
  glyph,
  tone = 'neutral',
}: {
  label: string
  value: string
  unit?: string
  delta?: { value: string; direction: 'up' | 'down' | 'flat' }
  glyph?: GlyphName
  tone?: 'neutral' | 'ok' | 'warn' | 'bad'
}) {
  const toneColor =
    tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--medium)' : tone === 'bad' ? 'var(--critical)' : 'var(--ink-0)'
  return (
    <div className="flex min-w-0 flex-col gap-1 border border-[var(--line-0)] bg-[var(--bg-2)] px-3 py-2" style={{ borderRadius: 'var(--radius-card)' }}>
      <div className="flex items-center gap-2">
        {glyph ? (
          <span className="text-[var(--ink-2)]">
            <Glyph name={glyph} size={14} />
          </span>
        ) : null}
        <span className="overline truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="mono text-[20px] leading-[1.2]" style={{ color: toneColor }}>
          {value}
        </span>
        {unit ? <span className="mono text-[11px] text-[var(--ink-2)]">{unit}</span> : null}
        {delta ? (
          <span
            className="mono ml-auto text-[11px]"
            style={{
              color: delta.direction === 'up' ? 'var(--ok)' : delta.direction === 'down' ? 'var(--critical)' : 'var(--ink-2)',
            }}
          >
            {delta.direction === 'up' ? '+' : delta.direction === 'down' ? '-' : ''}
            {delta.value}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The seven-stage progression.
 *
 * Seven labels do not fit across a 400px drawer, and shrinking them to fit makes
 * a row of unreadable stubs. So the strip shows seven segments and names only
 * the stage the incident is actually at, with the position spelled out. Hovering
 * a segment names it.
 */
export function StepStrip({ status, dismissed = false }: { status: IncidentStatus; dismissed?: boolean }) {
  const index = INCIDENT_STATUSES.indexOf(status)
  return (
    <div className="flex flex-col gap-1">
      <ol className="flex items-center gap-1" aria-label={`incident progress: ${status}`}>
        {INCIDENT_STATUSES.map((step, i) => {
          const done = i <= index && !dismissed
          return (
            <li key={step} className="flex-1" title={step}>
              <span
                aria-hidden
                style={{
                  display: 'block',
                  height: 3,
                  background: dismissed ? 'var(--line-0)' : done ? (i === index ? 'var(--live)' : 'var(--ink-2)') : 'var(--line-0)',
                }}
              />
            </li>
          )
        })}
      </ol>
      <div className="mono flex items-baseline gap-2 text-[11px]">
        <span style={{ color: dismissed ? 'var(--critical)' : 'var(--live)' }}>{dismissed ? 'dismissed' : status}</span>
        <span className="text-[var(--ink-3)]">
          stage {index + 1} of {INCIDENT_STATUSES.length}
        </span>
        <span className="ml-auto text-[var(--ink-3)]">
          {index + 1 < INCIDENT_STATUSES.length && !dismissed ? `next ${INCIDENT_STATUSES[index + 1]}` : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * The six severity components as one stacked bar. Each segment is labelled with
 * its contribution, because the whole argument of the product is that a score is
 * inspectable rather than pronounced.
 */
export function StackedSeverityBar({
  components,
  score,
}: {
  components: { key: string; label: string; raw: number; weight: number; contribution: number; note: string }[]
  score: number
}) {
  const total = components.reduce((s, c) => s + c.contribution, 0) || 1
  const SHADES = ['var(--ink-0)', 'var(--ink-1)', 'var(--live)', 'var(--medium)', 'var(--high)', 'var(--violet)']
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-4 w-full overflow-hidden border border-[var(--line-0)]" style={{ borderRadius: 'var(--radius-chip)' }}>
        {components.map((c, i) => (
          <span
            key={c.key}
            title={`${c.label}: raw ${fmtScore(c.raw)} x weight ${fmtScore(c.weight)} = ${fmtScore(c.contribution, 3)}`}
            style={{ width: `${(c.contribution / total) * 100}%`, background: SHADES[i % SHADES.length], opacity: 0.85 }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1">
        {components.map((c, i) => (
          <div key={c.key} className="contents">
            <dt className="flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--ink-1)]">
              <span aria-hidden style={{ width: 8, height: 8, background: SHADES[i % SHADES.length], flex: 'none' }} />
              <span className="truncate" title={c.note}>
                {c.label}
              </span>
            </dt>
            <dd className="mono text-[12.5px] text-[var(--ink-2)]">{fmtScore(c.raw)}</dd>
            <dd className="mono text-[12.5px] text-[var(--ink-3)]">x{fmtScore(c.weight)}</dd>
            <dd className="mono text-[12.5px] text-[var(--ink-0)]">{fmtScore(c.contribution, 3)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-baseline justify-between border-t border-[var(--line-0)] pt-2">
        <span className="overline">composite severity</span>
        <span className="mono text-[16px] text-[var(--ink-0)]">{fmtScore(score, 3)}</span>
      </div>
    </div>
  )
}

export function EmptyState({
  line,
  actionLabel,
  onAction,
  glyph = 'search',
}: {
  line: string
  actionLabel?: string
  onAction?: () => void
  glyph?: GlyphName
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="text-[var(--ink-3)]">
        <Glyph name={glyph} size={20} />
      </span>
      <p className="mono text-[12.5px] text-[var(--ink-2)]">{line}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

/** Static loading blocks matching the final layout. No shimmer anywhere. */
export function LoadingBlocks({ rows = 6, height = 32 }: { rows?: number; height?: number }) {
  return (
    <div role="status" className="flex flex-col gap-px" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height, background: 'var(--bg-2)' }} />
      ))}
    </div>
  )
}

export function ErrorPanel({
  code,
  detail,
  onRetry,
}: {
  code: string
  detail: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex flex-col gap-2 border border-[var(--critical)] bg-[var(--bg-2)] p-3"
      style={{ borderRadius: 'var(--radius-card)' }}
      role="alert"
    >
      <div className="flex items-center gap-2" style={{ color: 'var(--critical)' }}>
        <Glyph name="tampered" size={14} />
        <span className="mono text-[12.5px]">{code}</span>
      </div>
      <p className="text-[12.5px] text-[var(--ink-1)]">{detail}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mono step self-start border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          retry
        </button>
      ) : null}
    </div>
  )
}

export function Collapsible({
  title,
  defaultOpen = true,
  children,
  right,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  right?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="border-b border-[var(--line-0)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="step flex min-w-0 flex-1 items-center gap-2 text-left text-[var(--ink-1)] hover:text-[var(--ink-0)]"
        >
          <Glyph name={open ? 'chevron-s' : 'chevron-e'} size={12} />
          <span className="overline truncate">{title}</span>
        </button>
        {right}
      </div>
      {open ? (
        <div id={id} className="px-3 pb-3">
          {children}
        </div>
      ) : null}
    </section>
  )
}

/** Resizable side panel. Width is persisted per key so a layout survives reloads. */
export function useResizable(storageKey: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  const dragging = useRef(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) setWidth(Math.min(max, Math.max(min, Number(stored))))
    } catch {
      /* storage can be unavailable; the default width is fine */
    }
  }, [storageKey, min, max])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const next = Math.min(max, Math.max(min, window.innerWidth - e.clientX))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      try {
        window.localStorage.setItem(storageKey, String(width))
      } catch {
        /* not persisting a panel width is not worth surfacing */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [storageKey, width, min, max])

  return { width, startDrag: () => { dragging.current = true } }
}
