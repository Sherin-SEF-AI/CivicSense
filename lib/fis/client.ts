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

export interface FisAuthenticityTest {
  test: string
  result: 'pass' | 'fail' | 'inconclusive'
  detail: string
  standard: string | null
  mandatory: boolean
  measurements: Record<string, unknown>
}

export interface FisAuthenticity {
  sha256: string
  verdict: 'verified' | 'consistent' | 'flagged' | 'inconsistent'
  tests: FisAuthenticityTest[]
}

/**
 * The full battery over one object, when the tier is attached.
 *
 * Returns null rather than throwing when it is not, because a console without
 * the forensic tier still has to produce a bundle. What it must not do is
 * silently present the smaller set of local checks as though the full battery
 * had run, so the caller marks the difference.
 */
export interface OverlayRecord {
  x: number
  y: number
  scale: number
  layout: string
  seconds_per_frame?: number
  claimed_start_utc_ms?: number
}

export async function fisAuthenticity(input: {
  sha256: string
  width: number | null
  height: number | null
  claimedCaptureMs: number | null
  signatureVerdict: string
  overlay?: OverlayRecord | null
}): Promise<FisAuthenticity | null> {
  if (!fisConfigured()) return null
  try {
    return await fis<FisAuthenticity>('/v1/authenticity', {
      method: 'POST',
      body: {
        sha256: input.sha256,
        width: input.width,
        height: input.height,
        claimed_capture_ms: input.claimedCaptureMs,
        signature_verdict: input.signatureVerdict,
        overlay: input.overlay ?? null,
      },
    })
  } catch {
    return null
  }
}

export interface FisKinematicsItem {
  track_id: string
  entity_ref: string | null
  descriptor?: string
  estimator?: string
  refused?: string
  grade?: string
  peak_speed_kmh?: number
  peak_speed_interval_95?: [number, number]
  braking_onset_ms?: number | null
  series?: { t: number; speed: number; speed_lo: number; speed_hi: number; accel: number }[]
}

/**
 * Speed and acceleration from ground-plane tracks, filtered rather than differenced.
 *
 * Returns null when the tier is not attached, so the caller can fall back and
 * say which method it used. The two are not interchangeable: dividing the gap
 * between consecutive positions by the interval between them amplifies position
 * noise instead of averaging it down, and on a typical site it is wrong by three
 * orders of magnitude more than the filter.
 */
export async function fisKinematics(
  tracks: {
    track_id: string
    entity_ref: string | null
    descriptor: string
    residual_m: number
    sync_sigma_ms: number
    samples: { t_ms: number; lat: number; lon: number }[]
  }[],
): Promise<FisKinematicsItem[] | null> {
  if (!fisConfigured() || tracks.length === 0) return null
  try {
    const body = await fis<{ items: FisKinematicsItem[] }>('/v1/kinematics', { method: 'POST', body: { tracks } })
    return body.items
  } catch {
    return null
  }
}

export interface SyncObservation {
  source_id: string
  t_source_ms: number
  t_utc_ms: number
  sigma_ms: number
  method: 'ntp' | 'gnss' | 'burned_ocr' | 'pts_anchor' | 'gcc_phat' | 'visual_event' | 'manual'
  detail?: string
}

/**
 * Records what a source's clock read against when its bytes actually arrived.
 *
 * Fire and forget. The console must not fail an ingest because the forensic
 * tier is down, and a clock observation that never reached the model is a
 * slightly wider interval later rather than a lost observation now.
 */
export function recordSync(observations: SyncObservation[]): void {
  if (!fisConfigured() || observations.length === 0) return
  void fis('/v1/timebase/observations', { method: 'POST', body: observations }).catch(() => {
    /* Deliberately swallowed. See above. */
  })
}

export interface FisResolvedTime {
  t_utc_ms: number | null
  sigma_ms: number | null
  grade: string
  extrapolated_s: number
  refused: string | null
  detail: string
}

export async function fisResolveTime(sourceId: string, tSourceMs: number): Promise<FisResolvedTime | null> {
  if (!fisConfigured()) return null
  try {
    return await fis<FisResolvedTime>(
      `/v1/timebase/${encodeURIComponent(sourceId)}/resolve?t_source_ms=${Math.round(tSourceMs)}`,
    )
  } catch {
    return null
  }
}
