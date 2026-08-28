'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Domain, PriorityBand, SourceType } from '@/lib/api/schemas'
import type { IncidentFilters } from '@/lib/api/keys'

/**
 * Filters live in the URL, not in a store.
 *
 * Everything that matters about what an operator is looking at has to be in the
 * address bar, so a link into a shift handover reproduces the exact screen.
 */
export function useIncidentFilters(): {
  filters: IncidentFilters
  toggle: (key: keyof IncidentFilters, value: string) => void
  setSearch: (value: string) => void
  setIncludeClosed: (value: boolean) => void
  clear: () => void
  active: number
} {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const filters = useMemo<IncidentFilters>(
    () => ({
      priority: split(params.get('priority')) as PriorityBand[],
      domain: split(params.get('domain')) as Domain[],
      zone: split(params.get('zone')),
      sourceType: split(params.get('src')) as SourceType[],
      status: split(params.get('status')),
      q: params.get('q') ?? '',
      includeClosed: params.get('closed') === '1',
    }),
    [params],
  )

  const write = useCallback(
    (next: URLSearchParams) => {
      const s = next.toString()
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
    },
    [router, pathname],
  )

  const KEY_MAP: Record<string, string> = {
    priority: 'priority',
    domain: 'domain',
    zone: 'zone',
    sourceType: 'src',
    status: 'status',
  }

  const toggle = useCallback(
    (key: keyof IncidentFilters, value: string) => {
      const param = KEY_MAP[key]
      if (!param) return
      const next = new URLSearchParams(params.toString())
      const current = split(next.get(param))
      const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      if (updated.length === 0) next.delete(param)
      else next.set(param, updated.join(','))
      write(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, write],
  )

  const setSearch = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value) next.set('q', value)
      else next.delete('q')
      write(next)
    },
    [params, write],
  )

  const setIncludeClosed = useCallback(
    (value: boolean) => {
      const next = new URLSearchParams(params.toString())
      if (value) next.set('closed', '1')
      else next.delete('closed')
      write(next)
    },
    [params, write],
  )

  const clear = useCallback(() => {
    const next = new URLSearchParams(params.toString())
    for (const key of ['priority', 'domain', 'zone', 'src', 'status', 'q', 'closed']) next.delete(key)
    write(next)
  }, [params, write])

  const active =
    filters.priority.length +
    filters.domain.length +
    filters.zone.length +
    filters.sourceType.length +
    filters.status.length +
    (filters.q ? 1 : 0) +
    (filters.includeClosed ? 1 : 0)

  return { filters, toggle, setSearch, setIncludeClosed, clear, active }
}

function split(value: string | null): string[] {
  return value === null || value === '' ? [] : value.split(',').filter(Boolean)
}

/** Selection also lives in the URL so a shared link opens on the same incident. */
export function useSelectedIncidentParam(): [string | null, (id: string | null) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const selected = params.get('i')

  const set = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (id) next.set('i', id)
      else next.delete('i')
      const s = next.toString()
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
    },
    [params, router, pathname],
  )

  return [selected, set]
}
