import { json } from '../../_lib/handler'
import type { RoleHealth, SystemHealth } from '@/lib/api/schemas'
import { all, get } from '@/lib/db'
import { isConfigured, ROLES } from '@/lib/groq/client'
import { countsByBand } from '@/lib/store/incidents'
import { spendToday } from '@/lib/store/analytics'
import { bus } from '@/lib/events/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE_LABELS: Record<string, string> = {
  scene: 'scene understanding',
  context: 'context assessment',
  forensic: 'forensic narrative',
  guard: 'policy audit',
  audio: 'transcription',
}

/**
 * System health, measured rather than asserted.
 *
 * Role health comes from the outcome of the calls that have actually been made
 * in the last hour. A role with no traffic is amber and says so, because "no
 * data" is not "healthy" and an operator should be able to tell the difference.
 */
export async function GET() {
  const now = Date.now()
  const hourAgo = now - 3600_000

  const roles: RoleHealth[] = (['scene', 'context', 'forensic', 'guard', 'audio'] as const).map((role) => {
    const stats = get<{ calls: number; failures: number; p95: number | null; fallbacks: number }>(
      `SELECT COUNT(*) AS calls,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
              MAX(latency_ms) AS p95,
              SUM(CASE WHEN fallback_from IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks
       FROM model_calls WHERE role = ? AND t > ?`,
      [role, hourAgo],
    )
    const calls = stats?.calls ?? 0
    const failures = stats?.failures ?? 0
    const errorRate = calls === 0 ? 0 : failures / calls

    const state: RoleHealth['state'] = !isConfigured()
      ? 'red'
      : calls === 0
        ? 'amber'
        : errorRate > 0.2
          ? 'red'
          : errorRate > 0.05
            ? 'amber'
            : 'green'

    return {
      role,
      label: ROLE_LABELS[role] ?? role,
      state,
      model: ROLES[role].primary,
      fallback_active: (stats?.fallbacks ?? 0) > 0,
      p95_latency_ms: stats?.p95 ?? 0,
      error_rate: Math.round(errorRate * 1000) / 1000,
      circuit: errorRate > 0.5 ? 'open' : errorRate > 0.2 ? 'half-open' : 'closed',
    }
  })

  const sources = all<{ state: string; c: number }>('SELECT state, COUNT(*) AS c FROM sources GROUP BY state')
  const total = sources.reduce((s, r) => s + r.c, 0)
  const up = sources.find((r) => r.state === 'up')?.c ?? 0
  const degraded = sources.find((r) => r.state === 'degraded')?.c ?? 0

  const spend = spendToday()
  const budget = get<{ daily_usd: number; monthly_usd: number }>(
    "SELECT daily_usd, monthly_usd FROM budgets WHERE scope = 'tenant' LIMIT 1",
  )

  const eventsPerMin =
    get<{ c: number }>('SELECT COUNT(*) AS c FROM observations WHERE received_at > ?', [now - 60_000])?.c ?? 0

  const health: SystemHealth = {
    t: now,
    roles,
    edge: { up, total, degraded },
    spend: {
      today_usd: spend.today_usd,
      budget_usd: budget?.daily_usd ?? 0,
      month_usd: spend.month_usd,
      month_budget_usd: budget?.monthly_usd ?? 0,
      degradation_active: budget ? spend.today_usd > budget.daily_usd * 0.9 : false,
    },
    incident_counts: countsByBand(),
    stream: { clients: bus().clientCount, events_per_min: eventsPerMin },
  }
  return json(health)
}
