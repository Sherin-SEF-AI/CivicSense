'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/resources'
import { qk } from '@/lib/api/keys'
import { errorDetail } from '@/lib/api/client'
import type { ForensicsBundle } from '@/lib/api/schemas'
import { Glyph, type GlyphName } from '@/components/glyphs'
import { ScopeChart } from '@/components/data/ScopeChart'
import { CausalGraphPanel } from '@/components/incident/CausalGraphPanel'
import { MetrologyPanel } from './MetrologyPanel'
import { EvidenceChip, HashChip, Overline } from '@/components/primitives/chips'
import { AuthenticityDot } from '@/components/primitives/indicators'
import { fmtScore, fmtTime } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'
import { CANVAS } from '@/lib/tokens'

type Tab = 'kinematics' | 'metrology' | 'causality' | 'authenticity' | 'hypotheses' | 'entities'

const TABS: { key: Tab; label: string; glyph: GlyphName }[] = [
  { key: 'kinematics', label: 'kinematics', glyph: 'kinematics' },
  { key: 'metrology', label: 'metrology', glyph: 'calibration' },
  { key: 'causality', label: 'causality', glyph: 'causal-graph' },
  { key: 'authenticity', label: 'authenticity', glyph: 'verified' },
  { key: 'hypotheses', label: 'hypotheses', glyph: 'prediction' },
  { key: 'entities', label: 'entities', glyph: 'trajectory' },
]

const CONFLICT_COLOR = {
  none: 'var(--ink-3)',
  low: 'var(--low)',
  serious: 'var(--high)',
  critical: 'var(--critical)',
} as const

export function AnalysisRail({ bundle, onEvidence }: { bundle: ForensicsBundle; onEvidence: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('kinematics')
  const openCustody = useUi((s) => s.openCustody)
  const toast = useUi((s) => s.toast)
  const qc = useQueryClient()

  const refreshBundle = () => void qc.invalidateQueries({ queryKey: qk.forensics.all() })

  const generate = useMutation({
    mutationFn: () => api.generateHypotheses(bundle.incident_id),
    onSuccess: (result) => {
      refreshBundle()
      toast(
        result.items.length === 0
          ? {
              tone: 'info',
              text: 'no testable hypothesis was formed',
              detail: 'either the reasoning layer is unavailable or nothing could be separated with the sources in range',
            }
          : { tone: 'ok', text: `${result.items.length} competing explanations formed` },
      )
    },
    onError: (error) => toast({ tone: 'error', text: 'could not form hypotheses', detail: errorDetail(error) }),
  })

  const pull = useMutation({
    mutationFn: (requestId: string) => api.pullHypothesisRequest(requestId),
    onSuccess: (updated) => {
      refreshBundle()
      toast({ tone: 'ok', text: `retrieval pulled, posterior now ${updated.posterior.toFixed(2)}` })
    },
    onError: (error) => toast({ tone: 'error', text: 'the retrieval failed', detail: errorDetail(error) }),
  })

  return (
    <aside
      className="flex min-h-0 flex-none flex-col border-l border-[var(--line-0)] bg-[var(--bg-1)]"
      style={{ width: 340 }}
      aria-label="analysis"
    >
      <div role="tablist" aria-label="analysis tabs" className="flex flex-none border-b border-[var(--line-0)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            title={t.label}
            className="step flex flex-1 items-center justify-center gap-1 py-1.5"
            style={{
              color: tab === t.key ? 'var(--ink-0)' : 'var(--ink-2)',
              background: tab === t.key ? 'var(--bg-3)' : undefined,
              borderBottom: tab === t.key ? '2px solid var(--live)' : '2px solid transparent',
            }}
          >
            <Glyph name={t.glyph} size={14} />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'kinematics' ? (
          <div className="flex flex-col gap-4">
            {bundle.kinematics.length === 0 ? (
              <p className="mono text-[12.5px] text-[var(--ink-2)]">no tracks were measured in this window</p>
            ) : null}
            {bundle.kinematics.map((track) => (
              <section key={track.track_id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="mono text-[12.5px] text-[var(--ink-0)]">{track.track_id}</span>
                  <span
                    className="mono text-[11px]"
                    style={{ color: track.measurement_grade === 'measured' ? 'var(--ok)' : 'var(--medium)' }}
                    title={
                      track.measurement_grade === 'measured'
                        ? 'uncertainty inside the configured tolerance'
                        : 'uncertainty wider than tolerance, reported as an indication rather than a measurement'
                    }
                  >
                    {track.measurement_grade}
                  </span>
                  {track.validated_against_can ? (
                    <span
                      className="mono ml-auto border px-1 text-[11px]"
                      style={{ color: 'var(--ok)', borderColor: 'var(--ok)', borderRadius: 'var(--radius-chip)' }}
                      title="camera speed estimate calibrated against the patrol vehicle's own CAN speed at this site"
                    >
                      validated against CAN
                    </span>
                  ) : (
                    <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">no ground truth</span>
                  )}
                </div>
                <p className="text-[12.5px] text-[var(--ink-1)]">{track.descriptor}</p>
                <ScopeChart
                  x={track.samples.map((s) => s.t)}
                  series={[
                    {
                      label: 'speed',
                      color: CANVAS.live,
                      fill: CANVAS.liveFill,
                      values: track.samples.map((s) => s.speed),
                      band: { lo: track.samples.map((s) => s.speed_lo), hi: track.samples.map((s) => s.speed_hi) },
                      unit: 'km/h',
                    },
                  ]}
                  height={92}
                />
                <dl className="mono grid grid-cols-2 gap-x-3 text-[11px]">
                  <div className="flex justify-between">
                    <dt className="text-[var(--ink-2)]">peak</dt>
                    <dd className="text-[var(--ink-0)]">
                      {track.peak_speed.value.toFixed(1)} [{track.peak_speed.lo.toFixed(1)}-
                      {track.peak_speed.hi.toFixed(1)}]
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--ink-2)]">braking onset</dt>
                    <dd className="text-[var(--ink-0)]">
                      {track.braking_onset_t === null ? 'none' : fmtTime(track.braking_onset_t, { zone: false })}
                    </dd>
                  </div>
                </dl>
              </section>
            ))}

            {bundle.conflicts.length > 0 ? (
              <section>
                <Overline>surrogate safety measures</Overline>
                <table className="mt-1.5 w-full">
                  <thead>
                    <tr className="overline text-left">
                      <th className="pb-1">pair</th>
                      <th className="pb-1 text-right">ttc</th>
                      <th className="pb-1 text-right">pet</th>
                      <th className="pb-1 text-right">drac</th>
                    </tr>
                  </thead>
                  <tbody className="mono text-[11px]">
                    {bundle.conflicts.map((c, i) => (
                      <tr key={i} className="border-t border-[var(--line-0)]">
                        <td className="py-1" style={{ color: CONFLICT_COLOR[c.severity] }}>
                          {c.pair.join(' / ')}
                        </td>
                        <td className="py-1 text-right text-[var(--ink-1)]">
                          {c.ttc_s ? `${c.ttc_s.value.toFixed(1)}s` : '--'}
                        </td>
                        <td className="py-1 text-right text-[var(--ink-1)]">
                          {c.pet_s ? `${c.pet_s.value.toFixed(1)}s` : '--'}
                        </td>
                        <td className="py-1 text-right text-[var(--ink-1)]">
                          {c.drac ? c.drac.value.toFixed(1) : '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mono mt-2 text-[11px] text-[var(--ink-3)]">
                  time to collision, post-encroachment time and deceleration rate to avoid the crash, each carried as an
                  interval from calibration residual and timestamp jitter.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'metrology' ? <MetrologyPanel incidentId={bundle.incident_id} /> : null}

        {tab === 'causality' ? <CausalGraphPanel graph={bundle.causal} onEvidence={onEvidence} /> : null}

        {tab === 'authenticity' ? (
          <div className="flex flex-col gap-3">
            {bundle.authenticity.map((report) => (
              <section key={report.evidence_id} className="border-b border-[var(--line-0)] pb-3 last:border-b-0">
                <div className="flex items-center gap-2">
                  <AuthenticityDot verdict={report.verdict} />
                  <span className="mono text-[12.5px] text-[var(--ink-0)]">{report.verdict}</span>
                  <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">{report.evidence_id}</span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {report.tests.map((test, i) => (
                    <li key={i} className="flex flex-col">
                      <span className="mono flex items-center gap-2 text-[11px]">
                        <span
                          style={{
                            color:
                              test.result === 'pass'
                                ? 'var(--ok)'
                                : test.result === 'fail'
                                  ? 'var(--critical)'
                                  : 'var(--medium)',
                          }}
                        >
                          {test.result}
                        </span>
                        <span className="text-[var(--ink-1)]">{test.test}</span>
                      </span>
                      <span className="text-[11px] text-[var(--ink-2)]">{test.detail}</span>
                      {test.standard ? (
                        <span className="mono text-[11px] text-[var(--ink-3)]">{test.standard}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 flex items-center gap-2">
                  <HashChip hash={report.hash} onOpen={openCustody} verified={report.verdict !== 'inconsistent'} />
                  {report.device_signature ? (
                    <span className="mono text-[11px] text-[var(--ink-3)]">device signed</span>
                  ) : (
                    <span className="mono text-[11px] text-[var(--medium)]">no device signature</span>
                  )}
                </div>
                {report.verdict === 'inconsistent' ? (
                  <p className="mono mt-1 text-[11px]" style={{ color: 'var(--critical)' }}>
                    quarantined from automatic dispositions and flagged for human review. it is not dropped.
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

        {tab === 'hypotheses' ? (
          <div className="flex flex-col gap-3">
            <p className="mono text-[11px] text-[var(--ink-3)]">
              the loop forms competing explanations, asks for the observation that would separate them, and stops when
              they separate or the budget runs out.
            </p>
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="mono step self-start border px-2 py-1 text-[11px] disabled:opacity-40"
              style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--live)', color: 'var(--live)' }}
            >
              {generate.isPending
                ? 'forming'
                : bundle.hypotheses.length === 0
                  ? 'form competing explanations'
                  : 'form them again'}
            </button>
            {bundle.hypotheses.length === 0 && !generate.isPending ? (
              <p className="mono text-[11px] text-[var(--ink-3)]">
                nothing has been proposed for this incident yet. this costs one reasoning call, which is why it is not
                automatic.
              </p>
            ) : null}
            {bundle.hypotheses.map((h) => (
              <section key={h.hypothesis_id} className="border border-[var(--line-0)] p-2" style={{ borderRadius: 'var(--radius-card)' }}>
                <div className="flex items-start gap-2">
                  <span className="mono text-[11px] text-[var(--ink-3)]">{h.hypothesis_id}</span>
                  <span className="flex-1 text-[12.5px] text-[var(--ink-1)]">{h.statement}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="mono text-[11px] text-[var(--ink-2)]">prior {fmtScore(h.prior)}</span>
                  <span aria-hidden className="relative h-1.5 flex-1" style={{ background: 'var(--line-0)' }}>
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: `${h.posterior * 100}%`,
                        background:
                          h.status === 'supported' ? 'var(--ok)' : h.status === 'refuted' ? 'var(--critical)' : 'var(--live)',
                      }}
                    />
                  </span>
                  <span className="mono text-[11px] text-[var(--ink-0)]">{fmtScore(h.posterior)}</span>
                </div>
                <p className="mono mt-1 text-[11px]" style={{ color: h.status === 'budget-exhausted' ? 'var(--medium)' : 'var(--ink-2)' }}>
                  {h.status}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {h.requests.map((r) => (
                    <li key={r.request_id} className="mono flex items-center gap-2 text-[11px]">
                      <span
                        style={{
                          color:
                            r.state === 'returned'
                              ? 'var(--ok)'
                              : r.state === 'unavailable'
                                ? 'var(--critical)'
                                : 'var(--ink-2)',
                        }}
                      >
                        {r.state}
                      </span>
                      <span className="flex-1 truncate text-[var(--ink-1)]" title={r.what}>
                        {r.what}
                      </span>
                      {r.delta === null ? null : (
                        <span style={{ color: r.delta > 0 ? 'var(--ok)' : 'var(--critical)' }}>
                          {r.delta > 0 ? '+' : ''}
                          {fmtScore(r.delta)}
                        </span>
                      )}
                      {r.state === 'queued' ? (
                        <button
                          type="button"
                          onClick={() => pull.mutate(r.request_id)}
                          disabled={pull.isPending}
                          aria-label={`pull ${r.what} from ${r.source_id}`}
                          className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)] disabled:opacity-40"
                          style={{ borderRadius: 'var(--radius-chip)' }}
                        >
                          pull
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}

        {tab === 'entities' ? (
          <div className="flex flex-col gap-3">
            {bundle.entities.map((entity) => (
              <section key={entity.entity_ref} className="border border-[var(--line-0)] p-2" style={{ borderRadius: 'var(--radius-card)' }}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[12.5px] text-[var(--ink-0)]">{entity.entity_ref}</span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">{entity.kind}</span>
                  {entity.kind === 'person' && !entity.investigation_flag ? (
                    <span
                      className="mono ml-auto flex items-center gap-1 text-[11px]"
                      style={{ color: 'var(--medium)' }}
                      title="person tracking across sources requires an authorised investigation flag on a case"
                    >
                      <Glyph name="redaction" size={11} />
                      path locked
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12.5px] text-[var(--ink-1)]">{entity.descriptor}</p>
                {entity.plate_hash ? (
                  <p className="mono mt-1 text-[11px] text-[var(--ink-2)]">
                    plate hash {entity.plate_hash.slice(0, 12)} · raw plate stays in the incident vault
                  </p>
                ) : null}
                <div className="mt-2 flex gap-1 overflow-x-auto">
                  {entity.appearance_strip.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={url}
                      alt=""
                      className="h-12 w-20 flex-none border border-[var(--line-0)] object-cover"
                      style={{
                        filter: entity.kind === 'person' && !entity.investigation_flag ? 'blur(6px)' : undefined,
                      }}
                    />
                  ))}
                </div>
                <dl className="mono mt-2 grid grid-cols-2 gap-x-3 text-[11px]">
                  <div className="flex justify-between">
                    <dt className="text-[var(--ink-2)]">prior incidents</dt>
                    <dd className="text-[var(--ink-0)]">{entity.prior_incidents}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--ink-2)]">path points</dt>
                    <dd className="text-[var(--ink-0)]">
                      {entity.kind === 'person' && !entity.investigation_flag ? 'locked' : entity.path.length}
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="mono flex-none border-t border-[var(--line-0)] px-3 py-1.5 text-[11px] text-[var(--ink-3)]">
        {bundle.tree.length} evidence items ·{' '}
        <button
          type="button"
          onClick={() => onEvidence(bundle.tree[0]?.evidence_id ?? '')}
          className="step underline decoration-dotted hover:text-[var(--ink-1)]"
        >
          open first item
        </button>
        <span className="ml-2">
          <EvidenceChip id={bundle.incident_id} onOpen={onEvidence} />
        </span>
      </footer>
    </aside>
  )
}
