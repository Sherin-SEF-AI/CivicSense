'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { IncidentSummary } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { DataTable, type Column } from '@/components/data/DataTable'
import { EmptyState, ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { ConfidenceInterval, DomainGlyph, PriorityTag, SourceGlyph, SyncGrade } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDateTime } from '@/lib/format'
import { EMPTY_INCIDENT_FILTERS } from '@/lib/api/keys'

/**
 * Choosing what to reconstruct.
 *
 * The workspace works on one incident at a time, so this is the door into it:
 * everything with evidence attached, most recent first, with the number of
 * contributing sources visible because that is what determines whether a
 * reconstruction has anything to reconcile.
 */
export function ForensicsIndex() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const filters = { ...EMPTY_INCIDENT_FILTERS, includeClosed: true, q: search }
  const incidentsQuery = useQuery({
    queryKey: qk.incidents.list(filters),
    queryFn: ({ signal }) => api.incidents(filters, null, signal),
  })

  const rows = incidentsQuery.data?.items ?? []

  const columns: Column<IncidentSummary>[] = [
    {
      key: 'priority',
      header: 'priority',
      width: 78,
      render: (row) => <PriorityTag priority={row.priority} />,
      sortValue: (row) => row.priority,
      csv: (row) => row.priority,
    },
    {
      key: 'domain',
      header: 'domain',
      width: 52,
      render: (row) => <DomainGlyph domain={row.domain} />,
      sortValue: (row) => row.domain,
      csv: (row) => row.domain,
    },
    {
      key: 'title',
      header: 'incident',
      width: 340,
      prose: true,
      render: (row) => <span className="truncate text-[var(--ink-0)]">{row.title}</span>,
      sortValue: (row) => row.title,
      csv: (row) => row.title,
    },
    {
      key: 'detected',
      header: 'detected',
      width: 168,
      render: (row) => <span className="text-[var(--ink-2)]">{fmtDateTime(row.detected_at)}</span>,
      sortValue: (row) => row.detected_at,
      csv: (row) => fmtDateTime(row.detected_at),
    },
    {
      key: 'sources',
      header: 'sources',
      width: 128,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--ink-1)]">{row.source_count}</span>
          {row.source_types.map((t) => (
            <SourceGlyph key={t} type={t} size={12} />
          ))}
        </span>
      ),
      sortValue: (row) => row.source_count,
      csv: (row) => String(row.source_count),
    },
    {
      key: 'sync',
      header: 'sync',
      width: 56,
      render: (row) => <SyncGrade grade={row.sync_quality} />,
      csv: (row) => row.sync_quality,
    },
    {
      key: 'css',
      header: 'severity',
      width: 180,
      render: (row) => <ConfidenceInterval value={row.css.value} lo={row.css.lo} hi={row.css.hi} />,
      sortValue: (row) => row.css.value,
      csv: (row) => String(row.css.value),
    },
    {
      key: 'status',
      header: 'status',
      width: 116,
      render: (row) => <span className="text-[var(--ink-2)]">{row.status}</span>,
      sortValue: (row) => row.status,
      csv: (row) => row.status,
    },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">forensics</h1>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          select an incident to reconstruct across every source that observed it
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by title or identifier"
          aria-label="filter incidents"
          className="mono ml-auto w-[280px] border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
      </header>

      <div className="min-h-0 flex-1">
        {incidentsQuery.error ? (
          <div className="p-3">
            <ErrorPanel
              code={errorCode(incidentsQuery.error)}
              detail={errorDetail(incidentsQuery.error)}
              onRetry={() => void incidentsQuery.refetch()}
            />
          </div>
        ) : incidentsQuery.isPending ? (
          <div className="p-3">
            <LoadingBlocks rows={10} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <EmptyState
              line={
                search
                  ? 'no incident matches that filter'
                  : 'nothing to reconstruct yet. incidents appear here once a source reports a trigger.'
              }
              glyph="timeline"
            />
            {!search ? (
              <Link
                href="/sources"
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="edge-device" size={12} />
                connect a source
              </Link>
            ) : null}
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.incident_id}
            onRowClick={(row) => router.push(`/forensics/${row.incident_id}`)}
            ariaLabel="incidents available for reconstruction"
            emptyLine="no incident matches that filter"
          />
        )}
      </div>
    </div>
  )
}
