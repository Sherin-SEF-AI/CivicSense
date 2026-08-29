'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Glyph } from '@/components/glyphs'
import { Overline } from '@/components/primitives/chips'
import { EmptyState, LoadingBlocks } from '@/components/primitives/panels'
import { request } from '@/lib/api/client'
import { API_BASE } from '@/lib/env'
import { fmtDateTime } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'

const KINDS = [
  { value: 'patrol-car', label: 'dashcam' },
  { value: 'cctv-fixed', label: 'cctv, fixed' },
  { value: 'cctv-ptz', label: 'cctv, ptz' },
  { value: 'bodycam', label: 'bodycam' },
  { value: 'phone', label: 'phone' },
  { value: 'drone', label: 'drone' },
  { value: 'sensor', label: 'sensor log' },
] as const

const UploadListSchema = z.object({
  items: z.array(
    z.object({
      upload_id: z.string(),
      sha256: z.string(),
      source_id: z.string(),
      uploaded_by: z.string(),
      uploaded_at: z.number(),
      purpose: z.string(),
      original_name: z.string().nullable(),
      media_kind: z.string(),
      duration_ms: z.number().nullable(),
      state: z.string(),
      analysis: z.string(),
      detection: z
        .object({
          detection_id: z.string(),
          classes: z.array(z.string()),
          confidence: z.number(),
          summary: z.string(),
          proposed_situation: z.string().nullable(),
          situation_confidence: z.number(),
          situation_reason: z.string(),
          frames_examined: z.number(),
          model: z.string(),
          adjudication: z.string(),
          adjudicated_by: z.string().nullable(),
          adjudication_note: z.string(),
          incident_id: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
})

/**
 * Intake for material that was handed over rather than captured.
 *
 * The screen is built around one distinction, because everything downstream
 * depends on it. What the platform established for itself is shown as fact: the
 * digest, the container's own metadata, which frames were examined. What the
 * person handing the file over asserted is shown as their assertion: where it
 * was taken, when, by what. Nothing on this screen lets the second quietly
 * become the first.
 *
 * A detection never opens an incident. It proposes, and a person with the
 * authority to open one rules on it in front of the frames it was drawn from.
 */
export function UploadScreen() {
  const toast = useUi((s) => s.toast)
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [kind, setKind] = useState<string>('patrol-car')
  const [purpose, setPurpose] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [capturedAt, setCapturedAt] = useState('')
  const [note, setNote] = useState('')
  const [sensorKind, setSensorKind] = useState('noise')
  const [unit, setUnit] = useState('dB(A)')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  const list = useQuery({
    queryKey: ['uploads'],
    queryFn: ({ signal }) => request('/uploads', UploadListSchema, { signal }),
    refetchInterval: 20_000,
  })

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('choose a file first')
      const body = new FormData()
      body.append('file', file)
      body.append('source_kind', kind)
      body.append('purpose', purpose)
      if (lat.trim()) body.append('lat', lat.trim())
      if (lon.trim()) body.append('lon', lon.trim())
      if (capturedAt.trim()) body.append('captured_at', String(Date.parse(capturedAt)))
      if (note.trim()) body.append('note', note.trim())
      if (kind === 'sensor') {
        body.append('sensor_kind', sensorKind)
        body.append('unit', unit)
      }

      const response = await fetch(`${API_BASE}/uploads`, { method: 'POST', body })
      const parsed = (await response.json()) as { error?: string; detail?: string; note?: string; readings?: number }
      if (!response.ok) throw new Error(parsed.detail ?? parsed.error ?? `upload failed with ${response.status}`)
      return parsed
    },
    onSuccess: (result) => {
      toast({
        tone: 'ok',
        text: result.readings ? `${result.readings} readings stored` : 'stored, hashed and examined',
        detail: result.note,
      })
      setFile(null)
      setPurpose('')
      if (fileRef.current) fileRef.current.value = ''
      void qc.invalidateQueries({ queryKey: ['uploads'] })
    },
    onError: (error) => toast({ tone: 'error', text: 'not accepted', detail: error.message }),
  })

  const rule = useMutation({
    mutationFn: (input: { detection_id: string; decision: 'confirmed' | 'rejected'; note: string }) =>
      request(
        '/uploads/adjudicate',
        z.object({ incident_id: z.string().nullable(), state: z.string(), note: z.string() }),
        { method: 'POST', body: input },
      ),
    onSuccess: (result) => {
      toast({
        tone: result.incident_id ? 'ok' : 'info',
        text: result.incident_id ? `incident ${result.incident_id} opened` : 'recorded, no incident opened',
        detail: result.note,
      })
      void qc.invalidateQueries({ queryKey: ['uploads'] })
    },
    onError: (error) => toast({ tone: 'error', text: 'not recorded', detail: error.message }),
  })

  const ready = file !== null && purpose.trim().length >= 8 && !upload.isPending

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">intake</h1>
        <p className="mono text-[11px] text-[var(--ink-3)]">
          material handed over rather than captured. it is hashed and put under custody exactly as an edge capture is,
          and everything it claims about itself stays marked as a claim.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[420px_1fr] overflow-hidden">
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-[var(--line-0)] p-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer.files[0]
              if (dropped) setFile(dropped)
            }}
            className="flex flex-col items-center gap-2 border border-dashed p-6 text-center"
            style={{
              borderRadius: 'var(--radius-card)',
              borderColor: dragging ? 'var(--live)' : 'var(--line-1)',
              background: dragging ? 'var(--bg-2)' : undefined,
            }}
          >
            <Glyph name="export" size={18} />
            <p className="text-[12.5px] text-[var(--ink-1)]">
              {file ? file.name : 'drop a recording, an audio file or a sensor log here'}
            </p>
            <p className="mono text-[11px] text-[var(--ink-3)]">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || 'unknown type'}`
                : 'video, audio, images, and csv or json readings'}
            </p>
            <input
              ref={fileRef}
              type="file"
              aria-label="file to upload"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mono text-[11px] text-[var(--ink-2)]"
            />
          </div>

          <label className="flex flex-col gap-1">
            <Overline>what kind of source</Overline>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
              style={{ borderRadius: 'var(--radius-chip)' }}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          {kind === 'sensor' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="what is measured" value={sensorKind} onChange={setSensorKind} />
              <Field label="unit" value={unit} onChange={setUnit} />
            </div>
          ) : null}

          <label className="flex flex-col gap-1">
            <Overline>why this is being brought in</Overline>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="dashcam clip handed in by a member of the public"
              className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] placeholder:text-[var(--ink-3)]"
              style={{ borderRadius: 'var(--radius-chip)' }}
            />
            <span className="mono text-[11px] text-[var(--ink-3)]">
              this goes into the custody record. a blank reason makes the chain formally complete and useless.
            </span>
          </label>

          <div
            className="flex flex-col gap-2 border p-2"
            style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--line-0)' }}
          >
            <Overline>stated by you, not measured</Overline>
            <p className="mono text-[11px] text-[var(--ink-3)]">
              nothing corroborates any of this. it is stored as your assertion and shown as one wherever it appears.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="latitude" value={lat} onChange={setLat} />
              <Field label="longitude" value={lon} onChange={setLon} />
            </div>
            <Field label="when it was captured" value={capturedAt} onChange={setCapturedAt} placeholder="2026-08-29 14:30" />
            <Field label="anything else worth recording" value={note} onChange={setNote} />
          </div>

          <button
            type="button"
            disabled={!ready}
            onClick={() => upload.mutate()}
            className="mono step border px-2 py-1.5 text-[12.5px] disabled:opacity-40"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: ready ? 'var(--live)' : 'var(--line-1)',
              color: ready ? 'var(--live)' : 'var(--ink-3)',
            }}
          >
            {upload.isPending ? 'hashing, examining, this can take a minute' : 'bring it in'}
          </button>
        </section>

        <section className="flex min-h-0 flex-col overflow-y-auto p-3">
          <Overline>what has been brought in</Overline>
          {list.isPending ? (
            <div className="mt-2">
              <LoadingBlocks rows={4} height={72} />
            </div>
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <EmptyState line="nothing has been uploaded yet" glyph="export" />
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {list.data!.items.map((item) => (
                <UploadCard
                  key={item.upload_id}
                  item={item}
                  onRule={(detection_id, decision, ruling) => rule.mutate({ detection_id, decision, note: ruling })}
                  pending={rule.isPending}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

type Item = z.infer<typeof UploadListSchema>['items'][number]

function UploadCard({
  item,
  onRule,
  pending,
}: {
  item: Item
  onRule: (detectionId: string, decision: 'confirmed' | 'rejected', note: string) => void
  pending: boolean
}) {
  const [ruling, setRuling] = useState('')
  const analysis = safeParse(item.analysis)
  const sampling = typeof analysis.sampling === 'string' ? analysis.sampling : null
  const transcript = analysis.transcript as { text?: string; language?: string } | undefined
  const open = item.detection && item.detection.adjudication === 'open' && item.detection.proposed_situation

  return (
    <li
      className="flex flex-col gap-2 border bg-[var(--bg-1)] p-2"
      style={{ borderRadius: 'var(--radius-card)', borderColor: open ? 'var(--medium)' : 'var(--line-0)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Glyph name={item.media_kind === 'audio' ? 'audio-segment' : item.media_kind === 'sensor' ? 'sensor' : 'clip'} size={12} />
        <span className="text-[12.5px] text-[var(--ink-0)]">{item.original_name ?? item.upload_id}</span>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          {item.media_kind}
          {item.duration_ms ? ` · ${(item.duration_ms / 1000).toFixed(1)} s` : ''} · {fmtDateTime(item.uploaded_at)} ·{' '}
          {item.uploaded_by}
        </span>
        <span className="mono ml-auto text-[11px] text-[var(--ink-2)]">{item.state.replace(/_/g, ' ')}</span>
      </div>

      <p className="mono text-[11px] break-all text-[var(--ink-3)]">
        sha-256 {item.sha256.slice(0, 32)} · attributed to {item.source_id}
      </p>
      <p className="text-[12.5px] text-[var(--ink-1)]">{item.purpose}</p>

      {sampling ? <p className="mono text-[11px] text-[var(--ink-2)]">{sampling}</p> : null}

      {item.detection ? (
        <div
          className="flex flex-col gap-1 border-t border-[var(--line-0)] pt-2"
        >
          <span className="mono text-[11px] text-[var(--ink-3)]">
            read by {item.detection.model} from {item.detection.frames_examined} frame(s)
          </span>
          <p className="text-[12.5px] text-[var(--ink-1)]">{item.detection.summary}</p>
          {item.detection.classes.length > 0 ? (
            <p className="mono text-[11px] text-[var(--ink-2)]">seen: {item.detection.classes.join(', ')}</p>
          ) : null}

          {item.detection.proposed_situation ? (
            <div className="mono flex flex-wrap items-center gap-2 text-[11px]">
              <span style={{ color: 'var(--medium)' }}>proposes {item.detection.proposed_situation}</span>
              <span className="text-[var(--ink-3)]">{item.detection.situation_reason}</span>
            </div>
          ) : (
            <p className="mono text-[11px] text-[var(--ink-3)]">
              nothing proposed, which is the usual and correct outcome
            </p>
          )}
        </div>
      ) : null}

      {transcript?.text ? (
        <p className="mono text-[11px] text-[var(--ink-2)]">
          transcript ({transcript.language}): {transcript.text.slice(0, 180)}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2 border-t border-[var(--line-0)] pt-2">
          <span className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
            a model reading sampled frames proposed this. it is not an incident until you say so.
          </span>
          <input
            value={ruling}
            onChange={(e) => setRuling(e.target.value)}
            placeholder="why you are confirming or rejecting"
            aria-label={`ruling for ${item.upload_id}`}
            className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] placeholder:text-[var(--ink-3)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || ruling.trim().length < 10}
              onClick={() => onRule(item.detection!.detection_id, 'confirmed', ruling.trim())}
              className="mono step border px-2 py-1 text-[12.5px] disabled:opacity-40"
              style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--ok)', color: 'var(--ok)' }}
            >
              confirm and open an incident
            </button>
            <button
              type="button"
              disabled={pending || ruling.trim().length < 10}
              onClick={() => onRule(item.detection!.detection_id, 'rejected', ruling.trim())}
              className="mono step border px-2 py-1 text-[12.5px] disabled:opacity-40"
              style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--line-1)', color: 'var(--ink-1)' }}
            >
              reject
            </button>
          </div>
        </div>
      ) : item.detection && item.detection.adjudication !== 'open' ? (
        <p className="mono border-t border-[var(--line-0)] pt-2 text-[11px] text-[var(--ink-2)]">
          {item.detection.adjudication} by {item.detection.adjudicated_by}
          {item.detection.incident_id ? `, opened ${item.detection.incident_id}` : ''}. {item.detection.adjudication_note}
        </p>
      ) : null}
    </li>
  )
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <Overline>{label}</Overline>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)] placeholder:text-[var(--ink-3)]"
        style={{ borderRadius: 'var(--radius-chip)' }}
      />
    </label>
  )
}
