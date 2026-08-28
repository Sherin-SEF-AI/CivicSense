import 'server-only'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Schema migrations.
 *
 * The schema used to be one file applied with CREATE TABLE IF NOT EXISTS on every
 * open, which silently cannot add a column: an existing database kept its old
 * shape and the only remedy was deleting the file. That is fine for a project
 * with no data and unacceptable for one holding evidence.
 *
 * Migrations are ordered files applied once each, inside a transaction, with the
 * checksum of what was applied recorded. If a migration file changes after it
 * has been applied, opening the database is a hard failure rather than a
 * warning, because the schema on disk no longer matches the schema in the
 * repository and every assumption downstream of that is void.
 */

export interface Migration {
  version: number
  name: string
  sql: string
  checksum: string
}

const DIR = join(process.cwd(), 'lib', 'db', 'migrations')

export function loadMigrations(dir = DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const seen = new Set<number>()
  return files.map((file) => {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file)
    if (!match) throw new Error(`migration filename is not NNNN_name.sql: ${file}`)
    const version = Number(match[1])
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`)
    seen.add(version)
    const sql = readFileSync(join(dir, file), 'utf8')
    return { version, name: match[2]!, sql, checksum: createHash('sha256').update(sql).digest('hex') }
  })
}

export function applyMigrations(connection: Database.Database, dir = DIR): { applied: number[]; at: number } {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum   TEXT NOT NULL
    );
  `)

  const migrations = loadMigrations(dir)
  const done = new Map(
    (connection.prepare('SELECT version, name, checksum FROM schema_migrations').all() as {
      version: number
      name: string
      checksum: string
    }[]).map((r) => [r.version, r]),
  )

  /* An applied migration whose file has changed means the database and the
     repository disagree about the schema. Refuse rather than guess. */
  for (const migration of migrations) {
    const record = done.get(migration.version)
    if (record && record.checksum !== migration.checksum) {
      throw new Error(
        `migration ${String(migration.version).padStart(4, '0')}_${migration.name} was applied with a different checksum. ` +
          `the file has changed since it ran. write a new migration instead of editing an applied one.`,
      )
    }
  }

  const applied: number[] = []
  const at = Date.now()
  const insert = connection.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
  )

  for (const migration of migrations) {
    if (done.has(migration.version)) continue
    connection.transaction(() => {
      connection.exec(migration.sql)
      insert.run(migration.version, migration.name, at, migration.checksum)
    })()
    applied.push(migration.version)
  }

  return { applied, at }
}
