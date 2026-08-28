'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Domain, PriorityBand, SourceType } from '@/lib/api/schemas'
import { DOMAINS, PRIORITY_BANDS, SOURCE_TYPES } from '@/lib/api/schemas/common'
import { Glyph } from '@/components/glyphs'
import { FilterChip } from '@/components/primitives/chips'
import { EmptyState, ErrorPanel } from '@/components/primitives/panels'
import { MapCanvas, type MapLayerToggles } from '@/components/map/MapCanvas'
import { IncidentFeed } from './IncidentFeed'
import { IncidentDrawer } from './IncidentDrawer'
import { PreAlertBanner } from './PreAlertBanner'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { useIncidentFilters, useSelectedIncidentParam } from '@/lib/stores/filters'
import { useSelection } from '@/lib/stores/selection'
import { usePreAlerts, useStreamEvents } from '@/lib/stream/StreamProvider'
import { useUi } from '@/lib/stores/ui'
import { useConnectionState } from '@/lib/stream/StreamProvider'
import { DOMAIN_COLOR, DOMAIN_GLYPH, PRIORITY_COLOR } from '@/lib/tokens'

/**
 * The control room screen: map, feed, drawer.
 *
 * The acceptance test for this screen is that an operator can go from a
 * pre-alert strip to an acknowledged and dispatched incident in under five
 * seconds without touching the mouse, so every action here has a key and the
 * selection is shared between the feed, the map and the palette.
 */
export function OpsScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const enqueue = useUi((s) => s.enqueue)
  const connection = useConnectionState()
  const preAlerts = usePreAlerts()
  const { filters, toggle, clear, active } = useIncidentFilters()
  const [selectedId, setSelectedId] = useSelectedIncidentParam()
  const selectStore = useSelection((s) => s.select)
  const [toggles, setToggles] = useState<MapLayerToggles>({ fov: true, zones: false, risk: false })

  const incidentsQuery = useQuery({
    queryKey: qk.incidents.list(filters),
    queryFn: ({ signal }) => api.incidents(filters, null, signal),
  })

  const sourcesQuery = useQuery({
    queryKey: qk.sources.list([], [], ''),
    queryFn: ({ signal }) => api.sources([], [], '', signal),
    staleTime: 60_000,
  })

  const riskQuery = useQuery({
    queryKey: qk.predict.risk(null, 6),
    queryFn: ({ signal }) => api.risk(null, 6, signal),
    enabled: toggles.risk,
    staleTime: 120_000,
  })

  /* Patrol positions arrive at 4Hz and never touch the query cache. They are
     held here and handed to the map controller, which writes them straight to a
     source without a React render for the rest of the screen. */
  const [patrolPositions, setPatrolPositions] = useState<Record<string, { lat: number; lon: number; heading: number }>>({})
  useStreamEvents(
    useCallback((event) => {
      if (event.type !== 'patrol.position') return
      setPatrolPositions((prev) => ({
        ...prev,
        [event.payload.source_id]: { lat: event.payload.lat, lon: event.payload.lon, heading: event.payload.heading },
      }))
    }, []),
  )

  const incidents = useMemo(() => incidentsQuery.data?.items ?? [], [incidentsQuery.data])
  const sources = useMemo(() => sourcesQuery.data?.items ?? [], [sourcesQuery.data])

  const patrols = useMemo(
    () =>
      sources
        .filter((s) => s.source_type === 'patrol-car' || s.source_type === 'patrol-bike')
        .map((s) => {
          const live = patrolPositions[s.source_id]
          if (!live) return s
          return {
            ...s,
            position: { lat: live.lat, lon: live.lon },
            heading_deg: live.heading,
            trail: [...s.trail.slice(-14), { t: Date.now(), lat: live.lat, lon: live.lon, heading: live.heading }],
          }
        }),
    [sources, patrolPositions],
  )

  const selected = useMemo(
    () => incidents.find((i) => i.incident_id === selectedId) ?? null,
    [incidents, selectedId],
  )

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      selectStore(id)
    },
    [setSelectedId, selectStore],
  )

  const act = useCallback(
    async (id: string, action: 'ack' | 'dispatch' | 'escalate' | 'resolve' | 'dismiss', reason?: string) => {
      const run = async () => {
        const updated = await api.incidentAction(id, action, reason)
        qc.setQueryData(qk.incidents.detail(id), updated)
        await qc.invalidateQueries({ queryKey: qk.incidents.lists() })
        return updated
      }
      if (connection === 'offline') {
        if (action !== 'ack') {
          toast({ tone: 'error', text: 'offline: only acknowledgement queues', detail: `${action} needs the api` })
          return
        }
        enqueue({ label: `ack ${id}`, glyph: 'acknowledge', run })
        toast({ tone: 'info', text: 'queued acknowledgement, will replay when the stream returns' })
        return
      }
      try {
        await run()
        toast({ tone: 'ok', text: `${action}${action.endsWith('e') ? 'd' : 'ed'}`, detail: id })
      } catch (error) {
        toast({ tone: 'error', text: `${action} failed`, detail: errorDetail(error) })
      }
    },
    [qc, connection, enqueue, toast],
  )

  const counts = useMemo(() => {
    const byPriority = new Map<string, number>()
    const byDomain = new Map<string, number>()
    for (const i of incidents) {
      byPriority.set(i.priority, (byPriority.get(i.priority) ?? 0) + 1)
      byDomain.set(i.domain, (byDomain.get(i.domain) ?? 0) + 1)
    }
    return { byPriority, byDomain }
  }, [incidents])

  const isStale = incidentsQuery.isStale && incidentsQuery.isFetching

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <MapCanvas
        incidents={incidents}
        sources={sources}
        patrols={patrols}
        risk={riskQuery.data?.cells ?? []}
        toggles={toggles}
        selectedId={selectedId}
        onSelect={select}
        onToggle={(key) => setToggles((t) => ({ ...t, [key]: !t[key] }))}
      />

      <section
        className="flex min-h-0 flex-none flex-col border-l border-[var(--line-0)] bg-[var(--bg-1)]"
        style={{ width: 'var(--feed-w)' }}
        aria-label="incident feed"
      >
        <PreAlertBanner
          alerts={preAlerts}
          onOpen={(alert) => {
            if (alert.incident_id) select(alert.incident_id)
            else toast({ tone: 'info', text: 'the package for this pre-alert has not landed yet', detail: alert.pre_alert_id })
          }}
        />

        <div className="flex flex-none flex-col gap-1.5 border-b border-[var(--line-0)] px-2 py-2">
          <div className="flex flex-wrap gap-1">
            {PRIORITY_BANDS.map((band) => (
              <FilterChip
                key={band}
                label={band.toLowerCase()}
                count={counts.byPriority.get(band)}
                active={filters.priority.includes(band as PriorityBand)}
                onToggle={() => toggle('priority', band)}
                color={PRIORITY_COLOR[band]}
                glyph="incident"
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {DOMAINS.map((domain) => (
              <FilterChip
                key={domain}
                label={domain}
                count={counts.byDomain.get(domain)}
                active={filters.domain.includes(domain as Domain)}
                onToggle={() => toggle('domain', domain)}
                glyph={DOMAIN_GLYPH[domain]}
                color={DOMAIN_COLOR[domain]}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {SOURCE_TYPES.slice(0, 6).map((type) => (
              <FilterChip
                key={type}
                label={type}
                active={filters.sourceType.includes(type as SourceType)}
                onToggle={() => toggle('sourceType', type)}
              />
            ))}
            {active > 0 ? (
              <button
                type="button"
                onClick={clear}
                className="mono step ml-auto flex items-center gap-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
              >
                <Glyph name="close" size={11} />
                clear {active}
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {incidentsQuery.error ? (
            <div className="p-3">
              <ErrorPanel
                code={errorCode(incidentsQuery.error)}
                detail={errorDetail(incidentsQuery.error)}
                onRetry={() => void incidentsQuery.refetch()}
              />
            </div>
          ) : incidents.length === 0 && !incidentsQuery.isPending ? (
            <EmptyState
              line={active > 0 ? 'no incidents match these filters' : 'no open incidents in the last six hours'}
              actionLabel={active > 0 ? 'clear filters' : undefined}
              onAction={active > 0 ? clear : undefined}
              glyph="incident"
            />
          ) : (
            <IncidentFeed
              incidents={incidents}
              selectedId={selectedId}
              onSelect={select}
              onAck={(id) => void act(id, 'ack')}
              onDispatch={(id) => void act(id, 'dispatch')}
              onForensics={(id) => router.push(`/forensics/${id}`)}
              onDismiss={(id) => select(id)}
              loading={incidentsQuery.isPending}
              stale={isStale}
            />
          )}
        </div>

        <footer className="mono flex flex-none items-center gap-3 border-t border-[var(--line-0)] px-2 py-1 text-[11px] text-[var(--ink-3)]">
          <span>{incidentsQuery.data?.total ?? 0} matching</span>
          <span className="ml-auto">j/k move · a ack · d dispatch · f forensics · x dismiss</span>
        </footer>
      </section>

      {selected ? (
        <IncidentDrawer
          incident={selected}
          onClose={() => select(null)}
          onAction={(action, reason) => void act(selected.incident_id, action, reason)}
        />
      ) : null}
    </div>
  )
}
