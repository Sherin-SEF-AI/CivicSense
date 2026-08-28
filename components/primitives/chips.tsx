'use client'

import { useEffect, useRef, useState } from 'react'
import { Glyph, type GlyphName } from '@/components/glyphs'
import { fmtDuration, shortHash } from '@/lib/format'
import { useNow } from '@/lib/useNow'

/**
 * A hash chip. Eight hex characters plus the chain glyph, and clicking it opens
 * custody. The point of showing the hash at all is that a number an operator can
 * read back is what makes the chain feel like a fact rather than a claim.
 */
export function HashChip({
  hash,
  onOpen,
  verified = true,
}: {
  hash: string
  onOpen?: (hash: string) => void
  verified?: boolean
}) {
  const Tag = onOpen ? 'button' : 'span'
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: () => onOpen(hash) } : {})}
      title={`${hash}\nclick to open custody`}
      className="mono step inline-flex items-center gap-1 border border-[var(--line-0)] bg-[var(--bg-2)] px-1 text-[11px] leading-[16px] text-[var(--ink-1)] hover:border-[var(--line-1)] hover:text-[var(--ink-0)]"
      style={{ borderRadius: 'var(--radius-chip)' }}
    >
      <Glyph name="hash" size={12} />
      {shortHash(hash)}
      {verified ? null : <Glyph name="tampered" size={12} />}
    </Tag>
  )
}

/** Citation chip. Every model claim carries these and they open the item. */
export function EvidenceChip({
  id,
  onOpen,
  invalid = false,
}: {
  id: string
  onOpen?: (id: string) => void
  invalid?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(id)}
      title={invalid ? `${id} does not resolve, claim confidence lowered` : id}
      className="mono step inline-flex items-center gap-1 border px-1 text-[11px] leading-[16px]"
      style={{
        borderRadius: 'var(--radius-chip)',
        borderColor: invalid ? 'var(--critical)' : 'var(--line-0)',
        color: invalid ? 'var(--critical)' : 'var(--ink-1)',
        background: 'var(--bg-2)',
      }}
    >
      <Glyph name={invalid ? 'tampered' : 'keyframe'} size={12} />
      {id.length > 14 ? `${id.slice(0, 6)}..${id.slice(-6)}` : id}
    </button>
  )
}

export function FilterChip({
  label,
  count,
  active,
  onToggle,
  glyph,
  color,
}: {
  label: string
  count?: number
  active: boolean
  onToggle: () => void
  glyph?: GlyphName
  color?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className="mono step inline-flex h-[22px] items-center gap-1.5 border px-1.5 text-[11px] whitespace-nowrap"
      style={{
        borderRadius: 'var(--radius-chip)',
        borderColor: active ? 'var(--line-1)' : 'var(--line-0)',
        background: active ? 'var(--bg-3)' : 'transparent',
        color: active ? 'var(--ink-0)' : 'var(--ink-2)',
      }}
    >
      {glyph ? (
        <span style={{ color: active ? (color ?? 'var(--ink-0)') : (color ?? 'var(--ink-2)') }}>
          <Glyph name={glyph} size={12} />
        </span>
      ) : null}
      {label}
      {count === undefined ? null : <span style={{ color: 'var(--ink-3)' }}>{count}</span>}
    </button>
  )
}

/**
 * The SLA countdown. It turns amber inside the last fifth and red inside the
 * last twentieth, and it counts in real time because a static due-time does not
 * create the pressure the number exists to create.
 */
export function SLACountdown({ dueAt, slaSeconds }: { dueAt: number | null; slaSeconds: number }) {
  const now = useNow(1000)

  if (now === null) {
    return <span className="mono text-[12.5px] text-[var(--ink-3)]">--:--:--</span>
  }
  if (dueAt === null) {
    return <span className="mono text-[12.5px] text-[var(--ink-3)]">no sla</span>
  }
  const remaining = dueAt - now
  const fraction = slaSeconds > 0 ? remaining / (slaSeconds * 1000) : 0
  const color =
    remaining <= 0 ? 'var(--critical)' : fraction < 0.05 ? 'var(--critical)' : fraction < 0.2 ? 'var(--high)' : 'var(--ink-1)'
  return (
    <span className="mono text-[12.5px]" style={{ color }} title={remaining <= 0 ? 'sla breached' : 'time remaining on the sla'}>
      {remaining <= 0 ? `-${fmtDuration(-remaining)}` : fmtDuration(remaining)}
    </span>
  )
}

export function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1200)
      }}
      title={`copy ${value}`}
      className="mono step inline-flex items-center gap-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
    >
      {label ?? value}
      <Glyph name={copied ? 'acknowledge' : 'copy'} size={12} />
    </button>
  )
}

export function Overline({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`overline ${className}`}>{children}</div>
}

export function KeyHint({ keys }: { keys: string }) {
  return (
    <span
      className="mono inline-flex items-center border border-[var(--line-0)] px-1 text-[11px] leading-[14px] text-[var(--ink-2)]"
      style={{ borderRadius: 'var(--radius-chip)' }}
    >
      {keys}
    </span>
  )
}
