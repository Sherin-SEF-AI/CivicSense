'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { Glyph } from '@/components/glyphs'
import { Overline } from '@/components/primitives/chips'
import { request } from '@/lib/api/client'
import { useUi } from '@/lib/stores/ui'

const MeasurementSchema = z.union([
  z.object({
    error: z.string(),
    detail: z.string(),
  }),
  z.object({
    operator: z.string(),
    class: z.string(),
    refused: z.string(),
    detail: z.string(),
  }),
  z.object({
    operator: z.string(),
    class: z.string(),
    registry_digest: z.string(),
    params_digest: z.string(),
    result: z.object({
      quantity: z.string(),
      unit: z.string(),
      value: z.number(),
      sigma: z.number(),
      interval_95: z.tuple([z.number(), z.number()]),
      caveats: z.array(z.string()),
      working: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      construction: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
])

type Measurement = z.infer<typeof MeasurementSchema>

/**
 * The two line speed check.
 *
 * It exists so a person can verify the automated speed in front of a magistrate
 * with arithmetic they can follow: two lines a surveyed distance apart, two
 * frame-accurate crossing times, one division. The working is shown because the
 * point of this tool is that the number is checkable, not that it is produced.
 */
export function MetrologyPanel({ incidentId }: { incidentId: string }) {
  const toast = useUi((s) => s.toast)
  const [separationM, setSeparationM] = useState('10.00')
  const [toleranceCm, setToleranceCm] = useState('3')
  const [firstMs, setFirstMs] = useState('0')
  const [secondMs, setSecondMs] = useState('800')
  const [timingMs, setTimingMs] = useState('40')
  const [measurement, setMeasurement] = useState<Measurement | null>(null)

  const run = useMutation({
    mutationFn: () =>
      request('/fis/measure', MeasurementSchema, {
        method: 'POST',
        body: {
          operator: 'V-MET-4',
          incident_id: incidentId,
          params: {
            separation_mm: Math.round(Number(separationM) * 1000),
            separation_tolerance_mm: Math.round(Number(toleranceCm) * 10),
            first_crossing_ms: Math.round(Number(firstMs)),
            second_crossing_ms: Math.round(Number(secondMs)),
            timing_sigma_ms: Math.round(Number(timingMs)),
          },
        },
      }),
    onSuccess: setMeasurement,
    onError: (error) =>
      toast({ tone: 'error', text: 'the measurement did not run', detail: error instanceof Error ? error.message : String(error) }),
  })

  const unavailable = measurement !== null && 'error' in measurement
  const refused = measurement !== null && 'refused' in measurement
  const measured = measurement !== null && 'result' in measurement ? measurement : null

  return (
    <div className="flex flex-col gap-3">
      <p className="mono text-[11px] text-[var(--ink-3)]">
        mark two ground lines a surveyed distance apart, step to the frame where the subject crosses each, and the
        speed follows by division. this is the cross check on the automated figure, and it is arithmetic a person can
        follow.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Field label="separation, metres" value={separationM} onChange={setSeparationM} />
        <Field label="survey tolerance, cm" value={toleranceCm} onChange={setToleranceCm} />
        <Field label="first crossing, ms" value={firstMs} onChange={setFirstMs} />
        <Field label="second crossing, ms" value={secondMs} onChange={setSecondMs} />
        <Field label="frame ambiguity, ms" value={timingMs} onChange={setTimingMs} />
      </div>

      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="mono step self-start border px-2 py-1 text-[12.5px] disabled:opacity-40"
        style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--live)', color: 'var(--live)' }}
      >
        {run.isPending ? 'measuring' : 'measure'}
      </button>

      {unavailable ? (
        <p className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
          the forensic tier is not attached, so no measurement can be taken here.{' '}
          {(measurement as { detail: string }).detail}
        </p>
      ) : null}

      {refused ? (
        <p className="mono text-[11px]" style={{ color: 'var(--high)' }}>
          refused: {(measurement as { refused: string; detail: string }).refused}.{' '}
          {(measurement as { detail: string }).detail}
        </p>
      ) : null}

      {measured ? (
        <section
          className="flex flex-col gap-2 border p-2"
          style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--line-1)' }}
        >
          <div className="flex items-baseline gap-2">
            <span className="mono text-[20px] text-[var(--ink-0)]">{measured.result.value.toFixed(2)}</span>
            <span className="mono text-[12.5px] text-[var(--ink-2)]">{measured.result.unit}</span>
            <span className="mono ml-auto flex items-center gap-1 text-[11px]" style={{ color: 'var(--ok)' }}>
              <Glyph name="verified" size={11} />
              class {measured.class}
            </span>
          </div>

          {/* The interval is the measurement. A bare value would be an assertion. */}
          <p className="mono text-[12.5px] text-[var(--ink-1)]">
            95 percent interval {measured.result.interval_95[0].toFixed(2)} to{' '}
            {measured.result.interval_95[1].toFixed(2)} {measured.result.unit}
          </p>

          {measured.result.working ? (
            <dl className="mono flex flex-col gap-0.5 text-[11px]">
              {Object.entries(measured.result.working).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="w-[170px] flex-none text-[var(--ink-3)]">{key.replace(/_/g, ' ')}</dt>
                  <dd className="text-[var(--ink-1)]">{typeof value === 'number' ? value : String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <ul className="flex flex-col gap-1">
            {measured.result.caveats.map((caveat) => (
              <li key={caveat} className="mono text-[11px] text-[var(--ink-2)]">
                {caveat}
              </li>
            ))}
          </ul>

          <p className="mono text-[11px] break-all text-[var(--ink-3)]">
            {measured.operator} · parameters {measured.params_digest.slice(0, 16)} · registry{' '}
            {measured.registry_digest.slice(0, 16)}
          </p>
        </section>
      ) : null}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <Overline>{label}</Overline>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
        style={{ borderRadius: 'var(--radius-chip)' }}
      />
    </label>
  )
}
