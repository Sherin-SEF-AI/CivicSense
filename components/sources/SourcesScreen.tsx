'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import type { SourceDevice } from '@/lib/api/schemas'
import { SOURCE_TYPES } from '@/lib/api/schemas/common'
import { SOURCE_STATES } from '@/lib/api/schemas/source'
import { Glyph } from '@/components/glyphs'
import { DataTable, downloadCsv, toCsv, type Column } from '@/components/data/DataTable'
import { ScopeChart } from '@/components/data/ScopeChart'
import { MapCanvas } from '@/components/map/MapCanvas'
import { EmptyState, ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { FilterChip, Overline } from '@/components/primitives/chips'
import { SourceGlyph, StatusLED, SyncGrade, TrustBar } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDate, fmtDuration, fmtPct, fmtScore, fmtTime } from '@/lib/format'
import { CANVAS } from '@/lib/tokens'
import { useNow } from '@/lib/useNow'
import { useUi } from '@/lib/stores/ui'
import { RegisterSource } from './RegisterSource'
import { Synopsis } from './Synopsis'

const CALIBRATION_STALE_DAYS = 30

/**
 * Fleet management.
 *
 * The coverage map is the screen an operator uses to justify the next camera:
 * the union of fields of view against the corridors, with the uncovered stretches
 * left dark. Calibration age turns amber past thirty days because a stale
 * homography is what silently turns a measurement into a guess.
 */
export function SourcesScreen() {
  const toast = useUi((s) => s.toast)
  const now = useNow(5000)
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [states, setStates] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [registering, setRegistering] = useState(false)
  const qc = useQueryClient()

  const driftCheck = useMutation({
    mutationFn: (sourceId: string) => api.runDriftCheck(sourceId),
    onSuccess: async (run) => {
      await qc.invalidateQueries({ queryKey: qk.sources.all() })
      toast({ tone: 'ok', text: `drift check ${run.state}`, detail: run.detail })
    },
    onError: (error) => toast({ tone: 'error', text: 'could not queue the drift check', detail: errorDetail(error) }),
  })

  const sourcesQuery = useQuery({
    queryKey: qk.sources.list([...types], [...states], search),
    queryFn: ({ signal }) => api.sources([...types], [...states], search, signal),
  })

  const detailQuery = useQuery({
    queryKey: qk.sources.detail(expanded ?? ''),
    queryFn: ({ signal }) => api.source(expanded!, signal),
    enabled: expanded !== null,
  })

  const rows = useMemo(() => sourcesQuery.data?.items ?? [], [sourcesQuery.data])

  const toggle = useCallback((set: Set<string>, value: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    apply(next)
  }, [])

  const calibrationAgeDays = (source: SourceDevice) =>
    source.calibrated_at === null || now === null ? null : (now - source.calibrated_at) / 86400_000

  const columns: Column<SourceDevice>[] = [
    {
      key: 'type',
      header: 'type',
      width: 46,
      render: (row) => <SourceGlyph type={row.source_type} />,
      sortValue: (row) => row.source_type,
      csv: (row) => row.source_type,
    },
    {
      key: 'id',
      header: 'id',
      width: 96,
      render: (row) => <span className="text-[var(--ink-0)]">{row.source_id}</span>,
      sortValue: (row) => row.source_id,
      csv: (row) => row.source_id,
    },
    {
      key: 'site',
      header: 'site or vehicle',
      width: 210,
      prose: true,
      render: (row) => <span className="truncate text-[var(--ink-1)]">{row.label}</span>,
      sortValue: (row) => row.label,
      csv: (row) => row.label,
    },
    {
      key: 'state',
      header: 'state',
      width: 106,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusLED state={row.state} label={row.state} />
          {row.state}
        </span>
      ),
      sortValue: (row) => row.state,
      csv: (row) => row.state,
    },
    {
      key: 'uptime',
      header: 'uptime 7d',
      width: 88,
      align: 'right',
      render: (row) => (
        <span style={{ color: row.uptime_7d < 0.95 ? 'var(--medium)' : 'var(--ink-1)' }}>{fmtPct(row.uptime_7d, 1)}</span>
      ),
      sortValue: (row) => row.uptime_7d,
      csv: (row) => String(row.uptime_7d),
    },
    {
      key: 'sync',
      header: 'sync',
      width: 56,
      render: (row) => <SyncGrade grade={row.sync_quality} />,
      sortValue: (row) => row.sync_quality,
      csv: (row) => row.sync_quality,
    },
    {
      key: 'calibration',
      header: 'calibration age',
      width: 122,
      align: 'right',
      render: (row) => {
        const age = calibrationAgeDays(row)
        if (age === null) return <span className="text-[var(--ink-3)]">not applicable</span>
        return (
          <span style={{ color: age > CALIBRATION_STALE_DAYS ? 'var(--medium)' : 'var(--ink-1)' }}>
            {age.toFixed(0)}d
          </span>
        )
      },
      sortValue: (row) => row.calibrated_at ?? 0,
      csv: (row) => (row.calibrated_at === null ? '' : fmtDate(row.calibrated_at)),
    },
    {
      key: 'trust',
      header: 'trust',
      width: 118,
      render: (row) => <TrustBar trust={row.trust} />,
      sortValue: (row) => row.trust,
      csv: (row) => String(row.trust),
    },
    {
      key: 'last',
      header: 'last obs',
      width: 92,
      align: 'right',
      render: (row) => {
        if (now === null) return <span className="text-[var(--ink-3)]">--</span>
        const age = now - row.last_observation_at
        return <span style={{ color: age > 300_000 ? 'var(--medium)' : 'var(--ink-2)' }}>{fmtDuration(age)}</span>
      },
      sortValue: (row) => row.last_observation_at,
      csv: (row) => fmtTime(row.last_observation_at, { ms: false }),
    },
    {
      key: 'firmware',
      header: 'firmware',
      width: 132,
      render: (row) => <span className="text-[var(--ink-2)]">{row.firmware}</span>,
      sortValue: (row) => row.firmware,
      csv: (row) => row.firmware,
    },
  ]

  const summary = useMemo(() => {
    const up = rows.filter((r) => r.state === 'up').length
    const stale = rows.filter((r) => {
      const age = calibrationAgeDays(r)
      return age !== null && age > CALIBRATION_STALE_DAYS
    }).length
    return { up, stale }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, now])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">sources</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by id or label"
          aria-label="filter sources"
          className="mono w-[210px] border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
        <div className="flex flex-wrap gap-1">
          {SOURCE_TYPES.map((t) => (
            <FilterChip key={t} label={t} active={types.has(t)} onToggle={() => toggle(types, t, setTypes)} />
          ))}
        </div>
        <div className="flex gap-1">
          {SOURCE_STATES.map((s) => (
            <FilterChip key={s} label={s} active={states.has(s)} onToggle={() => toggle(states, s, setStates)} />
          ))}
        </div>
        <span className="mono text-[11px] text-[var(--ink-2)]">
          {summary.up}/{rows.length} up
          {summary.stale > 0 ? (
            <span style={{ color: 'var(--medium)' }}> · {summary.stale} past calibration</span>
          ) : null}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={showMap}
            onClick={() => setShowMap((v) => !v)}
            className="mono step flex items-center gap-1 border px-2 py-1 text-[12.5px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: showMap ? 'var(--live)' : 'var(--line-1)',
              color: showMap ? 'var(--live)' : 'var(--ink-1)',
            }}
          >
            <Glyph name="zone" size={12} />
            coverage map
          </button>
          <button
            type="button"
            onClick={() => setRegistering((v) => !v)}
            className="mono step flex items-center gap-1 border px-2 py-1 text-[12.5px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: registering ? 'var(--live)' : 'var(--line-1)',
              color: registering ? 'var(--live)' : 'var(--ink-1)',
            }}
          >
            <Glyph name="edge-device" size={12} />
            register source
          </button>
          <button
            type="button"
            onClick={() => downloadCsv('civicsense-sources.csv', toCsv(rows, columns))}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="export" size={12} />
            csv
          </button>
        </div>
      </header>

      {registering ? (
        <div className="flex-none border-b border-[var(--line-0)] p-3">
          <RegisterSource onDone={() => setRegistering(false)} />
        </div>
      ) : null}

      {showMap ? (
        <div className="flex-none border-b border-[var(--line-0)]" style={{ height: 320 }}>
          <div className="flex h-full">
            <MapCanvas
              incidents={[]}
              sources={rows}
              patrols={rows.filter((r) => r.source_type === 'patrol-car' || r.source_type === 'patrol-bike')}
              risk={[]}
              toggles={{ fov: true, zones: true, risk: false }}
              selectedId={null}
              onSelect={() => undefined}
              onToggle={() => undefined}
            >
              <div
                className="absolute right-2 bottom-2 flex flex-col gap-1 border border-[var(--line-0)] bg-[var(--bg-1)] px-2 py-1.5"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <span className="overline">coverage</span>
                <span className="mono flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
                  <span aria-hidden style={{ width: 10, height: 10, background: 'rgba(88,166,255,0.18)' }} />
                  camera field of view
                </span>
                <span className="mono flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
                  <span aria-hidden style={{ width: 10, height: 10, background: CANVAS.bg0, border: '1px solid var(--line-1)' }} />
                  uncovered
                </span>
              </div>
            </MapCanvas>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {sourcesQuery.error ? (
          <div className="p-3">
            <ErrorPanel code={errorCode(sourcesQuery.error)} detail={errorDetail(sourcesQuery.error)} onRetry={() => void sourcesQuery.refetch()} />
          </div>
        ) : sourcesQuery.isPending ? (
          <div className="p-3">
            <LoadingBlocks rows={14} />
          </div>
        ) : rows.length === 0 && types.size === 0 && states.size === 0 && search === '' ? (
          <EmptyState
            line="no sources are registered. the platform sees nothing until a camera or sensor is connected."
            actionLabel="register the first source"
            onAction={() => setRegistering(true)}
            glyph="edge-device"
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.source_id}
            selectedKey={expanded}
            expandedKey={expanded}
            onRowClick={(row) => setExpanded(expanded === row.source_id ? null : row.source_id)}
            ariaLabel="source fleet"
            emptyLine="no sources match these filters"
            renderExpanded={(row) => (
              <div className="grid gap-4 p-3 lg:grid-cols-[220px_1fr_260px]">
                <div className="flex flex-col gap-2">
                  <Overline>last frame</Overline>
                  {row.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumb_url} alt={`${row.source_id} last frame`} className="w-full border border-[var(--line-0)]" />
                  ) : (
                    <p className="mono text-[11px] text-[var(--ink-3)]">this source produces no imagery</p>
                  )}
                  <dl className="mono flex flex-col gap-0.5 text-[11px]">
                    <Row label="zone" value={`${row.zone_id} ${row.zone_label}`} />
                    <Row label="position" value={`${row.position.lat.toFixed(5)}, ${row.position.lon.toFixed(5)}`} />
                    <Row label="edge device" value={row.edge_device ?? 'none'} />
                    <Row label="privacy" value={row.privacy_class} />
                  </dl>
                </div>

                <div className="flex flex-col gap-3">
                  <Synopsis sourceId={row.source_id} />
                  <Overline>health, last 24 hours</Overline>
                  {detailQuery.isPending || !detailQuery.data ? (
                    <LoadingBlocks rows={2} height={60} />
                  ) : (
                    <>
                      <ScopeChart
                        x={detailQuery.data.health.map((h) => h.t)}
                        series={[
                          { label: 'fps', color: CANVAS.live, values: detailQuery.data.health.map((h) => h.fps), unit: 'fps' },
                          { label: 'latency', color: CANVAS.medium, values: detailQuery.data.health.map((h) => h.latency_ms), unit: 'ms' },
                        ]}
                        height={96}
                      />
                      <Overline>device events</Overline>
                      <ul className="flex max-h-[132px] flex-col gap-0.5 overflow-y-auto">
                        {detailQuery.data.events.map((event, i) => (
                          <li key={i} className="mono flex items-baseline gap-2 text-[11px]">
                            <span className="w-[124px] flex-none text-[var(--ink-3)]">{fmtTime(event.t, { ms: false })}</span>
                            <span
                              className="w-[80px] flex-none"
                              style={{
                                color:
                                  event.kind === 'down' || event.kind === 'tamper' || event.kind === 'moved'
                                    ? 'var(--critical)'
                                    : event.kind === 'degraded'
                                      ? 'var(--medium)'
                                      : 'var(--ink-2)',
                              }}
                            >
                              {event.kind}
                            </span>
                            <span className="flex-1 text-[var(--ink-1)]">{event.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Overline>calibration</Overline>
                  {row.calibrated_at === null ? (
                    <p className="mono text-[11px] text-[var(--ink-3)]">
                      this source class carries no ground-plane calibration, so it contributes corroboration rather than
                      measurement.
                    </p>
                  ) : (
                    <>
                      <dl className="mono flex flex-col gap-0.5 text-[11px]">
                        <Row label="calibrated" value={fmtDate(row.calibrated_at)} />
                        <Row label="residual" value={`${row.calibration_residual_m ?? 0} m`} />
                      </dl>
                      {detailQuery.data ? (
                        <ul className="mono flex flex-col gap-0.5 text-[11px]">
                          {detailQuery.data.homography_residuals.map((r) => (
                            <li key={r.point} className="flex items-center gap-2">
                              <span className="w-[56px] text-[var(--ink-2)]">{r.point}</span>
                              <span aria-hidden className="relative h-1.5 flex-1" style={{ background: 'var(--line-0)' }}>
                                <span
                                  style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: `${Math.min(100, r.residual_m * 60)}%`,
                                    background: r.residual_m > 0.8 ? 'var(--medium)' : 'var(--ok)',
                                  }}
                                />
                              </span>
                              <span className="w-[44px] text-right text-[var(--ink-1)]">{r.residual_m.toFixed(2)} m</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => driftCheck.mutate(row.source_id)}
                        disabled={driftCheck.isPending}
                        className="mono step flex items-center gap-1.5 self-start border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
                        style={{ borderRadius: 'var(--radius-chip)' }}
                      >
                        <Glyph name="calibration" size={12} />
                        run drift check
                      </button>
                    </>
                  )}

                  <Overline>trust components</Overline>
                  <dl className="mono flex flex-col gap-0.5 text-[11px]">
                    <Row label="attestation" value={fmtScore(row.trust_components.attestation)} />
                    <Row label="calibration recency" value={fmtScore(row.trust_components.calibration_recency)} />
                    <Row label="learned precision" value={fmtScore(row.trust_components.learned_precision)} />
                    <Row label="quality" value={fmtScore(row.trust_components.quality)} />
                  </dl>
                  <p className="mono text-[11px] text-[var(--ink-3)]">
                    trust weights fusion and confidence. it never changes severity.
                  </p>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[112px] flex-none text-[var(--ink-2)]">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[var(--ink-0)]" title={value}>
        {value}
      </dd>
    </div>
  )
}
