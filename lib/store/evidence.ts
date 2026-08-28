import 'server-only'
import type { EvidenceItem, EvidenceSearchResult, ParsedQuery } from '@/lib/api/schemas'
import { all, get } from '@/lib/db'

/**
 * Evidence search over what has actually been ingested.
 *
 * The parser is deliberately explicit rather than clever: the operator sees the
 * structured query as editable chips before it runs, so a wrong reading gets
 * corrected instead of silently executed. Person search is refused here, not
 * only hidden in the interface.
 */

const COLOURS = ['white', 'silver', 'black', 'blue', 'red', 'yellow', 'green', 'grey', 'brown', 'orange']
const VEHICLE_TYPES = ['hatchback', 'sedan', 'suv', 'lcv', 'truck', 'bus', 'autorickshaw', 'motorcycle', 'bicycle', 'tractor']

const TIME_WORDS: [RegExp, number][] = [
  [/last month|past month|30 days/i, 30 * 86400_000],
  [/last week|past week|7 days/i, 7 * 86400_000],
  [/last 3 ?days|past 3 ?days/i, 3 * 86400_000],
  [/last 24 ?h|past day|yesterday/i, 86400_000],
  [/last hour|past hour/i, 3600_000],
]

const PERSON_TERMS = /\b(person|people|man|woman|men|women|pedestrian|face|wearing|clothing)\b/i

export function parseQuery(text: string, now: number): ParsedQuery {
  const lower = text.toLowerCase()

  let from: number | null = null
  for (const [pattern, span] of TIME_WORDS) {
    if (pattern.test(text)) {
      from = now - span
      break
    }
  }
  let to: number | null = from === null ? null : now

  const clockRange = /(\d{1,2}):(\d{2})\s*(?:to|and|-|until)\s*(\d{1,2}):(\d{2})/.exec(text)
  if (clockRange) {
    const base = from ?? now - 86400_000
    const day = Math.floor(base / 86400_000) * 86400_000
    from = day + (Number(clockRange[1]) * 60 + Number(clockRange[2])) * 60_000
    to = day + (Number(clockRange[3]) * 60 + Number(clockRange[4])) * 60_000
    if (to < from) to += 86400_000
  }

  const zones = all<{ zone_id: string; label: string }>('SELECT zone_id, label FROM zones')
  const zoneIds = zones.filter((z) => lower.includes(z.label.toLowerCase())).map((z) => z.zone_id)

  const stop = new Set([
    'the', 'a', 'an', 'with', 'near', 'between', 'and', 'to', 'in', 'on', 'at', 'from', 'last', 'week',
    'show', 'me', 'find', 'all', 'of', 'that', 'was', 'were', 'is', 'are', 'past', 'day', 'days', 'hour',
  ])
  const colour = COLOURS.find((c) => lower.includes(c)) ?? null
  const vehicleType = VEHICLE_TYPES.find((v) => lower.includes(v)) ?? null

  const freeTerms = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w) && w !== colour && w !== vehicleType)
    .slice(0, 6)

  return {
    text,
    from,
    to,
    zone_ids: zoneIds,
    domains: [],
    source_types: [],
    classes: [],
    colour,
    vehicle_type: vehicleType,
    free_terms: freeTerms,
    requires_person_search: PERSON_TERMS.test(text),
    model: 'deterministic parser',
  }
}

interface Row {
  observation_id: string
  source_id: string
  source_type: string
  incident_id: string | null
  t_start: number
  lat: number | null
  lon: number | null
  zone_label: string | null
  content_ref: string
  derived: string | null
  device_signature: string | null
  width: number | null
  height: number | null
  media_type: string
}

export function searchEvidence(question: string, investigationFlag: boolean, limit = 120): EvidenceSearchResult {
  const started = Date.now()
  const parsed = parseQuery(question, started)

  if (parsed.requires_person_search && !investigationFlag) {
    return {
      parsed,
      items: [],
      next_cursor: null,
      total: 0,
      blocked_reason:
        'person search requires an authorised investigation flag on the active case. attach a flagged case, or search by vehicle attributes instead.',
      took_ms: Date.now() - started,
    }
  }

  const where: string[] = ['o.content_ref IS NOT NULL']
  const params: unknown[] = []
  if (parsed.from !== null) {
    where.push('o.t_start >= ?')
    params.push(parsed.from)
  }
  if (parsed.to !== null) {
    where.push('o.t_start <= ?')
    params.push(parsed.to)
  }
  if (parsed.zone_ids.length > 0) {
    where.push(`i.zone_id IN (${parsed.zone_ids.map(() => '?').join(',')})`)
    params.push(...parsed.zone_ids)
  }

  const rows = all<Row>(
    `SELECT o.observation_id, o.source_id, s.source_type, o.incident_id, o.t_start, o.lat, o.lon,
            i.zone_label, o.content_ref, o.derived, o.device_signature,
            e.width, e.height, e.media_type
     FROM observations o
     JOIN sources s ON s.source_id = o.source_id
     LEFT JOIN incidents i ON i.incident_id = o.incident_id
     JOIN evidence e ON e.sha256 = o.content_ref
     WHERE ${where.join(' AND ')}
     ORDER BY o.t_start DESC LIMIT 2000`,
    params,
  )

  const items: EvidenceItem[] = rows.map((row) => {
    const derived = row.derived
      ? (JSON.parse(row.derived) as { classes: string[]; counts: Record<string, number>; trigger: string | null })
      : { classes: [], counts: {}, trigger: null }

    return {
      evidence_id: row.content_ref,
      observation_id: row.observation_id,
      incident_id: row.incident_id,
      source_id: row.source_id,
      source_type: row.source_type as EvidenceItem['source_type'],
      t: row.t_start,
      position: { lat: row.lat ?? 0, lon: row.lon ?? 0 },
      zone_label: row.zone_label ?? 'outside any configured zone',
      kind: row.media_type.startsWith('video/') ? 'clip' : 'keyframe',
      thumb_url: `/api/v1/evidence/${row.content_ref}/content`,
      full_url: `/api/v1/evidence/${row.content_ref}/content`,
      preview_clip_url: row.media_type.startsWith('video/') ? `/api/v1/evidence/${row.content_ref}/content` : null,
      width: row.width ?? 0,
      height: row.height ?? 0,
      attributes: {
        classes: derived.classes,
        colour: derived.classes.find((c) => COLOURS.includes(c)) ?? null,
        vehicle_type: derived.classes.find((c) => VEHICLE_TYPES.includes(c)) ?? null,
        tags: [derived.trigger, row.source_type].filter((t): t is string => t !== null),
      },
      similarity: score(derived.classes, parsed),
      hash: row.content_ref,
      /* A device signature is what distinguishes verified from merely present. */
      authenticity: row.device_signature ? 'verified' : 'consistent',
      contains_person: derived.classes.includes('person'),
    }
  })

  const filtered = items.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, limit)

  return {
    parsed,
    items: filtered,
    next_cursor: null,
    total: items.length,
    blocked_reason: null,
    took_ms: Date.now() - started,
  }
}

/** Attribute overlap between the query and what the edge actually reported. */
function score(classes: string[], parsed: ParsedQuery): number {
  let matched = 0
  let asked = 0
  if (parsed.colour) {
    asked++
    if (classes.includes(parsed.colour)) matched++
  }
  if (parsed.vehicle_type) {
    asked++
    if (classes.includes(parsed.vehicle_type)) matched++
  }
  for (const term of parsed.free_terms) {
    asked++
    if (classes.some((c) => c.includes(term))) matched++
  }
  if (asked === 0) return 0.5
  return Math.round((matched / asked) * 100) / 100
}

export function evidenceCount(): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM evidence')?.c ?? 0
}
