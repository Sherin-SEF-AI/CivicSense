import 'server-only'
import { randomUUID } from 'node:crypto'
import { all, audit, get, run } from '@/lib/db'
import { call, isConfigured } from '@/lib/groq/client'
import { observationsForIncident } from './observations'
import { getIncidentRow } from './incidents'
import type { Hypothesis } from '@/lib/api/schemas'

/**
 * The active investigation loop.
 *
 * An incident record is a set of observations, and a set of observations is
 * usually consistent with more than one story. This generates the competing
 * stories explicitly, with a prior on each, and for every one it names the
 * specific thing that would separate it from the others: which source, which
 * window, what to look for.
 *
 * That last part is what makes it an investigation rather than a guess. A
 * hypothesis nobody can test is worth nothing, so one that cannot name a request
 * is not generated.
 *
 * Posteriors move only when a request comes back. Nothing here nudges a number
 * to look decisive.
 */

interface HypothesisRow {
  hypothesis_id: string
  incident_id: string
  statement: string
  prior: number
  posterior: number
  status: string
  evidence_ids: string
  created_at: number
}

interface RequestRow {
  request_id: string
  hypothesis_id: string
  what: string
  source_id: string
  window_from: number
  window_to: number
  state: string
  delta: number | null
}

function toHypothesis(row: HypothesisRow): Hypothesis {
  const requests = all<RequestRow>('SELECT * FROM hypothesis_requests WHERE hypothesis_id = ? ORDER BY rowid ASC', [
    row.hypothesis_id,
  ])
  return {
    hypothesis_id: row.hypothesis_id,
    statement: row.statement,
    prior: row.prior,
    posterior: row.posterior,
    status: row.status as Hypothesis['status'],
    evidence_ids: JSON.parse(row.evidence_ids) as string[],
    requests: requests.map((r) => ({
      request_id: r.request_id,
      what: r.what,
      source_id: r.source_id,
      window: [r.window_from, r.window_to] as [number, number],
      state: r.state as Hypothesis['requests'][number]['state'],
      delta: r.delta,
    })),
  }
}

export function hypothesesForIncident(incidentId: string): Hypothesis[] {
  return all<HypothesisRow>('SELECT * FROM hypotheses WHERE incident_id = ? ORDER BY posterior DESC, prior DESC', [
    incidentId,
  ]).map(toHypothesis)
}

interface Generated {
  hypotheses: {
    statement: string
    prior: number
    requests: { what: string; source_id: string; window_seconds_before: number; window_seconds_after: number }[]
  }[]
}

const SCHEMA = {
  name: 'competing_hypotheses',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['hypotheses'],
    properties: {
      hypotheses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['statement', 'prior', 'requests'],
          properties: {
            statement: { type: 'string' },
            prior: { type: 'number' },
            requests: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['what', 'source_id', 'window_seconds_before', 'window_seconds_after'],
                properties: {
                  what: { type: 'string' },
                  source_id: { type: 'string' },
                  window_seconds_before: { type: 'number' },
                  window_seconds_after: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

/**
 * Generates the competing explanations for an incident.
 *
 * Returns an empty list when the understanding tier is unavailable, which is the
 * same answer the rest of the platform gives: no reasoning layer means no
 * reasoning output, not a fabricated one.
 */
export async function generateHypotheses(incidentId: string, actor: string): Promise<Hypothesis[]> {
  const row = getIncidentRow(incidentId)
  if (!row) return []
  if (!isConfigured()) return []

  const observations = observationsForIncident(incidentId)
  if (observations.length === 0) return []

  const nearby = all<{ source_id: string; label: string; source_type: string }>(
    `SELECT source_id, label, source_type FROM sources
     WHERE ABS(lat - ?) < 0.01 AND ABS(lon - ?) < 0.01 LIMIT 12`,
    [row.lat, row.lon],
  )

  const record = observations
    .map(
      (o) =>
        `- ${new Date(o.capture.t_start).toISOString()} ${o.source.source_id} (${o.source.source_type}, trust ${o.source.trust_score.toFixed(2)}) ` +
        `${o.payload_kind}${o.derived.trigger ? `, trigger ${o.derived.trigger}` : ''}` +
        `${o.derived.classes.length > 0 ? `, classes ${o.derived.classes.join(', ')}` : ''}` +
        `${o.quality.valid ? '' : ', quality flagged invalid'}`,
    )
    .join('\n')

  const available = nearby.map((s) => `${s.source_id} (${s.source_type}, ${s.label})`).join('\n')

  let generated: Generated
  try {
    const result = await call<Generated>({
      role: 'forensic',
      schema: SCHEMA,
      messages: [
        {
          role: 'system',
          content: [
            'You generate competing explanations for a civic incident from an observation record.',
            'Rules you must follow.',
            'Every hypothesis must be consistent with every observation listed. Do not propose an explanation the record already rules out.',
            'Include the mundane explanation as well as the alarming one. Most triggers are the mundane one.',
            'Priors must sum to at most 1.0 and each must reflect how often that explanation is true in general, not how interesting it is.',
            'Every hypothesis must name at least one concrete retrieval that would separate it from the others: an existing source id from the available list, a window relative to the incident, and what specifically to look for in it.',
            'Do not propose retrieving from a source that is not in the available list.',
            'If a hypothesis cannot be tested with the available sources, do not include it.',
            'Write in plain sentences. Do not use em-dashes.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Incident ${incidentId}: ${row.title}`,
            `Detected at ${new Date(row.detected_at).toISOString()} in ${row.zone_label}.`,
            `Situation the edge reported: ${row.situation_key}.`,
            '',
            'Observation record:',
            record,
            '',
            'Sources available for retrieval:',
            available || 'none within range',
          ].join('\n'),
        },
      ],
      maxTokens: 8192,
    })
    generated = result.data
  } catch {
    return hypothesesForIncident(incidentId)
  }

  const known = new Set(nearby.map((s) => s.source_id))
  const anchor = row.detected_at
  const now = Date.now()

  run('DELETE FROM hypotheses WHERE incident_id = ? AND status = ?', [incidentId, 'open'])

  for (const item of generated.hypotheses) {
    /* A request against a source that does not exist is not a request. Drop it,
       and drop the hypothesis if nothing testable survives. */
    const requests = item.requests.filter((r) => known.has(r.source_id))
    if (requests.length === 0) continue

    const id = `HYP-${randomUUID().slice(0, 8).toUpperCase()}`
    const prior = Math.min(1, Math.max(0, item.prior))
    run(
      'INSERT INTO hypotheses (hypothesis_id, incident_id, statement, prior, posterior, status, evidence_ids, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, incidentId, item.statement, prior, prior, 'open', '[]', now],
    )
    for (const request of requests) {
      run(
        'INSERT INTO hypothesis_requests (request_id, hypothesis_id, what, source_id, window_from, window_to, state) VALUES (?,?,?,?,?,?,?)',
        [
          `REQ-${randomUUID().slice(0, 8).toUpperCase()}`,
          id,
          request.what,
          request.source_id,
          /* A zero width window retrieves nothing, so a request that asks for
             one is widened to the smallest span that could actually answer it. */
          anchor - Math.min(3600, Math.max(5, request.window_seconds_before)) * 1000,
          anchor + Math.min(3600, Math.max(5, request.window_seconds_after)) * 1000,
          'queued',
        ],
      )
    }
  }

  audit(actor, 'hypotheses.generated', `incident:${incidentId}`, `${generated.hypotheses.length} proposed`)
  return hypothesesForIncident(incidentId)
}

/**
 * Pulls a retrieval request and updates the posterior from what came back.
 *
 * The update is the honest one: evidence that exists in the requested window
 * raises the hypothesis it was asked for and lowers its competitors, and a
 * window with nothing in it lowers the hypothesis rather than leaving it
 * untouched. Absence is information, but weaker information, so it moves the
 * number less.
 */
export function pullRequest(requestId: string, actor: string): Hypothesis | null {
  const request = get<RequestRow>('SELECT * FROM hypothesis_requests WHERE request_id = ?', [requestId])
  if (!request) return null

  const hypothesis = get<HypothesisRow>('SELECT * FROM hypotheses WHERE hypothesis_id = ?', [request.hypothesis_id])
  if (!hypothesis) return null

  const found = all<{ observation_id: string; content_ref: string | null }>(
    'SELECT observation_id, content_ref FROM observations WHERE source_id = ? AND t_start BETWEEN ? AND ?',
    [request.source_id, request.window_from, request.window_to],
  )

  const hit = found.length > 0
  const delta = hit ? 0.18 : -0.1
  const posterior = Math.min(0.99, Math.max(0.01, hypothesis.posterior + delta))

  run('UPDATE hypothesis_requests SET state = ?, delta = ? WHERE request_id = ?', [
    hit ? 'returned' : 'unavailable',
    Math.round(delta * 100) / 100,
    requestId,
  ])

  const evidenceIds = [
    ...new Set([
      ...(JSON.parse(hypothesis.evidence_ids) as string[]),
      ...found.flatMap((f) => (f.content_ref ? [f.content_ref] : [])),
    ]),
  ]

  /* A hypothesis is only called supported or refuted once the number is far
     enough from even that the label is not noise. */
  const status = posterior >= 0.7 ? 'supported' : posterior <= 0.15 ? 'refuted' : 'open'
  run('UPDATE hypotheses SET posterior = ?, status = ?, evidence_ids = ? WHERE hypothesis_id = ?', [
    Math.round(posterior * 100) / 100,
    status,
    JSON.stringify(evidenceIds),
    hypothesis.hypothesis_id,
  ])

  /* Probability is conserved across the competing set, so supporting one costs
     the others. */
  const siblings = all<HypothesisRow>('SELECT * FROM hypotheses WHERE incident_id = ? AND hypothesis_id != ?', [
    hypothesis.incident_id,
    hypothesis.hypothesis_id,
  ])
  for (const sibling of siblings) {
    const shifted = Math.min(0.99, Math.max(0.01, sibling.posterior - delta / Math.max(1, siblings.length)))
    run('UPDATE hypotheses SET posterior = ?, status = ? WHERE hypothesis_id = ?', [
      Math.round(shifted * 100) / 100,
      shifted >= 0.7 ? 'supported' : shifted <= 0.15 ? 'refuted' : sibling.status === 'open' ? 'open' : sibling.status,
      sibling.hypothesis_id,
    ])
  }

  audit(
    actor,
    'hypothesis.request_pulled',
    `hypothesis:${hypothesis.hypothesis_id}`,
    `${request.source_id} ${hit ? `returned ${found.length} observations` : 'held nothing in that window'}`,
  )

  return toHypothesis(get<HypothesisRow>('SELECT * FROM hypotheses WHERE hypothesis_id = ?', [hypothesis.hypothesis_id])!)
}
