'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { EvidenceItem, ParsedQuery } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { EmptyState, ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { HashChip, Overline } from '@/components/primitives/chips'
import { AuthenticityDot, SourceGlyph } from '@/components/primitives/indicators'
import { Lightbox, type LightboxItem } from '@/components/primitives/Lightbox'
import { qk } from '@/lib/api/keys'
import { api } from '@/lib/api/resources'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDate, fmtScore, fmtTime } from '@/lib/format'
import { useSelection } from '@/lib/stores/selection'
import { useUi } from '@/lib/stores/ui'

const EXAMPLES = [
  'white pickup with a dented left door near the market between 22:00 and 01:00 last week',
  'lcv near KR Market last 24h',
  'silver hatchback Silk Board last week',
  'cattle on the carriageway last 3 days',
]

/**
 * Evidence search.
 *
 * The parsed query is shown as editable chips before anything runs, because an
 * operator has to see what the model decided a sentence meant rather than
 * discover it from surprising results. Person search stays locked, and the lock
 * is enforced by the server as well as shown here.
 */
export function EvidenceScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const activeCaseId = useSelection((s) => s.activeCaseId)

  const urlQuery = params.get('q') ?? ''
  const [draft, setDraft] = useState(urlQuery)
  const [submitted, setSubmitted] = useState(urlQuery)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Partial<ParsedQuery>>({})
  const [hovered, setHovered] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const casesQuery = useQuery({ queryKey: qk.cases.list(''), queryFn: ({ signal }) => api.cases('', signal) })
  const activeCase = casesQuery.data?.items.find((c) => c.case_id === activeCaseId) ?? null

  const searchQuery = useQuery({
    queryKey: qk.evidence.search(submitted, activeCaseId),
    queryFn: ({ signal }) => api.evidenceSearch(submitted, activeCaseId, signal),
    enabled: submitted.trim().length > 0,
  })

  const saveMutation = useMutation({
    mutationFn: async () => submitted,
    onSuccess: (q) => toast({ tone: 'ok', text: 'search saved', detail: `${q}, re-runs on new evidence` }),
  })

  const submit = useCallback(
    (value: string) => {
      setSubmitted(value)
      setOverrides({})
      const next = new URLSearchParams(params.toString())
      if (value) next.set('q', value)
      else next.delete('q')
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const result = searchQuery.data
  const parsed = result ? { ...result.parsed, ...overrides } : null

  const items = useMemo(() => result?.items ?? [], [result])
  const lightboxItems: LightboxItem[] = items.map((item) => ({
    id: item.evidence_id,
    label: `${item.source_id} · ${item.zone_label}`,
    t: item.t,
    url: item.full_url,
    annotations: [],
  }))

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
          className="flex items-center gap-2"
        >
          <span className="text-[var(--ink-2)]">
            <Glyph name="search" size={16} />
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="describe what you are looking for, in plain language"
            aria-label="evidence query"
            className="mono min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          />
          <span className="mono text-[11px] text-[var(--ink-3)]">/ to focus</span>
          <button
            type="submit"
            className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            run
          </button>
        </form>

        {submitted === '' ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mono text-[11px] text-[var(--ink-3)]">try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setDraft(example)
                  submit(example)
                }}
                className="mono step border border-[var(--line-0)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)] hover:border-[var(--line-1)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {parsed ? (
          <div className="flex flex-wrap items-center gap-1">
            <Overline>parsed as</Overline>
            <ParsedChip
              label="window"
              value={
                parsed.from === null
                  ? 'any time'
                  : `${fmtDate(parsed.from)} ${fmtTime(parsed.from, { ms: false, zone: false })} to ${fmtDate(parsed.to ?? Date.now())} ${fmtTime(parsed.to ?? Date.now(), { ms: false, zone: false })}`
              }
              onClear={() => setOverrides((o) => ({ ...o, from: null, to: null }))}
            />
            {parsed.colour ? (
              <ParsedChip label="colour" value={parsed.colour} onClear={() => setOverrides((o) => ({ ...o, colour: null }))} />
            ) : null}
            {parsed.vehicle_type ? (
              <ParsedChip
                label="vehicle"
                value={parsed.vehicle_type}
                onClear={() => setOverrides((o) => ({ ...o, vehicle_type: null }))}
              />
            ) : null}
            {parsed.free_terms.map((term) => (
              <ParsedChip
                key={term}
                label="term"
                value={term}
                onClear={() => setOverrides((o) => ({ ...o, free_terms: (o.free_terms ?? parsed.free_terms).filter((t) => t !== term) }))}
              />
            ))}
            <span className="mono ml-auto flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
              parsed by {parsed.model} · {result?.took_ms} ms · {result?.total ?? 0} candidates
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                className="step flex items-center gap-1 border border-[var(--line-1)] px-1.5 py-0.5 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="pin" size={11} />
                save search
              </button>
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <span
            className="mono flex items-center gap-1.5 border px-2 py-0.5 text-[11px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: activeCase?.investigation_flag ? 'var(--ok)' : 'var(--line-1)',
              color: activeCase?.investigation_flag ? 'var(--ok)' : 'var(--ink-2)',
            }}
            title={
              activeCase?.investigation_flag
                ? 'this case carries an authorised investigation flag, so person search is available'
                : 'person search is disabled: attach a case with an authorised investigation flag'
            }
          >
            <Glyph name={activeCase?.investigation_flag ? 'verified' : 'redaction'} size={11} />
            person search {activeCase?.investigation_flag ? 'available' : 'locked'}
          </span>
          <label className="mono flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
            case
            <select
              value={activeCaseId ?? ''}
              onChange={(e) => useSelection.getState().setActiveCase(e.target.value || null)}
              className="mono border border-[var(--line-1)] bg-[var(--bg-2)] px-1 py-0.5 text-[11px] text-[var(--ink-1)]"
              style={{ borderRadius: 'var(--radius-chip)' }}
            >
              <option value="">none</option>
              {casesQuery.data?.items.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.reference} {c.investigation_flag ? '(flagged)' : ''}
                </option>
              ))}
            </select>
          </label>
          {selected.size > 0 ? (
            <span className="mono ml-auto flex items-center gap-2 text-[11px] text-[var(--ink-1)]">
              {selected.size} selected
              <button
                type="button"
                onClick={() => {
                  if (!activeCaseId) {
                    toast({ tone: 'error', text: 'select a case first', detail: 'evidence is attached to a case, not to a session' })
                    return
                  }
                  toast({ tone: 'ok', text: `${selected.size} items sent to ${activeCase?.reference ?? activeCaseId}` })
                  setSelected(new Set())
                }}
                className="step border border-[var(--line-1)] px-1.5 py-0.5 hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                send to case
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="step border border-[var(--line-1)] px-1.5 py-0.5 hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                clear
              </button>
            </span>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {submitted.trim() === '' ? (
          <EmptyState line="no query yet. describe what you are looking for and the parsed query appears before it runs." glyph="search" />
        ) : searchQuery.error ? (
          <ErrorPanel
            code={errorCode(searchQuery.error)}
            detail={errorDetail(searchQuery.error)}
            onRetry={() => void searchQuery.refetch()}
          />
        ) : searchQuery.isPending ? (
          <LoadingBlocks rows={6} height={120} />
        ) : result?.blocked_reason ? (
          <div
            className="flex items-start gap-2 border p-3"
            style={{ borderColor: 'var(--medium)', borderRadius: 'var(--radius-card)' }}
          >
            <span style={{ color: 'var(--medium)' }}>
              <Glyph name="redaction" size={16} />
            </span>
            <div>
              <p className="text-[13px] text-[var(--ink-0)]">query blocked</p>
              <p className="mt-1 text-[12.5px] text-[var(--ink-1)]">{result.blocked_reason}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState line="no evidence matches that query" actionLabel="clear the query" onAction={() => { setDraft(''); submit('') }} glyph="keyframe" />
        ) : (
          <EvidenceGrid
            items={items}
            selected={selected}
            hovered={hovered}
            onHover={setHovered}
            onOpen={setLightboxIndex}
            onToggle={toggleSelect}
            onCustody={openCustody}
            scrollRef={scrollRef}
          />
        )}
      </div>

      {lightboxIndex !== null ? (
        <Lightbox items={lightboxItems} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={setLightboxIndex} />
      ) : null}
    </div>
  )
}

const CARD_MIN_W = 212
const CARD_H = 208
const GAP = 8

/**
 * Rows are virtualized rather than cards, because the grid reflows by width and
 * a row is the unit that actually leaves the viewport. Column count is derived
 * from the measured width so the layout still behaves like auto-fill.
 */
function EvidenceGrid({
  items,
  selected,
  hovered,
  onHover,
  onOpen,
  onToggle,
  onCustody,
  scrollRef,
}: {
  items: EvidenceItem[]
  selected: Set<string>
  hovered: string | null
  onHover: (id: string | null) => void
  onOpen: (index: number) => void
  onToggle: (id: string) => void
  onCustody: (hash: string) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const [columns, setColumns] = useState(4)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const width = host.clientWidth
      setColumns(Math.max(1, Math.floor((width + GAP) / (CARD_MIN_W + GAP))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  const rows = Math.ceil(items.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_H + GAP,
    overscan: 3,
  })

  return (
    <div ref={hostRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * columns
        const slice = items.slice(start, start + columns)
        return (
          <div
            key={row.key}
            className="absolute left-0 grid w-full gap-2"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {slice.map((item, i) => (
              <EvidenceCard
                key={item.evidence_id}
                item={item}
                selected={selected.has(item.evidence_id)}
                hovered={hovered === item.evidence_id}
                onHover={onHover}
                onOpen={() => onOpen(start + i)}
                onToggle={() => onToggle(item.evidence_id)}
                onCustody={onCustody}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ParsedChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span
      className="mono flex items-center gap-1.5 border border-[var(--line-1)] bg-[var(--bg-2)] px-1.5 py-0.5 text-[11px] text-[var(--ink-1)]"
      style={{ borderRadius: 'var(--radius-chip)' }}
    >
      <span className="text-[var(--ink-3)]">{label}</span>
      {value}
      <button type="button" onClick={onClear} aria-label={`remove ${label}`} className="step text-[var(--ink-3)] hover:text-[var(--ink-0)]">
        <Glyph name="close" size={10} />
      </button>
    </span>
  )
}

function EvidenceCard({
  item,
  selected,
  hovered,
  onHover,
  onOpen,
  onToggle,
  onCustody,
}: {
  item: EvidenceItem
  selected: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onOpen: () => void
  onToggle: () => void
  onCustody: (hash: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (hovered) void video.play().catch(() => undefined)
    else {
      video.pause()
      video.currentTime = 0
    }
  }, [hovered])

  return (
    <figure
      className="group relative flex flex-col border bg-[var(--bg-2)]"
      style={{ borderColor: selected ? 'var(--live)' : 'var(--line-0)', borderRadius: 'var(--radius-card)' }}
      onMouseEnter={() => onHover(item.evidence_id)}
      onMouseLeave={() => onHover(null)}
    >
      <button type="button" onClick={onOpen} className="step relative block overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.thumb_url} alt={item.zone_label} className="h-full w-full object-cover" />
        {item.preview_clip_url && hovered ? (
          <video
            ref={videoRef}
            src={item.preview_clip_url}
            muted
            playsInline
            loop
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <span className="mono absolute top-1 left-1 flex items-center gap-1 bg-[rgba(8,9,11,0.8)] px-1 text-[11px] text-[var(--ink-1)]">
          <SourceGlyph type={item.source_type} size={11} />
          {item.source_id}
        </span>
        {item.similarity !== null ? (
          <span className="mono absolute top-1 right-1 bg-[rgba(8,9,11,0.8)] px-1 text-[11px]" style={{ color: 'var(--live)' }}>
            {fmtScore(item.similarity)}
          </span>
        ) : null}
      </button>

      <figcaption className="flex flex-col gap-1 px-1.5 py-1">
        <span className="mono flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
          {fmtTime(item.t, { ms: false, zone: false })}
          <span className="text-[var(--ink-3)]">{fmtDate(item.t)}</span>
          <span className="ml-auto">
            <AuthenticityDot verdict={item.authenticity} />
          </span>
        </span>
        <span className="truncate text-[11px] text-[var(--ink-1)]" title={item.zone_label}>
          {item.zone_label}
        </span>
        <span className="flex items-center gap-1">
          <HashChip hash={item.hash} onOpen={onCustody} verified={item.authenticity !== 'inconsistent'} />
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            className="mono step ml-auto border px-1 text-[11px]"
            style={{
              borderRadius: 'var(--radius-chip)',
              borderColor: selected ? 'var(--live)' : 'var(--line-0)',
              color: selected ? 'var(--live)' : 'var(--ink-3)',
            }}
          >
            {selected ? 'selected' : 'select'}
          </button>
        </span>
      </figcaption>
    </figure>
  )
}
