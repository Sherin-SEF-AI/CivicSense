import type { Domain, PriorityBand, SourceType } from '@/lib/api/schemas'

/**
 * Query keys are canonicalised before they become cache keys. Without that, a
 * filter object built fresh on every render hashes differently every time and
 * the cache never hits.
 */

export interface IncidentFilters {
  priority: PriorityBand[]
  domain: Domain[]
  zone: string[]
  sourceType: SourceType[]
  status: string[]
  q: string
  includeClosed: boolean
}

export const EMPTY_INCIDENT_FILTERS: IncidentFilters = {
  priority: [],
  domain: [],
  zone: [],
  sourceType: [],
  status: [],
  q: '',
  includeClosed: false,
}

export function canonicalFilters(f: IncidentFilters): string {
  const parts = [
    [...f.priority].sort().join('|'),
    [...f.domain].sort().join('|'),
    [...f.zone].sort().join('|'),
    [...f.sourceType].sort().join('|'),
    [...f.status].sort().join('|'),
    f.q.trim().toLowerCase(),
    f.includeClosed ? '1' : '0',
  ]
  return parts.join('~')
}

export const qk = {
  incidents: {
    all: () => ['incidents'] as const,
    lists: () => ['incidents', 'list'] as const,
    list: (f: IncidentFilters) => ['incidents', 'list', canonicalFilters(f)] as const,
    detail: (id: string) => ['incidents', 'detail', id] as const,
    package: (id: string) => ['incidents', 'package', id] as const,
  },
  forensics: {
    all: () => ['forensics'] as const,
    bundle: (id: string, caseId: string | null) => ['forensics', 'bundle', id, caseId ?? ''] as const,
  },
  evidence: {
    all: () => ['evidence'] as const,
    search: (q: string, caseId: string | null) => ['evidence', 'search', q.trim().toLowerCase(), caseId ?? ''] as const,
  },
  cases: {
    all: () => ['cases'] as const,
    list: (q: string) => ['cases', 'list', q.trim().toLowerCase()] as const,
    detail: (id: string) => ['cases', 'detail', id] as const,
  },
  warnings: {
    all: () => ['warnings'] as const,
    list: (level: string[], domain: string[]) =>
      ['warnings', 'list', [...level].sort().join('|'), [...domain].sort().join('|')] as const,
  },
  predict: {
    risk: (domain: string | null, horizon: number) => ['predict', 'risk', domain ?? 'all', horizon] as const,
  },
  sources: {
    all: () => ['sources'] as const,
    list: (type: string[], state: string[], q: string) =>
      ['sources', 'list', [...type].sort().join('|'), [...state].sort().join('|'), q.trim().toLowerCase()] as const,
    detail: (id: string) => ['sources', 'detail', id] as const,
    series: (id: string, bucket: number) => ['sources', 'series', id, bucket] as const,
  },
  analytics: {
    overview: () => ['analytics', 'overview'] as const,
  },
  admin: {
    all: () => ['admin'] as const,
  },
  zones: {
    all: () => ['zones'] as const,
  },
  system: {
    health: () => ['system', 'health'] as const,
  },
} as const
