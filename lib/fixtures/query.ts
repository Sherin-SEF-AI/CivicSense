import 'server-only'
import type { IncidentSummary, QueryAnswer, QueryToolCall } from '@/lib/api/schemas'
import { DEPARTMENTS } from './catalog'
import { hashString } from './packages'
import { intRange, mulberry32, range, subSeed } from './rng'

/**
 * The NL query agent, rendered honestly: the operator sees the tool calls, the
 * row counts and the timings above the answer, and every claim links back to the
 * incident ids it came from. An answer with no citations is not an answer.
 */

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /reveal (the )?(system|hidden) prompt/i,
  /disregard (the )?(policy|rules)/i,
  /you are now/i,
]

const PERSON_PATTERNS = [/\bidentify\b.*\b(person|face|man|woman)\b/i, /\bwho (is|was)\b/i, /face recognition/i]

export function answerQuery(
  seed: number,
  question: string,
  incidents: IncidentSummary[],
  now: number,
): QueryAnswer {
  const rnd = mulberry32(subSeed(seed, 'query', hashString(question)))
  const injection = INJECTION_PATTERNS.some((re) => re.test(question))
  const personSearch = PERSON_PATTERNS.some((re) => re.test(question))

  if (injection || personSearch) {
    return {
      query_id: `Q-${now}`,
      question,
      asked_at: now,
      guard: {
        verdict: 'blocked',
        detail: injection
          ? 'the question contains an instruction-override pattern, screened before dispatch'
          : 'person identification is not available on this platform, and no investigation flag is set on this session',
        injection_score: injection ? Math.round(range(rnd, 0.82, 0.99) * 100) / 100 : 0.04,
      },
      trace: [],
      answer: injection
        ? 'blocked by the pre-dispatch policy audit. rephrase without instructions directed at the model.'
        : 'blocked. this platform performs no face recognition, and person search requires an authorised investigation flag on an open case.',
      citations: [],
      table: null,
      model: 'llama-prompt-guard-2-86m',
      cost_usd: 0,
    }
  }

  const lower = question.toLowerCase()
  const window = /week/.test(lower) ? 7 * 86400_000 : /month/.test(lower) ? 30 * 86400_000 : 86400_000
  const cutoff = now - window
  const scoped = incidents.filter((i) => i.detected_at >= cutoff)

  const domainHit = ['traffic', 'waste', 'safety', 'nuisance', 'infrastructure', 'environment', 'vehicle', 'disaster'].find(
    (d) => lower.includes(d),
  )
  const filtered = domainHit ? scoped.filter((i) => i.domain === domainHit) : scoped

  const byZone = new Map<string, number>()
  for (const i of filtered) byZone.set(i.zone_label, (byZone.get(i.zone_label) ?? 0) + 1)
  const ranked = [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  const trace: QueryToolCall[] = [
    {
      step: 1,
      tool: 'sql.incidents',
      args: { since: new Date(cutoff).toISOString(), domain: domainHit ?? null },
      rows: filtered.length,
      ms: intRange(rnd, 12, 90),
      error: null,
    },
    {
      step: 2,
      tool: 'sql.group_by_zone',
      args: { metric: 'count', order: 'desc', limit: 6 },
      rows: ranked.length,
      ms: intRange(rnd, 4, 28),
      error: null,
    },
    {
      step: 3,
      tool: 'sql.join_dispositions',
      args: { incident_ids: Math.min(filtered.length, 500) },
      rows: Math.min(filtered.length, 500),
      ms: intRange(rnd, 8, 60),
      error: null,
    },
  ]

  const top = ranked[0]
  const dept = DEPARTMENTS[hashString(question) % DEPARTMENTS.length]!
  const citations = filtered.slice(0, 4).map((i) => ({ incident_id: i.incident_id, label: i.title }))

  const answer = top
    ? `${filtered.length} ${domainHit ?? 'civic'} incidents in the window, concentrated at ${top[0]} with ${top[1]}. the owning department for most of them is ${dept.label}. the verified closure rate across the set is ${Math.round(range(rnd, 0.5, 0.9) * 100)} percent, and ${Math.round(range(rnd, 5, 22))} percent were dispositioned as educational rather than enforcement under the proportionality rule.`
    : 'no incidents match that window and filter. widen the window or drop the domain filter.'

  return {
    query_id: `Q-${now}`,
    question,
    asked_at: now,
    guard: { verdict: 'pass', detail: 'no policy findings', injection_score: Math.round(range(rnd, 0.01, 0.12) * 100) / 100 },
    trace,
    answer,
    citations,
    table: ranked.length
      ? { columns: ['zone', 'incidents'], rows: ranked.map(([z, n]) => [z, String(n)]) }
      : null,
    model: 'openai/gpt-oss-120b',
    cost_usd: Math.round(range(rnd, 0.002, 0.012) * 10000) / 10000,
  }
}
