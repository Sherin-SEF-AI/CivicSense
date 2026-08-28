import { guard, json } from '../_lib/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const blocked = guard()
  if (blocked) return blocked
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
