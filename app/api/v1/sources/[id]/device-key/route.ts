import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { all, audit, run } from '@/lib/db'
import { getSourceRow } from '@/lib/store/sources'
import { publicKeyFromRaw } from '@/lib/vault/signing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getSourceRow(id)) return notFound('source', id)
  return json({
    items: all(
      'SELECT key_id, public_key, algo, enrolled_at, enrolled_by, enrolment_method, revoked_at, revoked_reason FROM device_keys WHERE source_id = ? ORDER BY enrolled_at DESC',
      [id],
    ),
  })
}

/**
 * Enrols a capture key for a source.
 *
 * This is the moment the platform decides which key it will treat as that
 * device's. Without a hardware root of trust it is trust on first use, and that
 * is a real limit rather than a technicality: a verified signature afterwards
 * proves the object was signed by the key enrolled here, not that the device was
 * ever the only holder of it. The limitation travels with the record, into the
 * enrolment audit entry and into the section 63 certificate.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const source = getSourceRow(id)
  if (!source) return notFound('source', id)

  const body = (await req.json().catch(() => ({}))) as { public_key?: string; method?: string }
  if (!body.public_key) return badRequest('public_key_required', 'a base64 encoded 32 byte ed25519 public key')

  try {
    publicKeyFromRaw(body.public_key)
  } catch (error) {
    return badRequest('invalid_public_key', error instanceof Error ? error.message : String(error))
  }

  const keyId = `KEY-${randomUUID().slice(0, 8).toUpperCase()}`
  const method = body.method ?? 'operator-entered'
  run(
    'INSERT INTO device_keys (key_id, source_id, public_key, algo, enrolled_at, enrolled_by, enrolment_method) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [keyId, id, body.public_key, 'ed25519', Date.now(), user.name, method],
  )
  audit(
    user.name,
    'device_key.enrolled',
    `source:${id}`,
    `${keyId} by ${method}. trust on first use: this binds the key to the source, it does not prove exclusive possession.`,
  )

  return json({ key_id: keyId, source_id: id, enrolment_method: method, trust_model: 'trust-on-first-use' }, 201)
}

/** Revocation, so a compromised or replaced device stops verifying. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as { key_id?: string; reason?: string }
  if (!body.key_id) return badRequest('key_id_required')

  const result = run('UPDATE device_keys SET revoked_at = ?, revoked_reason = ? WHERE key_id = ? AND source_id = ?', [
    Date.now(),
    body.reason ?? 'no reason recorded',
    body.key_id,
    id,
  ])
  if (result.changes === 0) return notFound('device key', body.key_id)

  /* Objects signed before revocation keep their recorded verdict. Rewriting
     history to say they were never verified would be a different lie. */
  audit(user.name, 'device_key.revoked', `source:${id}`, `${body.key_id}: ${body.reason ?? 'no reason recorded'}`)
  return json({ key_id: body.key_id, revoked: true, note: 'objects verified before revocation keep their verdict' })
}
