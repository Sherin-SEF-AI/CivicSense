'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Domain, Warning, WarningLevel } from '@/lib/api/schemas'
import { DOMAINS } from '@/lib/api/schemas/common'
import { WARNING_LEVELS } from '@/lib/api/schemas/predict'
import { Glyph } from '@/components/glyphs'
import { MapCanvas } from '@/components/map/MapCanvas'
import { EmptyState, ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { FilterChip, Overline } from '@/components/primitives/chips'
import { WarningLevelGlyph } from '@/components/primitives/indicators'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDate, fmtDuration, fmtPct, fmtScore, fmtTime } from '@/lib/format'
import { CANVAS, DOMAIN_COLOR, DOMAIN_GLYPH, WARNING_COLOR } from '@/lib/tokens'
import { useNow } from '@/lib/useNow'
import { useUi } from '@/lib/stores/ui'

const HORIZONS = [1, 6, 24] as const

/**
 * Prediction.
 *
 * The screen has to prove its own value, so the outcomes strip at the bottom
 * carries measured before and after rates with confidence intervals from the
 * difference-in-differences analysis, rather than only listing what the engine
 * thinks might happen next.
 */
export function PredictScreen() {
  const toast = useUi((s) => s.toast)
  const now = useNow(1000)
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(6)
  const [domain, setDomain] = useState<Domain | null>(null)
  const [levels, setLevels] = useState<Set<WarningLevel>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)

  const taskMutation = useMutation({
    mutationFn: (input: { warning: Warning; intervention: Warning['interventions'][number] }) =>
      api.taskIntervention(input.warning.warning_id, {
        intervention_id: input.intervention.intervention_id,
        intervention_label: input.intervention.label,
        zone_label: input.warning.zone_label,
        department: input.intervention.department,
        lat: input.warning.position.lat,
        lon: input.warning.position.lon,
      }),
    onSuccess: (tasking) =>
      toast({
        tone: 'ok',
        text: tasking.assigned_label ? `tasked ${tasking.assigned_label}` : 'tasking recorded, no unit available',
        detail: tasking.eta_minutes !== null ? `about ${tasking.eta_minutes} minutes out` : 'assign a unit when one comes on shift',
      }),
    onError: (error) => toast({ tone: 'error', text: 'tasking failed', detail: errorDetail(error) }),
  })

  const warningsQuery = useQuery({
    queryKey: qk.warnings.list([...levels], domain ? [domain] : []),
    queryFn: ({ signal }) => api.warnings([...levels], domain ? [domain] : [], signal),
  })

  const riskQuery = useQuery({
    queryKey: qk.predict.risk(domain, horizon),
    queryFn: ({ signal }) => api.risk(domain, horizon, signal),
  })

  const sourcesQuery = useQuery({
    queryKey: qk.sources.list([], [], ''),
    queryFn: ({ signal }) => api.sources([], [], '', signal),
    staleTime: 60_000,
  })

  const warnings = useMemo(
    () => (warningsQuery.data?.items ?? []).filter((w) => w.horizon_h <= horizon),
    [warningsQuery.data, horizon],
  )
  const outcomes = warningsQuery.data?.outcomes ?? []
  const byLevel = useMemo(() => {
    const map = new Map<WarningLevel, Warning[]>()
    for (const level of WARNING_LEVELS) map.set(level, [])
    for (const w of warnings) map.get(w.level)?.push(w)
    return map
  }, [warnings])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">predict</h1>

        <div className="flex items-center gap-1" role="group" aria-label="horizon">
          <span className="overline">horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={horizon === h}
              onClick={() => setHorizon(h)}
              className="mono step border px-2 py-0.5 text-[12.5px]"
              style={{
                borderRadius: 'var(--radius-chip)',
                borderColor: horizon === h ? 'var(--live)' : 'var(--line-1)',
                color: horizon === h ? 'var(--live)' : 'var(--ink-2)',
              }}
            >
              {h}h
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="overline">domain</span>
          {DOMAINS.map((d) => (
            <FilterChip
              key={d}
              label={d}
              active={domain === d}
              onToggle={() => setDomain(domain === d ? null : (d as Domain))}
              glyph={DOMAIN_GLYPH[d]}
              color={DOMAIN_COLOR[d]}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="overline">level</span>
          {WARNING_LEVELS.map((level) => (
            <FilterChip
              key={level}
              label={level.toLowerCase()}
              count={byLevel.get(level)?.length}
              active={levels.has(level)}
              onToggle={() =>
                setLevels((prev) => {
                  const next = new Set(prev)
                  if (next.has(level)) next.delete(level)
                  else next.add(level)
                  return next
                })
              }
              glyph="warning-level"
              color={WARNING_COLOR[level]}
            />
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <MapCanvas
          incidents={[]}
          sources={sourcesQuery.data?.items ?? []}
          patrols={[]}
          risk={riskQuery.data?.cells ?? []}
          toggles={{ fov: false, zones: true, risk: true }}
          selectedId={null}
          onSelect={() => undefined}
          onToggle={() => undefined}
        >
          <div
            className="absolute bottom-2 left-2 flex items-center gap-3 border border-[var(--line-0)] bg-[var(--bg-1)] px-2 py-1"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            <span className="overline">risk</span>
            <span
              aria-hidden
              className="h-2 w-[120px]"
              style={{
                background: `linear-gradient(90deg, ${CANVAS.line0}, ${CANVAS.medium}, ${CANVAS.high}, ${CANVAS.critical})`,
              }}
            />
            <span className="mono text-[11px] text-[var(--ink-2)]">0 to 1 over {horizon}h</span>
            <span className="mono text-[11px] text-[var(--ink-3)]">{riskQuery.data?.cells.length ?? 0} cells</span>
          </div>
        </MapCanvas>

        <section
          className="flex min-h-0 flex-none flex-col border-l border-[var(--line-0)] bg-[var(--bg-1)]"
          style={{ width: 460 }}
          aria-label="warnings board"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {warningsQuery.error ? (
              <div className="p-3">
                <ErrorPanel code={errorCode(warningsQuery.error)} detail={errorDetail(warningsQuery.error)} onRetry={() => void warningsQuery.refetch()} />
              </div>
            ) : warningsQuery.isPending ? (
              <div className="p-3">
                <LoadingBlocks rows={6} height={92} />
              </div>
            ) : warnings.length === 0 ? (
              <EmptyState
                line={`no warnings inside the ${horizon} hour horizon`}
                actionLabel={horizon === 24 ? undefined : 'widen to 24 hours'}
                onAction={horizon === 24 ? undefined : () => setHorizon(24)}
                glyph="prediction"
              />
            ) : (
              WARNING_LEVELS.slice()
                .reverse()
                .map((level) => {
                  const list = byLevel.get(level) ?? []
                  if (list.length === 0) return null
                  return (
                    <div key={level}>
                      <div className="sticky top-0 z-[5] flex items-center gap-2 border-y border-[var(--line-0)] bg-[var(--bg-2)] px-2 py-1">
                        <WarningLevelGlyph level={level} />
                        <span className="mono ml-auto text-[11px] text-[var(--ink-2)]">{list.length}</span>
                      </div>
                      {list.map((w) => (
                        <WarningCard
                          key={w.warning_id}
                          warning={w}
                          now={now}
                          expanded={selected === w.warning_id}
                          onToggle={() => setSelected(selected === w.warning_id ? null : w.warning_id)}
                          onTask={(intervention) => taskMutation.mutate({ warning: w, intervention })}
                        />
                      ))}
                    </div>
                  )
                })
            )}
          </div>

          <div className="flex-none border-t border-[var(--line-0)] p-2">
            <div className="flex flex-col gap-0.5">
              <Overline>measured intervention outcomes</Overline>
              <span className="mono text-[11px] text-[var(--ink-3)]">
                difference in differences against matched control zones
              </span>
            </div>
            <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
              {outcomes.map((o) => (
                <div
                  key={o.outcome_id}
                  className="flex w-[228px] flex-none flex-col gap-1 border border-[var(--line-0)] bg-[var(--bg-2)] p-2"
                  style={{ borderRadius: 'var(--radius-card)' }}
                >
                  <span className="truncate text-[12.5px] text-[var(--ink-1)]" title={o.intervention_label}>
                    {o.intervention_label}
                  </span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">
                    {o.zone_label} · applied {fmtDate(o.applied_at)}
                  </span>
                  <div className="mono flex items-baseline gap-2">
                    <span
                      className="text-[16px]"
                      style={{ color: o.delta_pct < 0 ? 'var(--ok)' : 'var(--critical)' }}
                    >
                      {o.delta_pct > 0 ? '+' : ''}
                      {o.delta_pct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-[var(--ink-2)]">
                      [{o.ci_lo.toFixed(1)} to {o.ci_hi.toFixed(1)}]
                    </span>
                  </div>
                  <span className="mono text-[11px]" style={{ color: o.significant ? 'var(--ok)' : 'var(--medium)' }}>
                    {o.significant ? 'significant' : 'not significant'} · {o.control_zones} control zones
                  </span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">
                    {o.before_rate.toFixed(1)} to {o.after_rate.toFixed(1)} per week
                  </span>
                </div>
              ))}
              {outcomes.length === 0 ? (
                <p className="mono text-[12.5px] text-[var(--ink-2)]">no interventions have completed a measurement window yet.</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function WarningCard({
  warning,
  now,
  expanded,
  onToggle,
  onTask,
}: {
  warning: Warning
  now: number | null
  expanded: boolean
  onToggle: () => void
  onTask: (intervention: Warning['interventions'][number]) => void
}) {
  const remaining = now === null ? null : warning.crossing_at - now
  return (
    <article className="border-b border-[var(--line-0)]">
      <button type="button" onClick={onToggle} className="step flex w-full flex-col gap-1 px-2 py-2 text-left hover:bg-[var(--bg-3)]">
        <div className="flex items-start gap-2">
          <span aria-hidden style={{ width: 2, alignSelf: 'stretch', background: WARNING_COLOR[warning.level], flex: 'none' }} />
          <span className="text-[var(--ink-2)]">
            <Glyph name={DOMAIN_GLYPH[warning.domain]} size={14} />
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] text-[var(--ink-0)]">{warning.headline}</span>
          <span
            className="mono flex-none text-[12.5px]"
            style={{ color: remaining !== null && remaining < 15 * 60_000 ? 'var(--critical)' : 'var(--ink-1)' }}
            title="projected crossing time"
          >
            {remaining === null ? '--:--:--' : remaining <= 0 ? 'crossed' : fmtDuration(remaining)}
          </span>
        </div>
        <div className="mono flex flex-wrap items-center gap-x-3 pl-6 text-[11px] text-[var(--ink-2)]">
          <span>{warning.zone_label}</span>
          <span>{warning.horizon_h}h horizon</span>
          <span>confidence {fmtScore(warning.confidence)}</span>
          <span>issued {fmtTime(warning.issued_at, { ms: false, zone: false })}</span>
          {warning.acknowledged ? <span style={{ color: 'var(--ok)' }}>acknowledged</span> : null}
        </div>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-[var(--line-0)] bg-[var(--bg-2)] px-2 py-2">
          <div>
            <Overline>contributing indicators</Overline>
            <ul className="mt-1 flex flex-col gap-1">
              {warning.indicators.map((ind) => (
                <li key={ind.key} className="mono flex items-center gap-2 text-[11px]">
                  <span className="w-[128px] flex-none truncate text-[var(--ink-1)]">{ind.label}</span>
                  <span className="w-[76px] flex-none text-[var(--ink-0)]">{ind.value}</span>
                  <span
                    style={{
                      color: ind.trend === 'rising' ? 'var(--critical)' : ind.trend === 'falling' ? 'var(--ok)' : 'var(--ink-3)',
                    }}
                  >
                    {ind.trend}
                  </span>
                  <span aria-hidden className="relative ml-auto h-1.5 w-[64px]" style={{ background: 'var(--line-0)' }}>
                    <span style={{ position: 'absolute', inset: 0, width: `${ind.weight * 100}%`, background: 'var(--violet)' }} />
                  </span>
                  <span className="w-[32px] text-right text-[var(--ink-2)]">{fmtScore(ind.weight)}</span>
                </li>
              ))}
            </ul>
          </div>

          {warning.cascade.length > 0 ? (
            <div>
              <Overline>cascade zones</Overline>
              <ul className="mono mt-1 flex flex-col gap-0.5 text-[11px]">
                {warning.cascade.map((c) => (
                  <li key={c.zone_id} className="flex items-center gap-2">
                    <Glyph name="route" size={11} />
                    <span className="flex-1 text-[var(--ink-1)]">{c.zone_label}</span>
                    <span className="text-[var(--ink-2)]">+{c.lag_min} min</span>
                    <span className="text-[var(--ink-3)]">attenuation {fmtScore(c.attenuation)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <Overline>recommended interventions</Overline>
            <ul className="mt-1 flex flex-col gap-1.5">
              {warning.interventions.map((intervention) => (
                <li
                  key={intervention.intervention_id}
                  className="flex flex-col gap-1 border border-[var(--line-0)] p-2"
                  style={{ borderRadius: 'var(--radius-chip)' }}
                >
                  <span className="text-[12.5px] text-[var(--ink-0)]">{intervention.label}</span>
                  <span className="text-[11px] text-[var(--ink-2)]">{intervention.rationale}</span>
                  <div className="mono flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="text-[var(--ink-2)]">
                      expected effect <span style={{ color: 'var(--ok)' }}>{fmtPct(intervention.expected_effect)}</span>
                    </span>
                    <span className="text-[var(--ink-2)]">cost {intervention.cost_tier}</span>
                    <span className="text-[var(--ink-2)]">feasibility {fmtScore(intervention.feasibility)}</span>
                    <span className="text-[var(--ink-3)]">{intervention.department}</span>
                    {intervention.taskable ? (
                      <button
                        type="button"
                        onClick={() => onTask(intervention)}
                        className="step ml-auto flex items-center gap-1 border border-[var(--line-1)] px-1.5 py-0.5 text-[var(--ink-1)] hover:text-[var(--ink-0)]"
                        style={{ borderRadius: 'var(--radius-chip)' }}
                      >
                        <Glyph name="patrol-car" size={11} />
                        task patrol
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </article>
  )
}
