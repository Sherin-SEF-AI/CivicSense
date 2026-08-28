'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BiasAuditCell, DepartmentPerformance } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { DataTable, downloadCsv, toCsv, type Column } from '@/components/data/DataTable'
import { ScopeChart } from '@/components/data/ScopeChart'
import { ErrorPanel, LoadingBlocks, MetricTile } from '@/components/primitives/panels'
import { Overline } from '@/components/primitives/chips'
import { DomainGlyph } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDate, fmtDuration, fmtPct, fmtScore, fmtUsd } from '@/lib/format'
import { CANVAS } from '@/lib/tokens'

type Tab = 'departments' | 'bias' | 'models'

/**
 * Analytics.
 *
 * Department performance is measured from verified closures rather than from
 * self-reported status, which is why the reopened column sits next to the
 * closure rate: a high closure rate with a high reopen rate is not performance.
 */
export function AnalyticsScreen() {
  const [tab, setTab] = useState<Tab>('departments')
  const analyticsQuery = useQuery({
    queryKey: qk.analytics.overview(),
    queryFn: ({ signal }) => api.analytics(signal),
  })

  const data = analyticsQuery.data

  const departmentColumns: Column<DepartmentPerformance>[] = useMemo(
    () => [
      {
        key: 'label',
        header: 'department',
        width: 190,
        prose: true,
        render: (row) => <span className="truncate text-[var(--ink-0)]">{row.label}</span>,
        sortValue: (row) => row.label,
        csv: (row) => row.label,
      },
      {
        key: 'closure',
        header: 'verified closure',
        width: 138,
        align: 'right',
        render: (row) => (
          <span className="flex items-center justify-end gap-2">
            <span aria-hidden className="relative h-1.5 w-[52px]" style={{ background: 'var(--line-0)' }}>
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${row.verified_closure_rate * 100}%`,
                  background: row.verified_closure_rate > 0.8 ? 'var(--ok)' : row.verified_closure_rate > 0.6 ? 'var(--medium)' : 'var(--critical)',
                }}
              />
            </span>
            {fmtPct(row.verified_closure_rate)}
          </span>
        ),
        sortValue: (row) => row.verified_closure_rate,
        csv: (row) => String(row.verified_closure_rate),
      },
      {
        key: 'sla',
        header: 'sla compliance',
        width: 128,
        align: 'right',
        render: (row) => (
          <span style={{ color: row.sla_compliance < 0.7 ? 'var(--critical)' : row.sla_compliance < 0.85 ? 'var(--medium)' : 'var(--ink-1)' }}>
            {fmtPct(row.sla_compliance)}
          </span>
        ),
        sortValue: (row) => row.sla_compliance,
        csv: (row) => String(row.sla_compliance),
      },
      {
        key: 'critical',
        header: 'median critical',
        width: 132,
        align: 'right',
        render: (row) => fmtDuration(row.median_response_s.CRITICAL * 1000),
        sortValue: (row) => row.median_response_s.CRITICAL,
        csv: (row) => String(row.median_response_s.CRITICAL),
      },
      {
        key: 'high',
        header: 'median high',
        width: 118,
        align: 'right',
        render: (row) => fmtDuration(row.median_response_s.HIGH * 1000),
        sortValue: (row) => row.median_response_s.HIGH,
        csv: (row) => String(row.median_response_s.HIGH),
      },
      {
        key: 'open',
        header: 'open',
        width: 72,
        align: 'right',
        render: (row) => row.open,
        sortValue: (row) => row.open,
        csv: (row) => String(row.open),
      },
      {
        key: 'closed',
        header: 'closed 7d',
        width: 90,
        align: 'right',
        render: (row) => row.closed_7d,
        sortValue: (row) => row.closed_7d,
        csv: (row) => String(row.closed_7d),
      },
      {
        key: 'reopened',
        header: 'reopened 7d',
        width: 106,
        align: 'right',
        render: (row) => (
          <span style={{ color: row.reopened_7d > 8 ? 'var(--critical)' : 'var(--ink-2)' }}>{row.reopened_7d}</span>
        ),
        sortValue: (row) => row.reopened_7d,
        csv: (row) => String(row.reopened_7d),
      },
    ],
    [],
  )

  if (analyticsQuery.error) {
    return (
      <div className="w-full p-6">
        <ErrorPanel code={errorCode(analyticsQuery.error)} detail={errorDetail(analyticsQuery.error)} onRetry={() => void analyticsQuery.refetch()} />
      </div>
    )
  }

  if (analyticsQuery.isPending || !data) {
    return (
      <div className="w-full p-6">
        <LoadingBlocks rows={12} height={44} />
      </div>
    )
  }

  const totalCost = data.model_ops.by_role.reduce((s, r) => s + r.cost_usd, 0)
  const totalCalls = data.model_ops.by_role.reduce((s, r) => s + r.calls, 0)
  const cacheRate =
    data.model_ops.by_role.reduce((s, r) => s + r.cache_hit_rate * r.calls, 0) / Math.max(1, totalCalls)
  const flagged = data.bias.filter((b) => b.flagged).length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">analytics</h1>
        <div role="tablist" className="flex items-center gap-1">
          {(
            [
              ['departments', 'department performance'],
              ['bias', 'bias audit'],
              ['models', 'model operations'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="mono step border px-2 py-1 text-[12.5px]"
              style={{
                borderRadius: 'var(--radius-chip)',
                borderColor: tab === key ? 'var(--live)' : 'var(--line-1)',
                color: tab === key ? 'var(--live)' : 'var(--ink-2)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'departments' ? (
          <button
            type="button"
            onClick={() => downloadCsv('civicsense-departments.csv', toCsv(data.departments, departmentColumns))}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="export" size={12} />
            csv
          </button>
        ) : null}
        {flagged > 0 ? (
          <span className="mono flex items-center gap-1 text-[11px]" style={{ color: 'var(--medium)' }}>
            <Glyph name="warning-level" size={11} />
            {flagged} disparity flags in the current audit
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'departments' ? (
          <div className="flex flex-col gap-4 p-3">
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <MetricTile
                label="verified closure rate"
                value={fmtPct(
                  data.departments.reduce((s, d) => s + d.verified_closure_rate, 0) / Math.max(1, data.departments.length),
                )}
                glyph="resolve"
                tone="ok"
              />
              <MetricTile
                label="sla compliance"
                value={fmtPct(
                  data.departments.reduce((s, d) => s + d.sla_compliance, 0) / Math.max(1, data.departments.length),
                )}
                glyph="sla-timer"
              />
              <MetricTile
                label="open across departments"
                value={String(data.departments.reduce((s, d) => s + d.open, 0))}
                glyph="incident"
              />
              <MetricTile
                label="reopened in 7 days"
                value={String(data.departments.reduce((s, d) => s + d.reopened_7d, 0))}
                glyph="reopen"
                tone="warn"
              />
            </section>

            <section className="h-[280px]">
              <DataTable
                rows={data.departments}
                columns={departmentColumns}
                rowKey={(row) => row.department}
                ariaLabel="department performance"
              />
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              {data.trends.map((trend) => (
                <div
                  key={trend.key}
                  className="border border-[var(--line-0)] bg-[var(--bg-1)] p-2"
                  style={{ borderRadius: 'var(--radius-card)' }}
                >
                  <div className="flex items-center gap-2">
                    <Overline>{trend.label}</Overline>
                    <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">{trend.unit}</span>
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `civicsense-${trend.key}.csv`,
                          `t,${trend.key}\n${trend.points.map(([t, v]) => `${t},${v}`).join('\n')}\n`,
                        )
                      }
                      className="step text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                      title="export csv"
                    >
                      <Glyph name="export" size={12} />
                    </button>
                  </div>
                  <ScopeChart
                    x={trend.points.map((p) => p[0])}
                    series={[{ label: trend.label, color: CANVAS.live, values: trend.points.map((p) => p[1]), unit: trend.unit }]}
                    height={120}
                  />
                </div>
              ))}
            </section>

            <section>
              <Overline>by domain</Overline>
              <ul className="mt-1.5 grid grid-cols-2 gap-2 md:grid-cols-4">
                {data.by_domain.map((d) => (
                  <li
                    key={d.domain}
                    className="flex items-center gap-2 border border-[var(--line-0)] bg-[var(--bg-2)] px-2 py-1.5"
                    style={{ borderRadius: 'var(--radius-card)' }}
                  >
                    <DomainGlyph domain={d.domain} />
                    <span className="text-[12.5px] text-[var(--ink-1)]">{d.domain}</span>
                    <span className="mono ml-auto text-[12.5px] text-[var(--ink-0)]">{d.count}</span>
                    <span className="mono text-[11px]" style={{ color: 'var(--ok)' }} title="verified closures">
                      {d.verified}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}

        {tab === 'bias' ? (
          <div className="flex flex-col gap-3 p-3">
            <p className="mono text-[11px] text-[var(--ink-2)]">
              monthly audit of disposition rates across zone type and hour of day, run on the batch tier. a flag means
              enforcement dispositions concentrate beyond the configured tolerance for that combination, which is a
              prompt to inspect the thresholds rather than a verdict.
            </p>
            <BiasGrid cells={data.bias} />
          </div>
        ) : null}

        {tab === 'models' ? (
          <div className="flex flex-col gap-4 p-3">
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <MetricTile label="spend on this window" value={fmtUsd(totalCost)} glyph="budget" />
              <MetricTile label="calls" value={String(totalCalls)} glyph="model" />
              <MetricTile label="cache hit rate" value={fmtPct(cacheRate)} glyph="heartbeat" tone="ok" />
              <MetricTile
                label="fallback events"
                value={String(data.model_ops.by_role.reduce((s, r) => s + r.fallbacks, 0))}
                glyph="ota"
                tone="warn"
              />
            </section>

            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-2" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>daily spend, 30 days</Overline>
              <ScopeChart
                x={data.model_ops.spend_series.map((p) => p[0])}
                series={[{ label: 'spend', color: CANVAS.violet, fill: CANVAS.violetFill, values: data.model_ops.spend_series.map((p) => p[1]), unit: 'usd' }]}
                height={130}
              />
            </section>

            <section>
              <Overline>by role</Overline>
              <table className="mt-1.5 w-full">
                <thead>
                  <tr className="overline text-left">
                    <th className="pb-1 pr-3">role</th>
                    <th className="pb-1 pr-3">model</th>
                    <th className="pb-1 pr-3 text-right">calls</th>
                    <th className="pb-1 pr-3 text-right">cost</th>
                    <th className="pb-1 pr-3 text-right">cache</th>
                    <th className="pb-1 pr-3 text-right">fallbacks</th>
                    <th className="pb-1 text-right">p95 ms</th>
                  </tr>
                </thead>
                <tbody className="mono text-[11px]">
                  {data.model_ops.by_role.map((r) => (
                    <tr key={r.role} className="border-t border-[var(--line-0)]">
                      <td className="py-1 pr-3 text-[var(--ink-1)]">{r.role}</td>
                      <td className="py-1 pr-3 text-[var(--ink-2)]">{r.model}</td>
                      <td className="py-1 pr-3 text-right text-[var(--ink-1)]">{r.calls}</td>
                      <td className="py-1 pr-3 text-right text-[var(--ink-0)]">{fmtUsd(r.cost_usd)}</td>
                      <td className="py-1 pr-3 text-right" style={{ color: r.cache_hit_rate > 0.6 ? 'var(--ok)' : 'var(--ink-2)' }}>
                        {fmtPct(r.cache_hit_rate)}
                      </td>
                      <td className="py-1 pr-3 text-right" style={{ color: r.fallbacks > 10 ? 'var(--medium)' : 'var(--ink-2)' }}>
                        {r.fallbacks}
                      </td>
                      <td className="py-1 text-right text-[var(--ink-2)]">{r.p95_latency_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <Overline>batch jobs</Overline>
              <table className="mt-1.5 w-full">
                <thead>
                  <tr className="overline text-left">
                    <th className="pb-1 pr-3">job</th>
                    <th className="pb-1 pr-3">kind</th>
                    <th className="pb-1 pr-3">submitted</th>
                    <th className="pb-1 pr-3 text-right">items</th>
                    <th className="pb-1 pr-3 text-right">cost</th>
                    <th className="pb-1 text-right">state</th>
                  </tr>
                </thead>
                <tbody className="mono text-[11px]">
                  {data.model_ops.batch_jobs.map((job) => (
                    <tr key={job.job_id} className="border-t border-[var(--line-0)]">
                      <td className="py-1 pr-3 text-[var(--ink-2)]">{job.job_id}</td>
                      <td className="py-1 pr-3 text-[var(--ink-1)]">{job.kind}</td>
                      <td className="py-1 pr-3 text-[var(--ink-2)]">{fmtDate(job.submitted_at)}</td>
                      <td className="py-1 pr-3 text-right text-[var(--ink-1)]">{job.items}</td>
                      <td className="py-1 pr-3 text-right text-[var(--ink-0)]">{fmtUsd(job.cost_usd)}</td>
                      <td
                        className="py-1 text-right"
                        style={{
                          color:
                            job.state === 'completed' ? 'var(--ok)' : job.state === 'failed' ? 'var(--critical)' : 'var(--medium)',
                        }}
                      >
                        {job.state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BiasGrid({ cells }: { cells: BiasAuditCell[] }) {
  const zones = [...new Set(cells.map((c) => c.zone_kind))]
  const hours = [...new Set(cells.map((c) => c.hour_bucket))]
  const byKey = new Map(cells.map((c) => [`${c.zone_kind}|${c.hour_bucket}`, c]))

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[720px]">
        <thead>
          <tr>
            <th className="overline p-1 text-left">zone type</th>
            {hours.map((h) => (
              <th key={h} className="overline p-1 text-center">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zones.map((zone) => (
            <tr key={zone}>
              <td className="mono p-1 text-[11px] whitespace-nowrap text-[var(--ink-1)]">{zone}</td>
              {hours.map((h) => {
                const cell = byKey.get(`${zone}|${h}`)
                if (!cell) return <td key={h} className="p-1" />
                const intensity = Math.min(1, Math.abs(cell.disparity) / 0.4)
                return (
                  <td key={h} className="p-1">
                    <div
                      title={`enforcement ${fmtPct(cell.enforcement_rate)}, educational ${fmtPct(cell.educational_rate)}, n=${cell.sample}`}
                      className="flex h-9 flex-col items-center justify-center border"
                      style={{
                        borderColor: cell.flagged ? 'var(--medium)' : 'var(--line-0)',
                        background:
                          cell.disparity > 0
                            ? `rgba(219,109,40,${0.08 + intensity * 0.3})`
                            : `rgba(63,185,80,${0.06 + intensity * 0.2})`,
                        borderRadius: 'var(--radius-chip)',
                      }}
                    >
                      <span className="mono text-[11px] text-[var(--ink-0)]">{fmtScore(cell.enforcement_rate)}</span>
                      <span className="mono text-[11px] text-[var(--ink-3)]">n {cell.sample}</span>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
