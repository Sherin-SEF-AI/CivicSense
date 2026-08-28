import { fixturesDisabled, json } from '../../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld } = await import('@/lib/fixtures/world')
  const { buildAnalytics } = await import('@/lib/fixtures/analytics')
  const w = getWorld()
  return json('analytics', buildAnalytics(w.seed, Date.now(), w.incidents))
}
