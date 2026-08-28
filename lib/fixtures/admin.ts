import 'server-only'
import type { AuditEntry, Budget, Department, Playbook, PriorityBand, User } from '@/lib/api/schemas'
import { PRIORITY_BANDS } from '@/lib/api/schemas/common'
import { DEPARTMENTS } from './catalog'
import { ZONE_SEEDS } from '@/lib/geo/bengaluru'
import { SLA_SECONDS } from './incidents'
import { chance, hex, intRange, mulberry32, pick, range, subSeed } from './rng'

const CONTACT_NAMES = [
  'control room',
  'zonal officer',
  'shift supervisor',
  'duty inspector',
  'ward engineer',
]

const DOMAIN_OWNERSHIP: Record<string, Department['domains']> = {
  'traffic-police': ['traffic', 'vehicle'],
  'city-police': ['safety', 'nuisance'],
  sanitation: ['waste'],
  pwd: ['infrastructure'],
  bescom: ['infrastructure'],
  'pollution-control': ['environment'],
  'disaster-cell': ['disaster'],
  'fire-services': ['disaster'],
  'emergency-112': ['safety'],
  'animal-control': ['safety'],
  'bbmp-forest': ['disaster'],
  'transport-dept': ['vehicle'],
}

export function buildAdmin({ seed, now }: { seed: number; now: number }) {
  const departments: Department[] = DEPARTMENTS.map((d, i) => {
    const rnd = mulberry32(subSeed(seed, 'department', i))
    const sla = Object.fromEntries(
      PRIORITY_BANDS.map((b) => [b, Math.round(SLA_SECONDS[b] * range(rnd, 0.8, 1.4))]),
    ) as Record<PriorityBand, number>
    return {
      department: d.department,
      label: d.label,
      domains: DOMAIN_OWNERSHIP[d.department] ?? ['traffic'],
      contacts: Array.from({ length: intRange(rnd, 1, 3) }, (_, k) => ({
        name: `${d.label} ${CONTACT_NAMES[k % CONTACT_NAMES.length]}`,
        role: pick(rnd, ['primary', 'escalation', 'night shift']),
        channel: pick(rnd, ['whatsapp', 'sms', 'email', 'cad']),
        target: `+91 80 ${intRange(rnd, 2000, 4999)} ${intRange(rnd, 1000, 9999)}`,
      })),
      sla_seconds: sla,
      escalation_to: i % 3 === 0 ? 'city-police' : null,
    }
  })

  const playbooks: Playbook[] = [
    {
      playbook_id: 'PB-001',
      name: 'life-safety dispatch then enrich',
      domain: 'safety',
      min_priority: 'CRITICAL',
      version: 4,
      updated_at: now - 9 * 86400_000,
      steps: [
        { step_id: 's1', text: 'pre-alert 112 and the nearest patrol with location and camera link', owner: 'system', timer_s: 3, automatic: true, approval_gate: false },
        { step_id: 's2', text: 'attach the scene brief when the understanding pass returns', owner: 'system', timer_s: 15, automatic: true, approval_gate: false },
        { step_id: 's3', text: 'request corridor pre-clearing from the traffic management system', owner: 'traffic-police', timer_s: 60, automatic: true, approval_gate: false },
        { step_id: 's4', text: 'confirm ambulance assignment and ETA', owner: 'emergency-112', timer_s: 120, automatic: false, approval_gate: false },
        { step_id: 's5', text: 'attach bodycam arrival evidence and close the SLA', owner: 'city-police', timer_s: null, automatic: true, approval_gate: false },
      ],
    },
    {
      playbook_id: 'PB-002',
      name: 'waste dumping with route failure',
      domain: 'waste',
      min_priority: 'MEDIUM',
      version: 7,
      updated_at: now - 21 * 86400_000,
      steps: [
        { step_id: 's1', text: 'raise the operations brief for the missed collection', owner: 'sanitation', timer_s: 900, automatic: true, approval_gate: false },
        { step_id: 's2', text: 'raise the enforcement brief with the vehicle evidence', owner: 'traffic-police', timer_s: 900, automatic: false, approval_gate: true },
        { step_id: 's3', text: 'verify clearance with the nearest camera after reported resolution', owner: 'system', timer_s: 7200, automatic: true, approval_gate: false },
      ],
    },
    {
      playbook_id: 'PB-003',
      name: 'proportionate response for minor nuisance',
      domain: 'nuisance',
      min_priority: 'LOW',
      version: 3,
      updated_at: now - 40 * 86400_000,
      steps: [
        { step_id: 's1', text: 'check repeat history for the location over 30 days', owner: 'system', timer_s: 60, automatic: true, approval_gate: false },
        { step_id: 's2', text: 'if first observation in a low-risk context, issue the educational disposition', owner: 'system', timer_s: 120, automatic: true, approval_gate: false },
        { step_id: 's3', text: 'if the pattern repeats, raise an infrastructure request instead of enforcement', owner: 'sanitation', timer_s: 3600, automatic: false, approval_gate: true },
      ],
    },
    {
      playbook_id: 'PB-004',
      name: 'water logging pre-positioning',
      domain: 'disaster',
      min_priority: 'HIGH',
      version: 2,
      updated_at: now - 5 * 86400_000,
      steps: [
        { step_id: 's1', text: 'confirm water level sensor and camera water class agree', owner: 'system', timer_s: 30, automatic: true, approval_gate: false },
        { step_id: 's2', text: 'pre-position the pump crew and the tanker', owner: 'disaster-cell', timer_s: 600, automatic: false, approval_gate: true },
        { step_id: 's3', text: 'publish the depth estimate with its reference object and uncertainty', owner: 'system', timer_s: 300, automatic: true, approval_gate: false },
      ],
    },
  ]

  const budgets: Budget[] = [
    ...ZONE_SEEDS.slice(0, 8).map((z, i) => {
      const rnd = mulberry32(subSeed(seed, 'budget', i))
      const daily = Math.round(range(rnd, 0.6, 2.4) * 100) / 100
      const spent = Math.round(daily * range(rnd, 0.2, 1.05) * 100) / 100
      return {
        scope: 'zone' as const,
        key: z.id,
        label: z.label,
        daily_usd: daily,
        spent_today_usd: spent,
        monthly_usd: Math.round(daily * 30 * 100) / 100,
        spent_month_usd: Math.round(daily * range(rnd, 12, 26) * 100) / 100,
        degradation:
          spent > daily ? ('lower-effort' as const) : spent > daily * 0.85 ? ('fewer-images' as const) : ('none' as const),
      }
    }),
    {
      scope: 'tenant',
      key: 'bbmp-pilot',
      label: 'BBMP pilot tenant',
      daily_usd: 12,
      spent_today_usd: 6.4,
      monthly_usd: 400,
      spent_month_usd: 231.8,
      degradation: 'none',
    },
  ]

  const users: User[] = [
    { user_id: 'U-001', name: 'S. Srambickal', email: 'sherin.srambickal@gmail.com', role: 'admin', department: null, investigation_flag: true, last_active: now - 40_000 },
    { user_id: 'U-002', name: 'insp. Ramesh K', email: 'ramesh.k@ksp.gov.in', role: 'investigator', department: 'city-police', investigation_flag: true, last_active: now - 12 * 60_000 },
    { user_id: 'U-003', name: 'ctrl. Nandini R', email: 'nandini.r@bbmp.gov.in', role: 'operator', department: null, investigation_flag: false, last_active: now - 90_000 },
    { user_id: 'U-004', name: 'engr. Vijay S', email: 'vijay.s@bbmp.gov.in', role: 'department', department: 'pwd', investigation_flag: false, last_active: now - 5 * 3600_000 },
    { user_id: 'U-005', name: 'supr. Fatima A', email: 'fatima.a@bbmp.gov.in', role: 'department', department: 'sanitation', investigation_flag: false, last_active: now - 2 * 3600_000 },
    { user_id: 'U-006', name: 'analyst D. Nair', email: 'd.nair@deepmost.ai', role: 'investigator', department: null, investigation_flag: false, last_active: now - 26 * 60_000 },
  ]

  const AUDIT_ACTIONS = [
    ['package.dispatched', 'incident'],
    ['evidence.accessed', 'evidence'],
    ['case.legal_hold_set', 'case'],
    ['bundle.exported', 'case'],
    ['threshold.changed', 'zone'],
    ['user.role_changed', 'user'],
    ['model.fallback', 'role'],
    ['budget.degradation', 'zone'],
    ['investigation.flag_set', 'case'],
  ] as const

  const audit: AuditEntry[] = []
  let prev = '0'.repeat(64)
  for (let i = 0; i < 240; i++) {
    const rnd = mulberry32(subSeed(seed, 'audit', i))
    const [action, subjectKind] = pick(rnd, AUDIT_ACTIONS)
    const h = hex(rnd, 64)
    audit.push({
      seq: i + 1,
      t: now - (240 - i) * intRange(rnd, 30, 900) * 1000,
      actor: pick(rnd, users).name,
      action,
      subject: `${subjectKind}:${hex(rnd, 8)}`,
      detail: chance(rnd, 0.5) ? 'automatic stage transition' : 'operator action from the console',
      hash: h,
      prev_hash: prev,
    })
    prev = h
  }
  audit.reverse()

  return { departments, playbooks, budgets, users, audit }
}
