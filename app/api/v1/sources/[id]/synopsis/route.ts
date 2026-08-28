import type { NextRequest } from 'next/server'
import { json, notFound } from '../../../_lib/handler'
import { all, get } from '@/lib/db'
import { getSourceRow } from '@/lib/store/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Video synopsis for one source.
 *
 * A long recording is mostly nothing happening. This returns only the moments
 * the device actually recorded something, in order, so six hours of coverage
 * can be reviewed as the forty seconds that had content in them.
 *
 * It is a condensation, not a re-timed overlay: every moment keeps its real
 * timestamp and nothing from two different times is shown together. An operator
 * reviewing this is looking at the record, in order, with the empty parts
 * skipped, and the response says exactly how much was skipped.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getSourceRow(id)) return notFound('source', id)

  const url = new URL(req.url)
  const to = Number(url.searchParams.get('to') ?? Date.now())
  const from = Number(url.searchParams.get('from') ?? to - 6 * 3600_000)

  const rows = all<{
    observation_id: string
    t_start: number
    t_end: number
    payload_kind: string
    content_ref: string | null
    derived: string | null
    incident_id: string | null
    duration_ms: number | null
  }>(
    `SELECT o.observation_id, o.t_start, o.t_end, o.payload_kind, o.content_ref, o.derived,
            o.incident_id, e.duration_ms
     FROM observations o LEFT JOIN evidence e ON e.sha256 = o.content_ref
     WHERE o.source_id = ? AND o.t_start BETWEEN ? AND ?
     ORDER BY o.t_start ASC`,
    [id, from, to],
  )

  /* A keyframe stands for a moment, so it is given the dwell an operator needs
     to see it rather than counted as zero duration. */
  const KEYFRAME_DWELL_MS = 600

  let covered = 0
  const moments = rows.map((row) => {
    const duration = row.duration_ms ?? Math.max(KEYFRAME_DWELL_MS, row.t_end - row.t_start)
    covered += duration
    const derived = row.derived
      ? (JSON.parse(row.derived) as { classes?: string[]; trigger?: string | null })
      : { classes: [], trigger: null }
    return {
      observation_id: row.observation_id,
      t: row.t_start,
      duration_ms: duration,
      payload_kind: row.payload_kind,
      classes: derived.classes ?? [],
      trigger: derived.trigger ?? null,
      incident_id: row.incident_id,
      evidence_id: row.content_ref,
      media_url: row.content_ref ? `/api/v1/evidence/${row.content_ref}/content` : null,
    }
  })

  const span = Math.max(1, to - from)
  const health = get<{ uptime: number }>(
    'SELECT AVG(uptime) AS uptime FROM source_health WHERE source_id = ? AND t BETWEEN ? AND ?',
    [id, from, to],
  )

  return json({
    source_id: id,
    window: [from, to],
    moments,
    covered_ms: covered,
    /* How much shorter the review is than the window it covers. */
    compression: Math.round((span / Math.max(1, covered)) * 10) / 10,
    /* Without this the compression figure would flatter a device that was down:
       nothing recorded also condenses very well. */
    uptime: health?.uptime === null || health?.uptime === undefined ? null : Math.round(health.uptime * 100) / 100,
  })
}
