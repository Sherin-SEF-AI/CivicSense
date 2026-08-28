import 'server-only'
import { randomUUID } from 'node:crypto'
import { latLngToCell } from 'h3-js'
import type { IncidentStatus, IncidentSummary, PriorityBand, SourceType } from '@/lib/api/schemas'
import { all, audit, get, run, tx } from '@/lib/db'
import { SITUATION_BY_KEY, type SituationType } from '@/lib/config/situations'
import { computeSeverity, severityInterval, SLA_SECONDS } from './severity'
import { attachToIncident, findCandidateIncident } from './observations'
import { zoneAt } from './zones'

/**
 * Incidents.
 *
 * An incident is created when a source reports a trigger, and grows as further
 * observations associate with it. Severity is recomputed from the real inputs
 * every time the set of contributing observations changes, so a single
 * uncorroborated report and the same event seen by four sources do not score the
 * same.
 */

interface IncidentRow {
  incident_id: string
  title: string
  domain: string
  situation_key: string
  status: string
  priority: string
  css: number
  css_lo: number
  css_hi: number
  zone_id: string | null
  zone_label: string | null
  lat: number
  lon: number
  h3: string
  detected_at: number
  updated_at: number
  corroboration: number
  acknowledged: number
  department: string | null
  sla_due_at: number | null
  dismissed_reason: string | null
  package_json: string | null
  package_at: number | null
}

function sourceTypesFor(incidentId: string): SourceType[] {
  const rows = all<{ source_type: string }>(
    `SELECT DISTINCT s.source_type FROM observations o
     JOIN sources s ON s.source_id = o.source_id
     WHERE o.incident_id = ?`,
    [incidentId],
  )
  return rows.map((r) => r.source_type as SourceType)
}

/** Distinct devices, not distinct device types: two cameras are two sources. */
function sourceCountFor(incidentId: string): number {
  return (
    get<{ c: number }>('SELECT COUNT(DISTINCT source_id) AS c FROM observations WHERE incident_id = ?', [incidentId])?.c ?? 0
  )
}

function worstSync(incidentId: string): IncidentSummary['sync_quality'] {
  const row = get<{ worst: string | null }>(
    `SELECT MAX(sync_quality) AS worst FROM observations WHERE incident_id = ?`,
    [incidentId],
  )
  return (row?.worst ?? 'D') as IncidentSummary['sync_quality']
}

function toSummary(row: IncidentRow): IncidentSummary {
  const types = sourceTypesFor(row.incident_id)
  return {
    incident_id: row.incident_id,
    title: row.title,
    domain: row.domain as IncidentSummary['domain'],
    status: row.status as IncidentStatus,
    priority: row.priority as PriorityBand,
    css: { value: row.css, lo: row.css_lo, hi: row.css_hi },
    zone_id: row.zone_id ?? 'unassigned',
    zone_label: row.zone_label ?? 'outside any configured zone',
    position: { lat: row.lat, lon: row.lon },
    h3: row.h3,
    detected_at: row.detected_at,
    updated_at: row.updated_at,
    source_count: sourceCountFor(row.incident_id),
    source_types: types,
    sync_quality: worstSync(row.incident_id),
    corroboration: row.corroboration,
    acknowledged: row.acknowledged === 1,
    department: row.department,
    sla_due_at: row.sla_due_at,
    dismissed_reason: row.dismissed_reason,
  }
}

export interface IncidentFilters {
  priority?: string[]
  domain?: string[]
  zone?: string[]
  sourceType?: string[]
  status?: string[]
  search?: string
  includeClosed?: boolean
  department?: string | null
  from?: number | null
  to?: number | null
  limit?: number
  cursor?: { t: number; id: string } | null
}

export function listIncidents(filters: IncidentFilters): { items: IncidentSummary[]; total: number; nextCursor: string | null } {
  const where: string[] = []
  const params: unknown[] = []

  if (!filters.includeClosed) {
    where.push("status NOT IN ('resolved', 'verified')")
    where.push('dismissed_reason IS NULL')
  }
  if (filters.priority?.length) {
    where.push(`priority IN (${filters.priority.map(() => '?').join(',')})`)
    params.push(...filters.priority)
  }
  if (filters.domain?.length) {
    where.push(`domain IN (${filters.domain.map(() => '?').join(',')})`)
    params.push(...filters.domain)
  }
  if (filters.zone?.length) {
    where.push(`zone_id IN (${filters.zone.map(() => '?').join(',')})`)
    params.push(...filters.zone)
  }
  if (filters.status?.length) {
    where.push(`status IN (${filters.status.map(() => '?').join(',')})`)
    params.push(...filters.status)
  }
  /* A department user only ever sees their own queue, and it is enforced here
     rather than in the client. */
  if (filters.department) {
    where.push('department = ?')
    params.push(filters.department)
  }
  if (filters.from !== null && filters.from !== undefined) {
    where.push('detected_at >= ?')
    params.push(filters.from)
  }
  if (filters.to !== null && filters.to !== undefined) {
    where.push('detected_at <= ?')
    params.push(filters.to)
  }
  if (filters.search) {
    where.push('(LOWER(title) LIKE ? OR LOWER(incident_id) LIKE ?)')
    params.push(`%${filters.search.toLowerCase()}%`, `%${filters.search.toLowerCase()}%`)
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM incidents ${clause}`, params)?.c ?? 0

  const limit = Math.min(200, Math.max(1, filters.limit ?? 80))
  const cursorClause = filters.cursor ? `${clause ? 'AND' : 'WHERE'} (detected_at < ? OR (detected_at = ? AND incident_id < ?))` : ''
  const cursorParams = filters.cursor ? [filters.cursor.t, filters.cursor.t, filters.cursor.id] : []

  const rows = all<IncidentRow>(
    `SELECT * FROM incidents ${clause} ${cursorClause} ORDER BY detected_at DESC, incident_id DESC LIMIT ?`,
    [...params, ...cursorParams, limit],
  )

  const items = rows.map(toSummary)
  const last = items[items.length - 1]
  const nextCursor =
    items.length === limit && last ? Buffer.from(`${last.detected_at}:${last.incident_id}`).toString('base64url') : null

  /* Source type filtering needs the join, so it is applied after mapping. */
  const filtered = filters.sourceType?.length
    ? items.filter((i) => i.source_types.some((t) => filters.sourceType!.includes(t)))
    : items

  return { items: filtered, total, nextCursor }
}

export function getIncident(incidentId: string): IncidentSummary | null {
  const row = get<IncidentRow>('SELECT * FROM incidents WHERE incident_id = ?', [incidentId])
  return row ? toSummary(row) : null
}

export function getIncidentRow(incidentId: string): IncidentRow | undefined {
  return get<IncidentRow>('SELECT * FROM incidents WHERE incident_id = ?', [incidentId])
}

export interface TriggerInput {
  observation_id: string
  source_id: string
  situation_key: string
  t: number
  lat: number
  lon: number
  /** Counts the source actually reported, used for the population component. */
  affected?: number
}

/**
 * Creates or joins an incident from a trigger.
 *
 * Association is deterministic and happens before any model runs: same domain,
 * overlapping H3 neighbourhood, inside the fusion window. Joining an existing
 * incident raises its corroboration and re-scores it.
 */
export function recordTrigger(input: TriggerInput): { incident: IncidentSummary; created: boolean } {
  const situation = SITUATION_BY_KEY.get(input.situation_key)
  if (!situation) throw new Error(`unknown situation ${input.situation_key}`)

  const h3 = latLngToCell(input.lat, input.lon, 9)
  const source = get<{ sync_quality: string }>('SELECT sync_quality FROM sources WHERE source_id = ?', [input.source_id])
  const sync = (source?.sync_quality ?? 'D') as 'A' | 'B' | 'C' | 'D'

  const existingId = findCandidateIncident(h3, input.t, situation.domain, sync)
  if (existingId) {
    attachToIncident(input.observation_id, existingId)
    rescore(existingId)
    const incident = getIncident(existingId)!
    audit('system', 'incident.corroborated', `incident:${existingId}`, `observation ${input.observation_id} associated`)
    return { incident, created: false }
  }

  const zone = zoneAt(input.lat, input.lon)
  const incidentId = `INC-${new Date(input.t).toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`

  tx(() => {
    run(
      `INSERT INTO incidents (
         incident_id, title, domain, situation_key, status, priority, css, css_lo, css_hi,
         zone_id, zone_label, lat, lon, h3, detected_at, updated_at, corroboration, acknowledged
       ) VALUES (?, ?, ?, ?, 'detected', 'INFO', 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        incidentId,
        `${situation.title}, ${zone?.label ?? 'outside any configured zone'}`,
        situation.domain,
        situation.key,
        zone?.zone_id ?? null,
        zone?.label ?? null,
        input.lat,
        input.lon,
        h3,
        input.t,
        input.t,
      ],
    )
    attachToIncident(input.observation_id, incidentId)
  })

  rescore(incidentId, input.affected)
  audit('system', 'incident.created', `incident:${incidentId}`, `${situation.key} from ${input.source_id}`)
  return { incident: getIncident(incidentId)!, created: true }
}

/**
 * Recomputes severity from what is currently known.
 *
 * Corroboration is the fraction of distinct sources beyond the first, capped at
 * one, which is a fact about the evidence rather than a model output. It changes
 * confidence and the width of the interval; it never inflates the score.
 */
export function rescore(incidentId: string, affectedOverride?: number): void {
  const row = getIncidentRow(incidentId)
  if (!row) return
  const situation = SITUATION_BY_KEY.get(row.situation_key)
  if (!situation) return

  const sources = get<{ c: number }>(
    'SELECT COUNT(DISTINCT source_id) AS c FROM observations WHERE incident_id = ?',
    [incidentId],
  )?.c ?? 1
  const corroboration = Math.min(1, Math.round(((sources - 1) / 3) * 100) / 100)

  const counted = get<{ total: number | null }>(
    `SELECT SUM(COALESCE(json_extract(derived, '$.counts.person'), 0) +
                COALESCE(json_extract(derived, '$.counts.people'), 0)) AS total
     FROM observations WHERE incident_id = ?`,
    [incidentId],
  )?.total
  const affected = affectedOverride ?? (counted && counted > 0 ? counted : 1)

  const zone = row.zone_id ? get<{ kind: string; sensitivity: number }>('SELECT kind, sensitivity FROM zones WHERE zone_id = ?', [row.zone_id]) : undefined

  /* Amplifiers come from the context pass when it has run. Before that they are
     zero, and the score is the deterministic floor rather than a guess. */
  const pkg = row.package_json ? (JSON.parse(row.package_json) as { context?: { amplifiers?: Record<string, number> } }) : null
  const amplifiers = {
    escalation: pkg?.context?.amplifiers?.escalation_potential ?? 0,
    infrastructure: pkg?.context?.amplifiers?.infrastructure_state ?? 0,
  }

  const { score, band } = computeSeverity({
    situation,
    zoneKind: zone?.kind ?? 'residential',
    zoneSensitivity: zone?.sensitivity ?? 0.5,
    t: row.detected_at,
    affected,
    amplifiers,
  })
  const interval = severityInterval(score, corroboration, sources)

  run(
    'UPDATE incidents SET css = ?, css_lo = ?, css_hi = ?, priority = ?, corroboration = ?, updated_at = ? WHERE incident_id = ?',
    [score, interval.lo, interval.hi, band, corroboration, Date.now(), incidentId],
  )
}

export function advanceStatus(incidentId: string, status: IncidentStatus): void {
  run('UPDATE incidents SET status = ?, updated_at = ? WHERE incident_id = ?', [status, Date.now(), incidentId])
}

export function routeIncident(incidentId: string): void {
  const row = getIncidentRow(incidentId)
  if (!row) return
  const situation = SITUATION_BY_KEY.get(row.situation_key)
  if (!situation) return
  const sla = SLA_SECONDS[row.priority as PriorityBand]
  const now = Date.now()
  run('UPDATE incidents SET department = ?, sla_due_at = ?, status = ?, updated_at = ? WHERE incident_id = ?', [
    situation.department,
    now + sla * 1000,
    'dispatched',
    now,
    incidentId,
  ])
  audit('system', 'incident.dispatched', `incident:${incidentId}`, `routed to ${situation.department}`)
}

export type IncidentAction = 'ack' | 'dispatch' | 'escalate' | 'resolve' | 'dismiss'

export function applyAction(
  incidentId: string,
  action: IncidentAction,
  actor: string,
  reason?: string,
): IncidentSummary | null {
  const row = getIncidentRow(incidentId)
  if (!row) return null
  const now = Date.now()

  switch (action) {
    case 'ack':
      run('UPDATE incidents SET acknowledged = 1, status = CASE WHEN status IN (\'detected\',\'corroborated\',\'understood\',\'dispatched\') THEN \'acknowledged\' ELSE status END, updated_at = ? WHERE incident_id = ?', [now, incidentId])
      break
    case 'dispatch':
      routeIncident(incidentId)
      break
    case 'escalate': {
      const order: PriorityBand[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
      const index = order.indexOf(row.priority as PriorityBand)
      run('UPDATE incidents SET priority = ?, updated_at = ? WHERE incident_id = ?', [
        order[Math.max(0, index - 1)],
        now,
        incidentId,
      ])
      break
    }
    case 'resolve':
      run('UPDATE incidents SET status = \'resolved\', acknowledged = 1, updated_at = ? WHERE incident_id = ?', [now, incidentId])
      break
    case 'dismiss':
      if (!reason) return null
      run('UPDATE incidents SET dismissed_reason = ?, updated_at = ? WHERE incident_id = ?', [reason, now, incidentId])
      break
  }

  run('INSERT INTO incident_actions (incident_id, t, actor, action, reason) VALUES (?, ?, ?, ?, ?)', [
    incidentId,
    now,
    actor,
    action,
    reason ?? null,
  ])
  audit(actor, `incident.${action}`, `incident:${incidentId}`, reason ?? '')
  return getIncident(incidentId)
}

export function countsByBand(): Record<PriorityBand, number> {
  const rows = all<{ priority: string; c: number }>(
    `SELECT priority, COUNT(*) AS c FROM incidents
     WHERE status NOT IN ('resolved','verified') AND dismissed_reason IS NULL
     GROUP BY priority`,
  )
  const counts: Record<PriorityBand, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
  for (const row of rows) counts[row.priority as PriorityBand] = row.c
  return counts
}

export function incidentCount(): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM incidents')?.c ?? 0
}

export function situationOf(incidentId: string): SituationType | undefined {
  const row = getIncidentRow(incidentId)
  return row ? SITUATION_BY_KEY.get(row.situation_key) : undefined
}

export function storedPackage(incidentId: string): unknown | null {
  const row = getIncidentRow(incidentId)
  return row?.package_json ? JSON.parse(row.package_json) : null
}

export function storePackage(incidentId: string, pkg: unknown): void {
  run('UPDATE incidents SET package_json = ?, package_at = ?, status = CASE WHEN status = \'corroborated\' THEN \'understood\' ELSE status END WHERE incident_id = ?', [
    JSON.stringify(pkg),
    Date.now(),
    incidentId,
  ])
}
