import 'server-only'
import type {
  AuditEntry,
  Budget,
  CaseDetail,
  Department,
  IncidentSummary,
  InterventionOutcome,
  Playbook,
  PriorityBand,
  SourceDevice,
  User,
  Warning,
} from '@/lib/api/schemas'
import { PRIORITY_BANDS } from '@/lib/api/schemas/common'
import { ZONE_SEEDS } from '@/lib/geo/bengaluru'
import type { Position } from '@/lib/geo/build'
import { buildIncidents, SLA_SECONDS } from './incidents'
import { buildSources, cameraLines } from './sources'
import { buildWarnings, buildOutcomes } from './predict'
import { buildCases } from './cases'
import { buildAdmin } from './admin'
import { hex, mulberry32, subSeed } from './rng'

export const WORLD_SEED = 20260828
export const INCIDENT_COUNT = 2000

export interface World {
  seed: number
  /** Wall time the world was built. All fixture time is relative to this. */
  t0: number
  lines: Position[][]
  sources: SourceDevice[]
  incidents: IncidentSummary[]
  warnings: Warning[]
  outcomes: InterventionOutcome[]
  cases: CaseDetail[]
  departments: Department[]
  playbooks: Playbook[]
  budgets: Budget[]
  users: User[]
  audit: AuditEntry[]
  index: {
    incidentById: Map<string, IncidentSummary>
    sourceById: Map<string, SourceDevice>
    caseById: Map<string, CaseDetail>
    warningById: Map<string, Warning>
  }
  /** Operator mutations, applied on top of the deterministic base. */
  mutations: {
    acks: Map<string, number>
    dispatches: Map<string, number>
    escalations: Map<string, number>
    resolutions: Map<string, number>
    dismissals: Map<string, string>
    warningAcks: Set<string>
  }
  spend: { today_usd: number; budget_usd: number; month_usd: number; month_budget_usd: number }
  /** Monotonic sequence for SSE ids and the audit hash chain. */
  seq: number
}

function reindex(w: World) {
  w.index.incidentById = new Map(w.incidents.map((i) => [i.incident_id, i]))
  w.index.sourceById = new Map(w.sources.map((s) => [s.source_id, s]))
  w.index.caseById = new Map(w.cases.map((c) => [c.case_id, c]))
  w.index.warningById = new Map(w.warnings.map((x) => [x.warning_id, x]))
}

function build(): World {
  const seed = WORLD_SEED
  const t0 = Date.now()
  const lines = cameraLines(seed)
  const sources = buildSources({ seed, now: t0 })
  const incidents = buildIncidents({ seed, now: t0, count: INCIDENT_COUNT, lines })
  const warnings = buildWarnings({ seed, now: t0 })
  const outcomes = buildOutcomes({ seed, now: t0 })
  const cases = buildCases({ seed, now: t0, incidents })
  const admin = buildAdmin({ seed, now: t0 })

  const rnd = mulberry32(subSeed(seed, 'spend', 0))
  const world: World = {
    seed,
    t0,
    lines,
    sources,
    incidents,
    warnings,
    outcomes,
    cases,
    departments: admin.departments,
    playbooks: admin.playbooks,
    budgets: admin.budgets,
    users: admin.users,
    audit: admin.audit,
    index: {
      incidentById: new Map(),
      sourceById: new Map(),
      caseById: new Map(),
      warningById: new Map(),
    },
    mutations: {
      acks: new Map(),
      dispatches: new Map(),
      escalations: new Map(),
      resolutions: new Map(),
      dismissals: new Map(),
      warningAcks: new Set(),
    },
    spend: {
      today_usd: Math.round((4.2 + rnd() * 3.4) * 100) / 100,
      budget_usd: 12,
      month_usd: Math.round((186 + rnd() * 90) * 100) / 100,
      month_budget_usd: 400,
    },
    seq: 1,
  }
  reindex(world)
  return world
}

/**
 * The world is memoized on globalThis so Next's dev hot reload does not rebuild
 * it on every file save, which would reset acknowledgements mid-session and make
 * the app feel broken while working on it.
 */
const KEY = '__civicsense_world__'

interface GlobalWithWorld {
  [KEY]?: World
}

export function getWorld(): World {
  const g = globalThis as GlobalWithWorld
  if (!g[KEY]) g[KEY] = build()
  return g[KEY]
}

export function nextSeq(): number {
  const w = getWorld()
  w.seq += 1
  return w.seq
}

/** Applies operator mutations to a base incident, so reads always reflect actions. */
export function withMutations(w: World, base: IncidentSummary): IncidentSummary {
  const ack = w.mutations.acks.get(base.incident_id)
  const dispatch = w.mutations.dispatches.get(base.incident_id)
  const escalated = w.mutations.escalations.get(base.incident_id)
  const resolved = w.mutations.resolutions.get(base.incident_id)
  const dismissed = w.mutations.dismissals.get(base.incident_id)
  if (ack === undefined && dispatch === undefined && resolved === undefined && dismissed === undefined && escalated === undefined) {
    return base
  }
  const next: IncidentSummary = { ...base }
  if (dispatch !== undefined) {
    next.status = 'dispatched'
    next.department = next.department ?? 'traffic-police'
    next.sla_due_at = dispatch + SLA_SECONDS[next.priority] * 1000
  }
  if (ack !== undefined) {
    next.acknowledged = true
    if (next.status === 'detected' || next.status === 'corroborated' || next.status === 'understood' || next.status === 'dispatched') {
      next.status = 'acknowledged'
    }
  }
  if (escalated !== undefined) {
    const idx = PRIORITY_BANDS.indexOf(next.priority)
    next.priority = PRIORITY_BANDS[Math.max(0, idx - 1)] as PriorityBand
  }
  if (resolved !== undefined) {
    next.status = 'resolved'
    next.acknowledged = true
  }
  if (dismissed !== undefined) {
    next.dismissed_reason = dismissed
  }
  next.updated_at = Math.max(
    base.updated_at,
    ack ?? 0,
    dispatch ?? 0,
    resolved ?? 0,
    escalated ?? 0,
  )
  return next
}

export function liveIncidents(w: World): IncidentSummary[] {
  return w.incidents.map((i) => withMutations(w, i))
}

export function countsByBand(w: World): Record<PriorityBand, number> {
  const counts = Object.fromEntries(PRIORITY_BANDS.map((b) => [b, 0])) as Record<PriorityBand, number>
  const cutoff = Date.now() - 6 * 3600_000
  for (const base of w.incidents) {
    if (base.detected_at < cutoff) continue
    const i = withMutations(w, base)
    if (i.dismissed_reason !== null) continue
    if (i.status === 'resolved' || i.status === 'verified') continue
    counts[i.priority] += 1
  }
  return counts
}

export function zoneLabel(zoneId: string): string {
  return ZONE_SEEDS.find((z) => z.id === zoneId)?.label ?? zoneId
}

/** Deterministic content hash for an evidence item, stable across requests. */
export function contentHash(seed: number, ns: string, i: number): string {
  return hex(mulberry32(subSeed(seed, ns, i)), 64)
}
