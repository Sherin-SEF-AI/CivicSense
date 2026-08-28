'use client'

import { useMemo, useState } from 'react'
import type { CausalGraph } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { EvidenceChip, Overline } from '@/components/primitives/chips'
import { fmtScore, fmtTime } from '@/lib/format'

const CLASS_COLOR: Record<string, string> = {
  infrastructure: 'var(--domain-infrastructure)',
  behavioural: 'var(--violet)',
  environmental: 'var(--ok)',
  regulatory: 'var(--medium)',
  systemic: 'var(--high)',
}

/**
 * The why-graph, drawn as a left-to-right chain because civic causation is
 * almost always a sequence rather than a web, and a force-directed blob would
 * hide that. Nodes are draggable vertically to untangle crossings; edges carry
 * their confidence, and the counterfactual toggle dims the branch the prediction
 * engine says would have removed the outcome.
 */
export function CausalGraphPanel({ graph, onEvidence }: { graph: CausalGraph; onEvidence?: (id: string) => void }) {
  const [counterfactual, setCounterfactual] = useState(false)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [dragging, setDragging] = useState<{ id: string; startY: number; startOffset: number } | null>(null)

  const layout = useMemo(() => {
    const width = Math.max(560, graph.nodes.length * 190)
    const step = graph.nodes.length > 1 ? (width - 160) / (graph.nodes.length - 1) : 0
    const positions = new Map<string, { x: number; y: number }>()
    graph.nodes.forEach((node, i) => {
      positions.set(node.id, { x: 80 + i * step, y: 92 + (offsets[node.id] ?? 0) })
    })
    return { width, positions }
  }, [graph.nodes, offsets])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Overline>causal graph</Overline>
        <button
          type="button"
          aria-pressed={counterfactual}
          onClick={() => setCounterfactual((v) => !v)}
          className="mono step flex items-center gap-1.5 border px-2 py-0.5 text-[11px]"
          style={{
            borderRadius: 'var(--radius-chip)',
            borderColor: counterfactual ? 'var(--live)' : 'var(--line-1)',
            color: counterfactual ? 'var(--live)' : 'var(--ink-2)',
          }}
          title="dim the branch the prediction engine says would have removed the outcome"
        >
          <Glyph name="prediction" size={11} />
          counterfactual
        </button>
        <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">drag a node to untangle</span>
      </div>

      <div className="overflow-x-auto border border-[var(--line-0)] bg-[var(--bg-2)]" style={{ borderRadius: 'var(--radius-card)' }}>
        <svg
          width={layout.width}
          height={200}
          role="img"
          aria-label="causal graph"
          onPointerMove={(e) => {
            if (!dragging) return
            const delta = e.clientY - dragging.startY
            setOffsets((o) => ({ ...o, [dragging.id]: Math.max(-56, Math.min(56, dragging.startOffset + delta)) }))
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
        >
          {graph.edges.map((edge) => {
            const from = layout.positions.get(edge.from)
            const to = layout.positions.get(edge.to)
            if (!from || !to) return null
            const key = `${edge.from}-${edge.to}`
            const dimmed = counterfactual && edge.counterfactual
            return (
              <g key={key} onMouseEnter={() => setHoverEdge(key)} onMouseLeave={() => setHoverEdge(null)}>
                <line
                  x1={from.x + 62}
                  y1={from.y}
                  x2={to.x - 62}
                  y2={to.y}
                  stroke={dimmed ? 'var(--line-0)' : 'var(--line-1)'}
                  strokeWidth={hoverEdge === key ? 2 : 1}
                  strokeDasharray={dimmed ? '3 3' : undefined}
                />
                <path
                  d={`M${to.x - 62} ${to.y} l-6 -4 l0 8 z`}
                  fill={dimmed ? 'var(--line-0)' : 'var(--line-1)'}
                />
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 6}
                  textAnchor="middle"
                  className="mono"
                  fontSize={11}
                  fill={hoverEdge === key ? 'var(--ink-0)' : 'var(--ink-3)'}
                >
                  {fmtScore(edge.confidence)}
                </text>
              </g>
            )
          })}

          {graph.nodes.map((node) => {
            const p = layout.positions.get(node.id)!
            const color = node.root_cause_class ? CLASS_COLOR[node.root_cause_class] ?? 'var(--ink-2)' : 'var(--ink-2)'
            return (
              <g
                key={node.id}
                transform={`translate(${p.x - 62}, ${p.y - 26})`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  setDragging({ id: node.id, startY: e.clientY, startOffset: offsets[node.id] ?? 0 })
                }}
                style={{ cursor: 'ns-resize' }}
              >
                <rect width={124} height={52} fill="var(--bg-1)" stroke={color} strokeWidth={1} rx={2} />
                <rect width={2} height={52} fill={color} />
                <foreignObject x={8} y={5} width={110} height={42}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      lineHeight: 1.25,
                      color: 'var(--ink-1)',
                      fontFamily: 'var(--font-ui)',
                    }}
                  >
                    {node.label}
                  </span>
                </foreignObject>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-x-3">
        <Overline>ranked root causes</Overline>
        <span className="mono text-[11px] text-[var(--ink-3)]">share</span>
        {graph.root_causes.map((rc) => (
          <div key={rc.node_id} className="contents">
            <span className="flex items-center gap-2 border-t border-[var(--line-0)] py-1 text-[12.5px] text-[var(--ink-1)]">
              <span aria-hidden style={{ width: 8, height: 8, background: CLASS_COLOR[rc.class] ?? 'var(--ink-2)' }} />
              {rc.label}
              <span className="mono text-[11px] text-[var(--ink-3)]">{rc.class}</span>
            </span>
            <span className="mono border-t border-[var(--line-0)] py-1 text-right text-[12.5px] text-[var(--ink-0)]">
              {fmtScore(rc.share)}
            </span>
          </div>
        ))}
      </div>

      {onEvidence ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mono text-[11px] text-[var(--ink-3)]">node evidence</span>
          {graph.nodes.flatMap((n) =>
            n.evidence_ids.map((id) => <EvidenceChip key={`${n.id}-${id}`} id={id} onOpen={onEvidence} />),
          )}
        </div>
      ) : null}

      <p className="mono text-[11px] text-[var(--ink-3)]">
        edges are constructed from temporal precedence, spatial proximity and the rule library. model-proposed edges
        appear only with cited evidence, and the timestamps come from the reconstructed timeline
        {graph.nodes[0]?.t ? `, anchored at ${fmtTime(graph.nodes[0].t)}` : ''}.
      </p>
    </div>
  )
}
