import 'server-only'
import { NextResponse } from 'next/server'
import { get } from '@/lib/db'
import type { Session } from '@/lib/api/schemas'

/**
 * Shared plumbing for the API.
 *
 * These routes are the platform's own backend: they read and write the store,
 * and there is no second mode. Authentication is a header carrying the user id,
 * which is what an identity proxy in front of this service would set.
 */

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function notFound(what: string, id?: string): NextResponse {
  return json({ error: 'not_found', what, id: id ?? null }, 404)
}

export function badRequest(error: string, detail?: string): NextResponse {
  return json({ error, detail: detail ?? null }, 400)
}

export function forbidden(capability: string): NextResponse {
  return json({ error: 'forbidden', capability }, 403)
}

export function num(v: string | null, fallback: number): number {
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function list(v: string | null): string[] {
  return v === null || v === '' ? [] : v.split(',').filter(Boolean)
}

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

const CAPABILITIES_BY_ROLE: Record<string, Session['capabilities']> = {
  admin: [
    'incident.acknowledge', 'incident.dispatch', 'incident.escalate', 'incident.dismiss',
    'evidence.search', 'evidence.person_search', 'case.create', 'case.legal_hold',
    'case.disclose', 'forensics.pull', 'forensics.reanalyse', 'admin.configure', 'analytics.bias_audit',
  ],
  investigator: [
    'incident.acknowledge', 'incident.dispatch', 'incident.escalate', 'evidence.search',
    'evidence.person_search', 'case.create', 'case.legal_hold', 'case.disclose',
    'forensics.pull', 'forensics.reanalyse', 'analytics.bias_audit',
  ],
  operator: [
    'incident.acknowledge', 'incident.dispatch', 'incident.escalate', 'incident.dismiss',
    'evidence.search', 'case.create', 'forensics.pull',
  ],
  /* A department user works their own queue and nothing else. */
  department: ['incident.acknowledge', 'incident.dispatch'],
}

interface UserRow {
  user_id: string
  name: string
  email: string
  role: string
  department: string | null
  investigation_flag: number
}

/**
 * The caller.
 *
 * X-User-Id is what an identity proxy sets after authenticating. When it is
 * absent the single bootstrapped administrator is used, which is the correct
 * behaviour for a deployment that has not been put behind a proxy yet.
 */
export function session(req: Request): Session {
  const requested = req.headers.get('x-user-id')
  const row =
    (requested ? get<UserRow>('SELECT * FROM users WHERE user_id = ?', [requested]) : undefined) ??
    get<UserRow>('SELECT * FROM users ORDER BY user_id ASC LIMIT 1')

  if (!row) {
    return {
      user_id: 'anonymous',
      name: 'anonymous',
      email: '',
      role: 'operator',
      department: null,
      department_label: null,
      domains: [],
      capabilities: [],
      investigation_flag: false,
    }
  }

  const department = row.department
    ? get<{ label: string; domains: string }>('SELECT label, domains FROM departments WHERE department = ?', [row.department])
    : undefined

  return {
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role as Session['role'],
    department: row.department,
    department_label: department?.label ?? null,
    domains: department ? (JSON.parse(department.domains) as Session['domains']) : [],
    capabilities: CAPABILITIES_BY_ROLE[row.role] ?? [],
    investigation_flag: row.investigation_flag === 1,
  }
}

export function requires(s: Session, capability: Session['capabilities'][number]): NextResponse | null {
  return s.capabilities.includes(capability) ? null : forbidden(capability)
}
