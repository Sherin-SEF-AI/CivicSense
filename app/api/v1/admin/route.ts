import { json } from '../_lib/handler'
import { all, verifyAuditChain } from '@/lib/db'
import { spendToday } from '@/lib/store/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const departments = all<{
    department: string
    label: string
    domains: string
    contacts: string
    sla_seconds: string
    escalation_to: string | null
  }>('SELECT * FROM departments ORDER BY label').map((d) => ({
    department: d.department,
    label: d.label,
    domains: JSON.parse(d.domains) as string[],
    contacts: JSON.parse(d.contacts) as unknown[],
    sla_seconds: JSON.parse(d.sla_seconds) as Record<string, number>,
    escalation_to: d.escalation_to,
  }))

  const playbooks = all<{
    playbook_id: string
    name: string
    domain: string
    min_priority: string
    version: number
    updated_at: number
    steps: string
  }>('SELECT * FROM playbooks ORDER BY name').map((p) => ({ ...p, steps: JSON.parse(p.steps) as unknown[] }))

  const spend = spendToday()
  const budgets = all<{ scope: string; key: string; label: string; daily_usd: number; monthly_usd: number }>(
    'SELECT * FROM budgets',
  ).map((b) => ({
    ...b,
    spent_today_usd: b.scope === 'tenant' ? spend.today_usd : 0,
    spent_month_usd: b.scope === 'tenant' ? spend.month_usd : 0,
    degradation:
      spend.today_usd > b.daily_usd
        ? ('lower-effort' as const)
        : spend.today_usd > b.daily_usd * 0.85
          ? ('fewer-images' as const)
          : ('none' as const),
  }))

  const users = all<{
    user_id: string
    name: string
    email: string
    role: string
    department: string | null
    investigation_flag: number
    last_active: number
  }>('SELECT * FROM users ORDER BY name').map((u) => ({ ...u, investigation_flag: u.investigation_flag === 1 }))

  const audit = all<{
    seq: number
    t: number
    actor: string
    action: string
    subject: string
    detail: string
    hash: string
    prev_hash: string
  }>('SELECT * FROM audit ORDER BY seq DESC LIMIT 500')

  return json({ departments, playbooks, budgets, users, audit, audit_chain: verifyAuditChain() })
}
