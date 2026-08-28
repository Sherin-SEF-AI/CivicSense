'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from '@/lib/api/client'
import { Glyph } from '@/components/glyphs'
import { Overline } from '@/components/primitives/chips'
import { fmtDuration, fmtTime } from '@/lib/format'

const SynopsisSchema = z.object({
  source_id: z.string(),
  window: z.tuple([z.number(), z.number()]),
  moments: z.array(
    z.object({
      observation_id: z.string(),
      t: z.number(),
      duration_ms: z.number(),
      payload_kind: z.string(),
      classes: z.array(z.string()),
      trigger: z.string().nullable(),
      incident_id: z.string().nullable(),
      evidence_id: z.string().nullable(),
      media_url: z.string().nullable(),
    }),
  ),
  covered_ms: z.number(),
  compression: z.number(),
  uptime: z.number().nullable(),
})

const HOURS = [1, 6, 24] as const

/**
 * The synopsis.
 *
 * A device that ran for six hours and recorded forty moments is six hours to
 * scroll and forty seconds to watch. This plays only the moments, in the order
 * they happened, at the dwell each one needs.
 *
 * It is not a re-timed overlay. Nothing from two different times is ever shown
 * in the same frame, because that would put two things in one picture that were
 * never in one picture, and an operator would have no way to tell. Each moment
 * carries its own timestamp, and the gap that was skipped before it is stated.
 */
export function Synopsis({ sourceId }: { sourceId: string }) {
  const [hours, setHours] = useState<(typeof HOURS)[number]>(6)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const to = useRef(Date.now()).current
  const query = useQuery({
    queryKey: ['synopsis', sourceId, hours],
    queryFn: ({ signal }) =>
      request(
        `/sources/${encodeURIComponent(sourceId)}/synopsis?from=${to - hours * 3600_000}&to=${to}`,
        SynopsisSchema,
        { signal },
      ),
  })

  const moments = query.data?.moments ?? []
  const current = moments[index] ?? null

  useEffect(() => {
    setIndex(0)
    setPlaying(false)
  }, [sourceId, hours])

  useEffect(() => {
    if (!playing || moments.length === 0) return
    const dwell = Math.min(2500, Math.max(500, current?.duration_ms ?? 600))
    timerRef.current = setTimeout(() => {
      setIndex((i) => {
        if (i + 1 >= moments.length) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, dwell)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [playing, index, moments.length, current])

  const gapBefore = index > 0 && current ? current.t - moments[index - 1]!.t - moments[index - 1]!.duration_ms : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Overline>synopsis</Overline>
        <div className="flex items-center gap-1">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(h)}
              aria-pressed={hours === h}
              className="mono step border px-1.5 py-0.5 text-[11px]"
              style={{
                borderRadius: 'var(--radius-chip)',
                borderColor: hours === h ? 'var(--live)' : 'var(--line-1)',
                color: hours === h ? 'var(--live)' : 'var(--ink-2)',
              }}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <p className="mono text-[11px] text-[var(--ink-3)]">reading the record</p>
      ) : moments.length === 0 ? (
        <p className="mono text-[11px] text-[var(--ink-3)]">
          this source recorded nothing in the last {hours} hours
          {query.data?.uptime === null ? '' : `, and reported ${((query.data?.uptime ?? 0) * 100).toFixed(0)} percent uptime`}
        </p>
      ) : (
        <>
          <div
            className="relative flex aspect-video items-center justify-center overflow-hidden border border-[var(--line-0)] bg-[var(--bg-0)]"
            style={{ borderRadius: 'var(--radius-card)' }}
          >
            {current?.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.media_url} alt={`moment at ${fmtTime(current.t)}`} className="h-full w-full object-contain" />
            ) : (
              <p className="mono text-[11px] text-[var(--ink-3)]">this moment has no image, only a record</p>
            )}
            {current ? (
              <span
                className="mono absolute left-1 top-1 border px-1 py-0.5 text-[11px]"
                style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--line-1)', background: 'var(--bg-1)', color: 'var(--ink-0)' }}
              >
                {fmtTime(current.t)}
              </span>
            ) : null}
            {gapBefore > 1000 ? (
              <span
                className="mono absolute right-1 top-1 border px-1 py-0.5 text-[11px]"
                style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--medium)', background: 'var(--bg-1)', color: 'var(--medium)' }}
                title="time skipped between this moment and the previous one"
              >
                {fmtDuration(gapBefore)} skipped
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? 'pause the synopsis' : 'play the synopsis'}
              className="mono step border px-2 py-0.5 text-[11px]"
              style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--live)', color: 'var(--live)' }}
            >
              {playing ? 'pause' : 'play'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, moments.length - 1)}
              value={index}
              onChange={(e) => {
                setPlaying(false)
                setIndex(Number(e.target.value))
              }}
              aria-label="moment"
              className="min-w-0 flex-1"
            />
            <span className="mono flex-none text-[11px] text-[var(--ink-2)]">
              {index + 1} of {moments.length}
            </span>
          </div>

          <p className="mono text-[11px] text-[var(--ink-3)]">
            {fmtDuration(hours * 3600_000)} of coverage condensed to {fmtDuration(query.data?.covered_ms ?? 0)}, a factor of{' '}
            {query.data?.compression ?? 0}. every moment keeps its own timestamp and nothing is combined.
          </p>

          {current ? (
            <p className="mono flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-2)]">
              <Glyph name={current.trigger ? 'incident' : 'keyframe'} size={11} />
              {current.payload_kind}
              {current.classes.length > 0 ? <span>{current.classes.join(', ')}</span> : null}
              {current.trigger ? <span style={{ color: 'var(--high)' }}>{current.trigger}</span> : null}
              {current.incident_id ? <span className="text-[var(--ink-3)]">{current.incident_id}</span> : null}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
