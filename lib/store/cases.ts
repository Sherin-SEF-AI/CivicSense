import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { CaseDetail, CaseSummary, RecipientClass } from '@/lib/api/schemas'
import { all, audit, get, run, tx } from '@/lib/db'

/** Case files. A case is the unit that holds evidence under legal hold. */

interface CaseRow {
  case_id: string
  reference: string
  title: string
  state: string
  opened_at: number
  updated_at: number
  owner: string
  legal_hold: number
  investigation_flag: number
  certificate: string | null
}

export const REDACTION_PRESETS: Record<RecipientClass, { label: string; rules: string[] }> = {
  court: {
    label: 'court',
    rules: ['bystander faces blurred', 'subject plate retained', 'audio names retained', 'full custody report attached'],
  },
  department: { label: 'department', rules: ['faces and plates blurred', 'audio names bleeped', 'reporter identity withheld'] },
  insurer: { label: 'insurer', rules: ['faces blurred', 'subject plate retained', 'third-party plates blurred', 'audio withheld'] },
  public: { label: 'public', rules: ['all faces and plates blurred', 'audio fully redacted', 'location generalised to the ward'] },
}

function counts(caseId: string) {
  const incidents = get<{ c: number }>('SELECT COUNT(*) AS c FROM case_incidents WHERE case_id = ?', [caseId])?.c ?? 0
  const evidence = get<{ c: number; bytes: number | null }>(
    `SELECT COUNT(*) AS c, SUM(e.bytes) AS bytes FROM case_evidence ce
     LEFT JOIN evidence e ON e.sha256 = ce.sha256 WHERE ce.case_id = ?`,
    [caseId],
  )
  return { incidents, evidence: evidence?.c ?? 0, bytes: evidence?.bytes ?? 0 }
}

function toSummary(row: CaseRow): CaseSummary {
  const c = counts(row.case_id)
  return {
    case_id: row.case_id,
    reference: row.reference,
    title: row.title,
    state: row.state as CaseSummary['state'],
    opened_at: row.opened_at,
    owner: row.owner,
    incident_count: c.incidents,
    evidence_count: c.evidence,
    evidence_bytes: c.bytes,
    legal_hold: row.legal_hold === 1,
    investigation_flag: row.investigation_flag === 1,
    updated_at: row.updated_at,
  }
}

export function listCases(search: string): CaseSummary[] {
  const rows = all<CaseRow>('SELECT * FROM cases ORDER BY updated_at DESC')
  const needle = search.trim().toLowerCase()
  return rows
    .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.reference.toLowerCase().includes(needle))
    .map(toSummary)
}

export function getCase(caseId: string): CaseDetail | null {
  const row = get<CaseRow>('SELECT * FROM cases WHERE case_id = ?', [caseId])
  if (!row) return null

  const incidentIds = all<{ incident_id: string }>('SELECT incident_id FROM case_incidents WHERE case_id = ?', [caseId]).map(
    (r) => r.incident_id,
  )
  const evidenceIds = all<{ sha256: string }>('SELECT sha256 FROM case_evidence WHERE case_id = ? ORDER BY added_at ASC', [
    caseId,
  ]).map((r) => r.sha256)

  const notes = all<{ note_id: string; t: number; author: string; text: string; evidence_ids: string }>(
    'SELECT note_id, t, author, text, evidence_ids FROM case_notes WHERE case_id = ? ORDER BY t ASC',
    [caseId],
  ).map((n) => ({ ...n, evidence_ids: JSON.parse(n.evidence_ids) as string[] }))

  const tasks = all<{ task_id: string; text: string; owner: string; due_at: number | null; state: string }>(
    'SELECT task_id, text, owner, due_at, state FROM case_tasks WHERE case_id = ?',
    [caseId],
  ).map((t) => ({ ...t, state: t.state as CaseDetail['tasks'][number]['state'] }))

  const bundles = all<{
    bundle_id: string
    recipient_class: string
    recipient: string
    created_at: number
    evidence_ids: string
    redaction_preset: string
    redactions: string
    manifest_hash: string
    certificate_issued: number
  }>('SELECT * FROM case_bundles WHERE case_id = ? ORDER BY created_at DESC', [caseId]).map((b) => ({
    bundle_id: b.bundle_id,
    recipient_class: b.recipient_class as RecipientClass,
    recipient: b.recipient,
    created_at: b.created_at,
    evidence_ids: JSON.parse(b.evidence_ids) as string[],
    redaction_preset: b.redaction_preset,
    redactions: JSON.parse(b.redactions) as CaseDetail['bundles'][number]['redactions'],
    manifest_hash: b.manifest_hash,
    certificate_issued: b.certificate_issued === 1,
  }))

  const exports = all<{ export_id: string; t: number; actor: string; kind: string; recipient: string; manifest_hash: string }>(
    'SELECT * FROM case_exports WHERE case_id = ? ORDER BY t DESC',
    [caseId],
  ).map((e) => ({ ...e, kind: e.kind as CaseDetail['exports'][number]['kind'] }))

  return {
    ...toSummary(row),
    incident_ids: incidentIds,
    evidence_ids: evidenceIds,
    notes,
    tasks,
    bundles,
    exports,
    certificate: row.certificate ? (JSON.parse(row.certificate) as CaseDetail['certificate']) : null,
  }
}

export function createCase(title: string, incidentIds: string[], owner: string): CaseDetail {
  const now = Date.now()
  const sequence = (get<{ c: number }>('SELECT COUNT(*) AS c FROM cases')?.c ?? 0) + 1
  const caseId = `CASE-${String(sequence).padStart(4, '0')}`
  const reference = `CS/${new Date(now).getFullYear()}/${String(sequence).padStart(4, '0')}`

  tx(() => {
    run(
      'INSERT INTO cases (case_id, reference, title, state, opened_at, updated_at, owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [caseId, reference, title, 'open', now, now, owner],
    )
    for (const incidentId of incidentIds) {
      run('INSERT OR IGNORE INTO case_incidents (case_id, incident_id) VALUES (?, ?)', [caseId, incidentId])
    }
  })
  audit(owner, 'case.created', `case:${caseId}`, title)
  return getCase(caseId)!
}

export function patchCase(
  caseId: string,
  patch: { legal_hold?: boolean; investigation_flag?: boolean; state?: string; note?: string; title?: string },
  actor: string,
): CaseDetail | null {
  const row = get<CaseRow>('SELECT * FROM cases WHERE case_id = ?', [caseId])
  if (!row) return null
  const now = Date.now()

  if (patch.legal_hold !== undefined) {
    run('UPDATE cases SET legal_hold = ? WHERE case_id = ?', [patch.legal_hold ? 1 : 0, caseId])
    audit(actor, patch.legal_hold ? 'case.legal_hold_set' : 'case.legal_hold_cleared', `case:${caseId}`, '')
  }
  if (patch.investigation_flag !== undefined) {
    run('UPDATE cases SET investigation_flag = ? WHERE case_id = ?', [patch.investigation_flag ? 1 : 0, caseId])
    audit(actor, 'case.investigation_flag', `case:${caseId}`, patch.investigation_flag ? 'authorised' : 'cleared')
  }
  if (patch.state !== undefined) run('UPDATE cases SET state = ? WHERE case_id = ?', [patch.state, caseId])
  if (patch.title !== undefined) run('UPDATE cases SET title = ? WHERE case_id = ?', [patch.title, caseId])
  if (patch.note) {
    run('INSERT INTO case_notes (note_id, case_id, t, author, text, evidence_ids) VALUES (?, ?, ?, ?, ?, ?)', [
      `NOTE-${randomUUID().slice(0, 8)}`,
      caseId,
      now,
      actor,
      patch.note,
      '[]',
    ])
  }
  run('UPDATE cases SET updated_at = ? WHERE case_id = ?', [now, caseId])
  return getCase(caseId)
}

export function attachEvidence(caseId: string, shas: string[], actor: string): CaseDetail | null {
  if (!get('SELECT 1 FROM cases WHERE case_id = ?', [caseId])) return null
  const now = Date.now()
  tx(() => {
    for (const sha of shas) {
      run('INSERT OR IGNORE INTO case_evidence (case_id, sha256, added_at) VALUES (?, ?, ?)', [caseId, sha, now])
    }
    run('UPDATE cases SET updated_at = ? WHERE case_id = ?', [now, caseId])
  })
  audit(actor, 'case.evidence_attached', `case:${caseId}`, `${shas.length} items`)
  return getCase(caseId)
}

export function attachIncidents(caseId: string, incidentIds: string[], actor: string): CaseDetail | null {
  if (!get('SELECT 1 FROM cases WHERE case_id = ?', [caseId])) return null
  tx(() => {
    for (const id of incidentIds) run('INSERT OR IGNORE INTO case_incidents (case_id, incident_id) VALUES (?, ?)', [caseId, id])
    run('UPDATE cases SET updated_at = ? WHERE case_id = ?', [Date.now(), caseId])
  })
  audit(actor, 'case.incidents_linked', `case:${caseId}`, incidentIds.join(', '))
  return getCase(caseId)
}

/**
 * Builds a disclosure bundle.
 *
 * The manifest hash is computed over the sorted evidence hashes and the
 * redaction rules, so two bundles with the same content and the same policy
 * produce the same manifest, and any change to either is visible in it.
 */
export function createBundle(
  caseId: string,
  recipientClass: RecipientClass,
  recipient: string,
  actor: string,
): CaseDetail | null {
  const detail = getCase(caseId)
  if (!detail) return null

  const preset = REDACTION_PRESETS[recipientClass]
  const evidenceIds = detail.evidence_ids
  const manifestHash = createHash('sha256')
    .update([...evidenceIds].sort().join('|'))
    .update('|')
    .update(preset.rules.join('|'))
    .digest('hex')

  const bundleId = `BND-${randomUUID().slice(0, 8).toUpperCase()}`
  const now = Date.now()

  const redactions = evidenceIds.map((sha) => ({
    evidence_id: sha,
    what: preset.rules[0] ?? 'per recipient policy',
    why: `${preset.label} recipient class policy`,
    hash_after: createHash('sha256').update(`${sha}|${preset.rules.join('|')}`).digest('hex'),
  }))

  tx(() => {
    run(
      `INSERT INTO case_bundles (bundle_id, case_id, recipient_class, recipient, created_at, evidence_ids, redaction_preset, redactions, manifest_hash, certificate_issued)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bundleId,
        caseId,
        recipientClass,
        recipient,
        now,
        JSON.stringify(evidenceIds),
        `${preset.label}: ${preset.rules.join('; ')}`,
        JSON.stringify(redactions),
        manifestHash,
        recipientClass === 'court' && detail.certificate ? 1 : 0,
      ],
    )
    run('INSERT INTO case_exports (export_id, case_id, t, actor, kind, recipient, manifest_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
      caseId,
      now,
      actor,
      'disclosure',
      recipient,
      manifestHash,
    ])
    run('UPDATE cases SET state = ?, updated_at = ? WHERE case_id = ?', ['disclosed', now, caseId])
  })
  audit(actor, 'bundle.created', `case:${caseId}`, `${recipientClass} to ${recipient}, manifest ${manifestHash.slice(0, 12)}`)
  return getCase(caseId)
}

export function setCertificate(
  caseId: string,
  certificate: { issued_by: string; role: string; device_particulars: string },
  actor: string,
): CaseDetail | null {
  if (!get('SELECT 1 FROM cases WHERE case_id = ?', [caseId])) return null
  const record = {
    issued_at: Date.now(),
    issued_by: certificate.issued_by,
    role: certificate.role,
    device_particulars: certificate.device_particulars,
    hash_method: 'SHA-256 over the stored bytes, chained per evidence item',
    counsel_reviewed: false,
  }
  run('UPDATE cases SET certificate = ?, updated_at = ? WHERE case_id = ?', [JSON.stringify(record), Date.now(), caseId])
  audit(actor, 'certificate.drafted', `case:${caseId}`, `issued by ${certificate.issued_by}`)
  return getCase(caseId)
}

export function recordExport(caseId: string, actor: string, kind: string, recipient: string, manifestHash: string): void {
  run('INSERT INTO case_exports (export_id, case_id, t, actor, kind, recipient, manifest_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
    caseId,
    Date.now(),
    actor,
    kind,
    recipient,
    manifestHash,
  ])
}
