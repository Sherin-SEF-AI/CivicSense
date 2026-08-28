import 'server-only'
import type { AnalyticsOverview, Domain, PriorityBand } from '@/lib/api/schemas'
import { DOMAINS, PRIORITY_BANDS } from '@/lib/api/schemas/common'
import { all, get } from '@/lib/db'

/**
 * Analytics computed from the rows that exist.
 *
 * Every number here is an aggregate over real incidents, real actions and real
 * model calls. A department with no incidents shows zeroes rather than a
 * plausible-looking rate, because a plausible-looking rate is the thing that
 * makes a dashboard untrustworthy.
 */

const HOUR_BUCKETS: [string, number, number][] = [
  ['00-06', 0, 6],
  ['06-10', 6, 10],
  ['10-16', 10, 16],
  ['16-20', 16, 20],
  ['20-24', 20, 24],
]

const IST_OFFSET_MS = 5.5 * 3600_000

export function buildAnalytics(): AnalyticsOverview {
  const now = Date.now()
  const weekAgo = now - 7 * 86400_000

  const departments = all<{ department: string; label: string }>('SELECT department, label FROM departments ORDER BY label').map(
    (dept) => {
      const open =
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM incidents WHERE department = ? AND status NOT IN ('resolved','verified') AND dismissed_reason IS NULL`,
          [dept.department],
        )?.c ?? 0
      const closed =
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM incidents WHERE department = ? AND status IN ('resolved','verified') AND updated_at > ?`,
          [dept.department, weekAgo],
        )?.c ?? 0
      const verified =
        get<{ c: number }>(`SELECT COUNT(*) AS c FROM incidents WHERE department = ? AND status = 'verified' AND updated_at > ?`, [
          dept.department,
          weekAgo,
        ])?.c ?? 0
      const reopened =
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM incident_actions WHERE action = 'reopen' AND t > ?
             AND incident_id IN (SELECT incident_id FROM incidents WHERE department = ?)`,
          [weekAgo, dept.department],
        )?.c ?? 0

      /* SLA compliance is measured against the acknowledgement action, which is
         a real row, not against a self-reported status. */
      const withSla = all<{ incident_id: string; sla_due_at: number | null; priority: string }>(
        `SELECT incident_id, sla_due_at, priority FROM incidents WHERE department = ? AND sla_due_at IS NOT NULL AND detected_at > ?`,
        [dept.department, weekAgo],
      )
      let met = 0
      const responseByBand = new Map<string, number[]>()
      for (const incident of withSla) {
        const ack = get<{ t: number }>(
          `SELECT MIN(t) AS t FROM incident_actions WHERE incident_id = ? AND action IN ('ack','dispatch')`,
          [incident.incident_id],
        )
        if (ack?.t && incident.sla_due_at && ack.t <= incident.sla_due_at) met++
        if (ack?.t) {
          const detected = get<{ detected_at: number }>('SELECT detected_at FROM incidents WHERE incident_id = ?', [
            incident.incident_id,
          ])
          if (detected) {
            const list = responseByBand.get(incident.priority) ?? []
            list.push((ack.t - detected.detected_at) / 1000)
            responseByBand.set(incident.priority, list)
          }
        }
      }

      const median = Object.fromEntries(
        PRIORITY_BANDS.map((band) => {
          const values = (responseByBand.get(band) ?? []).sort((a, b) => a - b)
          return [band, values.length === 0 ? 0 : Math.round(values[Math.floor(values.length / 2)]!)]
        }),
      ) as Record<PriorityBand, number>

      return {
        department: dept.department,
        label: dept.label,
        verified_closure_rate: closed === 0 ? 0 : Math.round((verified / closed) * 100) / 100,
        sla_compliance: withSla.length === 0 ? 0 : Math.round((met / withSla.length) * 100) / 100,
        median_response_s: median,
        open,
        closed_7d: closed,
        reopened_7d: reopened,
      }
    },
  )

  /* Hourly series over the last week, from the incident table. */
  const hours = 168
  const incidentsPerHour: [number, number][] = []
  const closuresPerHour: [number, number][] = []
  for (let i = hours; i >= 0; i--) {
    const from = now - i * 3600_000
    const to = from + 3600_000
    incidentsPerHour.push([
      from,
      get<{ c: number }>('SELECT COUNT(*) AS c FROM incidents WHERE detected_at >= ? AND detected_at < ?', [from, to])?.c ?? 0,
    ])
    closuresPerHour.push([
      from,
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM incidents WHERE status = 'verified' AND updated_at >= ? AND updated_at < ?`,
        [from, to],
      )?.c ?? 0,
    ])
  }

  const latencyPerHour: [number, number][] = []
  for (let i = hours; i >= 0; i--) {
    const from = now - i * 3600_000
    const to = from + 3600_000
    const row = get<{ p: number | null }>(
      'SELECT MAX(latency_ms) AS p FROM model_calls WHERE t >= ? AND t < ? AND ok = 1',
      [from, to],
    )
    latencyPerHour.push([from, row?.p ? Math.round(row.p / 100) / 10 : 0])
  }

  const dismissedPerHour: [number, number][] = []
  for (let i = hours; i >= 0; i--) {
    const from = now - i * 3600_000
    const to = from + 3600_000
    const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM incidents WHERE detected_at >= ? AND detected_at < ?', [from, to])?.c ?? 0
    const dismissed =
      get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM incidents WHERE dismissed_reason IS NOT NULL AND detected_at >= ? AND detected_at < ?',
        [from, to],
      )?.c ?? 0
    dismissedPerHour.push([from, total === 0 ? 0 : Math.round((dismissed / total) * 1000) / 10])
  }

  const trends = [
    { key: 'incidents', label: 'incidents per hour', unit: 'n', points: incidentsPerHour },
    { key: 'verified_closures', label: 'verified closures per hour', unit: 'n', points: closuresPerHour },
    { key: 'model_latency_p95', label: 'model latency, worst per hour', unit: 's', points: latencyPerHour },
    { key: 'dismissal_rate', label: 'dismissal rate', unit: '%', points: dismissedPerHour },
  ]

  /* Bias audit: disposition rates across zone kind and hour of day. */
  const zoneKinds = all<{ kind: string }>('SELECT DISTINCT kind FROM zones ORDER BY kind').map((r) => r.kind)
  const bias = zoneKinds.flatMap((kind) =>
    HOUR_BUCKETS.map(([bucket, fromHour, toHour]) => {
      const rows = all<{ dismissed: string | null; department: string | null; detected_at: number }>(
        `SELECT i.dismissed_reason AS dismissed, i.department, i.detected_at FROM incidents i
         JOIN zones z ON z.zone_id = i.zone_id WHERE z.kind = ?`,
        [kind],
      ).filter((r) => {
        const hour = ((r.detected_at + IST_OFFSET_MS) % 86400_000) / 3600_000
        return hour >= fromHour && hour < toHour
      })
      const sample = rows.length
      const enforcement = rows.filter((r) => r.department !== null && r.dismissed === null).length
      const enforcementRate = sample === 0 ? 0 : Math.round((enforcement / sample) * 100) / 100
      const educationalRate = sample === 0 ? 0 : Math.round(((sample - enforcement) / sample) * 100) / 100
      const disparity = Math.round((enforcementRate - 0.5) * 100) / 100
      return {
        zone_kind: kind,
        hour_bucket: bucket,
        enforcement_rate: enforcementRate,
        educational_rate: educationalRate,
        sample,
        disparity,
        /* A flag needs enough observations to mean anything. */
        flagged: sample >= 20 && Math.abs(disparity) > 0.25,
      }
    }),
  )

  const byRole = all<{
    role: string
    model: string
    calls: number
    cost: number
    fallbacks: number
    p95: number
  }>(
    `SELECT role, model, COUNT(*) AS calls, SUM(cost_usd) AS cost,
            SUM(CASE WHEN fallback_from IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks,
            MAX(latency_ms) AS p95
     FROM model_calls GROUP BY role, model ORDER BY cost DESC`,
  ).map((r) => ({
    role: r.role,
    model: r.model,
    calls: r.calls,
    cost_usd: Math.round((r.cost ?? 0) * 10000) / 10000,
    cache_hit_rate: 0,
    fallbacks: r.fallbacks,
    p95_latency_ms: r.p95 ?? 0,
  }))

  const spendSeries: [number, number][] = []
  for (let i = 29; i >= 0; i--) {
    const from = now - i * 86400_000
    const to = from + 86400_000
    const row = get<{ total: number | null }>('SELECT SUM(cost_usd) AS total FROM model_calls WHERE t >= ? AND t < ?', [from, to])
    spendSeries.push([from, Math.round((row?.total ?? 0) * 10000) / 10000])
  }

  const byDomain = DOMAINS.map((domain) => ({
    domain: domain as Domain,
    count: get<{ c: number }>('SELECT COUNT(*) AS c FROM incidents WHERE domain = ?', [domain])?.c ?? 0,
    verified: get<{ c: number }>(`SELECT COUNT(*) AS c FROM incidents WHERE domain = ? AND status = 'verified'`, [domain])?.c ?? 0,
  }))

  return {
    departments,
    trends,
    bias,
    model_ops: { by_role: byRole, batch_jobs: [], spend_series: spendSeries },
    by_domain: byDomain,
  }
}

export function spendToday(): { today_usd: number; month_usd: number } {
  const now = Date.now()
  const dayStart = now - (now % 86400_000)
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime()
  return {
    today_usd: Math.round((get<{ t: number | null }>('SELECT SUM(cost_usd) AS t FROM model_calls WHERE t >= ?', [dayStart])?.t ?? 0) * 10000) / 10000,
    month_usd: Math.round((get<{ t: number | null }>('SELECT SUM(cost_usd) AS t FROM model_calls WHERE t >= ?', [monthStart])?.t ?? 0) * 10000) / 10000,
  }
}
