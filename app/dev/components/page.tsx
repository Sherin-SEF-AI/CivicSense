'use client'

import { useState } from 'react'
import { PRIORITY_BANDS, SYNC_QUALITIES } from '@/lib/api/schemas/common'
import { WARNING_LEVELS } from '@/lib/api/schemas/predict'
import { SOURCE_TYPES } from '@/lib/api/schemas/common'
import { DOMAINS } from '@/lib/api/schemas/common'
import type { Domain, PriorityBand, SourceType, SyncQuality } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import {
  AuthenticityDot,
  ConfidenceInterval,
  DomainGlyph,
  Meter,
  PriorityBar,
  PriorityTag,
  SourceGlyph,
  StatusLED,
  SyncGrade,
  TrustBar,
  WarningLevelGlyph,
} from '@/components/primitives/indicators'
import { CopyChip, EvidenceChip, FilterChip, HashChip, KeyHint, Overline, SLACountdown } from '@/components/primitives/chips'
import {
  Collapsible,
  EmptyState,
  ErrorPanel,
  LoadingBlocks,
  MetricTile,
  StackedSeverityBar,
  StepStrip,
} from '@/components/primitives/panels'
import { Drawer } from '@/components/primitives/Drawer'
import { ScopeChart } from '@/components/data/ScopeChart'
import { DataTable, type Column } from '@/components/data/DataTable'
import { CANVAS } from '@/lib/tokens'
import { useUi } from '@/lib/stores/ui'

/**
 * Every primitive in every state, on one page.
 *
 * This is where a component is checked against the design language before it
 * reaches a screen: the states that are hard to reach in the product, an SLA
 * inside its last five per cent, an inconsistent authenticity verdict, a
 * measurement too uncertain to be called one, are all one scroll away here.
 */
export default function ComponentGallery() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filters, setFilters] = useState<Set<string>>(new Set(['traffic']))
  const toast = useUi((s) => s.toast)
  const openCustody = useUi((s) => s.openCustody)
  const now = Date.now()

  const severityComponents = [
    { key: 'inherent', label: 'inherent severity', raw: 0.92, weight: 0.34, contribution: 0.313, note: 'fire base severity' },
    { key: 'contextual', label: 'contextual amplifiers', raw: 0.78, weight: 0.2, contribution: 0.156, note: 'transit hub' },
    { key: 'temporal', label: 'temporal urgency', raw: 0.9, weight: 0.12, contribution: 0.108, note: '19:40 IST' },
    { key: 'population', label: 'affected population', raw: 0.85, weight: 0.14, contribution: 0.119, note: '34 people' },
    { key: 'escalation', label: 'escalation potential', raw: 0.8, weight: 0.12, contribution: 0.096, note: 'bounded amplifier' },
    { key: 'infrastructure', label: 'infrastructure risk', raw: 0.6, weight: 0.08, contribution: 0.048, note: 'asset registry' },
  ]

  interface Row {
    id: string
    label: string
    value: number
  }
  const tableRows: Row[] = Array.from({ length: 60 }, (_, i) => ({
    id: `R-${i}`,
    label: `row ${i} with a longer label to test truncation`,
    value: Math.round(Math.sin(i) * 100) / 100,
  }))
  const tableColumns: Column<Row>[] = [
    { key: 'id', header: 'id', width: 90, render: (r) => r.id, sortValue: (r) => r.id },
    { key: 'label', header: 'label', width: 320, prose: true, render: (r) => <span className="truncate">{r.label}</span> },
    { key: 'value', header: 'value', width: 90, align: 'right', render: (r) => r.value.toFixed(2), sortValue: (r) => r.value },
  ]

  const series = Array.from({ length: 120 }, (_, i) => now - (119 - i) * 60_000)

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-6 py-6">
      <header className="border-b border-[var(--line-0)] pb-4">
        <h1 className="text-[20px] leading-tight">component gallery</h1>
        <p className="mono mt-2 text-[12.5px] text-[var(--ink-1)]">
          every primitive, in every state that matters. dev only.
        </p>
      </header>

      <Section title="priority and domain">
        <Row label="priority tag">
          {PRIORITY_BANDS.map((band) => (
            <PriorityTag key={band} priority={band as PriorityBand} blink={band === 'CRITICAL'} />
          ))}
        </Row>
        <Row label="priority bar">
          {PRIORITY_BANDS.map((band) => (
            <span key={band} className="flex items-center gap-1">
              <PriorityBar priority={band as PriorityBand} height={20} blink={band === 'CRITICAL'} />
              <span className="mono text-[11px] text-[var(--ink-3)]">{band}</span>
            </span>
          ))}
        </Row>
        <Row label="domain glyph">
          {DOMAINS.map((d) => (
            <DomainGlyph key={d} domain={d as Domain} withLabel />
          ))}
        </Row>
        <Row label="source glyph">
          {SOURCE_TYPES.map((t) => (
            <span key={t} className="flex items-center gap-1 text-[var(--ink-2)]">
              <SourceGlyph type={t as SourceType} />
              <span className="mono text-[11px]">{t}</span>
            </span>
          ))}
        </Row>
      </Section>

      <Section title="state">
        <Row label="status led">
          {(['up', 'degraded', 'down', 'maintenance'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <StatusLED state={s} label={s} />
              <span className="mono text-[11px] text-[var(--ink-2)]">{s}</span>
            </span>
          ))}
        </Row>
        <Row label="sync grade">
          {SYNC_QUALITIES.map((g) => (
            <SyncGrade key={g} grade={g as SyncQuality} />
          ))}
        </Row>
        <Row label="authenticity">
          {(['verified', 'consistent', 'unverifiable', 'inconsistent'] as const).map((v) => (
            <span key={v} className="flex items-center gap-1.5">
              <AuthenticityDot verdict={v} />
              <span className="mono text-[11px] text-[var(--ink-2)]">{v}</span>
            </span>
          ))}
        </Row>
        <Row label="warning level">
          {WARNING_LEVELS.map((level) => (
            <WarningLevelGlyph key={level} level={level} />
          ))}
        </Row>
        <Row label="trust">
          <TrustBar trust={0.94} />
          <TrustBar trust={0.71} />
          <TrustBar trust={0.38} />
        </Row>
        <Row label="budget meter">
          <Meter value={3} max={12} />
          <Meter value={11} max={12} />
          <Meter value={13.4} max={12} />
        </Row>
      </Section>

      <Section title="measurement">
        <Row label="confidence interval">
          <ConfidenceInterval value={0.72} lo={0.61} hi={0.83} />
          <ConfidenceInterval value={53.2} lo={48.4} hi={58.0} digits={1} />
        </Row>
        <Row label="sla countdown">
          <SLACountdown dueAt={now + 40 * 60_000} slaSeconds={3600} />
          <SLACountdown dueAt={now + 9 * 60_000} slaSeconds={3600} />
          <SLACountdown dueAt={now + 90_000} slaSeconds={3600} />
          <SLACountdown dueAt={now - 120_000} slaSeconds={3600} />
          <SLACountdown dueAt={null} slaSeconds={0} />
        </Row>
        <div className="mt-2 max-w-[520px]">
          <StackedSeverityBar components={severityComponents} score={0.84} />
        </div>
      </Section>

      <Section title="evidence chrome">
        <Row label="hash chip">
          <HashChip hash="8b8fa93f2c41ad09bb7cd0e5f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4" onOpen={openCustody} />
          <HashChip hash="d74e8b5d1c2b3a495867f0e1d2c3b4a596877665544332211009988776655443" onOpen={openCustody} verified={false} />
        </Row>
        <Row label="evidence chip">
          <EvidenceChip id="OBS-CAM-005-7KG48Z" onOpen={() => toast({ tone: 'info', text: 'opened evidence' })} />
          <EvidenceChip id="OBS-MISSING-0001" invalid onOpen={() => undefined} />
        </Row>
        <Row label="copy chip">
          <CopyChip value="01M145VTQ7PZWA9AQ328WNJMSH" />
        </Row>
        <Row label="key hint">
          <KeyHint keys="mod+k" />
          <KeyHint keys=", ." />
          <KeyHint keys="space" />
        </Row>
        <Row label="filter chip">
          {DOMAINS.slice(0, 4).map((d) => (
            <FilterChip
              key={d}
              label={d}
              count={12}
              active={filters.has(d)}
              onToggle={() =>
                setFilters((prev) => {
                  const next = new Set(prev)
                  if (next.has(d)) next.delete(d)
                  else next.add(d)
                  return next
                })
              }
            />
          ))}
        </Row>
      </Section>

      <Section title="progression">
        <div className="max-w-[520px]">
          <StepStrip status="dispatched" />
        </div>
        <div className="mt-3 max-w-[520px]">
          <StepStrip status="detected" dismissed />
        </div>
      </Section>

      <Section title="tiles and panels">
        <div className="grid grid-cols-4 gap-2">
          <MetricTile label="coverage" value="0.82" glyph="keyframe" />
          <MetricTile label="sla compliance" value="54%" glyph="sla-timer" tone="warn" />
          <MetricTile label="reopened" value="12" glyph="reopen" tone="bad" delta={{ value: '3', direction: 'down' }} />
          <MetricTile label="verified" value="96%" glyph="resolve" tone="ok" delta={{ value: '2', direction: 'up' }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="border border-[var(--line-0)]" style={{ borderRadius: 'var(--radius-card)' }}>
            <Collapsible title="collapsible section">
              <p className="text-[12.5px] text-[var(--ink-1)]">content sits inside, and the header carries the overline.</p>
            </Collapsible>
          </div>
          <ErrorPanel code="schema_mismatch" detail="incidents[0].css.hi: expected number" onRetry={() => undefined} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="border border-[var(--line-0)]" style={{ borderRadius: 'var(--radius-card)' }}>
            <EmptyState line="no incidents match these filters" actionLabel="clear filters" onAction={() => undefined} />
          </div>
          <div>
            <Overline>loading, static blocks and never a shimmer</Overline>
            <div className="mt-1.5">
              <LoadingBlocks rows={5} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="charts">
        <div className="max-w-[620px] border border-[var(--line-0)] p-2" style={{ borderRadius: 'var(--radius-card)' }}>
          <ScopeChart
            x={series}
            series={[
              {
                label: 'noise',
                color: CANVAS.live,
                fill: CANVAS.liveFill,
                values: series.map((_, i) => 55 + Math.sin(i / 9) * 7),
                band: {
                  lo: series.map((_, i) => 52 + Math.sin(i / 9) * 7),
                  hi: series.map((_, i) => 58 + Math.sin(i / 9) * 7),
                },
                unit: 'dB(A)',
              },
            ]}
            height={130}
            limit={65}
            limitLabel="limit 65 dB(A)"
          />
        </div>
      </Section>

      <Section title="table, virtualized">
        <div className="h-[280px] border border-[var(--line-0)]" style={{ borderRadius: 'var(--radius-card)' }}>
          <DataTable rows={tableRows} columns={tableColumns} rowKey={(r) => r.id} ariaLabel="gallery table" />
        </div>
      </Section>

      <Section title="overlays">
        <Row label="">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            open drawer
          </button>
          <button
            type="button"
            onClick={() => toast({ tone: 'ok', text: 'acknowledged', detail: 'toasts stack to three' })}
            className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            toast, ok
          </button>
          <button
            type="button"
            onClick={() => toast({ tone: 'error', text: 'dispatch failed', detail: 'errors never auto-dismiss' })}
            className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            toast, error
          </button>
          <button
            type="button"
            onClick={() => openCustody('8b8fa93f2c41ad09bb7cd0e5f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4')}
            className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            open custody
          </button>
        </Row>
      </Section>

      {drawerOpen ? (
        <div className="fixed inset-y-0 right-0 z-40 flex">
          <Drawer
            open
            onClose={() => setDrawerOpen(false)}
            ariaLabel="gallery drawer"
            title={
              <>
                <Glyph name="incident" size={16} />
                <span>drawer</span>
              </>
            }
            subtitle="resizable, escape closes, focus returns"
          >
            <div className="p-3">
              <p className="text-[12.5px] text-[var(--ink-1)]">
                the drawer hosts detail without leaving the screen, so the map behind stays live.
              </p>
            </div>
          </Drawer>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="overline mb-3">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line-0)] py-2 last:border-b-0">
      <span className="mono w-[128px] flex-none text-[11px] text-[var(--ink-3)]">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
