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
    const started = Date.now()
    try {
      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
        max_completion_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        stream: false,
      }
      if (config.reasoning) body.reasoning_effort = config.reasoning
      if (options.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: options.schema.name, schema: options.schema.schema, strict: true },
        }
      }
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
        throw new GroqCallFailed(response.status, text)
      }

      const payload = (await response.json()) as CompletionResponse
      const content = payload.choices[0]?.message.content ?? ''
      const tokensIn = payload.usage?.prompt_tokens ?? 0
      const tokensOut = payload.usage?.completion_tokens ?? 0
      const costUsd =
        (tokensIn / 1_000_000) * config.priceIn + (tokensOut / 1_000_000) * config.priceOut

      record(options, model, tokensIn, tokensOut, costUsd, latencyMs, index > 0 ? chain[0]! : null, true, null)

      const data = options.schema ? (JSON.parse(content) as T) : (content as unknown as T)
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

  throw lastError instanceof Error ? lastError : new Error('every model in the chain failed')
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
