import 'server-only'
import { NextResponse } from 'next/server'
import { IS_FIXTURES } from '@/lib/env'

/**
 * Shared plumbing for the fixture server.
 *
 * Every handler is a real HTTP route so the client has one code path and no
 * fixture awareness: the swap to the production backend is a base URL. In a live
 * build these routes answer 404 and the fixture modules are never imported,
 * because the dynamic import below sits behind a constant the minifier folds.
 */

export const FIXTURE_SENTINEL = 'civicsense-fixture-server'

/**
 * The 404 a live build answers with.
 *
 * Callers must compare the inlined constant themselves rather than call a
 * predicate: NEXT_PUBLIC_DATA_MODE is replaced with a string literal at build
 * time, so `process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures'` folds to `true`
 * and everything after it, including the dynamic imports of the fixture world,
 * is provably unreachable and dropped. Hiding that comparison behind a function
 * defeats the analysis and ships the whole fixture world in a live build.
 */
export function fixturesDisabled(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export const FIXTURES_ENABLED = IS_FIXTURES

/** Deterministic per-route delay, so loading states are genuinely exercised. */
function latencyFor(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return 20 + ((h >>> 0) % 100)
}

export async function json<T>(key: string, data: T, status = 200): Promise<NextResponse> {
  await new Promise((r) => setTimeout(r, latencyFor(key)))
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Fixture-Server': FIXTURE_SENTINEL },
  })
}

export function num(v: string | null, fallback: number): number {
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function list(v: string | null): string[] {
  return v === null || v === '' ? [] : v.split(',').filter(Boolean)
}

/** Opaque cursor over (detected_at, id), the same shape the real API uses. */
export function encodeCursor(t: number, id: string): string {
  return Buffer.from(`${t}:${id}`).toString('base64url')
}

export function decodeCursor(cursor: string | null): { t: number; id: string } | null {
  if (!cursor) return null
  try {
    const [t, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(':')
    if (t === undefined || id === undefined) return null
    return { t: Number(t), id }
  } catch {
    return null
  }
}
