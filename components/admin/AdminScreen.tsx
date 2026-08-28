'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuditEntry, Budget, Playbook, User, Zone } from '@/lib/api/schemas'
import { Glyph, type GlyphName } from '@/components/glyphs'
import { DataTable, type Column } from '@/components/data/DataTable'
import { ZoneEditor } from './ZoneEditor'
import { PlaybookEditor } from './PlaybookEditor'
import { MapCanvas } from '@/components/map/MapCanvas'
import { ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { HashChip, Overline } from '@/components/primitives/chips'
import { DomainGlyph, Meter } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDateTime, fmtDuration, fmtScore, fmtUsd } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'

type Tab = 'zones' | 'departments' | 'playbooks' | 'budgets' | 'users' | 'audit'

const TABS: { key: Tab; label: string; glyph: GlyphName }[] = [
  { key: 'zones', label: 'zones', glyph: 'zone' },
  { key: 'departments', label: 'departments', glyph: 'department' },
  { key: 'playbooks', label: 'playbooks', glyph: 'playbook' },
  { key: 'budgets', label: 'budgets', glyph: 'budget' },
  { key: 'users', label: 'users', glyph: 'responder' },
  { key: 'audit', label: 'audit', glyph: 'custody' },
]

export function AdminScreen() {
  const [tab, setTab] = useState<Tab>('zones')
  const [editingZone, setEditingZone] = useState<string | null>(null)
  const [editingPlaybook, setEditingPlaybook] = useState<string | null>(null)
  const [zoneFilter, setZoneFilter] = useState('')
  const openCustody = useUi((s) => s.openCustody)

  const adminQuery = useQuery({ queryKey: qk.admin.all(), queryFn: ({ signal }) => api.admin(signal) })
  const zonesQuery = useQuery({ queryKey: qk.zones.all(), queryFn: ({ signal }) => api.zones(signal) })
  const sourcesQuery = useQuery({
    queryKey: qk.sources.list([], [], ''),
    queryFn: ({ signal }) => api.sources([], [], '', signal),
    enabled: tab === 'zones',
    staleTime: 60_000,
  })

  if (adminQuery.error) {
    return (
      <div className="w-full p-6">
        <ErrorPanel code={errorCode(adminQuery.error)} detail={errorDetail(adminQuery.error)} onRetry={() => void adminQuery.refetch()} />
      </div>
    )
  }

  if (adminQuery.isPending || !adminQuery.data) {
    return (
      <div className="w-full p-6">
        <LoadingBlocks rows={12} height={44} />
      </div>
    )
  }

  const data = adminQuery.data
  const allZones = zonesQuery.data?.items ?? []
  const needle = zoneFilter.trim().toLowerCase()
  /* 547 wards is more than a scroll pane is worth, so the list is capped until
     the operator narrows it. */
  const visibleZones = (
    needle === ''
      ? allZones
      : allZones.filter((z) => z.label.toLowerCase().includes(needle) || z.zone_id.toLowerCase().includes(needle))
  ).slice(0, 60)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">admin</h1>
        <div role="tablist" className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="mono step flex items-center gap-1.5 border px-2 py-1 text-[12.5px]"
              style={{
                borderRadius: 'var(--radius-chip)',
                borderColor: tab === t.key ? 'var(--live)' : 'var(--line-1)',
                color: tab === t.key ? 'var(--live)' : 'var(--ink-2)',
              }}
            >
              <Glyph name={t.glyph} size={12} />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'zones' ? (
          <div className="flex h-full min-h-0">
            <div className="min-h-0 flex-1">
              <MapCanvas
                incidents={[]}
                sources={sourcesQuery.data?.items ?? []}
                patrols={[]}
                risk={[]}
                toggles={{ fov: true, zones: true, risk: false }}
                selectedId={null}
                onSelect={() => undefined}
                onToggle={() => undefined}
              />
            </div>
            <aside className="flex min-h-0 w-[420px] flex-none flex-col overflow-y-auto border-l border-[var(--line-0)] p-3">
              <Overline>zones</Overline>
              <p className="mono mt-1 mb-3 text-[11px] text-[var(--ink-3)]">
                the sensitivity index and the zone kind together select the severity weight profile, which is why a
                hospital approach and a residential ward score the same behaviour differently.
              </p>
              <input
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                placeholder="filter zones by name or id"
                aria-label="filter zones"
                className="mono mb-2 border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              />
              <ul className="flex flex-col gap-2">
                {visibleZones.map((zone: Zone) =>
                  editingZone === zone.zone_id ? (
                    <li key={zone.zone_id}>
                      <ZoneEditor zone={zone} onClose={() => setEditingZone(null)} />
                    </li>
                  ) : (
                  <li
                    key={zone.zone_id}
                    className="flex flex-col gap-1 border border-[var(--line-0)] bg-[var(--bg-2)] p-2"
                    style={{ borderRadius: 'var(--radius-card)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Glyph name="zone" size={12} />
                      <span className="mono text-[12.5px] text-[var(--ink-0)]">{zone.zone_id}</span>
                      <span className="text-[12.5px] text-[var(--ink-1)]">{zone.label}</span>
                      <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">{zone.kind}</span>
                      <button
                        type="button"
                        onClick={() => setEditingZone(zone.zone_id)}
                        aria-label={`edit ${zone.label}`}
                        className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]"
                        style={{ borderRadius: 'var(--radius-chip)' }}
                      >
                        edit
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="mono text-[11px] text-[var(--ink-2)]">sensitivity</span>
                      <span aria-hidden className="relative h-1.5 flex-1" style={{ background: 'var(--line-0)' }}>
                        <span
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: `${zone.sensitivity * 100}%`,
                            background: zone.sensitivity > 0.75 ? 'var(--high)' : 'var(--live)',
                          }}
                        />
                      </span>
                      <span className="mono text-[11px] text-[var(--ink-0)]">{fmtScore(zone.sensitivity)}</span>
                    </div>
                    <span className="mono text-[11px] text-[var(--ink-3)]">
                      {zone.polygon.length} boundary points · adjacent to {zone.adjacency.length || 'no'} zones
                    </span>
                  </li>
                  ),
                )}
                {visibleZones.length === 0 ? (
                  <li className="mono text-[11px] text-[var(--ink-3)]">no zone matches that filter</li>
                ) : null}
                {allZones.length > visibleZones.length ? (
                  <li className="mono text-[11px] text-[var(--ink-3)]">
                    showing {visibleZones.length} of {allZones.length} zones, filter to reach the rest
                  </li>
                ) : null}
              </ul>
            </aside>
          </div>
        ) : null}

        {tab === 'departments' ? (
          <div className="flex flex-col gap-3 p-3">
            {data.departments.map((dept) => (
              <section
                key={dept.department}
                className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3"
                style={{ borderRadius: 'var(--radius-card)' }}
              >
                <div className="flex items-center gap-2">
                  <Glyph name="department" size={14} />
                  <span className="text-[13px] text-[var(--ink-0)]">{dept.label}</span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">{dept.department}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {dept.domains.map((d) => (
                      <DomainGlyph key={d} domain={d} size={12} />
                    ))}
                  </span>
                </div>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  <div>
                    <Overline>contacts</Overline>
                    <ul className="mono mt-1 flex flex-col gap-0.5 text-[11px]">
                      {dept.contacts.map((c, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="w-[52px] text-[var(--ink-3)]">{c.channel}</span>
                          <span className="flex-1 truncate text-[var(--ink-1)]">{c.name}</span>
                          <span className="text-[var(--ink-2)]">{c.target}</span>
                          <span className="text-[var(--ink-3)]">{c.role}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <Overline>sla by priority</Overline>
                    <ul className="mono mt-1 flex flex-col gap-0.5 text-[11px]">
                      {Object.entries(dept.sla_seconds).map(([band, seconds]) => (
                        <li key={band} className="flex items-center gap-2">
                          <span className="w-[80px] text-[var(--ink-2)]">{band}</span>
                          <span className="text-[var(--ink-0)]">{fmtDuration(seconds * 1000)}</span>
                        </li>
                      ))}
                    </ul>
                    {dept.escalation_to ? (
                      <p className="mono mt-1 text-[11px] text-[var(--ink-3)]">escalates to {dept.escalation_to}</p>
                    ) : null}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {tab === 'playbooks' ? (
          <div className="flex flex-col gap-3 p-3">
            {data.playbooks.map((playbook: Playbook) =>
              editingPlaybook === playbook.playbook_id ? (
                <PlaybookEditor key={playbook.playbook_id} playbook={playbook} onClose={() => setEditingPlaybook(null)} />
              ) : (
              <section
                key={playbook.playbook_id}
                className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3"
                style={{ borderRadius: 'var(--radius-card)' }}
              >
                <div className="flex items-center gap-2">
                  <Glyph name="playbook" size={14} />
                  <span className="text-[13px] text-[var(--ink-0)]">{playbook.name}</span>
                  <DomainGlyph domain={playbook.domain} size={12} />
                  <span className="mono text-[11px] text-[var(--ink-3)]">
                    from {playbook.min_priority} · version {playbook.version} · updated {fmtDateTime(playbook.updated_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingPlaybook(playbook.playbook_id)}
                    aria-label={`edit ${playbook.name}`}
                    className="mono step ml-auto border border-[var(--line-1)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    edit
                  </button>
                </div>
                <ol className="mt-2 flex flex-col">
                  {playbook.steps.map((step, i) => (
                    <li key={step.step_id} className="flex items-start gap-2 border-b border-[var(--line-0)] py-1.5 last:border-b-0">
                      <span className="mono w-[20px] flex-none text-[11px] text-[var(--ink-3)]">{i + 1}</span>
                      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--ink-1)]">{step.text}</span>
                      <span className="mono flex flex-none items-center gap-2 text-[11px]">
                        <span className="text-[var(--ink-2)]">{step.owner}</span>
                        {step.timer_s === null ? null : (
                          <span className="text-[var(--ink-3)]">{fmtDuration(step.timer_s * 1000)}</span>
                        )}
                        {step.automatic ? (
                          <span style={{ color: 'var(--live)' }}>automatic</span>
                        ) : (
                          <span className="text-[var(--ink-3)]">manual</span>
                        )}
                        {step.approval_gate ? (
                          <span style={{ color: 'var(--medium)' }} title="anything punitive or physical needs approval">
                            approval gate
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              ),
            )}
          </div>
        ) : null}

        {tab === 'budgets' ? (
          <div className="flex flex-col gap-2 p-3">
            <p className="mono text-[11px] text-[var(--ink-3)]">
              exceeding a cap degrades the pipeline in steps, fewer images then lower reasoning effort then edge-only
              logging. it never silently drops observations.
            </p>
            {data.budgets.map((budget: Budget) => (
              <div
                key={`${budget.scope}-${budget.key}`}
                className="flex items-center gap-3 border border-[var(--line-0)] bg-[var(--bg-2)] px-3 py-2"
                style={{ borderRadius: 'var(--radius-card)' }}
              >
                <span className="mono w-[72px] flex-none text-[11px] text-[var(--ink-3)]">{budget.scope}</span>
                <span className="w-[200px] flex-none truncate text-[12.5px] text-[var(--ink-1)]">{budget.label}</span>
                <Meter value={budget.spent_today_usd} max={budget.daily_usd} width={120} label={`${budget.label} daily budget`} />
                <span className="mono text-[12.5px] text-[var(--ink-0)]">
                  {fmtUsd(budget.spent_today_usd)} / {fmtUsd(budget.daily_usd)}
                </span>
                <span className="mono text-[11px] text-[var(--ink-2)]">
                  month {fmtUsd(budget.spent_month_usd)} / {fmtUsd(budget.monthly_usd)}
                </span>
                <span
                  className="mono ml-auto text-[11px]"
                  style={{ color: budget.degradation === 'none' ? 'var(--ok)' : 'var(--medium)' }}
                >
                  {budget.degradation === 'none' ? 'full pipeline' : `degraded: ${budget.degradation}`}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'users' ? (
          <div className="p-3">
            <table className="w-full">
              <thead>
                <tr className="overline text-left">
                  <th className="pb-1 pr-3">name</th>
                  <th className="pb-1 pr-3">email</th>
                  <th className="pb-1 pr-3">role</th>
                  <th className="pb-1 pr-3">department</th>
                  <th className="pb-1 pr-3">investigation flag</th>
                  <th className="pb-1">last active</th>
                </tr>
              </thead>
              <tbody className="mono text-[12.5px]">
                {data.users.map((user: User) => (
                  <tr key={user.user_id} className="border-t border-[var(--line-0)]">
                    <td className="py-1.5 pr-3 text-[var(--ink-0)]">{user.name}</td>
                    <td className="py-1.5 pr-3 text-[var(--ink-2)]">{user.email}</td>
                    <td className="py-1.5 pr-3 text-[var(--ink-1)]">{user.role}</td>
                    <td className="py-1.5 pr-3 text-[var(--ink-2)]">{user.department ?? 'all'}</td>
                    <td className="py-1.5 pr-3" style={{ color: user.investigation_flag ? 'var(--violet)' : 'var(--ink-3)' }}>
                      {user.investigation_flag ? 'authorised' : 'not set'}
                    </td>
                    <td className="py-1.5 text-[var(--ink-2)]">{fmtDateTime(user.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'audit' ? <AuditLog entries={data.audit} onHash={openCustody} /> : null}
      </div>
    </div>
  )
}

function AuditLog({ entries, onHash }: { entries: AuditEntry[]; onHash: (hash: string) => void }) {
  const [filter, setFilter] = useState('')
  const rows = useMemo(
    () =>
      entries.filter(
        (e) =>
          filter === '' ||
          e.action.includes(filter) ||
          e.actor.toLowerCase().includes(filter.toLowerCase()) ||
          e.subject.includes(filter),
      ),
    [entries, filter],
  )

  const columns: Column<AuditEntry>[] = [
    {
      key: 'seq',
      header: 'seq',
      width: 64,
      align: 'right',
      render: (row) => <span className="text-[var(--ink-3)]">{row.seq}</span>,
      sortValue: (row) => row.seq,
      csv: (row) => String(row.seq),
    },
    {
      key: 't',
      header: 'when',
      width: 168,
      render: (row) => <span className="text-[var(--ink-2)]">{fmtDateTime(row.t)}</span>,
      sortValue: (row) => row.t,
      csv: (row) => fmtDateTime(row.t),
    },
    {
      key: 'actor',
      header: 'actor',
      width: 150,
      render: (row) => <span className="text-[var(--ink-1)]">{row.actor}</span>,
      sortValue: (row) => row.actor,
      csv: (row) => row.actor,
    },
    {
      key: 'action',
      header: 'action',
      width: 190,
      render: (row) => <span className="text-[var(--ink-0)]">{row.action}</span>,
      sortValue: (row) => row.action,
      csv: (row) => row.action,
    },
    {
      key: 'subject',
      header: 'subject',
      width: 170,
      render: (row) => <span className="text-[var(--ink-2)]">{row.subject}</span>,
      csv: (row) => row.subject,
    },
    {
      key: 'detail',
      header: 'detail',
      width: 230,
      prose: true,
      render: (row) => <span className="truncate text-[var(--ink-1)]">{row.detail}</span>,
      csv: (row) => row.detail,
    },
    {
      key: 'hash',
      header: 'chain',
      width: 118,
      render: (row) => <HashChip hash={row.hash} onOpen={onHash} />,
      csv: (row) => row.hash,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-3 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter by action, actor or subject"
          aria-label="filter audit log"
          className="mono w-[300px] border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
        <span className="mono text-[11px] text-[var(--ink-3)]">
          {rows.length} of {entries.length} entries · each hash chains to the previous, so a gap is detectable
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <DataTable rows={rows} columns={columns} rowKey={(row) => String(row.seq)} ariaLabel="audit log" emptyLine="no audit entries match that filter" />
      </div>
    </div>
  )
}
