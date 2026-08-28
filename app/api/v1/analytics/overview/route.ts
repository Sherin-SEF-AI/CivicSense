import { guard, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = guard()
  if (blocked) return blocked
  const { getWorld } = await import('@/lib/fixtures/world')
  const { buildAnalytics } = await import('@/lib/fixtures/analytics')
  const w = getWorld()
  return json('analytics', buildAnalytics(w.seed, Date.now(), w.incidents))
}
