import 'server-only'
import type { AnalyticsOverview, Domain, IncidentSummary, PriorityBand } from '@/lib/api/schemas'
import { PRIORITY_BANDS } from '@/lib/api/schemas/common'
import { DEPARTMENTS } from './catalog'
import { chance, intRange, mulberry32, range, subSeed } from './rng'
import { ZONE_SEEDS } from '@/lib/geo/bengaluru'

const DOMAINS: readonly Domain[] = [
  'traffic',
  'waste',
  'safety',
  'nuisance',
  'infrastructure',
  'environment',
  'vehicle',
  'disaster',
]

const HOUR_BUCKETS = ['00-06', '06-10', '10-16', '16-20', '20-24']

export function buildAnalytics(seed: number, now: number, incidents: IncidentSummary[]): AnalyticsOverview {
  const departments = DEPARTMENTS.map((d, i) => {
    const rnd = mulberry32(subSeed(seed, 'perf', i))
    const median = Object.fromEntries(
      PRIORITY_BANDS.map((b) => [
        b,
        Math.round(
          (b === 'CRITICAL' ? range(rnd, 90, 280) : b === 'HIGH' ? range(rnd, 400, 1500) : range(rnd, 1800, 20000)),
        ),
      ]),
    ) as Record<PriorityBand, number>
    return {
      department: d.department,
      label: d.label,
      verified_closure_rate: Math.round(range(rnd, 0.52, 0.96) * 100) / 100,
      sla_compliance: Math.round(range(rnd, 0.48, 0.98) * 100) / 100,
      median_response_s: median,
      open: intRange(rnd, 4, 90),
      closed_7d: intRange(rnd, 20, 260),
      reopened_7d: intRange(rnd, 0, 18),
    }
  })

  const trends = [
    { key: 'incidents', label: 'incidents per hour', unit: 'n' },
    { key: 'verified_closures', label: 'verified closures per hour', unit: 'n' },
    { key: 'p95_package_s', label: 'package latency p95', unit: 's' },
    { key: 'false_positive_rate', label: 'false positive rate', unit: '%' },
  ].map((t, i) => {
    const rnd = mulberry32(subSeed(seed, 'trend', i))
    const points: [number, number][] = []
    for (let h = 168; h >= 0; h--) {
      const ts = now - h * 3600_000
      const hour = ((ts + 5.5 * 3600_000) % 86400_000) / 3600_000
      const shape = 1 + Math.sin(((hour - 4) / 24) * Math.PI * 2) * 0.6
      const base =
        t.key === 'incidents' ? 18 : t.key === 'verified_closures' ? 11 : t.key === 'p95_package_s' ? 22 : 4.2
      points.push([ts, Math.round(base * shape * range(rnd, 0.8, 1.2) * 10) / 10])
    }
    return { ...t, points }
  })

  const bias = ZONE_SEEDS.slice(0, 7).flatMap((z, zi) =>
    HOUR_BUCKETS.map((hb, hi) => {
      const rnd = mulberry32(subSeed(seed, 'bias', zi * 10 + hi))
      const enforcement = Math.round(range(rnd, 0.15, 0.72) * 100) / 100
      const educational = Math.round((1 - enforcement) * range(rnd, 0.6, 1) * 100) / 100
      const disparity = Math.round((enforcement - 0.42) * 100) / 100
      return {
        zone_kind: `${z.kind} (${z.id})`,
        hour_bucket: hb,
        enforcement_rate: enforcement,
        educational_rate: educational,
        sample: intRange(rnd, 20, 340),
        disparity,
        flagged: Math.abs(disparity) > 0.22,
      }
    }),
  )

  const ROLES = [
    ['scene', 'qwen/qwen3.8-27b'],
    ['context', 'openai/gpt-oss-120b'],
    ['legal-routing', 'openai/gpt-oss-20b'],
    ['guard', 'openai/gpt-oss-safeguard-20b'],
    ['forensic', 'openai/gpt-oss-120b'],
    ['audio', 'whisper-large-v3-turbo'],
    ['query', 'openai/gpt-oss-120b'],
  ] as const

  const model_ops = {
    by_role: ROLES.map(([role, model], i) => {
      const rnd = mulberry32(subSeed(seed, 'modelops', i))
      return {
        role,
        model,
        calls: intRange(rnd, 200, 4200),
        cost_usd: Math.round(range(rnd, 0.4, 4.6) * 100) / 100,
        cache_hit_rate: Math.round(range(rnd, 0.35, 0.92) * 100) / 100,
        fallbacks: intRange(rnd, 0, 24),
        p95_latency_ms: intRange(rnd, 240, 4200),
      }
    }),
    batch_jobs: Array.from({ length: 8 }, (_, i) => {
      const rnd = mulberry32(subSeed(seed, 'batch', i))
      const submitted = now - intRange(rnd, 1, 30) * 86400_000
      const done = chance(rnd, 0.8)
      return {
        job_id: `BATCH-${String(i + 1).padStart(3, '0')}`,
        kind: ['nightly re-analysis', 'bias audit', 'weekly pattern report', 'department briefing'][i % 4]!,
        submitted_at: submitted,
        completed_at: done ? submitted + intRange(rnd, 2, 20) * 3600_000 : null,
        items: intRange(rnd, 40, 1800),
        cost_usd: Math.round(range(rnd, 0.3, 6.2) * 100) / 100,
        state: done ? ('completed' as const) : chance(rnd, 0.5) ? ('running' as const) : ('queued' as const),
      }
    }),
    spend_series: Array.from({ length: 30 }, (_, i) => {
      const rnd = mulberry32(subSeed(seed, 'spendseries', i))
      return [now - (29 - i) * 86400_000, Math.round(range(rnd, 4.2, 11.8) * 100) / 100] as [number, number]
    }),
  }

  const by_domain = DOMAINS.map((domain) => {
    const inDomain = incidents.filter((i) => i.domain === domain)
    return {
      domain,
      count: inDomain.length,
      verified: inDomain.filter((i) => i.status === 'verified').length,
    }
  })

  return { departments, trends, bias, model_ops, by_domain }
}
