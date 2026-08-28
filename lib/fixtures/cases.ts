import 'server-only'
import type { CaseDetail, CaseState, IncidentSummary, RecipientClass } from '@/lib/api/schemas'
import { chance, hex, intRange, mulberry32, pick, subSeed } from './rng'

const OWNERS = [
  'insp. Ramesh K',
  'insp. Latha M',
  'sub-insp. Arun P',
  'analyst D. Nair',
  'analyst S. Bhat',
]

const STATES: readonly CaseState[] = ['open', 'active', 'review', 'disclosed', 'closed']

const TITLES = [
  'repeat dumping by a light commercial vehicle',
  'injury collision on the ORR approach',
  'crowd management failure at the transit gate',
  'missed collection route causing chronic overflow',
  'night corridor assault complaint corroboration',
  'unauthorised hoarding cluster',
  'water logging with drain blockage evidence',
  'emergency corridor obstruction sequence',
  'construction dust compliance file',
  'stray cattle related collision sequence',
]

const NOTE_TEXTS = [
  'patrol pass-by at 23:04 recorded a readable plate on the same vehicle',
  'bin sensor shows continuous 100 percent fill from 18:00, consistent with the missed collection',
  'requested the adjacent camera window from the edge ring buffer, pull returned two clips',
  'transcript segment flagged for human transcription, machine confidence below threshold',
  'authenticity check inconsistent on one citizen submission, quarantined pending review',
  'counsel confirmed the Section 63 certificate format for this state',
]

const REDACTION_PRESETS: Record<RecipientClass, string> = {
  court: 'court-preset: bystander faces blurred, plates retained, audio names retained',
  department: 'department-preset: faces and plates blurred, audio names bleeped',
  insurer: 'insurer-preset: faces blurred, subject plate retained, third-party plates blurred',
  public: 'public-preset: all faces and plates blurred, audio fully redacted',
}

export function buildCases({
  seed,
  now,
  incidents,
}: {
  seed: number
  now: number
  incidents: IncidentSummary[]
}): CaseDetail[] {
  const out: CaseDetail[] = []
  for (let i = 0; i < 18; i++) {
    const rnd = mulberry32(subSeed(seed, 'case', i))
    const state = pick(rnd, STATES)
    const opened = now - intRange(rnd, 2, 120) * 86400_000
    const incidentCount = intRange(rnd, 1, 6)
    const linked = Array.from({ length: incidentCount }, (_, k) => {
      const idx = (i * 97 + k * 31) % incidents.length
      return incidents[idx]!.incident_id
    })
    const evidenceCount = incidentCount * intRange(rnd, 3, 8)
    const evidenceIds = Array.from({ length: evidenceCount }, (_, k) => `EV-${i}-${k}`)
    const legalHold = state === 'review' || state === 'disclosed' || chance(rnd, 0.2)
    const investigation = chance(rnd, 0.28)

    const bundles = state === 'disclosed' || state === 'closed'
      ? Array.from({ length: intRange(rnd, 1, 2) }, (_, k) => {
          const recipient = pick(rnd, ['court', 'department', 'insurer', 'public'] as const)
          return {
            bundle_id: `BND-${i}-${k}`,
            recipient_class: recipient,
            recipient:
              recipient === 'court'
                ? 'XIV ACMM Court, Bengaluru'
                : recipient === 'insurer'
                  ? 'National Insurance Co.'
                  : recipient === 'public'
                    ? 'open data portal'
                    : 'BBMP Sanitation',
            created_at: opened + intRange(rnd, 1, 40) * 86400_000,
            evidence_ids: evidenceIds.slice(0, intRange(rnd, 2, Math.max(3, evidenceIds.length))),
            redaction_preset: REDACTION_PRESETS[recipient],
            redactions: evidenceIds.slice(0, 3).map((eid) => ({
              evidence_id: eid,
              what: pick(rnd, ['bystander faces', 'third-party plate', 'audio name', 'reporter identity']),
              why: pick(rnd, ['DPDP Act 2023 minimisation', 'recipient class policy', 'no investigation flag']),
              hash_after: hex(rnd, 64),
            })),
            manifest_hash: hex(rnd, 64),
            certificate_issued: recipient === 'court',
          }
        })
      : []

    out.push({
      case_id: `CASE-${String(i + 1).padStart(3, '0')}`,
      reference: `CS/2026/${String(1200 + i * 7)}`,
      title: TITLES[i % TITLES.length]!,
      state,
      opened_at: opened,
      owner: pick(rnd, OWNERS),
      incident_count: incidentCount,
      evidence_count: evidenceCount,
      evidence_bytes: evidenceCount * intRange(rnd, 900_000, 42_000_000),
      legal_hold: legalHold,
      investigation_flag: investigation,
      updated_at: opened + intRange(rnd, 1, 60) * 86400_000,
      incident_ids: linked,
      evidence_ids: evidenceIds,
      notes: Array.from({ length: intRange(rnd, 1, 4) }, (_, k) => ({
        note_id: `NOTE-${i}-${k}`,
        t: opened + k * intRange(rnd, 1, 20) * 3600_000,
        author: pick(rnd, OWNERS),
        text: pick(rnd, NOTE_TEXTS),
        evidence_ids: evidenceIds.slice(k, k + intRange(rnd, 1, 2)),
      })),
      tasks: Array.from({ length: intRange(rnd, 1, 3) }, (_, k) => ({
        task_id: `TASK-${i}-${k}`,
        text: pick(rnd, [
          'obtain registration data through the authorised API',
          'request the 06:00 truck GPS window from the fleet operator',
          'schedule human transcription of the contested audio segment',
          'confirm counsel sign-off on the statute selection',
        ]),
        owner: pick(rnd, OWNERS),
        due_at: chance(rnd, 0.7) ? now + intRange(rnd, 1, 20) * 86400_000 : null,
        state: pick(rnd, ['open', 'done', 'blocked'] as const),
      })),
      bundles,
      exports: bundles.map((b, k) => ({
        export_id: `EXP-${i}-${k}`,
        t: b.created_at,
        actor: pick(rnd, OWNERS),
        kind: pick(rnd, ['offline-html', 'pdf', 'disclosure', 'csv'] as const),
        recipient: b.recipient,
        manifest_hash: b.manifest_hash,
      })),
      certificate:
        bundles.some((b) => b.certificate_issued)
          ? {
              issued_at: opened + intRange(rnd, 5, 50) * 86400_000,
              issued_by: pick(rnd, OWNERS),
              role: 'person in charge of the computer output',
              device_particulars: `edge hub HUB-${String(intRange(rnd, 1, 12)).padStart(2, '0')}, evidence vault node vault-01`,
              hash_method: 'SHA-256 chained per incident, manifest signed',
              counsel_reviewed: chance(rnd, 0.6),
            }
          : null,
    })
  }
  out.sort((a, b) => b.updated_at - a.updated_at)
  return out
}
