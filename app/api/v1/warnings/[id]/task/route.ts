import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { badRequest, json, session } from '../../../_lib/handler'
import { audit, run } from '@/lib/db'
import { listSources } from '@/lib/store/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tasks a unit against a warning.
 *
 * The nearest available patrol is chosen by straight-line distance from the
 * warning, and the tasking is a durable row: it is what the outcome measurement
 * later reads to work out whether the intervention changed anything.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = session(req)

  const body = (await req.json()) as {
    intervention_id?: string
    intervention_label?: string
    zone_label?: string
    department?: string
    lat?: number
    lon?: number
  }
  if (!body.intervention_label) return badRequest('intervention_label_required')

  const patrols = listSources({ types: ['patrol-car', 'patrol-bike'], states: ['up'] })
  let assigned: { source_id: string; label: string; distanceKm: number } | null = null
  if (body.lat !== undefined && body.lon !== undefined && patrols.length > 0) {
    for (const patrol of patrols) {
      const distanceKm =
        Math.hypot(patrol.position.lat - body.lat, patrol.position.lon - body.lon) * 111
      if (!assigned || distanceKm < assigned.distanceKm) {
        assigned = { source_id: patrol.source_id, label: patrol.label, distanceKm }
      }
    }
  }

  const taskingId = `TSK-${randomUUID().slice(0, 8).toUpperCase()}`
  const now = Date.now()
  run(
    `INSERT INTO taskings (tasking_id, warning_id, intervention_id, intervention_label, zone_label, department,
                           assigned_source_id, assigned_label, eta_minutes, created_at, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tasked')`,
    [
      taskingId,
      id,
      body.intervention_id ?? 'manual',
      body.intervention_label,
      body.zone_label ?? '',
      body.department ?? '',
      assigned?.source_id ?? null,
      assigned?.label ?? null,
      /* Thirty km/h through city traffic is the working assumption until the
         vehicle reports its own estimate. */
      assigned ? Math.round((assigned.distanceKm / 30) * 60) : null,
      now,
    ],
  )
  audit(user.name, 'intervention.tasked', `warning:${id}`, `${body.intervention_label}${assigned ? ` to ${assigned.label}` : ', no unit available'}`)

  return json(
    {
      tasking_id: taskingId,
      warning_id: id,
      intervention_id: body.intervention_id ?? 'manual',
      intervention_label: body.intervention_label,
      zone_label: body.zone_label ?? '',
      department: body.department ?? '',
      assigned_source_id: assigned?.source_id ?? null,
      assigned_label: assigned?.label ?? null,
      eta_minutes: assigned ? Math.round((assigned.distanceKm / 30) * 60) : null,
      created_at: now,
      state: 'tasked' as const,
    },
    201,
  )
}
