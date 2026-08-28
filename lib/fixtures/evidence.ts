import 'server-only'
import type { EvidenceItem, IncidentSummary, ParsedQuery, SourceDevice } from '@/lib/api/schemas'
import { situationOf } from './incidents'
import { hashString } from './packages'
import { chance, hex, intRange, mulberry32, pick, subSeed } from './rng'

const COLOURS = ['white', 'silver', 'black', 'blue', 'red', 'yellow', 'green', 'grey']
const VEHICLE_TYPES = ['hatchback', 'sedan', 'suv', 'lcv', 'truck', 'bus', 'autorickshaw', 'motorcycle']

/**
 * Evidence items are derived from incidents rather than stored, so the corpus is
 * consistent with the incident set by construction and there is no second source
 * of truth to drift.
 */
export function evidenceForIncident(
  seed: number,
  incident: IncidentSummary,
  sources: SourceDevice[],
): EvidenceItem[] {
  const rnd = mulberry32(subSeed(seed, 'evidence', hashString(incident.incident_id)))
  const situation = situationOf(incident)
  const count = intRange(rnd, 2, 6)
  const candidates = sources.filter((s) => incident.source_types.includes(s.source_type))
  const pool = candidates.length > 0 ? candidates : sources

  return Array.from({ length: count }, (_, i) => {
    const source = pool[(hashString(incident.incident_id) + i) % pool.length]!
    const kind = i === 0 ? 'keyframe' : chance(rnd, 0.4) ? 'crop' : 'keyframe'
    const family =
      source.source_type === 'bodycam'
        ? 'bodycam'
        : source.source_type === 'patrol-car' || source.source_type === 'patrol-bike'
          ? 'patrol'
          : source.source_type === 'sensor'
            ? 'sensor'
            : 'cam'
    const n = (hashString(incident.incident_id) + i) % 6
    return {
      evidence_id: `EV-${incident.incident_id.slice(-10)}-${i}`,
      observation_id: `OBS-${source.source_id}-${hex(rnd, 8)}`,
      incident_id: incident.incident_id,
      source_id: source.source_id,
      source_type: source.source_type,
      t: incident.detected_at + i * intRange(rnd, 400, 5000),
      position: incident.position,
      zone_label: incident.zone_label,
      kind,
      thumb_url: `/media/frames/${family}-${n + 1}.jpg`,
      full_url: `/media/frames/${family}-${n + 1}.jpg`,
      preview_clip_url: chance(rnd, 0.5) ? `/media/clips/clip-${(n % 4) + 1}.mp4` : null,
      width: kind === 'crop' ? intRange(rnd, 160, 420) : 1280,
      height: kind === 'crop' ? intRange(rnd, 160, 420) : 720,
      attributes: {
        classes: [...situation.classes],
        colour: chance(rnd, 0.7) ? pick(rnd, COLOURS) : null,
        vehicle_type: situation.classes.some((c) => ['car', 'lcv', 'truck', 'bus', 'motorcycle'].includes(c))
          ? pick(rnd, VEHICLE_TYPES)
          : null,
        tags: [situation.key, incident.domain, incident.zone_id],
      },
      similarity: null,
      hash: hex(rnd, 64),
      authenticity: chance(rnd, 0.86)
        ? 'verified'
        : chance(rnd, 0.7)
          ? 'consistent'
          : chance(rnd, 0.6)
            ? 'unverifiable'
            : 'inconsistent',
      contains_person: situation.classes.includes('person') || chance(rnd, 0.3),
    }
  })
}

const TIME_WORDS: readonly (readonly [RegExp, number])[] = [
  [/last week|past week|7 days/i, 7 * 86400_000],
  [/last 24 ?h|past day|yesterday/i, 86400_000],
  [/last hour|past hour/i, 3600_000],
  [/last 3 ?days|past 3 ?days/i, 3 * 86400_000],
]

/**
 * The query parser. It is deliberately explicit rather than clever: the operator
 * sees exactly what was extracted as editable chips before anything runs, so a
 * wrong reading is corrected rather than silently executed.
 */
export function parseQuery(text: string, now: number): ParsedQuery {
  const lower = text.toLowerCase()
  let from: number | null = null
  for (const [re, span] of TIME_WORDS) {
    if (re.test(text)) {
      from = now - span
      break
    }
  }
  const clockRange = /(\d{1,2}):(\d{2})\s*(?:to|and|-)\s*(\d{1,2}):(\d{2})/.exec(text)
  let to: number | null = from === null ? null : now
  if (clockRange) {
    const base = from ?? now - 86400_000
    const day = Math.floor(base / 86400_000) * 86400_000
    from = day + (Number(clockRange[1]) * 60 + Number(clockRange[2])) * 60_000
    to = day + (Number(clockRange[3]) * 60 + Number(clockRange[4])) * 60_000
    if (to < from) to += 86400_000
  }

  const colour = COLOURS.find((c) => lower.includes(c)) ?? null
  const vehicleType = VEHICLE_TYPES.find((v) => lower.includes(v)) ?? null
  const personTerms = /\b(person|man|woman|people|pedestrian|face|wearing)\b/i.test(text)

  const stop = new Set([
    'the', 'a', 'an', 'with', 'near', 'between', 'and', 'to', 'in', 'on', 'at', 'from', 'last', 'week',
    'show', 'me', 'find', 'all', 'of', 'that', 'was', 'were', 'is', 'are',
  ])
  const freeTerms = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w) && w !== colour && w !== vehicleType)
    .slice(0, 6)

  return {
    text,
    from,
    to,
    zone_ids: [],
    domains: [],
    source_types: [],
    classes: [],
    colour,
    vehicle_type: vehicleType,
    free_terms: freeTerms,
    requires_person_search: personTerms,
    model: 'openai/gpt-oss-20b',
  }
}

/** Scores an item against a parsed query. Deterministic, so results are stable. */
export function scoreItem(item: EvidenceItem, q: ParsedQuery): number {
  let score = 0.35
  if (q.colour && item.attributes.colour === q.colour) score += 0.25
  if (q.vehicle_type && item.attributes.vehicle_type === q.vehicle_type) score += 0.22
  for (const term of q.free_terms) {
    if (item.attributes.tags.some((t) => t.includes(term))) score += 0.08
    if (item.attributes.classes.some((c) => c.includes(term))) score += 0.08
    if (item.zone_label.toLowerCase().includes(term)) score += 0.1
  }
  const jitter = (hashString(item.evidence_id) % 100) / 1000
  return Math.min(0.99, Math.round((score + jitter) * 1000) / 1000)
}

