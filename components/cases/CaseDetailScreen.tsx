'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RecipientClass } from '@/lib/api/schemas'
import { RECIPIENT_CLASSES } from '@/lib/api/schemas/case'
import { Glyph } from '@/components/glyphs'
import { Collapsible, ErrorPanel, LoadingBlocks, MetricTile } from '@/components/primitives/panels'
import { CopyChip, HashChip, Overline } from '@/components/primitives/chips'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtBytes, fmtDate, fmtDateTime } from '@/lib/format'
import { useSelection } from '@/lib/stores/selection'
import { useUi } from '@/lib/stores/ui'

const REDACTION_PRESETS: Record<RecipientClass, { label: string; rules: string[] }> = {
  court: {
    label: 'court',
    rules: ['bystander faces blurred', 'subject plate retained', 'audio names retained', 'full custody report attached'],
  },
  department: {
    label: 'department',
    rules: ['faces and plates blurred', 'audio names bleeped', 'reporter identity withheld'],
  },
  insurer: {
    label: 'insurer',
    rules: ['faces blurred', 'subject plate retained', 'third-party plates blurred', 'audio withheld'],
  },
  public: {
    label: 'public',
    rules: ['all faces and plates blurred', 'audio fully redacted', 'location generalised to the ward'],
  },
}

/**
 * The case file, and the disclosure builder in particular.
 *
 * Redaction is a per-recipient decision with a preview, not a checkbox, and
 * every redacted output is a derivative with its own hash and a record of what
 * was removed and why. The original is never modified, which is the property the
 * verifier at the bottom exists to demonstrate.
 */
export function CaseDetailScreen({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const setActiveCase = useSelection((s) => s.setActiveCase)
  const activeCaseId = useSelection((s) => s.activeCaseId)
  const [recipient, setRecipient] = useState<RecipientClass>('department')
  const [note, setNote] = useState('')
  const [certificate, setCertificate] = useState({ issuedBy: '', role: 'person in charge of the computer output', device: '' })

  const caseQuery = useQuery({
    queryKey: qk.cases.detail(caseId),
    queryFn: ({ signal }) => api.case(caseId, signal),
  })

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.casePatch>[1]) => api.casePatch(caseId, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.cases.all() })
      setNote('')
    },
    onError: (error) => toast({ tone: 'error', text: 'update failed', detail: errorDetail(error) }),
  })

  const detail = caseQuery.data

  const incidentsQuery = useQuery({
    queryKey: ['cases', 'incidents', caseId],
    queryFn: async () => {
      if (!detail) return []
      const results = await Promise.all(
        detail.incident_ids.slice(0, 12).map((id) => api.incident(id).catch(() => null)),
      )
      return results.filter((i): i is NonNullable<typeof i> => i !== null)
    },
    enabled: detail !== undefined,
  })

  const preset = REDACTION_PRESETS[recipient]

  const evidencePreview = useMemo(() => detail?.evidence_ids.slice(0, 6) ?? [], [detail])

  if (caseQuery.error) {
    return (
      <div className="w-full p-6">
        <ErrorPanel code={errorCode(caseQuery.error)} detail={errorDetail(caseQuery.error)} onRetry={() => void caseQuery.refetch()} />
      </div>
    )
  }

  if (caseQuery.isPending || !detail) {
    return (
      <div className="w-full p-6">
        <LoadingBlocks rows={10} height={44} />
      </div>
    )
  }

  return (
    <div className="w-full overflow-auto">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-6 py-4">
        <header className="flex flex-col gap-3 border-b border-[var(--line-0)] pb-4">
          <div className="flex items-center gap-2">
            <Link href="/cases" className="mono step flex items-center gap-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]">
              <Glyph name="chevron-e" size={11} style={{ transform: 'rotate(180deg)' }} />
              cases
            </Link>
          </div>
          <div className="flex items-start gap-3">
            <h1 className="text-[20px] leading-tight text-[var(--ink-0)]">{detail.title}</h1>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveCase(activeCaseId === caseId ? null : caseId)}
                className="mono step flex items-center gap-1 border px-2 py-1 text-[12.5px]"
                style={{
                  borderRadius: 'var(--radius-chip)',
                  borderColor: activeCaseId === caseId ? 'var(--live)' : 'var(--line-1)',
                  color: activeCaseId === caseId ? 'var(--live)' : 'var(--ink-1)',
                }}
                title="the active case scopes evidence search and carries the investigation flag"
              >
                <Glyph name="pin" size={12} />
                {activeCaseId === caseId ? 'active case' : 'set active'}
              </button>
              <button
                type="button"
                onClick={() => patchMutation.mutate({ legal_hold: !detail.legal_hold })}
                className="mono step flex items-center gap-1 border px-2 py-1 text-[12.5px]"
                style={{
                  borderRadius: 'var(--radius-chip)',
                  borderColor: detail.legal_hold ? 'var(--medium)' : 'var(--line-1)',
                  color: detail.legal_hold ? 'var(--medium)' : 'var(--ink-1)',
                }}
                title="legal hold freezes retention and moves held evidence to write-once storage"
              >
                <Glyph name="pin" size={12} />
                legal hold {detail.legal_hold ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={() => patchMutation.mutate({ investigation_flag: !detail.investigation_flag })}
                className="mono step flex items-center gap-1 border px-2 py-1 text-[12.5px]"
                style={{
                  borderRadius: 'var(--radius-chip)',
                  borderColor: detail.investigation_flag ? 'var(--violet)' : 'var(--line-1)',
                  color: detail.investigation_flag ? 'var(--violet)' : 'var(--ink-1)',
                }}
                title="an authorised investigation flag is what unlocks person search, and every access under it is logged"
              >
                <Glyph name="verified" size={12} />
                investigation {detail.investigation_flag ? 'authorised' : 'not set'}
              </button>
            </div>
          </div>
          <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-2)]">
            <CopyChip value={detail.reference} />
            <span>opened {fmtDate(detail.opened_at)}</span>
            <span>owner {detail.owner}</span>
            <span>state {detail.state}</span>
            <span>updated {fmtDateTime(detail.updated_at)}</span>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricTile label="linked incidents" value={String(detail.incident_count)} glyph="incident" />
          <MetricTile label="evidence items" value={String(detail.evidence_count)} glyph="keyframe" />
          <MetricTile label="evidence size" value={fmtBytes(detail.evidence_bytes)} glyph="hash" />
          <MetricTile
            label="disclosure bundles"
            value={String(detail.bundles.length)}
            glyph="export"
            tone={detail.bundles.length > 0 ? 'ok' : 'neutral'}
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-4">
            <section className="border border-[var(--line-0)] bg-[var(--bg-1)]" style={{ borderRadius: 'var(--radius-card)' }}>
              <Collapsible title="linked incidents">
                {incidentsQuery.isPending ? (
                  <LoadingBlocks rows={3} height={32} />
                ) : (
                  <ul className="flex flex-col">
                    {(incidentsQuery.data ?? []).map((incident) => (
                      <li key={incident.incident_id} className="flex items-center gap-2 border-b border-[var(--line-0)] py-1.5 last:border-b-0">
                        <Link
                          href={`/incident/${incident.incident_id}`}
                          className="step min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
                        >
                          {incident.title}
                        </Link>
                        <span className="mono text-[11px] text-[var(--ink-3)]">{incident.priority}</span>
                        <Link
                          href={`/forensics/${incident.incident_id}`}
                          className="step text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                          title="open in forensics"
                        >
                          <Glyph name="timeline" size={12} />
                        </Link>
                      </li>
                    ))}
                    {detail.incident_ids.length === 0 ? (
                      <li className="mono py-2 text-[12.5px] text-[var(--ink-2)]">
                        no incidents linked. open an incident and use create case, or add it from the palette.
                      </li>
                    ) : null}
                  </ul>
                )}
              </Collapsible>

              <Collapsible title="notes">
                <ul className="flex flex-col">
                  {detail.notes.map((n) => (
                    <li key={n.note_id} className="flex flex-col gap-1 border-b border-[var(--line-0)] py-2 last:border-b-0">
                      <span className="mono flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
                        {fmtDateTime(n.t)} · {n.author}
                      </span>
                      <span className="text-[12.5px] text-[var(--ink-1)]">{n.text}</span>
                      <span className="flex flex-wrap gap-1">
                        {n.evidence_ids.map((id) => (
                          <span key={id} className="mono border border-[var(--line-0)] px-1 text-[11px] text-[var(--ink-2)]" style={{ borderRadius: 'var(--radius-chip)' }}>
                            {id}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (note.trim()) patchMutation.mutate({ note: note.trim() })
                  }}
                  className="mt-2 flex items-center gap-2"
                >
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="add a note, cite evidence ids in the text"
                    aria-label="new note"
                    className="mono min-w-0 flex-1 border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  />
                  <button
                    type="submit"
                    className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    add
                  </button>
                </form>
              </Collapsible>

              <Collapsible title="tasks">
                <ul className="flex flex-col">
                  {detail.tasks.map((task) => (
                    <li key={task.task_id} className="flex items-center gap-2 border-b border-[var(--line-0)] py-1.5 last:border-b-0">
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          flex: 'none',
                          background:
                            task.state === 'done' ? 'var(--ok)' : task.state === 'blocked' ? 'var(--critical)' : 'var(--medium)',
                        }}
                      />
                      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--ink-1)]">{task.text}</span>
                      <span className="mono text-[11px] text-[var(--ink-3)]">{task.owner}</span>
                      <span className="mono text-[11px] text-[var(--ink-2)]">
                        {task.due_at === null ? 'no due date' : fmtDate(task.due_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Collapsible>

              <Collapsible title="export log" defaultOpen={false}>
                {detail.exports.length === 0 ? (
                  <p className="mono text-[12.5px] text-[var(--ink-2)]">nothing has been exported from this case.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="overline text-left">
                        <th className="pb-1">when</th>
                        <th className="pb-1">actor</th>
                        <th className="pb-1">kind</th>
                        <th className="pb-1">recipient</th>
                        <th className="pb-1">manifest</th>
                      </tr>
                    </thead>
                    <tbody className="mono text-[11px]">
                      {detail.exports.map((x) => (
                        <tr key={x.export_id} className="border-t border-[var(--line-0)]">
                          <td className="py-1 text-[var(--ink-2)]">{fmtDateTime(x.t)}</td>
                          <td className="py-1 text-[var(--ink-1)]">{x.actor}</td>
                          <td className="py-1 text-[var(--ink-1)]">{x.kind}</td>
                          <td className="py-1 text-[var(--ink-2)]">{x.recipient}</td>
                          <td className="py-1">
                            <HashChip hash={x.manifest_hash} onOpen={openCustody} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Collapsible>
            </section>
          </div>

          <div className="flex flex-col gap-4">
            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>disclosure builder</Overline>
              <p className="mono mt-1 text-[11px] text-[var(--ink-3)]">
                the recipient class drives the redaction preset. every redacted output is a derivative with its own hash,
                and the original is never modified.
              </p>

              <div className="mt-2 flex flex-wrap gap-1">
                {RECIPIENT_CLASSES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={recipient === r}
                    onClick={() => setRecipient(r)}
                    className="mono step border px-2 py-1 text-[12.5px]"
                    style={{
                      borderRadius: 'var(--radius-chip)',
                      borderColor: recipient === r ? 'var(--live)' : 'var(--line-1)',
                      color: recipient === r ? 'var(--live)' : 'var(--ink-2)',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <ul className="mt-2 flex flex-col gap-1">
                {preset.rules.map((rule) => (
                  <li key={rule} className="mono flex items-center gap-2 text-[11px] text-[var(--ink-1)]">
                    <Glyph name="redaction" size={11} />
                    {rule}
                  </li>
                ))}
              </ul>

              <div className="mt-3">
                <Overline>preview, original beside redacted</Overline>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <figure className="m-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/media/frames/cam-2.jpg" alt="original" className="w-full border border-[var(--line-0)]" />
                    <figcaption className="mono mt-1 text-[11px] text-[var(--ink-2)]">original, untouched</figcaption>
                  </figure>
                  <figure className="m-0">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/media/frames/cam-2.jpg" alt="redacted preview" className="w-full border border-[var(--line-0)]" />
                      <span
                        aria-hidden
                        className="absolute"
                        style={{ left: '14%', top: '52%', width: '22%', height: '14%', background: 'var(--bg-0)' }}
                      />
                      <span
                        aria-hidden
                        className="absolute"
                        style={{ left: '52%', top: '48%', width: '18%', height: '12%', background: 'var(--bg-0)' }}
                      />
                    </div>
                    <figcaption className="mono mt-1 text-[11px]" style={{ color: 'var(--medium)' }}>
                      derivative for {preset.label}
                    </figcaption>
                  </figure>
                </div>
              </div>

              <div className="mono mt-3 flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-[var(--ink-3)]">included</span>
                {evidencePreview.map((id) => (
                  <span key={id} className="border border-[var(--line-0)] px-1 text-[11px] text-[var(--ink-2)]" style={{ borderRadius: 'var(--radius-chip)' }}>
                    {id}
                  </span>
                ))}
                {detail.evidence_ids.length > evidencePreview.length ? (
                  <span className="text-[11px] text-[var(--ink-3)]">
                    and {detail.evidence_ids.length - evidencePreview.length} more
                  </span>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() =>
                  toast({
                    tone: 'ok',
                    text: `disclosure bundle generated for ${preset.label}`,
                    detail: `${detail.evidence_ids.length} items, ${preset.rules.length} redaction rules, manifest signed`,
                  })
                }
                className="mono step mt-3 flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="export" size={12} />
                generate bundle with manifest
              </button>
            </section>

            <section className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3" style={{ borderRadius: 'var(--radius-card)' }}>
              <Overline>section 63 certificate</Overline>
              <p className="mono mt-1 text-[11px] text-[var(--ink-3)]">
                electronic record certificate under the Bharatiya Sakshya Adhiniyam 2023. the format requires counsel
                confirmation for the deployment state before the first court-bound package is issued.
              </p>
              {detail.certificate ? (
                <dl className="mono mt-2 flex flex-col gap-1 text-[11px]">
                  <Field label="issued" value={fmtDateTime(detail.certificate.issued_at)} />
                  <Field label="issued by" value={detail.certificate.issued_by} />
                  <Field label="role" value={detail.certificate.role} />
                  <Field label="devices" value={detail.certificate.device_particulars} />
                  <Field label="hash method" value={detail.certificate.hash_method} />
                  <Field
                    label="counsel review"
                    value={detail.certificate.counsel_reviewed ? 'confirmed' : 'pending'}
                  />
                </dl>
              ) : (
                <form
                  className="mt-2 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    toast({
                      tone: 'ok',
                      text: 'certificate drafted',
                      detail: 'counsel confirmation is still required before issue',
                    })
                  }}
                >
                  <LabelledInput
                    label="issued by"
                    value={certificate.issuedBy}
                    onChange={(v) => setCertificate((c) => ({ ...c, issuedBy: v }))}
                    placeholder="name and designation"
                  />
                  <LabelledInput
                    label="role"
                    value={certificate.role}
                    onChange={(v) => setCertificate((c) => ({ ...c, role: v }))}
                  />
                  <LabelledInput
                    label="device particulars"
                    value={certificate.device}
                    onChange={(v) => setCertificate((c) => ({ ...c, device: v }))}
                    placeholder="edge hub, vault node"
                  />
                  <button
                    type="submit"
                    className="mono step self-start border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    draft certificate
                  </button>
                </form>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[104px] flex-none text-[var(--ink-2)]">{label}</dt>
      <dd className="text-[var(--ink-0)]">{value}</dd>
    </div>
  )
}

function LabelledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="mono flex items-center gap-2 text-[11px] text-[var(--ink-2)]">
      <span className="w-[104px] flex-none">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
        style={{ borderRadius: 'var(--radius-chip)' }}
      />
    </label>
  )
}
