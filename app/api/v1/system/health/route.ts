import type { RoleHealth, SystemHealth } from '@/lib/api/schemas'
import { fixturesDisabled, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES: readonly (readonly [RoleHealth['role'], string, string])[] = [
  ['scene', 'scene understanding', 'qwen/qwen3.8-27b'],
  ['context', 'context assessment', 'openai/gpt-oss-120b'],
  ['forensic', 'forensic narrative', 'openai/gpt-oss-120b'],
  ['guard', 'policy audit', 'openai/gpt-oss-safeguard-20b'],
  ['audio', 'transcription', 'whisper-large-v3-turbo'],
]

export async function GET() {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld, countsByBand } = await import('@/lib/fixtures/world')
  const { getHub } = await import('@/lib/fixtures/hub')
  const w = getWorld()
  const now = Date.now()

  /* Health flaps slowly and deterministically off the clock, so the five-dot row
     in the status strip is not static but also does not flicker. */
  const roles: RoleHealth[] = ROLES.map(([role, label, model], i) => {
    const phase = Math.sin(now / (90_000 + i * 17_000) + i)
    const state = phase > 0.94 ? 'red' : phase > 0.72 ? 'amber' : 'green'
    return {
      role,
      label,
      state,
      model,
      fallback_active: state !== 'green' && i === 0,
      p95_latency_ms: Math.round(600 + Math.abs(phase) * 2600),
      error_rate: Math.round((state === 'red' ? 0.14 : state === 'amber' ? 0.04 : 0.006) * 1000) / 1000,
      circuit: state === 'red' ? 'half-open' : 'closed',
    }
  })

  const up = w.sources.filter((s) => s.state === 'up').length
  const degraded = w.sources.filter((s) => s.state === 'degraded').length

  const health: SystemHealth = {
    t: now,
    roles,
    edge: { up, total: w.sources.length, degraded },
    spend: {
      today_usd: w.spend.today_usd,
      budget_usd: w.spend.budget_usd,
      month_usd: w.spend.month_usd,
      month_budget_usd: w.spend.month_budget_usd,
      degradation_active: w.spend.today_usd > w.spend.budget_usd * 0.9,
    },
    incident_counts: countsByBand(w),
    stream: { clients: getHub().clientCount, events_per_min: 84 },
  }
  return json('system/health', health)
}
