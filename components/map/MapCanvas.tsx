'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { IncidentSummary, RiskCell, SourceDevice } from '@/lib/api/schemas'
import { MapController } from '@/lib/map/controller'
import { Glyph } from '@/components/glyphs'
import { fmtDuration, fmtScore } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { PRIORITY_COLOR, PRIORITY_MARK } from '@/lib/tokens'

export interface MapLayerToggles {
  fov: boolean
  zones: boolean
  risk: boolean
}

/**
 * React mounts the map and then stays out of the way. Data flows in through the
 * controller's imperative setters, never through props that would re-render a
 * component tree on every stream frame.
 */
export function MapCanvas({
  incidents,
  sources,
  patrols,
  risk,
  toggles,
  selectedId,
  onSelect,
  onToggle,
  children,
}: {
  incidents: IncidentSummary[]
  sources: SourceDevice[]
  patrols: SourceDevice[]
  risk: RiskCell[]
  toggles: MapLayerToggles
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: (key: keyof MapLayerToggles) => void
  children?: React.ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<MapController | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [clusters, setClusters] = useState<{ id: number; count: number; x: number; y: number }[]>([])
  const now = useNow(1000)

  const byId = useMemo(() => new Map(incidents.map((i) => [i.incident_id, i])), [incidents])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const c = new MapController({
      onSelect,
      onHover: (id, screen) => setHover(id && screen ? { id, x: screen.x, y: screen.y } : null),
      onClusterCounts: setClusters,
    })
    controller.current = c
    const dispose = c.mount(node)
    return () => {
      dispose()
      controller.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    controller.current?.setIncidents(incidents)
  }, [incidents])

  useEffect(() => {
    controller.current?.setSources(sources)
  }, [sources])

  useEffect(() => {
    controller.current?.setPatrols(patrols)
  }, [patrols])

  useEffect(() => {
    controller.current?.setRisk(risk, toggles.risk)
  }, [risk, toggles.risk])

  useEffect(() => {
    controller.current?.setZonesVisible(toggles.zones)
  }, [toggles.zones])

  useEffect(() => {
    controller.current?.setFovVisible(toggles.fov)
  }, [toggles.fov])

  useEffect(() => {
    controller.current?.setSelected(selectedId)
    if (selectedId) {
      const incident = byId.get(selectedId)
      if (incident) controller.current?.flyTo(incident.position.lon, incident.position.lat, 15)
    }
  }, [selectedId, byId])

  const hovered = hover ? byId.get(hover.id) : null

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div ref={host} className="h-full w-full" aria-label="incident map" role="application" />

      {/* Cluster counts are the only DOM markers on the map, and there are never many. */}
      {clusters.map((c) => (
        <span
          key={c.id}
          aria-hidden
          className="mono pointer-events-none absolute text-[12.5px] leading-none text-[var(--ink-0)]"
          style={{ left: c.x, top: c.y, transform: 'translate(-50%,-50%)' }}
        >
          {c.count}
        </span>
      ))}

      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 w-[240px] border border-[var(--line-1)] bg-[var(--bg-1)] p-2"
          style={{
            left: Math.min(hover!.x + 12, (host.current?.clientWidth ?? 800) - 252),
            top: hover!.y + 12,
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--overlay-shadow)',
          }}
        >
          <div className="mono flex items-center gap-2 text-[11px]">
            <span style={{ color: PRIORITY_COLOR[hovered.priority] }}>{PRIORITY_MARK[hovered.priority]}</span>
            <span className="truncate text-[var(--ink-2)]">{hovered.incident_id}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.35] text-[var(--ink-0)]">{hovered.title}</p>
          <dl className="mono mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[var(--ink-2)]">
            <div className="flex justify-between">
              <dt>css</dt>
              <dd className="text-[var(--ink-1)]">{fmtScore(hovered.css.value)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>age</dt>
              <dd className="text-[var(--ink-1)]">{now === null ? '--' : fmtDuration(now - hovered.detected_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>src</dt>
              <dd className="text-[var(--ink-1)]">{hovered.source_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt>sync</dt>
              <dd className="text-[var(--ink-1)]">{hovered.sync_quality}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="absolute top-2 left-2 flex flex-col gap-1">
        {(
          [
            ['fov', 'cctv-fixed', 'camera fields of view'],
            ['zones', 'zone', 'zone boundaries'],
            ['risk', 'prediction', 'h3 risk surface'],
          ] as const
        ).map(([key, glyph, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={toggles[key]}
            onClick={() => onToggle(key)}
            title={label}
            className="mono step flex h-7 items-center gap-1.5 border px-2 text-[11px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              background: 'var(--bg-1)',
              borderColor: toggles[key] ? 'var(--live)' : 'var(--line-0)',
              color: toggles[key] ? 'var(--live)' : 'var(--ink-2)',
            }}
          >
            <Glyph name={glyph} size={12} />
            {key}
          </button>
        ))}
      </div>

      {children}
    </div>
  )
}
