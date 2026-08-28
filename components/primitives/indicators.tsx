'use client'

import type { Domain, PriorityBand, SourceType, SyncQuality, WarningLevel } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import {
  AUTHENTICITY_COLOR,
  AUTHENTICITY_GLYPH,
  DOMAIN_COLOR,
  DOMAIN_GLYPH,
  PRIORITY_COLOR,
  PRIORITY_MARK,
  SOURCE_GLYPH,
  STATE_COLOR,
  SYNC_COLOR,
  WARNING_COLOR,
} from '@/lib/tokens'
import { fmtPct, fmtScore } from '@/lib/format'

/** The 2px priority spine that runs down the left edge of every incident row. */
export function PriorityBar({
  priority,
  blink = false,
  height,
}: {
  priority: PriorityBand
  blink?: boolean
  height?: number | string
}) {
  return (
    <span
      aria-hidden
      className={blink && priority === 'CRITICAL' ? 'blink-critical' : undefined}
      style={{
        display: 'block',
        width: 2,
        height: height ?? '100%',
        background: PRIORITY_COLOR[priority],
        flex: 'none',
      }}
    />
  )
}

export function PriorityTag({ priority, blink = false }: { priority: PriorityBand; blink?: boolean }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1 px-1 text-[11px] leading-[16px] ${blink && priority === 'CRITICAL' ? 'blink-critical' : ''}`}
      style={{
        color: PRIORITY_COLOR[priority],
        border: `1px solid ${PRIORITY_COLOR[priority]}`,
        borderRadius: 'var(--radius-chip)',
      }}
      title={`priority ${priority.toLowerCase()}`}
    >
      {PRIORITY_MARK[priority]}
    </span>
  )
}

export function DomainGlyph({ domain, size = 14, withLabel = false }: { domain: Domain; size?: number; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ color: DOMAIN_COLOR[domain] }}>
      <Glyph name={DOMAIN_GLYPH[domain]} size={size} label={withLabel ? undefined : domain} />
      {withLabel ? <span className="text-[12.5px] text-[var(--ink-1)]">{domain}</span> : null}
    </span>
  )
}

export function SourceGlyph({ type, size = 14 }: { type: SourceType; size?: number }) {
  return <Glyph name={SOURCE_GLYPH[type]} size={size} label={type} />
}

export function StatusLED({
  state,
  label,
}: {
  state: keyof typeof STATE_COLOR | 'green' | 'amber' | 'red'
  label?: string
}) {
  const color =
    state === 'green'
      ? 'var(--ok)'
      : state === 'amber'
        ? 'var(--medium)'
        : state === 'red'
          ? 'var(--critical)'
          : STATE_COLOR[state]
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      title={label ?? state}
      style={{ display: 'inline-block', width: 6, height: 6, background: color, flex: 'none' }}
    />
  )
}

/** A/B/C/D clock alignment. The letter is the point, the colour is the reminder. */
export function SyncGrade({ grade, size = 'sm' }: { grade: SyncQuality; size?: 'sm' | 'md' }) {
  const tolerance = grade === 'A' ? 'under 10 ms' : grade === 'B' ? 'under 100 ms' : grade === 'C' ? 'under 1 s' : 'unknown'
  return (
    <span
      className={`mono inline-flex items-center justify-center ${size === 'sm' ? 'h-4 w-4 text-[11px]' : 'h-5 w-5 text-[12.5px]'}`}
      style={{ color: SYNC_COLOR[grade], border: `1px solid ${SYNC_COLOR[grade]}`, borderRadius: 'var(--radius-chip)' }}
      title={`sync ${grade}, ${tolerance}`}
    >
      {grade}
    </span>
  )
}

export function TrustBar({ trust, width = 48 }: { trust: number; width?: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={`trust ${fmtScore(trust)}`}>
      <span
        aria-hidden
        style={{ display: 'block', width, height: 6, border: '1px solid var(--line-1)', position: 'relative' }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            width: `${Math.round(trust * 100)}%`,
            background: trust > 0.8 ? 'var(--ok)' : trust > 0.6 ? 'var(--medium)' : 'var(--critical)',
          }}
        />
      </span>
      <span className="mono text-[11px] text-[var(--ink-1)]">{fmtScore(trust)}</span>
    </span>
  )
}

/**
 * A value with its interval, both as text and as a 24px band. The band is what
 * makes a wide interval visible at a glance in a dense table.
 */
export function ConfidenceInterval({
  value,
  lo,
  hi,
  digits = 2,
  bandWidth = 24,
}: {
  value: number
  lo: number
  hi: number
  digits?: number
  bandWidth?: number
}) {
  const span = Math.max(1e-6, hi - lo)
  const markerPct = Math.min(100, Math.max(0, ((value - lo) / span) * 100))
  return (
    <span className="mono inline-flex items-center gap-2 text-[12.5px] whitespace-nowrap">
      <span>{value.toFixed(digits)}</span>
      <span
        aria-hidden
        style={{ position: 'relative', width: bandWidth, height: 8, borderLeft: '1px solid var(--line-1)', borderRight: '1px solid var(--line-1)' }}
      >
        <span style={{ position: 'absolute', top: 3, left: 0, right: 0, height: 1, background: 'var(--line-1)' }} />
        <span style={{ position: 'absolute', top: 1, left: `${markerPct}%`, width: 1, height: 6, background: 'var(--ink-0)' }} />
      </span>
      <span className="text-[var(--ink-2)]">
        [{lo.toFixed(digits)}-{hi.toFixed(digits)}]
      </span>
    </span>
  )
}

export function AuthenticityDot({ verdict }: { verdict: keyof typeof AUTHENTICITY_COLOR }) {
  return (
    <span className="inline-flex items-center" style={{ color: AUTHENTICITY_COLOR[verdict] }} title={`authenticity ${verdict}`}>
      <Glyph name={AUTHENTICITY_GLYPH[verdict]} size={14} label={`authenticity ${verdict}`} />
    </span>
  )
}

export function WarningLevelGlyph({ level, size = 14 }: { level: WarningLevel; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ color: WARNING_COLOR[level] }}>
      <Glyph name="warning-level" size={size} label={`warning level ${level.toLowerCase()}`} />
      <span className="mono text-[11px]">{level}</span>
    </span>
  )
}

export function Meter({
  value,
  max,
  width = 64,
  danger = 0.9,
  label,
}: {
  value: number
  max: number
  width?: number
  danger?: number
  label?: string
}) {
  const ratio = max <= 0 ? 0 : Math.min(1.15, value / max)
  const color = ratio >= 1 ? 'var(--critical)' : ratio >= danger ? 'var(--high)' : 'var(--ok)'
  /* A bar with a label is a meter, and saying so gives a screen reader the
     number rather than only the sentence wrapped around it. */
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={label}
      title={label ?? `${fmtPct(ratio)} of budget`}
      style={{ display: 'inline-block', width, height: 6, border: '1px solid var(--line-1)', position: 'relative' }}
    >
      <span style={{ position: 'absolute', inset: 0, width: `${Math.min(100, ratio * 100)}%`, background: color }} />
    </span>
  )
}
