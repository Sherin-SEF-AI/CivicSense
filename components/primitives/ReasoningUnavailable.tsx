'use client'

import type { IncidentSummary, IntelligencePackage } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'

export interface ReasoningUnavailable {
  error: 'reasoning_unavailable'
  detail: string
  incident: IncidentSummary
}

export function isUnavailable(
  value: IntelligencePackage | ReasoningUnavailable | undefined,
): value is ReasoningUnavailable {
  return value !== undefined && 'error' in value
}

/**
 * Shown when the understanding tier has not produced a package.
 *
 * The alternative would be to render a plausible looking package assembled
 * without a model, which is the one thing this product must never do. An absent
 * assessment is a fact about the deployment, and it is stated as one.
 */
export function ReasoningUnavailablePanel({
  detail,
  onRetry,
  retrying,
}: {
  detail: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <section
      className="flex flex-col gap-2 border p-3"
      style={{ borderColor: 'var(--medium)', borderRadius: 'var(--radius-card)' }}
    >
      <div className="flex items-center gap-2" style={{ color: 'var(--medium)' }}>
        <Glyph name="model" size={14} />
        <span className="mono text-[12.5px]">no assessment for this incident</span>
      </div>
      <p className="text-[12.5px] leading-[1.4] text-[var(--ink-1)]">{detail}</p>
      <p className="mono text-[11px] text-[var(--ink-3)]">
        the incident, its observations and its severity are unaffected: those are computed from the evidence and are shown
        above. only the written assessment is missing.
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mono step self-start border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)] disabled:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          {retrying ? 'running the understanding pass' : 'run the understanding pass'}
        </button>
      ) : null}
    </section>
  )
}
