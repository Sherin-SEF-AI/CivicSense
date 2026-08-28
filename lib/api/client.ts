import type { z } from 'zod'
import { API_BASE } from '@/lib/env'

/**
 * The typed HTTP boundary.
 *
 * Every response is parsed through its zod schema here and nowhere else, so a
 * backend that drifts from the contract fails loudly at the edge with a readable
 * error instead of producing undefined three components deep.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class SchemaError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string[],
  ) {
    super(`response did not match the contract at ${path}`)
    this.name = 'SchemaError'
  }
}

const API_KEY_HEADER = 'X-API-Key'

function apiKey(): string {
  if (typeof window === 'undefined') return 'server'
  return window.localStorage.getItem('cs.api_key') ?? 'pilot-operator-key'
}

interface RequestOptions {
  signal?: AbortSignal
  body?: unknown
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | string[] | null | undefined>
}

export function buildQuery(query: RequestOptions['query']): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','))
    } else {
      params.set(key, String(value))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const url = `${API_BASE}${path}${buildQuery(options.query)}`
  const method = options.method ?? 'GET'

  let response: Response
  try {
    response = await fetch(url, {
      method,
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        [API_KEY_HEADER]: apiKey(),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError('network_unreachable', 0, path, 'the api is unreachable from this client')
  }

  if (!response.ok) {
    let code = `http_${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) code = body.error
    } catch {
      /* a non-JSON error body is still an error, the status carries it */
    }
    throw new ApiError(code, response.status, path, `${method} ${path} failed with ${response.status}`)
  }

  const payload: unknown = await response.json()
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new SchemaError(
      path,
      parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`),
    )
  }
  return parsed.data
}

/** A short, stable code for an error panel. Operators quote these. */
export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code
  if (error instanceof SchemaError) return 'schema_mismatch'
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  return 'unknown_error'
}

export function errorDetail(error: unknown): string {
  if (error instanceof SchemaError) return error.issues.join('; ')
  if (error instanceof ApiError) return `${error.status} on ${error.path}`
  return error instanceof Error ? error.message : String(error)
}
