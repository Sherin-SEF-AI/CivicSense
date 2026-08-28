import 'server-only'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyMigrations } from './migrate'

/**
 * The store.
 *
 * One SQLite file, opened once per process and held on globalThis so a hot
 * reload does not reopen it. Write-ahead logging is on because the ingest path
 * writes while the console reads, and a reader must never block on an upload.
 *
 * There is no seeded content. The database starts empty and fills as real
 * sources are registered and real observations arrive.
 */

const DB_PATH = process.env.CIVICSENSE_DB ?? join(process.cwd(), 'data', 'civicsense.db')
export const EVIDENCE_DIR = process.env.CIVICSENSE_EVIDENCE ?? join(process.cwd(), 'data', 'evidence')

const KEY = '__civicsense_db__'

interface GlobalWithDb {
  [KEY]?: Database.Database
}

export function db(): Database.Database {
  const g = globalThis as GlobalWithDb
  if (g[KEY]) return g[KEY]

  mkdirSync(dirname(DB_PATH), { recursive: true })
  mkdirSync(EVIDENCE_DIR, { recursive: true })

  const connection = new Database(DB_PATH)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma('synchronous = NORMAL')

  applyMigrations(connection)

  g[KEY] = connection
  return connection
}

/** Typed row helpers. better-sqlite3 returns unknown, and unknown should not spread. */
export function all<T>(sql: string, params: unknown[] = []): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[]
}

export function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return db().prepare(sql).get(...(params as never[])) as T | undefined
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return db().prepare(sql).run(...(params as never[]))
}

export function tx<T>(fn: () => T): T {
  return db().transaction(fn)()
}

/**
 * Appends to the hash-chained audit log.
 *
 * Each entry hashes its own contents together with the previous entry's hash, so
 * a removed or altered row breaks the chain at that point and everything after
 * it fails to verify.
 */
export function audit(actor: string, action: string, subject: string, detail: string): void {
  const previous = get<{ hash: string }>('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')
  const prevHash = previous?.hash ?? '0'.repeat(64)
  const t = Date.now()
  const hash = createHash('sha256')
    .update(`${prevHash}|${t}|${actor}|${action}|${subject}|${detail}`)
    .digest('hex')
  run('INSERT INTO audit (t, actor, action, subject, detail, hash, prev_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    t,
    actor,
    action,
    subject,
    detail,
    hash,
    prevHash,
  ])
}

export function verifyAuditChain(): { valid: boolean; brokenAt: number | null; entries: number } {
  const rows = all<{ seq: number; t: number; actor: string; action: string; subject: string; detail: string; hash: string; prev_hash: string }>(
    'SELECT * FROM audit ORDER BY seq ASC',
  )
  let previous = '0'.repeat(64)
  for (const row of rows) {
    const expected = createHash('sha256')
      .update(`${previous}|${row.t}|${row.actor}|${row.action}|${row.subject}|${row.detail}`)
      .digest('hex')
    if (row.prev_hash !== previous || row.hash !== expected) {
      return { valid: false, brokenAt: row.seq, entries: rows.length }
    }
    previous = row.hash
  }
  return { valid: true, brokenAt: null, entries: rows.length }
}

/**
 * The seven actions a custody entry may record.
 *
 * Four of these were declared in the schema and never written by anything, which
 * meant a chain could show an object being accessed but never exported, derived
 * or placed under hold. Typing the parameter is what stops the set drifting
 * again.
 */
export type CustodyAction = 'capture' | 'ingest' | 'access' | 'export' | 'derive' | 'hold' | 'verify'

export interface CustodyRow {
  id: number
  sha256: string
  t: number
  actor: string
  role: string
  action: CustodyAction
  purpose: string
  hash_after: string
  prev_hash: string
}

/** Custody entries chain per evidence item, the same way the audit log does. */
export function appendCustody(
  sha256: string,
  actor: string,
  role: string,
  action: string,
  purpose: string,
): void {
  const previous = get<{ hash_after: string }>(
    'SELECT hash_after FROM custody WHERE sha256 = ? ORDER BY id DESC LIMIT 1',
    [sha256],
  )
  const prevHash = previous?.hash_after ?? sha256
  const t = Date.now()
  const hashAfter = createHash('sha256').update(`${prevHash}|${t}|${actor}|${action}|${purpose}`).digest('hex')
  run(
    'INSERT INTO custody (sha256, t, actor, role, action, purpose, hash_after, prev_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [sha256, t, actor, role, action, purpose, hashAfter, prevHash],
  )
}

/** The same append, with the action restricted to the declared set. */
export function appendCustodyTyped(
  sha256: string,
  actor: string,
  role: string,
  action: CustodyAction,
  purpose: string,
): void {
  appendCustody(sha256, actor, role, action, purpose)
}

export function custodyChain(sha256: string): CustodyRow[] {
  return all<CustodyRow>('SELECT * FROM custody WHERE sha256 = ? ORDER BY id ASC', [sha256])
}

/**
 * Recomputes a custody chain from its own contents.
 *
 * The seed is the evidence hash itself rather than zeros, which is what binds
 * the chain to the object it describes: a chain lifted from one item cannot be
 * replayed against another. Every entry is recomputed in order, so a removed,
 * reordered or edited row breaks verification at that entry and at everything
 * after it.
 *
 * Note that `role` is stored but is deliberately not part of the preimage, which
 * matches how the chain has been written since the first entry. Changing that
 * now would invalidate every existing chain.
 */
export function verifyCustodyChain(sha256: string): {
  valid: boolean
  brokenAt: number | null
  entries: number
  results: { id: number; ok: boolean }[]
} {
  const rows = custodyChain(sha256)
  let previous = sha256
  let brokenAt: number | null = null
  const results: { id: number; ok: boolean }[] = []

  for (const row of rows) {
    const expected = createHash('sha256')
      .update(`${previous}|${row.t}|${row.actor}|${row.action}|${row.purpose}`)
      .digest('hex')
    const ok = row.prev_hash === previous && row.hash_after === expected
    results.push({ id: row.id, ok })
    if (!ok && brokenAt === null) brokenAt = row.id
    previous = row.hash_after
  }

  return { valid: brokenAt === null, brokenAt, entries: rows.length, results }
}

export function setting(key: string, fallback: string): string {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? fallback
}

export function setSetting(key: string, value: string): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ])
}
