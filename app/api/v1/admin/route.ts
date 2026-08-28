import { fixturesDisabled, json } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'fixtures') return fixturesDisabled()
  const { getWorld } = await import('@/lib/fixtures/world')
  const w = getWorld()
  return json('admin', {
    departments: w.departments,
    playbooks: w.playbooks,
    budgets: w.budgets,
    users: w.users,
    audit: w.audit,
  })
}
