'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Glyph } from '@/components/glyphs'
import { CopyChip, EvidenceChip, HashChip, Overline } from '@/components/primitives/chips'
import {
  Collapsible,
  ErrorPanel,
  LoadingBlocks,
  MetricTile,
  StackedSeverityBar,
  StepStrip,
} from '@/components/primitives/panels'
import { Lightbox, type LightboxItem } from '@/components/primitives/Lightbox'
import {
  ConfidenceInterval,
  DomainGlyph,
  PriorityTag,
  SourceGlyph,
  SyncGrade,
} from '@/components/primitives/indicators'
import { CausalGraphPanel } from './CausalGraphPanel'
import { isUnavailable, ReasoningUnavailablePanel } from '@/components/primitives/ReasoningUnavailable'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDateTime, fmtDuration, fmtPct, fmtScore, fmtTime, fmtUsd } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'
import { useSelection } from '@/lib/stores/selection'
import { buildOfflineBundleAsync, downloadText } from '@/lib/export/offline'

const ADMISSIBILITY_COLOR = {
  met: 'var(--ok)',
  partial: 'var(--medium)',
  unmet: 'var(--critical)',
  'not-applicable': 'var(--ink-3)',
} as const

/**
 * The full-page dossier: what an investigator reads before acting and what a
 * department receives. Everything on this page is either evidence, a cited
 * claim, or arithmetic over the two, and the quality strip at the top says how
 * much of the incident window anyone actually saw.
 */
export function IncidentPackageScreen({ incidentId }: { incidentId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const activeCaseId = useSelection((s) => s.activeCaseId)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const packageQuery = useQuery({
    queryKey: qk.incidents.package(incidentId),
    queryFn: ({ signal }) => api.incidentPackage(incidentId, signal),
  })

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshPackage(incidentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.incidents.package(incidentId) })
      toast({ tone: 'ok', text: 'understanding pass complete' })
    },
    onError: (error) => toast({ tone: 'error', text: 'the understanding pass failed', detail: errorDetail(error) }),
  })

  const forensicsQuery = useQuery({
    queryKey: qk.forensics.bundle(incidentId, activeCaseId),
    queryFn: ({ signal }) => api.forensics(incidentId, activeCaseId, signal),
  })

  if (packageQuery.error) {
    return (
      <div className="w-full overflow-auto p-6">
        <ErrorPanel
          code={errorCode(packageQuery.error)}
          detail={errorDetail(packageQuery.error)}
          onRetry={() => void packageQuery.refetch()}
        />
      </div>
    )
  }

  if (packageQuery.isPending || !packageQuery.data) {
    return (
      <div className="w-full overflow-auto p-6">
        <LoadingBlocks rows={12} height={44} />
      </div>
    )
  }

  if (isUnavailable(packageQuery.data)) {
    return (
      <div className="w-full overflow-auto">
        <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-6 py-6">
          <header className="flex flex-col gap-2 border-b border-[var(--line-0)] pb-4">
            <Link href="/ops" className="mono step flex w-fit items-center gap-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]">
              <Glyph name="chevron-e" size={11} style={{ transform: 'rotate(180deg)' }} />
              operations
            </Link>
            <h1 className="text-[20px] leading-tight text-[var(--ink-0)]">{packageQuery.data.incident.title}</h1>
            <p className="mono text-[11px] text-[var(--ink-2)]">
              {packageQuery.data.incident.incident_id} · {fmtDateTime(packageQuery.data.incident.detected_at)} ·{' '}
              {packageQuery.data.incident.zone_label}
            </p>
          </header>
          <ReasoningUnavailablePanel
            detail={packageQuery.data.detail}
            onRetry={() => void refreshMutation.mutate()}
            retrying={refreshMutation.isPending}
          />
        </div>
      </div>
    )
  }

  const pkg = packageQuery.data
  const incident = pkg.incident
  const bundle = forensicsQuery.data

  const boardItems: LightboxItem[] = pkg.board.map((tile) => ({
    id: tile.observation_id,
    label: `${tile.label} · ${tile.kind}`,
    t: tile.t,
    url: tile.full_url,
    annotations: tile.annotations,
  }))

  const showEvidence = (id: string) => {
    const index = boardItems.findIndex((b) => b.id === id)
    if (index >= 0) setLightboxIndex(index)
    else toast({ tone: 'info', text: 'that observation is not on the evidence board', detail: id })
  }

  const totalCost = pkg.model_trace.reduce((s, r) => s + r.cost_usd, 0)

  const exportBundle = async () => {
    if (!bundle) {
      toast({ tone: 'error', text: 'the forensic bundle has not loaded yet', detail: 'retry in a moment' })
      return
    }
    const html = await buildOfflineBundleAsync(pkg, bundle)
    downloadText(`civicsense-${incident.incident_id}.html`, html, 'text/html')
    toast({
      tone: 'ok',
      text: 'offline bundle exported',
      detail: 'self-contained html, hashes verifiable without the platform',
    })
  }

  return (
    <div className="w-full overflow-auto">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-6 py-4">
        <header className="flex flex-col gap-3 border-b border-[var(--line-0)] pb-4">
          <div className="flex items-center gap-2">
            <Link
              href="/ops"
              className="mono step flex items-center gap-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
            >
              <Glyph name="chevron-e" size={11} style={{ transform: 'rotate(180deg)' }} />
              operations
            </Link>
            <span className="mono text-[11px] text-[var(--ink-3)]">/ incident package</span>
          </div>

          <div className="flex items-start gap-3">
            <PriorityTag priority={incident.priority} blink={incident.priority === 'CRITICAL' && !incident.acknowledged} />
            <DomainGlyph domain={incident.domain} size={16} />
            <h1 className="text-[20px] leading-tight text-[var(--ink-0)]">{incident.title}</h1>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void exportBundle()}
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
                title="self-contained html that opens without the platform"
              >
                <Glyph name="export" size={12} />
                offline bundle
              </button>
              <button
                type="button"
                onClick={() => router.push(`/forensics/${incident.incident_id}`)}
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="timeline" size={12} />
                forensics
              </button>
              <button
                type="button"
                onClick={async () => {
                  const created = await api.caseCreate(`case from ${incident.incident_id}`, [incident.incident_id])
                  await qc.invalidateQueries({ queryKey: qk.cases.all() })
                  router.push(`/case/${created.case_id}`)
                }}
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="custody" size={12} />
                create case
              </button>
            </div>
          </div>

          <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-2)]">
            <CopyChip value={incident.incident_id} />
            <span>{fmtDateTime(incident.detected_at)}</span>
            <span>
              zone {incident.zone_id} · {incident.zone_label}
            </span>
            <span>
              {incident.position.lat.toFixed(5)}, {incident.position.lon.toFixed(5)}
            </span>
            <span className="flex items-center gap-1">
              sync <SyncGrade grade={incident.sync_quality} />
            </span>
            <span className="flex items-center gap-1">
              sources
              {incident.source_types.map((t) => (
                <SourceGlyph key={t} type={t} size={12} />
              ))}
            </span>
          </div>

          <StepStrip status={incident.status} dismissed={incident.dismissed_reason !== null} />
        </header>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
          <MetricTile
            label="composite severity"
            value={fmtScore(pkg.severity.score, 3)}
            glyph="warning-level"
            tone={incident.priority === 'CRITICAL' ? 'bad' : incident.priority === 'HIGH' ? 'warn' : 'neutral'}
          />
          <MetricTile label="coverage" value={fmtPct(pkg.quality.coverage)} glyph="keyframe" />
          <MetricTile label="citation validity" value={fmtPct(pkg.quality.citation_validity, 1)} glyph="verified" />
          <MetricTile label="identity confidence" value={fmtScore(pkg.quality.identity_confidence)} glyph="trust" />
          <MetricTile
            label="calibration"
            value={`${pkg.quality.calibration_uncertainty_m}`}
            unit="m"
            glyph="calibration"
          />
          <MetricTile label="package cost" value={fmtUsd(totalCost, 4)} glyph="budget" />
        </section>

        {!pkg.scene.trigger_agreement ? (
          <section
            className="flex items-start gap-2 border p-3"
            style={{ borderColor: 'var(--medium)', borderRadius: 'var(--radius-card)' }}
          >
            <span style={{ color: 'var(--medium)', marginTop: 1 }}>
              <Glyph name="tampered" size={16} />
            </span>
            <div>
              <p className="text-[13px] text-[var(--ink-0)]">the scene assessment disagrees with the edge trigger</p>
              <p className="mt-1 text-[12.5px] leading-[1.4] text-[var(--ink-1)]">
                the source reported a trigger that the frames do not support. this package is evidence that the detector
                fired without cause, which is a finding about the source rather than about the situation, and it should
                not be dispositioned as a violation.
              </p>
            </div>
          </section>
        ) : null}

        <section>
          <Overline>evidence reel</Overline>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {pkg.board.map((tile, i) => (
              <button
                key={tile.observation_id}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="step relative w-[248px] flex-none overflow-hidden border border-[var(--line-0)] hover:border-[var(--line-1)]"
                style={{ borderRadius: 'var(--radius-card)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tile.thumb_url} alt={tile.label} className="h-[140px] w-full object-cover" />
                <span className="mono absolute top-1 left-1 flex items-center gap-1 bg-[rgba(8,9,11,0.78)] px-1 text-[11px] text-[var(--ink-1)]">
                  <SourceGlyph type={tile.source_type} size={11} />
                  {tile.source_id}
                </span>
                <span className="mono absolute right-1 bottom-1 bg-[rgba(8,9,11,0.78)] px-1 text-[11px] text-[var(--ink-1)]">
                  {fmtTime(tile.t, { zone: false })}
                </span>
                <span className="mono absolute bottom-1 left-1 bg-[rgba(8,9,11,0.78)] px-1 text-[11px] text-[var(--ink-2)]">
                  {tile.kind}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-4">
            <section className="border border-[var(--line-0)] bg-[var(--bg-1)]" style={{ borderRadius: 'var(--radius-card)' }}>
              <Collapsible title="executive summary">
                <p className="text-[13px] leading-[1.4] text-[var(--ink-1)]">{pkg.scene.summary}</p>
                <p className="mt-2 text-[13px] leading-[1.4] text-[var(--ink-1)]">
                  {pkg.context.what_happens_next.text}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {pkg.context.what_happens_next.evidence_ids.map((id) => (
                    <EvidenceChip key={id} id={id} onOpen={showEvidence} />
                  ))}
                </div>
              </Collapsible>

              <Collapsible title="complete timeline" defaultOpen>
                {forensicsQuery.isPending ? (
                  <LoadingBlocks rows={5} height={36} />
                ) : bundle ? (
                  <ol className="flex flex-col">
                    {bundle.timeline.map((entry) => (
                      <li key={entry.entry_id} className="flex gap-3 border-b border-[var(--line-0)] py-2 last:border-b-0">
                        <span className="mono w-[104px] flex-none text-[11px] text-[var(--ink-2)]">
                          {fmtTime(entry.t, { zone: false })}
                        </span>
                        <span className="flex-none pt-0.5 text-[var(--ink-2)]">
                          <SourceGlyph type={entry.source_type} size={12} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-[12.5px] leading-[1.35] text-[var(--ink-1)]">{entry.text}</span>
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="mono text-[11px] text-[var(--ink-3)]">{entry.lane}</span>
                            {entry.evidence_ids.map((id) => (
                              <EvidenceChip key={id} id={id} onOpen={showEvidence} />
                            ))}
                            <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">
                              conf {fmtScore(entry.confidence)}
                            </span>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mono text-[12.5px] text-[var(--ink-2)]">the forensic bundle is unavailable</p>
                )}
              </Collapsible>

              <Collapsible title="contextual analysis">
                <Overline>contributing factors</Overline>
                <ul className="mt-1 mb-3">
                  {pkg.context.contributing_factors.map((c, i) => (
                    <li key={i} className="flex flex-col gap-1 border-b border-[var(--line-0)] py-1.5 last:border-b-0">
                      <span className="text-[12.5px] text-[var(--ink-1)]">{c.text}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        {c.evidence_ids.map((id) => (
                          <EvidenceChip key={id} id={id} onOpen={showEvidence} />
                        ))}
                        <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">conf {fmtScore(c.confidence)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Overline>bounded amplifiers from the context pass</Overline>
                <dl className="mono mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  {Object.entries(pkg.context.amplifiers).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <dt className="text-[var(--ink-2)]">{key.replace(/_/g, ' ')}</dt>
                      <dd className="flex items-center gap-2">
                        <span
                          aria-hidden
                          style={{ display: 'block', width: 40, height: 4, background: 'var(--line-0)', position: 'relative' }}
                        >
                          <span style={{ position: 'absolute', inset: 0, width: `${value * 100}%`, background: 'var(--violet)' }} />
                        </span>
                        <span className="text-[var(--ink-0)]">{fmtScore(value)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Collapsible>

              <Collapsible title="causal graph" defaultOpen>
                {pkg.causal && pkg.causal.nodes.length > 0 ? (
                  <CausalGraphPanel graph={pkg.causal} onEvidence={showEvidence} />
                ) : bundle && bundle.causal.nodes.length > 0 ? (
                  <CausalGraphPanel graph={bundle.causal} onEvidence={showEvidence} />
                ) : (
                  <p className="mono text-[12.5px] text-[var(--ink-2)]">
                    the context pass stated no causal chain for this incident.
                  </p>
                )}
              </Collapsible>
            </section>
          </div>

          <div className="flex flex-col gap-4">
            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>severity breakdown</Overline>
              <div className="mt-2">
                <StackedSeverityBar components={pkg.severity.components} score={pkg.severity.score} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="mono text-[11px] text-[var(--ink-2)]">reported interval</span>
                <ConfidenceInterval value={incident.css.value} lo={incident.css.lo} hi={incident.css.hi} digits={3} />
              </div>
            </section>

            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <div className="flex items-center gap-2">
                <Overline>legal mapping</Overline>
                {pkg.legal.some((l) => !l.counsel_verified) ? (
                  <span className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
                    reference only until counsel verifies
                  </span>
                ) : null}
              </div>
              {pkg.legal.length === 0 ? (
                <p className="mono mt-2 text-[12.5px] text-[var(--ink-2)]">
                  no statute is cited: this situation is dispositioned operationally, not punitively.
                </p>
              ) : (
                <table className="mt-2 w-full">
                  <thead>
                    <tr className="overline text-left">
                      <th className="pb-1">statute</th>
                      <th className="pb-1">section</th>
                      <th className="pb-1">title</th>
                      <th className="pb-1 text-right">conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.legal.map((l, i) => (
                      <tr key={i} className="border-t border-[var(--line-0)] align-top">
                        <td className="mono py-1 pr-2 text-[11px] text-[var(--ink-1)]">{l.statute}</td>
                        <td className="mono py-1 pr-2 text-[11px] text-[var(--ink-0)]">{l.section}</td>
                        <td className="py-1 pr-2 text-[12.5px] text-[var(--ink-1)]">
                          {l.title}
                          <span className="mono block text-[11px] text-[var(--ink-3)]">{l.source_reference}</span>
                        </td>
                        <td className="mono py-1 text-right text-[11px] text-[var(--ink-1)]">{fmtScore(l.confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {pkg.routing ? (
              <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
                <Overline>routing</Overline>
                <p className="mt-1.5 text-[13px] text-[var(--ink-0)]">{pkg.routing.department_label}</p>
                <p className="mt-1 text-[12.5px] text-[var(--ink-1)]">{pkg.routing.action_line}</p>
                <dl className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <Row label="sla" value={fmtDuration(pkg.routing.sla_seconds * 1000)} />
                  <Row
                    label="dispatched"
                    value={pkg.routing.dispatched_at ? fmtTime(pkg.routing.dispatched_at, { ms: false }) : 'not yet'}
                  />
                  <Row
                    label="acknowledged"
                    value={pkg.routing.acknowledged_at ? fmtTime(pkg.routing.acknowledged_at, { ms: false }) : 'not yet'}
                  />
                  <Row label="escalations" value={String(pkg.routing.escalation_level)} />
                </dl>
              </section>
            ) : null}

            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>package quality and admissibility</Overline>
              <ul className="mt-2 flex flex-col gap-1.5">
                {pkg.quality.admissibility.map((item) => (
                  <li key={item.key} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      style={{ marginTop: 5, width: 6, height: 6, flex: 'none', background: ADMISSIBILITY_COLOR[item.state] }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[12.5px] text-[var(--ink-1)]">
                        {item.label}
                        <span className="mono ml-2 text-[11px]" style={{ color: ADMISSIBILITY_COLOR[item.state] }}>
                          {item.state}
                        </span>
                      </span>
                      <span className="mono text-[11px] text-[var(--ink-3)]">
                        {item.standard} · {item.note}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mono mt-3 flex items-center gap-3 border-t border-[var(--line-0)] pt-2 text-[11px]">
                <span className="text-[var(--ink-2)]">guard</span>
                <span style={{ color: pkg.guard.verdict === 'pass' ? 'var(--ok)' : 'var(--medium)' }}>{pkg.guard.verdict}</span>
                <span className="text-[var(--ink-3)]">{pkg.guard.policy_version}</span>
                <HashChip hash={pkg.observation_ids.join('')} onOpen={openCustody} />
              </div>
            </section>

            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>model trace</Overline>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead>
                    <tr className="overline text-left">
                      <th className="pb-1 pr-3">role</th>
                      <th className="pb-1 pr-3">model</th>
                      <th className="pb-1 pr-3">tier</th>
                      <th className="pb-1 pr-3 text-right whitespace-nowrap">tokens</th>
                      <th className="pb-1 pr-3 text-right">ms</th>
                      <th className="pb-1 text-right">usd</th>
                    </tr>
                  </thead>
                  <tbody className="mono text-[11px]">
                    {pkg.model_trace.map((row, i) => (
                      <tr key={i} className="border-t border-[var(--line-0)]">
                        <td className="py-1 pr-3 whitespace-nowrap text-[var(--ink-1)]">{row.role}</td>
                        <td className="py-1 pr-3 whitespace-nowrap text-[var(--ink-2)]">{row.model.split('/').pop()}</td>
                        <td className="py-1 pr-3 whitespace-nowrap text-[var(--ink-3)]">{row.tier}</td>
                        <td className="py-1 pr-3 text-right whitespace-nowrap text-[var(--ink-2)]">
                          {row.tokens_in}/{row.tokens_out}
                        </td>
                        <td className="py-1 pr-3 text-right whitespace-nowrap text-[var(--ink-2)]">{row.latency_ms}</td>
                        <td className="py-1 text-right whitespace-nowrap text-[var(--ink-0)]">{fmtUsd(row.cost_usd, 4)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--line-1)]">
                      <td className="py-1 pr-3 text-[var(--ink-2)]" colSpan={5}>
                        total
                      </td>
                      <td className="py-1 text-right whitespace-nowrap text-[var(--ink-0)]">{fmtUsd(totalCost, 4)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox items={boardItems} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={setLightboxIndex} />
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--ink-2)]">{label}</dt>
      <dd className="text-[var(--ink-0)]">{value}</dd>
    </div>
  )
}
