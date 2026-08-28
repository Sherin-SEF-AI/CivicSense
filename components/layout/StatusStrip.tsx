'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Glyph } from '@/components/glyphs'
import { Meter, StatusLED } from '@/components/primitives/indicators'
import { PRIORITY_BANDS } from '@/lib/api/schemas/common'
import type { PriorityBand } from '@/lib/api/schemas'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { fmtTime, fmtUsd } from '@/lib/format'
import { PRIORITY_COLOR, PRIORITY_MARK } from '@/lib/tokens'
import { useConnectionState, useLiveCounts, useStreamEvents } from '@/lib/stream/StreamProvider'

const CONNECTION_LABEL = {
  connecting: 'connecting',
  live: 'sse live',
  reconnecting: 'reconnecting',
  offline: 'offline',
} as const

const CONNECTION_COLOR = {
  connecting: 'var(--medium)',
  live: 'var(--ok)',
  reconnecting: 'var(--high)',
  offline: 'var(--critical)',
} as const

/**
 * The always-visible instrument strip.
 *
 * The clock writes itself directly to the DOM every 200ms rather than through
 * React state: it is the one element on screen that changes constantly, and it
 * should not cost a render tree walk to do it.
 */
export function StatusStrip() {
  const clockRef = useRef<HTMLSpanElement>(null)
  const spendRef = useRef<HTMLSpanElement>(null)
  const connection = useConnectionState()
  const liveCounts = useLiveCounts()
  const [spend, setSpend] = useState<{ today: number; budget: number } | null>(null)

  const { data: health } = useQuery({
    queryKey: qk.system.health(),
    queryFn: ({ signal }) => api.systemHealth(signal),
    refetchInterval: 20_000,
  })

  useEffect(() => {
    const write = () => {
      if (clockRef.current) clockRef.current.textContent = fmtTime(Date.now(), { ms: false })
    }
    write()
    const id = setInterval(write, 200)
    return () => clearInterval(id)
  }, [])

  /* Spend ticks at 1Hz on the stream. It never enters the query cache. */
  useStreamEvents((event) => {
    if (event.type !== 'spend.tick') return
    setSpend({ today: event.payload.today_usd, budget: event.payload.budget_usd })
    if (spendRef.current) spendRef.current.textContent = fmtUsd(event.payload.today_usd)
  })

  const counts: Record<PriorityBand, number> = health
    ? { ...health.incident_counts, ...stripZeroes(liveCounts) }
    : liveCounts

  const todaySpend = spend?.today ?? health?.spend.today_usd ?? 0
  const budget = spend?.budget ?? health?.spend.budget_usd ?? 12

  return (
    <header
      className="flex flex-none items-center gap-4 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3"
      style={{ height: 'var(--strip-h)' }}
      aria-label="system status"
    >
      <span className="mono flex items-center gap-1.5 text-[12.5px] text-[var(--ink-0)]">
        <span ref={clockRef}>--:--:-- IST</span>
      </span>

      <span className="h-4 w-px bg-[var(--line-0)]" aria-hidden />

      <ul className="flex items-center gap-2" aria-label="live incident counts">
        {PRIORITY_BANDS.map((band) => (
          <li key={band} className="mono flex items-center gap-1 text-[12.5px]" title={`${band.toLowerCase()} open in the last 6 hours`}>
            <span style={{ color: PRIORITY_COLOR[band] }}>{PRIORITY_MARK[band]}</span>
            <span className="text-[var(--ink-1)]">{counts[band] ?? 0}</span>
          </li>
        ))}
      </ul>

      <span className="h-4 w-px bg-[var(--line-0)]" aria-hidden />

      <span className="flex items-center gap-1.5" title="groq role health: scene, context, forensic, guard, audio">
        <span className="overline">roles</span>
        <span className="flex items-center gap-1">
          {(health?.roles ?? []).map((role) => (
            <StatusLED key={role.role} state={role.state} label={`${role.label}: ${role.state}${role.fallback_active ? ', fallback active' : ''}`} />
          ))}
          {health ? null : <span className="mono text-[11px] text-[var(--ink-3)]">-----</span>}
        </span>
      </span>

      <span className="flex items-center gap-1.5 text-[var(--ink-2)]" title="edge fleet up of total">
        <Glyph name="edge-device" size={14} />
        <span className="mono text-[12.5px] text-[var(--ink-1)]">
          {health ? `${health.edge.up}/${health.edge.total}` : '--/--'}
        </span>
        {health && health.edge.degraded > 0 ? (
          <span className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
            {health.edge.degraded} degraded
          </span>
        ) : null}
      </span>

      <span className="flex items-center gap-1.5" title="model spend today against the daily budget">
        <span className="text-[var(--ink-2)]">
          <Glyph name="budget" size={14} />
        </span>
        <span ref={spendRef} className="mono text-[12.5px] text-[var(--ink-1)]">
          {fmtUsd(todaySpend)}
        </span>
        <span className="mono text-[11px] text-[var(--ink-3)]">/ {fmtUsd(budget, 0)}</span>
        <Meter value={todaySpend} max={budget} width={48} label={`spend ${fmtUsd(todaySpend)} of ${fmtUsd(budget, 0)}`} />
      </span>

      <span className="ml-auto flex items-center gap-1.5" title={`stream ${CONNECTION_LABEL[connection]}`}>
        <StatusLED
          state={connection === 'live' ? 'green' : connection === 'offline' ? 'red' : 'amber'}
          label={`stream ${CONNECTION_LABEL[connection]}`}
        />
        <span className="mono text-[11px]" style={{ color: CONNECTION_COLOR[connection] }}>
          {CONNECTION_LABEL[connection]}
        </span>
      </span>
    </header>
  )
}

/** Live counts start at zero before the first stream frame; do not blank the strip with them. */
function stripZeroes(counts: Record<PriorityBand, number>): Partial<Record<PriorityBand, number>> {
  const total = PRIORITY_BANDS.reduce((s, b) => s + (counts[b] ?? 0), 0)
  return total === 0 ? {} : counts
}
