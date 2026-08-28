import 'server-only'
import { run } from '@/lib/db'

/**
 * The Groq gateway.
 *
 * Real calls to the real API. There is no simulated path: without a key the
 * gateway reports itself unconfigured and every caller surfaces that to the
 * operator, because a fabricated scene assessment is worse than an absent one.
 *
 * Roles rather than models are referenced everywhere else in the application, so
 * a withdrawn preview model is a change to this table alone.
 */

const BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'

/** How many times to wait out a transient capacity signal before giving up on a model. */
const CAPACITY_RETRIES = 3

export type Role = 'scene' | 'context' | 'fast' | 'forensic' | 'guard' | 'query' | 'audio'

interface RoleConfig {
  primary: string
  fallback: string | null
  /** USD per million tokens, from the published price list. */
  priceIn: number
  priceOut: number
  reasoning?: 'none' | 'low' | 'medium' | 'high'
  vision?: boolean
}

/**
 * What each model accepts for reasoning_effort.
 *
 * This is a per-model property, not a per-role one. The gpt-oss models take the
 * four-level scale; the Qwen vision models accept only none or default and
 * answer 400 for anything else; transcription takes no reasoning parameter at
 * all. A role asks for the effort it wants and the gateway maps it onto what the
 * model it actually reached will accept.
 */
type ReasoningDialect = 'levels' | 'binary' | 'unsupported'

const MODEL_REASONING: Record<string, ReasoningDialect> = {
  'openai/gpt-oss-120b': 'levels',
  'openai/gpt-oss-20b': 'levels',
  'openai/gpt-oss-safeguard-20b': 'levels',
  'qwen/qwen3.8-27b': 'binary',
  'qwen/qwen3.6-27b': 'binary',
  'whisper-large-v3-turbo': 'unsupported',
  'whisper-large-v3': 'unsupported',
}

/**
 * How each model can be made to return structured output.
 *
 * Only some models support a strict JSON schema. The Qwen vision models take
 * json_object mode, where the schema has to be described in the prompt and
 * validated in code afterwards. Sending a schema to a model that cannot honour
 * it returns a 400 with an empty generation, which is a confusing failure to
 * diagnose from the outside.
 */
type StructuredMode = 'schema' | 'object'

const MODEL_STRUCTURED: Record<string, StructuredMode> = {
  'openai/gpt-oss-120b': 'schema',
  'openai/gpt-oss-20b': 'schema',
  'openai/gpt-oss-safeguard-20b': 'schema',
  'qwen/qwen3.8-27b': 'schema',
  'qwen/qwen3.6-27b': 'object',
}

export function structuredModeFor(model: string): StructuredMode {
  return MODEL_STRUCTURED[model] ?? 'schema'
}

export function reasoningFor(model: string, requested: RoleConfig['reasoning']): string | null {
  if (requested === undefined) return null
  const dialect = MODEL_REASONING[model] ?? 'levels'
  if (dialect === 'unsupported') return null
  /* A model that only knows none and default gets default for anything the role
     asked for above none, rather than a value it will reject. */
  if (dialect === 'binary') return requested === 'none' ? 'none' : 'default'
  return requested
}

export const ROLES: Record<Role, RoleConfig> = {
  scene: { primary: 'qwen/qwen3.8-27b', fallback: 'qwen/qwen3.6-27b', priceIn: 0.4, priceOut: 1.2, reasoning: 'low', vision: true },
  context: { primary: 'openai/gpt-oss-120b', fallback: 'openai/gpt-oss-20b', priceIn: 0.15, priceOut: 0.6, reasoning: 'medium' },
  fast: { primary: 'openai/gpt-oss-20b', fallback: 'openai/gpt-oss-120b', priceIn: 0.075, priceOut: 0.3, reasoning: 'low' },
  forensic: { primary: 'openai/gpt-oss-120b', fallback: 'openai/gpt-oss-20b', priceIn: 0.15, priceOut: 0.6, reasoning: 'high' },
  guard: { primary: 'openai/gpt-oss-safeguard-20b', fallback: 'openai/gpt-oss-20b', priceIn: 0.075, priceOut: 0.3 },
  query: { primary: 'openai/gpt-oss-120b', fallback: 'openai/gpt-oss-20b', priceIn: 0.15, priceOut: 0.6, reasoning: 'medium' },
  audio: { primary: 'whisper-large-v3-turbo', fallback: 'whisper-large-v3', priceIn: 0, priceOut: 0 },
}

export function apiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim()
  return key && key.length > 0 ? key : null
}

export function isConfigured(): boolean {
  return apiKey() !== null
}

export class GroqUnconfigured extends Error {
  constructor() {
    super('GROQ_API_KEY is not set, so the reasoning layer is unavailable')
    this.name = 'GroqUnconfigured'
  }
}

export class GroqCallFailed extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`groq returned ${status}`)
    this.name = 'GroqCallFailed'
  }
}

export interface TextPart {
  type: 'text'
  text: string
}

export interface ImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string | (TextPart | ImagePart)[]
}

export interface CallOptions {
  role: Role
  messages: Message[]
  /** A JSON schema turns the response into a contract instead of a hope. */
  schema?: { name: string; schema: Record<string, unknown> }
  maxTokens?: number
  temperature?: number
  incidentId?: string | null
  /** on_demand for life safety, auto otherwise, batch for offline work. */
  tier?: 'on_demand' | 'auto' | 'flex' | 'batch'
}

export interface CallResult<T> {
  data: T
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  fallbackFrom: string | null
}

interface CompletionResponse {
  choices: { message: { content: string } }[]
  usage?: { prompt_tokens: number; completion_tokens: number }
  model?: string
}

/**
 * One call, with the fallback chain and the cost ledger.
 *
 * Every attempt is written to model_calls whether it succeeded or not, because
 * the spend meter and the role health dots are only honest if failures are
 * counted too.
 */
export async function call<T>(options: CallOptions): Promise<CallResult<T>> {
  const key = apiKey()
  if (!key) throw new GroqUnconfigured()

  const config = ROLES[options.role]
  const chain = [config.primary, ...(config.fallback ? [config.fallback] : [])]
  let lastError: unknown

  for (const [index, model] of chain.entries()) {
    /* Object mode gets one corrective retry: a truncated or prose-wrapped reply
       is recoverable by asking again more firmly, and burning the fallback on it
       would lose the better model for no reason. */
    const attempts = options.schema && structuredModeFor(model) === 'object' ? 2 : 1
    let capacityRetries = 0
    for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now()
    try {
      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
        max_completion_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        stream: false,
      }
      const reasoning = reasoningFor(model, config.reasoning)
      if (reasoning !== null) body.reasoning_effort = reasoning
      let messages = options.messages
      if (options.schema) {
        if (structuredModeFor(model) === 'schema') {
          body.response_format = {
            type: 'json_schema',
            json_schema: { name: options.schema.name, schema: options.schema.schema, strict: true },
          }
        } else {
          /* Object mode: the schema goes in the prompt and the result is checked
             here, because the model will not enforce it. */
          body.response_format = { type: 'json_object' }
          messages = [
            ...options.messages,
            {
              role: 'system',
              content: [
                'Reply with a single JSON object and nothing else. No prose before or after it.',
                'It must match this JSON Schema exactly, including every required property:',
                JSON.stringify(options.schema.schema),
                attempt > 0
                  ? 'Your previous reply was not valid JSON. Keep every string short so the object completes within the token budget.'
                  : 'Keep every string to one or two sentences so the object completes within the token budget.',
              ].join('\n'),
            },
          ]
        }
      }
      body.messages = messages
      if (options.tier) body.service_tier = options.tier

      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })

      const latencyMs = Date.now() - started

      if (!response.ok) {
        const text = await response.text()
        record(options, model, 0, 0, 0, latencyMs, index > 0 ? chain[0]! : null, false, `${response.status} ${text.slice(0, 300)}`)

        /* 498 is the flex tier saying it is momentarily full, and 429 is a rate
           limit. Both mean try this model again shortly. Falling through to a
           weaker model on a transient capacity signal would quietly degrade
           every assessment made during a busy minute. */
        if ((response.status === 498 || response.status === 429) && capacityRetries < CAPACITY_RETRIES) {
          capacityRetries++
          await new Promise((r) => setTimeout(r, 1200 * capacityRetries))
          attempt--
          continue
        }

        throw new GroqCallFailed(response.status, text)
      }

      const payload = (await response.json()) as CompletionResponse
      const content = payload.choices[0]?.message.content ?? ''
      const tokensIn = payload.usage?.prompt_tokens ?? 0
      const tokensOut = payload.usage?.completion_tokens ?? 0
      const costUsd =
        (tokensIn / 1_000_000) * config.priceIn + (tokensOut / 1_000_000) * config.priceOut

      record(options, model, tokensIn, tokensOut, costUsd, latencyMs, index > 0 ? chain[0]! : null, true, null)

      if (!options.schema) {
        return {
          data: content as unknown as T,
          model,
          tokensIn,
          tokensOut,
          costUsd: Math.round(costUsd * 1e6) / 1e6,
          latencyMs,
          fallbackFrom: index > 0 ? chain[0]! : null,
        }
      }

      /* Object mode can return prose around the object, or miss a required
         property. Both are recoverable here rather than at the call site. */
      const data = parseStructured<T>(content, options.schema.schema)
      return {
        data,
        model,
        tokensIn,
        tokensOut,
        costUsd: Math.round(costUsd * 1e6) / 1e6,
        latencyMs,
        fallbackFrom: index > 0 ? chain[0]! : null,
      }
    } catch (error) {
      lastError = error
      if (error instanceof GroqUnconfigured) throw error
    }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('every model in the chain failed')
}

/**
 * Parses a structured response and checks the required properties are present.
 *
 * Object mode gives no guarantee, so a missing required key is caught here and
 * raised as a normal failure, which sends the call down the fallback chain
 * rather than letting a half-formed object reach the pipeline.
 */
function parseStructured<T>(content: string, schema: Record<string, unknown>): T {
  const trimmed = content.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('the model returned no JSON object')

  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  const missing = required.filter((key) => parsed[key] === undefined)
  if (missing.length > 0) throw new Error(`the response is missing required properties: ${missing.join(', ')}`)
  return parsed as T
}

function record(
  options: CallOptions,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costUsd: number,
  latencyMs: number,
  fallbackFrom: string | null,
  ok: boolean,
  error: string | null,
): void {
  try {
    run(
      `INSERT INTO model_calls (t, incident_id, role, model, tier, tokens_in, tokens_out, cost_usd, latency_ms, cached, fallback_from, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        Date.now(),
        options.incidentId ?? null,
        options.role,
        model,
        options.tier ?? 'auto',
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        fallbackFrom,
        ok ? 1 : 0,
        error,
      ],
    )
  } catch {
    /* The ledger must never take down the call it is recording. */
  }
}

/** Live check against the API, used by the health endpoint. */
export async function ping(): Promise<{ ok: boolean; models: string[]; error: string | null }> {
  const key = apiKey()
  if (!key) return { ok: false, models: [], error: 'GROQ_API_KEY is not set' }
  try {
    const response = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { ok: false, models: [], error: `${response.status} ${await response.text()}` }
    const body = (await response.json()) as { data?: { id: string }[] }
    return { ok: true, models: (body.data ?? []).map((m) => m.id), error: null }
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}
