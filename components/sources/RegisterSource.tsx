'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SOURCE_TYPES } from '@/lib/api/schemas/common'
import { SENSOR_KINDS } from '@/lib/api/schemas/observation'
import { Glyph } from '@/components/glyphs'
import { Overline } from '@/components/primitives/chips'
import { api } from '@/lib/api/resources'
import { errorDetail } from '@/lib/api/client'
import { qk } from '@/lib/api/keys'
import { useUi } from '@/lib/stores/ui'

/**
 * Registering a real device.
 *
 * A source is an address the platform can reach and a position it speaks about.
 * Nothing is inferred: if a camera has no calibration it contributes
 * corroboration rather than measurement, and the form says so rather than
 * filling the field in.
 */
export function RegisterSource({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const [form, setForm] = useState({
    source_id: '',
    source_type: 'cctv-fixed',
    label: '',
    lat: '',
    lon: '',
    heading_deg: '',
    fov_deg: '',
    range_m: '',
    stream_url: '',
    stream_kind: 'rtsp',
    sync_quality: 'C',
    sensor_kind: '',
    representativity_m: '',
  })

  const isSensor = form.source_type === 'sensor'

  const mutation = useMutation({
    mutationFn: () =>
      api.registerSource({
        source_id: form.source_id.trim(),
        source_type: form.source_type,
        label: form.label.trim(),
        lat: Number(form.lat),
        lon: Number(form.lon),
        heading_deg: form.heading_deg === '' ? null : Number(form.heading_deg),
        fov_deg: form.fov_deg === '' ? null : Number(form.fov_deg),
        range_m: form.range_m === '' ? null : Number(form.range_m),
        stream_url: form.stream_url.trim() || null,
        stream_kind: form.stream_url.trim() ? form.stream_kind : 'none',
        sync_quality: form.sync_quality,
        sensor_kind: isSensor ? form.sensor_kind || null : null,
        representativity_m: isSensor && form.representativity_m !== '' ? Number(form.representativity_m) : null,
      }),
    onSuccess: async (device) => {
      await qc.invalidateQueries({ queryKey: qk.sources.all() })
      toast({
        tone: 'ok',
        text: `${device.source_id} registered in ${device.zone_label}`,
        detail: 'it stays down until it sends its first observation',
      })
      onDone()
    },
    onError: (error) => toast({ tone: 'error', text: 'registration failed', detail: errorDetail(error) }),
  })

  const valid =
    form.source_id.trim() !== '' &&
    form.label.trim() !== '' &&
    Number.isFinite(Number(form.lat)) &&
    form.lat !== '' &&
    Number.isFinite(Number(form.lon)) &&
    form.lon !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) mutation.mutate()
      }}
      className="flex flex-col gap-3 border border-[var(--line-0)] bg-[var(--bg-1)] p-3"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <div className="flex items-center gap-2">
        <Glyph name="edge-device" size={14} />
        <Overline>register a source</Overline>
        <button
          type="button"
          onClick={onDone}
          aria-label="close"
          className="step ml-auto text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name="close" size={12} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Field label="identifier" value={form.source_id} onChange={(v) => setForm({ ...form, source_id: v })} placeholder="CAM-001" required />
        <label className="mono flex flex-col gap-1 text-[11px] text-[var(--ink-2)]">
          type
          <select
            value={form.source_type}
            onChange={(e) => setForm({ ...form, source_type: e.target.value })}
            className="border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <Field label="label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Victoria Road, north approach" required />
        <label className="mono flex flex-col gap-1 text-[11px] text-[var(--ink-2)]">
          sync quality
          <select
            value={form.sync_quality}
            onChange={(e) => setForm({ ...form, sync_quality: e.target.value })}
            title="A under 10 ms, B under 100 ms, C under 1 s, D unknown"
            className="border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            {(['A', 'B', 'C', 'D'] as const).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <Field label="latitude" value={form.lat} onChange={(v) => setForm({ ...form, lat: v })} placeholder="12.97160" required />
        <Field label="longitude" value={form.lon} onChange={(v) => setForm({ ...form, lon: v })} placeholder="77.59460" required />
        {!isSensor ? (
          <>
            <Field label="heading, degrees" value={form.heading_deg} onChange={(v) => setForm({ ...form, heading_deg: v })} placeholder="90" />
            <Field label="field of view" value={form.fov_deg} onChange={(v) => setForm({ ...form, fov_deg: v })} placeholder="60" />
            <Field label="range, metres" value={form.range_m} onChange={(v) => setForm({ ...form, range_m: v })} placeholder="80" />
          </>
        ) : (
          <>
            <label className="mono flex flex-col gap-1 text-[11px] text-[var(--ink-2)]">
              measures
              <select
                value={form.sensor_kind}
                onChange={(e) => setForm({ ...form, sensor_kind: e.target.value })}
                className="border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <option value="">select</option>
                {SENSOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="representativity, metres"
              value={form.representativity_m}
              onChange={(v) => setForm({ ...form, representativity_m: v })}
              placeholder="100"
            />
          </>
        )}

        <div className="col-span-2">
          <Field
            label="stream url"
            value={form.stream_url}
            onChange={(v) => setForm({ ...form, stream_url: v })}
            placeholder="rtsp://camera.local/stream1, or leave empty for a device that pushes"
          />
        </div>
        {form.stream_url.trim() !== '' ? (
          <label className="mono flex flex-col gap-1 text-[11px] text-[var(--ink-2)]">
            stream kind
            <select
              value={form.stream_kind}
              onChange={(e) => setForm({ ...form, stream_kind: e.target.value })}
              className="border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
              style={{ borderRadius: 'var(--radius-chip)' }}
            >
              <option value="rtsp">rtsp</option>
              <option value="hls">hls</option>
              <option value="file">file</option>
            </select>
          </label>
        ) : null}
      </div>

      <p className="mono text-[11px] text-[var(--ink-3)]">
        the source is registered as down and contributes nothing until it posts to /api/v1/ingest/observation. a camera
        without a calibration contributes corroboration rather than measurement.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!valid || mutation.isPending}
          className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)] disabled:border-[var(--line-0)] disabled:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          {mutation.isPending ? 'registering' : 'register'}
        </button>
        {!valid ? (
          <span className="mono text-[11px] text-[var(--ink-3)]">identifier, label and a position are required</span>
        ) : null}
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="mono flex flex-col gap-1 text-[11px] text-[var(--ink-2)]">
      {label}
      {required ? <span className="sr-only">required</span> : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-[var(--line-1)] bg-[var(--bg-2)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
        style={{ borderRadius: 'var(--radius-chip)' }}
      />
    </label>
  )
}
