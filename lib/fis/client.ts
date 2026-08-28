import 'server-only'
import { createHmac } from 'node:crypto'
import type { Session } from '@/lib/api/schemas'

/**
 * The console's side of the forensic tier.
 *
 * FIS holds operators, recipes, derivatives, timebase models and geometry. The
 * console keeps its own store and never queries FIS's database directly, for one
 * reason that matters more than the others: the class gate, the custody rules
 * and the dual control checks live in the same process as the data. If a route
 * here could select from the derivative table, a future route could assemble a
 * disclosure bundle without passing the gate, and it would do it by accident.
 *
 * Identity is asserted rather than re-authenticated. The console has already
 * resolved the session through its own helpers; what FIS checks is that the
 * assertion came from the console, by HMAC over the exact bytes.
 */

const BASE = process.env.FIS_BASE_URL ?? null
const SECRET = process.env.FIS_SERVICE_SECRET ?? 'fis-local-only-secret'
const TIMEOUT_MS = Number(process.env.FIS_TIMEOUT_MS ?? 8000)

export class FisUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'FisUnavailable'
  }
}

export function fisConfigured(): boolean {
  return BASE !== null
}

function assertion(user: Session): { header: string; signature: string } {
  const header = JSON.stringify({
    user_id: user.user_id,
    name: user.name,
    role: user.role,
    capabilities: user.capabilities,
    investigation_flag: user.investigation_flag,
  })
  return { header, signature: createHmac('sha256', SECRET).update(header).digest('hex') }
}

export async function fis<T>(
  path: string,
  options: { user?: Session; method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (BASE === null) {
    throw new FisUnavailable('FIS_BASE_URL is not set, so the forensic tier is not attached to this console')
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.user) {
    const signed = assertion(options.user)
    headers['x-fis-actor'] = signed.header
    headers['x-fis-sig'] = signed.signature
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  options.signal?.addEventListener('abort', () => controller.abort())

  try {
    const response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new FisUnavailable(`the forensic tier answered ${response.status}: ${text.slice(0, 240)}`)
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof FisUnavailable) throw error
    /* A connection refused here is the ordinary state of a console running
       without the forensic tier, not a fault. It is reported as unavailable so
       the screens render the state they have for it. */
    throw new FisUnavailable(
      error instanceof Error && error.name === 'AbortError'
        ? `the forensic tier did not answer within ${TIMEOUT_MS} ms`
        : `the forensic tier is not reachable: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

export interface FisHealth {
  service: string
  environment: string
  postgres: string
  operators: number
  registry_digest: string
}

export async function fisHealth(): Promise<
  { available: true; health: FisHealth } | { available: false; reason: string }
> {
  if (!fisConfigured()) {
    return { available: false, reason: 'FIS_BASE_URL is not set, so the forensic tier is not attached' }
  }
  try {
    return { available: true, health: await fis<FisHealth>('/health') }
  } catch (error) {
    return { available: false, reason: error instanceof FisUnavailable ? error.reason : String(error) }
  }
}
