'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Glyph } from '@/components/glyphs'
import { Drawer } from '@/components/primitives/Drawer'
import { Lightbox, type LightboxItem } from '@/components/primitives/Lightbox'
import { Collapsible, ErrorPanel, LoadingBlocks, StackedSeverityBar, StepStrip } from '@/components/primitives/panels'
import { CopyChip, EvidenceChip, Overline, SLACountdown } from '@/components/primitives/chips'
import { ConfidenceInterval, DomainGlyph, PriorityTag, SourceGlyph, SyncGrade } from '@/components/primitives/indicators'
import type { Claim, IncidentSummary } from '@/lib/api/schemas'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDateTime, fmtPct, fmtScore, fmtTime, fmtUsd } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'
import { isUnavailable, ReasoningUnavailablePanel } from '@/components/primitives/ReasoningUnavailable'

const DISMISS_REASONS = [
  'not a violation in this context',
  'duplicate of another incident',
  'source quality too low to act',
  'already resolved on site',
  'permitted activity, permit on file',
]

/** A model claim with its citations. Uncited text never renders as a claim. */
function ClaimLine({ claim, onEvidence }: { claim: Claim; onEvidence: (id: string) => void }) {
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--line-0)] py-1.5 last:border-b-0">
      <span className="text-[12.5px] leading-[1.35] text-[var(--ink-1)]">{claim.text}</span>
      <span className="flex flex-wrap items-center gap-1">
        {claim.evidence_ids.map((id) => (
          <EvidenceChip key={id} id={id} onOpen={onEvidence} />
        ))}
        <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">conf {fmtScore(claim.confidence)}</span>
      </span>
    </li>
  )
}

export function IncidentDrawer({
  incident,
  onClose,
  onAction,
}: {
  incident: IncidentSummary | null
  onClose: () => void
  onAction: (action: 'ack' | 'dispatch' | 'escalate' | 'resolve' | 'dismiss', reason?: string) => void
}) {
  const router = useRouter()
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [dismissOpen, setDismissOpen] = useState(false)

  const id = incident?.incident_id ?? ''
  const { data, isPending, error, refetch } = useQuery({
    queryKey: qk.incidents.package(id),
    queryFn: ({ signal }) => api.incidentPackage(id, signal),
    enabled: id !== '',
  })

  if (!incident) return null

  const pkg = isUnavailable(data) ? null : data
  const boardItems: LightboxItem[] =
    pkg?.board.map((tile) => ({
      id: tile.observation_id,
      label: `${tile.label} · ${tile.kind}`,
      t: tile.t,
      url: tile.full_url,
      annotations: tile.annotations,
    })) ?? []

  const showEvidence = (evidenceId: string) => {
    const index = boardItems.findIndex((b) => b.id === evidenceId)
    if (index >= 0) setLightboxIndex(index)
    else toast({ tone: 'info', text: 'that observation is not on the evidence board', detail: evidenceId })
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        ariaLabel="incident detail"
        title={
          <>
            <PriorityTag priority={incident.priority} blink={incident.priority === 'CRITICAL' && !incident.acknowledged} />
            <DomainGlyph domain={incident.domain} />
            <span className="truncate">{incident.title}</span>
          </>
        }
        subtitle={
          <span className="flex items-center gap-2">
            <CopyChip value={incident.incident_id} />
            <span>·</span>
            <span>{fmtDateTime(incident.detected_at)}</span>
            <SyncGrade grade={incident.sync_quality} />
          </span>
        }
      >
        <div className="border-b border-[var(--line-0)] px-3 py-2">
          <StepStrip status={incident.status} dismissed={incident.dismissed_reason !== null} />
        </div>

        <div className="flex flex-wrap gap-1 border-b border-[var(--line-0)] px-3 py-2">
          <ActionButton glyph="acknowledge" label="ack" hint="a" disabled={incident.acknowledged} onClick={() => onAction('ack')} />
          <ActionButton glyph="dispatch" label="dispatch" hint="d" onClick={() => onAction('dispatch')} />
          <ActionButton glyph="escalate" label="escalate" onClick={() => onAction('escalate')} />
          <ActionButton glyph="timeline" label="forensics" hint="f" onClick={() => router.push(`/forensics/${incident.incident_id}`)} />
          <ActionButton glyph="playbook" label="package" onClick={() => router.push(`/incident/${incident.incident_id}`)} />
          <ActionButton glyph="close" label="dismiss" hint="x" onClick={() => setDismissOpen((v) => !v)} />
        </div>

        {dismissOpen ? (
          <div className="border-b border-[var(--line-0)] bg-[var(--bg-2)] px-3 py-2">
            <Overline>dismissal reason, required</Overline>
            <p className="mono mt-1 mb-2 text-[11px] text-[var(--ink-2)]">
              the reason feeds the learning loop and the trigger thresholds. it is not free text discarded on write.
            </p>
            <ul className="flex flex-col gap-1">
              {DISMISS_REASONS.map((reason) => (
                <li key={reason}>
                  <button
                    type="button"
                    onClick={() => {
                      onAction('dismiss', reason)
                      setDismissOpen(false)
                    }}
                    className="step w-full border border-[var(--line-0)] px-2 py-1 text-left text-[12.5px] text-[var(--ink-1)] hover:border-[var(--line-1)] hover:text-[var(--ink-0)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    {reason}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="p-3">
            <ErrorPanel code={errorCode(error)} detail={errorDetail(error)} onRetry={() => void refetch()} />
          </div>
        ) : isPending ? (
          <div className="p-3">
            <LoadingBlocks rows={7} height={44} />
          </div>
        ) : isUnavailable(data) ? (
          <div className="p-3">
            <ReasoningUnavailablePanel detail={data.detail} />
          </div>
        ) : pkg ? (
          <>
            <section className="border-b border-[var(--line-0)] px-3 py-3">
              <Overline>evidence board</Overline>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {pkg.board.map((tile, i) => (
                  <button
                    key={tile.observation_id}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="step relative overflow-hidden border border-[var(--line-0)] hover:border-[var(--line-1)]"
                    style={{ borderRadius: 'var(--radius-chip)', aspectRatio: '16/9' }}
                    title={`${tile.label} at ${fmtTime(tile.t)}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={tile.thumb_url} alt={tile.label} className="h-full w-full object-cover" />
                    <span className="mono absolute top-0.5 left-0.5 flex items-center gap-1 bg-[rgba(8,9,11,0.75)] px-1 text-[11px] text-[var(--ink-1)]">
                      <SourceGlyph type={tile.source_type} size={11} />
                      {tile.kind}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <Collapsible title="scene understanding" right={<span className="mono text-[11px] text-[var(--ink-3)]">{pkg.scene.model}</span>}>
              <p className="text-[12.5px] leading-[1.35] text-[var(--ink-1)]">{pkg.scene.summary}</p>
              <div className="mt-2">
                <Overline>actors</Overline>
                <ul className="mt-1">
                  {pkg.scene.actors.map((actor) => (
                    <li key={actor.ref} className="flex items-baseline gap-2 border-b border-[var(--line-0)] py-1 last:border-b-0">
                      <span className="mono text-[11px] text-[var(--ink-3)]">{actor.kind}</span>
                      <span className="flex-1 text-[12.5px] text-[var(--ink-1)]">{actor.descriptor}</span>
                      {actor.evidence_ids.map((eid) => (
                        <EvidenceChip key={eid} id={eid} onOpen={showEvidence} />
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
              {pkg.scene.violation_assessment ? (
                <div className="mt-2">
                  <Overline>violation assessment</Overline>
                  <ul className="mt-1">
                    <ClaimLine claim={pkg.scene.violation_assessment} onEvidence={showEvidence} />
                  </ul>
                </div>
              ) : null}
              {pkg.scene.hazards.length > 0 ? (
                <div className="mt-2">
                  <Overline>hazards</Overline>
                  <ul className="mt-1">
                    {pkg.scene.hazards.map((h, i) => (
                      <ClaimLine key={i} claim={h} onEvidence={showEvidence} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {pkg.scene.intent_hypotheses.length > 0 ? (
                <div className="mt-2">
                  <Overline>intent hypotheses, not findings</Overline>
                  <ul className="mt-1">
                    {pkg.scene.intent_hypotheses.map((h, i) => (
                      <ClaimLine key={i} claim={h} onEvidence={showEvidence} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {!pkg.scene.trigger_agreement ? (
                <p className="mono mt-2 text-[11px]" style={{ color: 'var(--medium)' }}>
                  the scene pass disagrees with the edge trigger. this package is flagged for review.
                </p>
              ) : null}
            </Collapsible>

            <Collapsible title="context assessment" right={<span className="mono text-[11px] text-[var(--ink-3)]">{pkg.context.model}</span>}>
              <dl className="mono mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">normalcy</dt>
                  <dd className="text-[var(--ink-0)]">{fmtScore(pkg.context.normalcy)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">disposition</dt>
                  <dd className="text-[var(--ink-0)]">{pkg.context.disposition}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">permitted</dt>
                  <dd className="text-[var(--ink-0)]">{pkg.context.permitted_activity ? 'yes' : 'no'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">human review</dt>
                  <dd style={{ color: pkg.context.needs_human_review ? 'var(--medium)' : 'var(--ink-0)' }}>
                    {pkg.context.needs_human_review ? 'required' : 'not required'}
                  </dd>
                </div>
              </dl>

              <Overline>causal chain</Overline>
              <ol className="mono mt-1 mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-[var(--ink-1)]">
                {pkg.context.causal_chain.map((step, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <span className="border border-[var(--line-0)] px-1" style={{ borderRadius: 'var(--radius-chip)' }}>
                      {step}
                    </span>
                    {i < pkg.context.causal_chain.length - 1 ? <Glyph name="chevron-e" size={10} /> : null}
                  </li>
                ))}
              </ol>

              <Overline>contributing factors</Overline>
              <ul className="mt-1">
                {pkg.context.contributing_factors.map((c, i) => (
                  <ClaimLine key={i} claim={c} onEvidence={showEvidence} />
                ))}
              </ul>

              <div className="mt-2">
                <Overline>what happens next if nobody acts</Overline>
                <ul className="mt-1">
                  <ClaimLine claim={pkg.context.what_happens_next} onEvidence={showEvidence} />
                </ul>
              </div>
            </Collapsible>

            <Collapsible title="severity" defaultOpen>
              <StackedSeverityBar components={pkg.severity.components} score={pkg.severity.score} />
              <p className="mono mt-2 text-[11px] text-[var(--ink-3)]">
                weights from the {pkg.severity.zone_profile}. amplifiers are bounded model outputs; the arithmetic is code.
              </p>
              <div className="mt-2">
                <ConfidenceInterval value={incident.css.value} lo={incident.css.lo} hi={incident.css.hi} />
              </div>
            </Collapsible>

            {pkg.legal.length > 0 ? (
              <Collapsible title="legal mapping" defaultOpen={false}>
                <ul className="flex flex-col gap-2">
                  {pkg.legal.map((l, i) => (
                    <li key={i} className="flex flex-col gap-1 border-b border-[var(--line-0)] pb-2 last:border-b-0">
                      <span className="mono flex items-center gap-2 text-[12.5px] text-[var(--ink-0)]">
                        {l.statute} <span className="text-[var(--ink-2)]">s.{l.section}</span>
                        {l.counsel_verified ? null : (
                          <span className="text-[11px]" style={{ color: 'var(--medium)' }}>
                            reference only
                          </span>
                        )}
                      </span>
                      <span className="text-[12.5px] text-[var(--ink-1)]">{l.title}</span>
                      <span className="text-[11px] text-[var(--ink-2)]">{l.justification}</span>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}

            {pkg.routing ? (
              <Collapsible title="routing" defaultOpen>
                <div className="flex items-center gap-2">
                  <Glyph name="department" size={14} />
                  <span className="text-[12.5px] text-[var(--ink-0)]">{pkg.routing.department_label}</span>
                  <span className="mono ml-auto text-[11px] text-[var(--ink-2)]">sla</span>
                  <SLACountdown dueAt={pkg.routing.sla_due_at} slaSeconds={pkg.routing.sla_seconds} />
                </div>
                <p className="mt-2 text-[12.5px] text-[var(--ink-1)]">{pkg.routing.action_line}</p>
                <div className="mt-2">
                  <Overline>channel receipts</Overline>
                  <ul className="mono mt-1 flex flex-col gap-0.5 text-[11px]">
                    {pkg.routing.channels.map((c, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-[68px] text-[var(--ink-1)]">{c.channel}</span>
                        <span className="text-[var(--ink-2)]">sent {c.sent_at ? fmtTime(c.sent_at, { ms: false }) : '--'}</span>
                        <span className="text-[var(--ink-2)]">delivered {c.delivered_at ? fmtTime(c.delivered_at, { ms: false }) : '--'}</span>
                        <span style={{ color: c.acknowledged_at ? 'var(--ok)' : 'var(--ink-3)' }}>
                          {c.acknowledged_at ? `ack ${fmtTime(c.acknowledged_at, { ms: false })}` : 'no ack'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Collapsible>
            ) : null}

            <Collapsible title="package quality" defaultOpen={false}>
              <dl className="mono grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <Stat label="coverage" value={fmtPct(pkg.quality.coverage)} />
                <Stat label="sync grade" value={pkg.quality.sync_grade} />
                <Stat label="citation validity" value={fmtPct(pkg.quality.citation_validity, 1)} />
                <Stat label="calibration" value={`${pkg.quality.calibration_uncertainty_m} m`} />
                <Stat label="identity confidence" value={fmtScore(pkg.quality.identity_confidence)} />
                <Stat
                  label="authenticity"
                  value={`${pkg.quality.authenticity.verified}v ${pkg.quality.authenticity.inconsistent}x`}
                />
              </dl>
              <div className="mt-2">
                <Overline>guard</Overline>
                <p className="mono mt-1 text-[11px]" style={{ color: pkg.guard.verdict === 'pass' ? 'var(--ok)' : 'var(--medium)' }}>
                  {pkg.guard.verdict} · {pkg.guard.policy_version}
                </p>
                {pkg.guard.findings.map((f, i) => (
                  <p key={i} className="mt-1 text-[11px] text-[var(--ink-2)]">
                    {f.rule}: {f.detail}
                  </p>
                ))}
              </div>
            </Collapsible>

            <Collapsible title="model trace" defaultOpen={false}>
              <table className="w-full">
                <thead>
                  <tr className="overline text-left">
                    <th className="pb-1">role</th>
                    <th className="pb-1">model</th>
                    <th className="pb-1 text-right">tok</th>
                    <th className="pb-1 text-right">ms</th>
                    <th className="pb-1 text-right">cost</th>
                  </tr>
                </thead>
                <tbody className="mono text-[11px]">
                  {pkg.model_trace.map((row, i) => (
                    <tr key={i} className="border-t border-[var(--line-0)]">
                      <td className="py-1 text-[var(--ink-1)]">{row.role}</td>
                      <td className="py-1 text-[var(--ink-2)]">
                        {row.model.split('/').pop()}
                        {row.cached ? <span style={{ color: 'var(--ok)' }}> cached</span> : null}
                        {row.fallback_from ? <span style={{ color: 'var(--medium)' }}> fallback</span> : null}
                      </td>
                      <td className="py-1 text-right text-[var(--ink-2)]">
                        {row.tokens_in}/{row.tokens_out}
                      </td>
                      <td className="py-1 text-right text-[var(--ink-2)]">{row.latency_ms}</td>
                      <td className="py-1 text-right text-[var(--ink-1)]">{fmtUsd(row.cost_usd, 4)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[var(--line-1)]">
                    <td className="py-1 text-[var(--ink-2)]" colSpan={4}>
                      total
                    </td>
                    <td className="py-1 text-right text-[var(--ink-0)]">
                      {fmtUsd(pkg.model_trace.reduce((s, r) => s + r.cost_usd, 0), 4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Collapsible>

            <div className="px-3 py-3">
              <button
                type="button"
                onClick={() => openCustody(pkg.board[0]?.observation_id ?? incident.incident_id)}
                className="mono step flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
              >
                <Glyph name="custody" size={12} />
                open custody for this package
              </button>
            </div>
          </>
        ) : null}
      </Drawer>

      {lightboxIndex !== null ? (
        <Lightbox items={boardItems} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={setLightboxIndex} />
      ) : null}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--ink-2)]">{label}</dt>
      <dd className="text-[var(--ink-0)]">{value}</dd>
    </div>
  )
}

function ActionButton({
  glyph,
  label,
  hint,
  onClick,
  disabled,
}: {
  glyph: Parameters<typeof Glyph>[0]['name']
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} (${hint})` : label}
      className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)] disabled:border-[var(--line-0)] disabled:text-[var(--ink-3)] disabled:hover:bg-transparent"
      style={{ borderRadius: 'var(--radius-chip)' }}
    >
      <Glyph name={glyph} size={12} />
      {label}
      {hint ? <span className="text-[var(--ink-3)]">{hint}</span> : null}
    </button>
  )
}
