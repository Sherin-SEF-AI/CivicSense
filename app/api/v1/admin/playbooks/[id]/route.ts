import type { NextRequest } from 'next/server'
import { badRequest, json, notFound, requires, session } from '../../../_lib/handler'
import { audit, get, run } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Playbooks are versioned configuration: every edit bumps the version. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)
  const denied = requires(user, 'admin.configure')
  if (denied) return denied

  const existing = get<{ version: number }>('SELECT version FROM playbooks WHERE playbook_id = ?', [id])
  if (!existing) return notFound('playbook', id)

  const body = (await req.json()) as {
    name?: string
    min_priority?: string
    steps?: { step_id: string; text: string; owner: string; timer_s: number | null; automatic: boolean; approval_gate: boolean }[]
  }
  if (body.steps && !Array.isArray(body.steps)) return badRequest('steps_must_be_an_array')

  const now = Date.now()
  const version = existing.version + 1
  run(
    `UPDATE playbooks SET name = COALESCE(?, name), min_priority = COALESCE(?, min_priority),
       steps = COALESCE(?, steps), version = ?, updated_at = ? WHERE playbook_id = ?`,
    [body.name ?? null, body.min_priority ?? null, body.steps ? JSON.stringify(body.steps) : null, version, now, id],
  )
  audit(user.name, 'playbook.updated', `playbook:${id}`, `version ${version}`)

  const row = get<{
    playbook_id: string
    name: string
    domain: string
    min_priority: string
    version: number
    updated_at: number
    steps: string
  }>('SELECT * FROM playbooks WHERE playbook_id = ?', [id])!
  return json({ ...row, steps: JSON.parse(row.steps) as unknown[] })
}
