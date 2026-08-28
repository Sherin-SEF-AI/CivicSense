'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CaseSummary } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { DataTable, downloadCsv, toCsv, type Column } from '@/components/data/DataTable'
import { ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { StatusLED } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtBytes, fmtDate } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'
import { useSelection } from '@/lib/stores/selection'

const STATE_COLOR: Record<CaseSummary['state'], 'green' | 'amber' | 'red'> = {
  open: 'amber',
  active: 'green',
  review: 'amber',
  disclosed: 'green',
  closed: 'red',
}

export function CaseListScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const setActiveCase = useSelection((s) => s.setActiveCase)
  const activeCaseId = useSelection((s) => s.activeCaseId)
  const [search, setSearch] = useState('')

  const casesQuery = useQuery({
    queryKey: qk.cases.list(search),
    queryFn: ({ signal }) => api.cases(search, signal),
  })

  const createMutation = useMutation({
    mutationFn: () => api.caseCreate('untitled case', []),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: qk.cases.all() })
      router.push(`/case/${created.case_id}`)
    },
    onError: (error) => toast({ tone: 'error', text: 'could not create the case', detail: errorDetail(error) }),
  })

  const columns: Column<CaseSummary>[] = [
    {
      key: 'reference',
      header: 'reference',
      width: 148,
      render: (row) => <span className="text-[var(--ink-0)]">{row.reference}</span>,
      sortValue: (row) => row.reference,
      csv: (row) => row.reference,
    },
    {
      key: 'title',
      header: 'title',
      width: 300,
      prose: true,
      render: (row) => <span className="truncate text-[var(--ink-1)]">{row.title}</span>,
      sortValue: (row) => row.title,
      csv: (row) => row.title,
    },
    {
      key: 'state',
      header: 'state',
      width: 108,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusLED state={STATE_COLOR[row.state]} label={row.state} />
          {row.state}
        </span>
      ),
      sortValue: (row) => row.state,
      csv: (row) => row.state,
    },
    {
      key: 'incidents',
      header: 'incidents',
      width: 84,
      align: 'right',
      render: (row) => row.incident_count,
      sortValue: (row) => row.incident_count,
      csv: (row) => String(row.incident_count),
    },
    {
      key: 'evidence',
      header: 'evidence',
      width: 96,
      align: 'right',
      render: (row) => row.evidence_count,
      sortValue: (row) => row.evidence_count,
      csv: (row) => String(row.evidence_count),
    },
    {
      key: 'bytes',
      header: 'size',
      width: 92,
      align: 'right',
      render: (row) => <span className="text-[var(--ink-2)]">{fmtBytes(row.evidence_bytes)}</span>,
      sortValue: (row) => row.evidence_bytes,
      csv: (row) => String(row.evidence_bytes),
    },
    {
      key: 'flags',
      header: 'flags',
      width: 150,
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.legal_hold ? (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--medium)' }} title="legal hold freezes retention">
              <Glyph name="pin" size={11} />
              hold
            </span>
          ) : null}
          {row.investigation_flag ? (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--violet)' }} title="authorised investigation flag: person search is available on this case">
              <Glyph name="verified" size={11} />
              investigation
            </span>
          ) : null}
          {!row.legal_hold && !row.investigation_flag ? <span className="text-[var(--ink-3)]">none</span> : null}
        </span>
      ),
      csv: (row) => [row.legal_hold ? 'hold' : '', row.investigation_flag ? 'investigation' : ''].filter(Boolean).join(' '),
    },
    {
      key: 'owner',
      header: 'owner',
      width: 148,
      render: (row) => <span className="text-[var(--ink-2)]">{row.owner}</span>,
      sortValue: (row) => row.owner,
      csv: (row) => row.owner,
    },
    {
      key: 'updated',
      header: 'updated',
      width: 108,
      render: (row) => <span className="text-[var(--ink-2)]">{fmtDate(row.updated_at)}</span>,
      sortValue: (row) => row.updated_at,
      csv: (row) => fmtDate(row.updated_at),
    },
  ]

  const rows = casesQuery.data?.items ?? []

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">cases</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by reference or title"
          aria-label="filter cases"
          className="mono w-[260px] border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
        <span className="mono text-[11px] text-[var(--ink-3)]">{rows.length} cases</span>
        {activeCaseId ? (
          <span className="mono text-[11px]" style={{ color: 'var(--live)' }}>
            active case {activeCaseId}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => downloadCsv('civicsense-cases.csv', toCsv(rows, columns))}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="export" size={12} />
            csv
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="custody" size={12} />
            new case
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {casesQuery.error ? (
          <div className="p-3">
            <ErrorPanel code={errorCode(casesQuery.error)} detail={errorDetail(casesQuery.error)} onRetry={() => void casesQuery.refetch()} />
          </div>
        ) : casesQuery.isPending ? (
          <div className="p-3">
            <LoadingBlocks rows={10} />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.case_id}
            selectedKey={activeCaseId}
            onRowClick={(row) => {
              setActiveCase(row.case_id)
              router.push(`/case/${row.case_id}`)
            }}
            ariaLabel="cases"
            emptyLine="no cases match that filter"
          />
        )}
      </div>
    </div>
  )
}
