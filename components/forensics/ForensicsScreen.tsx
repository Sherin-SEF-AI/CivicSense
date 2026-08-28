'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { PlaybackSource, SensorSeries } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { EmptyState, ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { HashChip, Overline } from '@/components/primitives/chips'
import { AuthenticityDot, SourceGlyph, SyncGrade } from '@/components/primitives/indicators'
import { Lightbox, type LightboxItem } from '@/components/primitives/Lightbox'
import { TimelineDeck } from '@/components/timeline/TimelineDeck'
import { AnalysisRail } from './AnalysisRail'
import { ScopeTile } from './ScopeTile'
import { TrajectoryTile } from './TrajectoryTile'
import { TransportBar } from './TransportBar'
import { VideoTile } from './VideoTile'
import { MasterClock } from '@/lib/playback/clock'
import { coverageAt, nextBoundary, windowCoverage } from '@/lib/playback/coverage'
import { stepFrame } from '@/lib/playback/frames'
import { useTransport } from '@/lib/playback/store'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtBytes, fmtDuration, fmtPct, fmtTime } from '@/lib/format'
import { useSelection } from '@/lib/stores/selection'
import { useUi } from '@/lib/stores/ui'
import { buildOfflineBundleAsync, downloadText } from '@/lib/export/offline'

/**
 * The forensics workspace.
 *
 * Left: the evidence tree. Centre: up to four tiles locked to one clock. Bottom:
 * the deck. Right: the analysis rail. The claim this screen has to earn is that
 * an incident is reconstructable across sources on one timeline, so every tile
 * carries its sync grade and its measured drift, and a tile with no coverage says
 * so rather than showing a frozen frame.
 */
export function ForensicsScreen({ incidentId }: { incidentId: string }) {
  const activeCaseId = useSelection((s) => s.activeCaseId)
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const [lightbox, setLightbox] = useState<LightboxItem[] | null>(null)
  const [deckHeight, setDeckHeight] = useState(240)
  const clockRef = useRef<MasterClock | null>(null)
  const [clockReady, setClockReady] = useState(false)

  const tiles = useTransport((s) => s.tiles)
  const setTiles = useTransport((s) => s.setTiles)
  const toggleTile = useTransport((s) => s.toggleTile)
  const focusedSourceId = useTransport((s) => s.focusedSourceId)
  const focus = useTransport((s) => s.focus)
  const selection = useTransport((s) => s.selection)
  const measuring = useTransport((s) => s.measuring)
  const setMeasuring = useTransport((s) => s.setMeasuring)
  const resetTransport = useTransport((s) => s.reset)

  const bundleQuery = useQuery({
    queryKey: qk.forensics.bundle(incidentId, activeCaseId),
    queryFn: ({ signal }) => api.forensics(incidentId, activeCaseId, signal),
  })

  const packageQuery = useQuery({
    queryKey: qk.incidents.package(incidentId),
    queryFn: ({ signal }) => api.incidentPackage(incidentId, signal),
  })

  const bundle = bundleQuery.data
  const scopeSources = useMemo(
    () => bundle?.playback.filter((p) => p.tile_kind === 'scope') ?? [],
    [bundle],
  )

  const seriesQueries = useQueries({
    queries: scopeSources.map((source) => ({
      queryKey: qk.sources.series(source.source_id, bundle?.window[0] ?? 0),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.series(source.source_id, bundle!.window[0], bundle!.window[1], 600, signal),
      enabled: bundle !== undefined,
    })),
  })

  const series = useMemo(() => {
    const map: Record<string, SensorSeries> = {}
    seriesQueries.forEach((q) => {
      if (q.data) map[q.data.sensor_id] = q.data
    })
    return map
  }, [seriesQueries])

  /* One clock per incident window. Rebuilt only when the window changes. */
  useEffect(() => {
    if (!bundle) return
    const clock = new MasterClock(bundle.window[0], bundle.window[1])
    /* Open on the anchor, not on the window edge: the edge is two minutes of
       lead-in where most sources have no coverage yet, which reads as broken. */
    const anchor = bundle.timeline.find((e) => e.lane === 'anchor')?.t ?? bundle.window[0]
    clock.seek(anchor)
    clockRef.current = clock
    setClockReady(true)
    return () => {
      clock.destroy()
      clockRef.current = null
      setClockReady(false)
      resetTransport()
    }
  }, [bundle, resetTransport])

  useEffect(() => {
    if (!bundle || tiles.length > 0) return
    const preferred = bundle.playback
      .filter((p) => p.tile_kind === 'video')
      .slice(0, 2)
      .map((p) => p.source_id)
    const map = bundle.playback.find((p) => p.tile_kind === 'map')?.source_id
    const scope = bundle.playback.find((p) => p.tile_kind === 'scope')?.source_id
    const initial = [...preferred, map, scope].filter((id): id is string => typeof id === 'string').slice(0, 4)
    setTiles(initial)
    focus(preferred[0] ?? initial[0] ?? null)
  }, [bundle, tiles.length, setTiles, focus])

  const focusedSource = bundle?.playback.find((p) => p.source_id === focusedSourceId) ?? null

  const step = useCallback(
    (direction: 1 | -1) => {
      const clock = clockRef.current
      if (!clock || !focusedSource) return
      clock.pause()
      const t = clock.now()
      const coverage = coverageAt(focusedSource, t)
      if (coverage.state !== 'covered') {
        /* Without a frame rate under the playhead, "one frame" has no meaning.
           Say so rather than guessing at 25fps. */
        toast({
          tone: 'info',
          text: 'the focused source has no coverage here',
          detail: 'step is defined by the focused tile, so focus a covered tile or jump to a boundary',
        })
        return
      }
      const media = t - focusedSource.clock_offset_ms
      const next = stepFrame(media, coverage.segment, direction)
      clock.seek(next + focusedSource.clock_offset_ms)
    },
    [focusedSource, toast],
  )

  const boundary = useCallback(
    (direction: 1 | -1) => {
      const clock = clockRef.current
      if (!clock || !focusedSource) return
      const next = nextBoundary(focusedSource, clock.now(), direction)
      if (next === null) {
        toast({ tone: 'info', text: 'no further segment boundary on this source' })
        return
      }
      clock.pause()
      clock.seek(next)
    },
    [focusedSource, toast],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const clock = clockRef.current
      if (!clock) return
      if (e.key === ' ') {
        e.preventDefault()
        clock.toggle()
      } else if (e.key === ',') {
        e.preventDefault()
        step(-1)
      } else if (e.key === '.') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'n') {
        e.preventDefault()
        boundary(1)
      } else if (e.key === 'p') {
        e.preventDefault()
        boundary(-1)
      } else if (e.key === 'm') {
        e.preventDefault()
        setMeasuring(!useTransport.getState().measuring)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, boundary, setMeasuring])

  const openEvidence = useCallback(
    (evidenceId: string) => {
      if (!bundle) return
      const node = bundle.tree.find((n) => n.evidence_id === evidenceId)
      if (!node?.thumb_url) {
        toast({ tone: 'info', text: 'that item has no visual representation', detail: evidenceId })
        return
      }
      setLightbox([
        {
          id: node.evidence_id,
          label: `${node.source_id} ${node.label}`,
          t: node.t_start,
          url: node.thumb_url,
          annotations: [],
        },
      ])
    },
    [bundle, toast],
  )

  const exportRange = useCallback(async () => {
    if (!bundle || !selection) return
    const result = await api.forensicsPull(incidentId, {
      from: selection[0],
      to: selection[1],
      source_ids: tiles,
      kind: 'clip',
    })
    toast({
      tone: 'ok',
      text: 'clip pull queued from the edge ring buffer',
      detail: `${fmtDuration(selection[1] - selection[0])} across ${tiles.length} sources, about ${fmtBytes(result.estimated_bytes)}`,
    })
  }, [bundle, selection, incidentId, tiles, toast])

  const reanalyseRange = useCallback(async () => {
    if (!bundle || !selection) return
    const result = await api.forensicsPull(incidentId, {
      from: selection[0],
      to: selection[1],
      source_ids: tiles,
      kind: 'reanalysis',
    })
    toast({
      tone: 'ok',
      text: 'range queued for re-analysis',
      detail: `estimated $${result.estimated_cost_usd.toFixed(4)}, budget remaining $${result.budget_remaining_usd.toFixed(2)}`,
    })
  }, [bundle, selection, incidentId, tiles, toast])

  const exportOffline = useCallback(async () => {
    if (!bundle || !packageQuery.data) return
    const html = await buildOfflineBundleAsync(packageQuery.data, bundle)
    downloadText(`civicsense-${incidentId}.html`, html, 'text/html')
    toast({ tone: 'ok', text: 'offline bundle exported', detail: 'opens standalone, hashes printed in full' })
  }, [bundle, packageQuery.data, incidentId, toast])

  if (bundleQuery.error) {
    return (
      <div className="w-full p-6">
        <ErrorPanel
          code={errorCode(bundleQuery.error)}
          detail={errorDetail(bundleQuery.error)}
          onRetry={() => void bundleQuery.refetch()}
        />
      </div>
    )
  }

  if (bundleQuery.isPending || !bundle || !clockReady || !clockRef.current) {
    return (
      <div className="w-full p-6">
        <LoadingBlocks rows={10} height={44} />
      </div>
    )
  }

  const clock = clockRef.current
  const coverage = windowCoverage(bundle.playback, bundle.window)
  const stageSources = tiles
    .map((id) => bundle.playback.find((p) => p.source_id === id))
    .filter((p): p is PlaybackSource => p !== undefined)

  const focusedCoverage = focusedSource ? coverageAt(focusedSource, clock.now()) : null
  const focusedFps = focusedCoverage?.state === 'covered' ? focusedCoverage.segment.fps : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-1.5">
        <Link
          href={`/incident/${incidentId}`}
          className="mono step flex items-center gap-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name="chevron-e" size={11} style={{ transform: 'rotate(180deg)' }} />
          package
        </Link>
        <span className="text-[14px] text-[var(--ink-0)]">forensics</span>
        <span className="mono text-[11px] text-[var(--ink-3)]">{incidentId}</span>
        <span className="mono text-[11px] text-[var(--ink-2)]">
          window {fmtTime(bundle.window[0], { ms: false })} to {fmtTime(bundle.window[1], { ms: false })} ·{' '}
          {fmtDuration(bundle.window[1] - bundle.window[0])}
        </span>
        <span
          className="mono text-[11px]"
          style={{ color: coverage < 0.6 ? 'var(--medium)' : 'var(--ink-2)' }}
          title="fraction of the window observed by any source"
        >
          coverage {fmtPct(coverage)}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={measuring}
            onClick={() => setMeasuring(!measuring)}
            title="measurement mode (m): click two ground points on a calibrated tile"
            className="mono step flex items-center gap-1 border px-2 py-1 text-[11px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: measuring ? 'var(--live)' : 'var(--line-1)',
              color: measuring ? 'var(--live)' : 'var(--ink-1)',
            }}
          >
            <Glyph name="kinematics" size={11} />
            measure
          </button>
          <button
            type="button"
            onClick={() => void exportRange()}
            disabled={selection === null}
            title={selection === null ? 'select a range on the deck first' : 'pull the selected range from the edge buffers'}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[11px] text-[var(--ink-1)] hover:text-[var(--ink-0)] disabled:border-[var(--line-0)] disabled:text-[var(--ink-3)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="clip" size={11} />
            export clip
          </button>
          <button
            type="button"
            onClick={() => void reanalyseRange()}
            disabled={selection === null}
            title={selection === null ? 'select a range on the deck first' : 'send the selected range for re-analysis'}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[11px] text-[var(--ink-1)] hover:text-[var(--ink-0)] disabled:border-[var(--line-0)] disabled:text-[var(--ink-3)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="model" size={11} />
            re-analyse
          </button>
          <button
            type="button"
            onClick={() => void exportOffline()}
            className="mono step flex items-center gap-1 border border-[var(--line-1)] px-2 py-1 text-[11px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <Glyph name="export" size={11} />
            offline bundle
          </button>
        </div>
      </header>

      <TransportBar
        clock={clock}
        window={bundle.window}
        focusedLabel={focusedSource?.source_id ?? 'no tile'}
        focusedFps={focusedFps}
        onStep={step}
        onBoundary={boundary}
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 flex-none flex-col border-r border-[var(--line-0)] bg-[var(--bg-1)]"
          style={{ width: 260 }}
          aria-label="evidence tree"
        >
          <div className="flex-none px-2 py-1.5">
            <Overline>evidence</Overline>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {bundle.playback.map((source) => {
              const items = bundle.tree.filter((n) => n.source_id === source.source_id)
              const onStage = tiles.includes(source.source_id)
              return (
                <section key={source.source_id} className="border-b border-[var(--line-0)]">
                  <button
                    type="button"
                    onClick={() => toggleTile(source.source_id)}
                    title={onStage ? 'remove from the stage' : 'add to the stage, up to four tiles'}
                    className="step flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                    style={{ background: onStage ? 'var(--bg-3)' : undefined }}
                  >
                    <span style={{ color: onStage ? 'var(--live)' : 'var(--ink-2)' }}>
                      <SourceGlyph type={source.source_type} size={12} />
                    </span>
                    <span className="mono truncate text-[11px] text-[var(--ink-1)]">{source.source_id}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <SyncGrade grade={source.sync_quality} />
                      {onStage ? (
                        <span className="mono text-[11px]" style={{ color: 'var(--live)' }}>
                          on
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <ul>
                    {items.map((node) => (
                      <li key={node.evidence_id} className="flex items-center gap-1.5 px-2 py-1 pl-6">
                        <AuthenticityDot verdict={node.authenticity} />
                        <button
                          type="button"
                          onClick={() => openEvidence(node.evidence_id)}
                          className="step min-w-0 flex-1 truncate text-left text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                          title={`${node.label} · ${fmtBytes(node.bytes)}`}
                        >
                          {node.label}
                        </button>
                        <HashChip hash={node.hash} onOpen={openCustody} verified={node.authenticity !== 'inconsistent'} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-2">
            {stageSources.length === 0 ? (
              <EmptyState line="no sources on the stage" actionLabel="add the first source" onAction={() => {
                const first = bundle.playback[0]
                if (first) toggleTile(first.source_id)
              }} glyph="storyboard" />
            ) : (
              <div
                className="grid h-full min-h-0 gap-2"
                style={{
                  gridTemplateColumns: stageSources.length > 1 ? '1fr 1fr' : '1fr',
                  gridTemplateRows: stageSources.length > 2 ? '1fr 1fr' : '1fr',
                }}
              >
                {stageSources.map((source) => {
                  const focused = source.source_id === focusedSourceId
                  if (source.tile_kind === 'map') {
                    return (
                      <TrajectoryTile
                        key={source.source_id}
                        clock={clock}
                        tracks={bundle.kinematics}
                        entities={bundle.entities}
                        window={bundle.window}
                        focused={focused}
                        onFocus={() => focus(source.source_id)}
                      />
                    )
                  }
                  if (source.tile_kind === 'scope') {
                    return (
                      <ScopeTile
                        key={source.source_id}
                        source={source}
                        series={series[source.source_id]}
                        clock={clock}
                        focused={focused}
                        onFocus={() => focus(source.source_id)}
                      />
                    )
                  }
                  return (
                    <VideoTile
                      key={source.source_id}
                      source={source}
                      clock={clock}
                      focused={focused}
                      onFocus={() => focus(source.source_id)}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="resize timeline deck"
            onPointerDown={(e) => {
              const startY = e.clientY
              const startHeight = deckHeight
              const move = (ev: PointerEvent) => setDeckHeight(Math.min(520, Math.max(140, startHeight - (ev.clientY - startY))))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            className="h-[3px] flex-none cursor-row-resize bg-[var(--line-0)] hover:bg-[var(--line-1)]"
          />

          <div className="flex-none" style={{ height: deckHeight }}>
            <TimelineDeck
              clock={clock}
              sources={bundle.playback.filter((p) => p.tile_kind !== 'map')}
              ticks={bundle.ticks}
              series={series}
              window={bundle.window}
              onSeek={(t) => clock.seek(t)}
            />
          </div>
        </div>

        <AnalysisRail bundle={bundle} onEvidence={openEvidence} />
      </div>

      {lightbox ? (
        <Lightbox items={lightbox} index={0} onClose={() => setLightbox(null)} onIndex={() => undefined} />
      ) : null}
    </div>
  )
}
