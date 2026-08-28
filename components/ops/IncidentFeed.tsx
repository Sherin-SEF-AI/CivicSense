'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { IncidentSummary, PriorityBand } from '@/lib/api/schemas'
import { PRIORITY_BANDS } from '@/lib/api/schemas/common'
import { Glyph } from '@/components/glyphs'
import { DomainGlyph, PriorityBar, SyncGrade } from '@/components/primitives/indicators'
import { fmtDuration, fmtScore } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { PRIORITY_COLOR, PRIORITY_MARK } from '@/lib/tokens'
import { useUi } from '@/lib/stores/ui'

type Row =
  | { kind: 'group'; band: PriorityBand; count: number }
  | { kind: 'incident'; incident: IncidentSummary }

/**
 * The incident feed.
 *
 * Rows are grouped by priority band with sticky headers, virtualized because a
 * busy shift produces thousands, and navigable entirely from the keyboard: j and
 * k move, a acknowledges, d dispatches, f opens forensics, x dismisses. The
 * acknowledge button only appears on hover or focus so a row at rest is data,
 * not chrome.
 */
export function IncidentFeed({
  incidents,
  selectedId,
  onSelect,
  onAck,
  onDispatch,
  onForensics,
  onDismiss,
  loading,
  stale,
}: {
  incidents: IncidentSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAck: (id: string) => void
  onDispatch: (id: string) => void
  onForensics: (id: string) => void
  onDismiss: (id: string) => void
  loading: boolean
  stale: boolean
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const now = useNow(1000)
  const density = useUi((s) => s.density)
  const rowHeight = density === 'compact' ? 64 : 76
  const groupHeight = 24

  const rows = useMemo<Row[]>(() => {
    const byBand = new Map<PriorityBand, IncidentSummary[]>()
    for (const band of PRIORITY_BANDS) byBand.set(band, [])
    for (const incident of incidents) byBand.get(incident.priority)?.push(incident)
    const out: Row[] = []
    for (const band of PRIORITY_BANDS) {
      const list = byBand.get(band) ?? []
      if (list.length === 0) continue
      out.push({ kind: 'group', band, count: list.length })
      for (const incident of list) out.push({ kind: 'incident', incident })
    }
    return out
  }, [incidents])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'group' ? groupHeight : rowHeight),
    overscan: 10,
  })

  const incidentIndexes = useMemo(
    () => rows.map((r, i) => (r.kind === 'incident' ? i : -1)).filter((i) => i >= 0),
    [rows],
  )

  const move = useCallback(
    (delta: number) => {
      if (incidentIndexes.length === 0) return
      const currentRow = rows.findIndex((r) => r.kind === 'incident' && r.incident.incident_id === selectedId)
      const position = incidentIndexes.indexOf(currentRow)
      const nextPosition = position < 0 ? 0 : Math.min(incidentIndexes.length - 1, Math.max(0, position + delta))
      const nextRow = rows[incidentIndexes[nextPosition]!]
      if (nextRow?.kind === 'incident') {
        onSelect(nextRow.incident.incident_id)
        virtualizer.scrollToIndex(incidentIndexes[nextPosition]!, { align: 'auto' })
      }
    },
    [incidentIndexes, rows, selectedId, onSelect, virtualizer],
  )

  useEffect(() => {
    const node = parentRef.current
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const handlers: Record<string, () => void> = {
        j: () => move(1),
        k: () => move(-1),
        a: () => selectedId && onAck(selectedId),
        d: () => selectedId && onDispatch(selectedId),
        f: () => selectedId && onForensics(selectedId),
        x: () => selectedId && onDismiss(selectedId),
      }
      const handler = handlers[e.key]
      if (!handler) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, selectedId, onAck, onDispatch, onForensics, onDismiss])

  if (loading && incidents.length === 0) {
    return (
      <div className="flex flex-col gap-px p-px" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ height: rowHeight, background: 'var(--bg-2)' }} />
        ))}
      </div>
    )
  }

  return (
    <div ref={parentRef} className="relative h-full overflow-y-auto" role="list" aria-label="incident feed">
      {stale ? (
        <span className="mono absolute top-1 right-2 z-10 border border-[var(--line-1)] bg-[var(--bg-2)] px-1 text-[11px] text-[var(--ink-2)]">
          stale
        </span>
      ) : null}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]!
          if (row.kind === 'group') {
            return (
              <div
                key={`g-${row.band}`}
                className="sticky top-0 z-[5] flex items-center gap-2 border-y border-[var(--line-0)] bg-[var(--bg-2)] px-2"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: groupHeight, transform: `translateY(${virtualRow.start}px)` }}
              >
                <span className="mono text-[11px]" style={{ color: PRIORITY_COLOR[row.band] }}>
                  {PRIORITY_MARK[row.band]}
                </span>
                <span className="overline">{row.band.toLowerCase()}</span>
                <span className="mono ml-auto text-[11px] text-[var(--ink-2)]">{row.count}</span>
              </div>
            )
          }

          const incident = row.incident
          const selected = incident.incident_id === selectedId
          const age = now === null ? null : now - incident.detected_at
          return (
            <div
              key={incident.incident_id}
              role="listitem"
              tabIndex={0}
              aria-current={selected}
              onClick={() => onSelect(incident.incident_id)}
              onFocus={() => onSelect(incident.incident_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(incident.incident_id)
              }}
              className="group step absolute left-0 flex w-full cursor-default gap-2 border-b border-[var(--line-0)] pr-2 hover:bg-[var(--bg-3)]"
              style={{
                height: rowHeight,
                transform: `translateY(${virtualRow.start}px)`,
                background: selected ? 'var(--bg-3)' : undefined,
              }}
            >
              <PriorityBar priority={incident.priority} blink={incident.priority === 'CRITICAL' && !incident.acknowledged} />

              <div className="flex flex-none items-start pt-2.5">
                <DomainGlyph domain={incident.domain} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-2">
                <span className="truncate text-[13px] leading-[1.2] text-[var(--ink-0)]">{incident.title}</span>
                <span className="mono truncate text-[11px] text-[var(--ink-2)]">
                  CSS {fmtScore(incident.css.value)} [{fmtScore(incident.css.lo)}-{fmtScore(incident.css.hi)}] ·{' '}
                  {incident.source_count} src · {age === null ? '--:--:--' : fmtDuration(age)} · {incident.zone_id}
                  {incident.department ? ` · ${incident.department}` : ''}
                </span>
              </div>

              <div className="flex flex-none flex-col items-end justify-center gap-1 py-2">
                <SyncGrade grade={incident.sync_quality} />
                {incident.acknowledged ? (
                  <span className="mono text-[11px]" style={{ color: 'var(--ok)' }} title="acknowledged">
                    ack
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAck(incident.incident_id)
                    }}
                    title="acknowledge (a)"
                    className="mono step flex items-center gap-1 border border-[var(--line-1)] px-1 text-[11px] text-[var(--ink-2)] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-[var(--ink-0)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    <Glyph name="acknowledge" size={11} />
                    ack
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
