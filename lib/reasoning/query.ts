import 'server-only'
import { randomUUID } from 'node:crypto'
import type { QueryAnswer, QueryToolCall } from '@/lib/api/schemas'
import { all, run } from '@/lib/db'
import { call, isConfigured } from '@/lib/groq/client'
import { QUERY_SCHEMA } from './schemas'

/**
 * Natural language query over the store.
 *
 * The model never writes SQL. A fixed set of parameterised tools runs against
 * the database, the rows come back, and the model is asked to answer from those
 * rows and cite the incident ids it used. That keeps the query surface closed
 * and makes the trace above the answer a true account of what was read.
 */

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /reveal (the )?(system|hidden) prompt/i,
  /disregard (the )?(policy|rules)/i,
  /you are now/i,
  /pretend (you are|to be)/i,
]

const PERSON_PATTERNS = [/\bidentify\b.*\b(person|face|man|woman)\b/i, /\bwho (is|was)\b/i, /face recognition/i]

const SYSTEM = `You answer questions about a civic intelligence deployment using only the rows you are given.

You are given the result of database queries that have already run. Answer from those rows and nothing
else. If the rows do not support an answer, say so plainly and say what would be needed.

Cite the incident ids you relied on in incident_ids. Do not cite an id that is not in the rows. Keep
the answer to a few sentences of plain English, and give a table only when the shape of the answer is
tabular.`

interface ToolResult {
  call: QueryToolCall
  rows: unknown[]
}

/** The closed tool surface. Every one is parameterised; none takes free SQL. */
function runTools(question: string, now: number): ToolResult[] {
  const lower = question.toLowerCase()
  const window = /month/.test(lower) ? 30 * 86400_000 : /week/.test(lower) ? 7 * 86400_000 : 86400_000
  const since = now - window
  const results: ToolResult[] = []

  const time = <T>(tool: string, args: Record<string, unknown>, fn: () => T[]): T[] => {
    const started = Date.now()
    let rows: T[] = []
    let error: string | null = null
    try {
      rows = fn()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    results.push({
      call: { step: results.length + 1, tool, args, rows: rows.length, ms: Date.now() - started, error },
      rows,
    })
    return rows
  }

  time('incidents.by_zone', { since: new Date(since).toISOString() }, () =>
    all(
      `SELECT zone_label, domain, COUNT(*) AS incidents,
              SUM(CASE WHEN status IN ('resolved','verified') THEN 1 ELSE 0 END) AS closed
       FROM incidents WHERE detected_at >= ? GROUP BY zone_label, domain ORDER BY incidents DESC LIMIT 40`,
      [since],
    ),
  )

  time('incidents.recent', { since: new Date(since).toISOString(), limit: 25 }, () =>
    all(
      `SELECT incident_id, title, domain, priority, status, zone_label, detected_at, department
       FROM incidents WHERE detected_at >= ? ORDER BY detected_at DESC LIMIT 25`,
      [since],
    ),
  )

  time('departments.performance', {}, () =>
    all(
      `SELECT d.label AS department,
              COUNT(i.incident_id) AS assigned,
              SUM(CASE WHEN i.status = 'verified' THEN 1 ELSE 0 END) AS verified
       FROM departments d LEFT JOIN incidents i ON i.department = d.department AND i.detected_at >= ?
       GROUP BY d.label ORDER BY assigned DESC`,
      [since],
    ),
  )

  time('sources.coverage', {}, () =>
    all(
      `SELECT source_type, state, COUNT(*) AS sources FROM sources GROUP BY source_type, state ORDER BY sources DESC`,
    ),
  )

  return results
}

export async function answerQuery(question: string, askedBy: string): Promise<QueryAnswer> {
  const now = Date.now()
  const queryId = `Q-${randomUUID().slice(0, 8).toUpperCase()}`

  const injection = INJECTION_PATTERNS.some((p) => p.test(question))
  const personSearch = PERSON_PATTERNS.some((p) => p.test(question))

  if (injection || personSearch) {
    const answer: QueryAnswer = {
      query_id: queryId,
      question,
      asked_at: now,
      guard: {
        verdict: 'blocked',
        detail: injection
          ? 'the question contains an instruction-override pattern and was screened before dispatch'
          : 'this platform performs no face recognition, and person identification is not available through the query console',
        injection_score: injection ? 0.95 : 0.05,
      },
      trace: [],
      answer: injection
        ? 'blocked by the pre-dispatch screen. rephrase without instructions directed at the model.'
        : 'blocked. person identification is out of scope for this platform. search by vehicle or location attributes instead.',
      citations: [],
      table: null,
      model: 'pre-dispatch screen',
      cost_usd: 0,
    }
    persist(answer, askedBy)
    return answer
  }

  const tools = runTools(question, now)

  if (!isConfigured()) {
    const answer: QueryAnswer = {
      query_id: queryId,
      question,
      asked_at: now,
      guard: { verdict: 'pass', detail: 'no policy findings', injection_score: 0 },
      trace: tools.map((t) => t.call),
      answer:
        'the queries ran and their results are above, but GROQ_API_KEY is not set so there is no model to phrase an answer from them. set the key to get a written answer, or read the rows directly.',
      citations: [],
      table: tableFrom(tools),
      model: 'unconfigured',
      cost_usd: 0,
    }
    persist(answer, askedBy)
    return answer
  }

  const result = await call<{ answer: string; incident_ids: string[]; table: { columns: string[]; rows: string[][] } | null }>({
    role: 'query',
    schema: QUERY_SCHEMA,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          `Question: ${question}`,
          `Current time: ${new Date(now).toISOString()} (UTC). Local time is IST.`,
          ...tools.map((t) => `Tool ${t.call.tool} returned ${t.rows.length} rows:\n${JSON.stringify(t.rows).slice(0, 12_000)}`),
        ].join('\n\n'),
      },
    ],
  })

  const known = new Set(
    tools.flatMap((t) => t.rows.map((r) => (r as { incident_id?: string }).incident_id).filter((id): id is string => !!id)),
  )
  const titles = new Map(
    tools.flatMap((t) =>
      t.rows
        .map((r) => r as { incident_id?: string; title?: string })
        .filter((r) => r.incident_id && r.title)
        .map((r) => [r.incident_id!, r.title!] as const),
    ),
  )

  const answer: QueryAnswer = {
    query_id: queryId,
    question,
    asked_at: now,
    guard: { verdict: 'pass', detail: 'no policy findings', injection_score: 0 },
    trace: tools.map((t) => t.call),
    answer: result.data.answer,
    /* A citation to an id the tools never returned is dropped rather than shown. */
    citations: result.data.incident_ids
      .filter((id) => known.has(id))
      .map((id) => ({ incident_id: id, label: titles.get(id) ?? id })),
    table: result.data.table,
    model: result.model,
    cost_usd: result.costUsd,
  }
  persist(answer, askedBy)
  return answer
}

function tableFrom(tools: ToolResult[]): QueryAnswer['table'] {
  const first = tools.find((t) => t.rows.length > 0)
  if (!first) return null
  const columns = Object.keys(first.rows[0] as Record<string, unknown>)
  return {
    columns,
    rows: first.rows.slice(0, 20).map((row) => columns.map((c) => String((row as Record<string, unknown>)[c] ?? ''))),
  }
}

function persist(answer: QueryAnswer, askedBy: string): void {
  run(
    `INSERT INTO queries (query_id, question, asked_at, asked_by, guard, trace, answer, citations, table_json, model, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      answer.query_id,
      answer.question,
      answer.asked_at,
      askedBy,
      JSON.stringify(answer.guard),
      JSON.stringify(answer.trace),
      answer.answer,
      JSON.stringify(answer.citations),
      answer.table ? JSON.stringify(answer.table) : null,
      answer.model,
      answer.cost_usd,
    ],
  )
}
