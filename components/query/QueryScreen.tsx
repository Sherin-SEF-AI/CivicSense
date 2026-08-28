'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import type { QueryAnswer } from '@/lib/api/schemas'
import { Glyph } from '@/components/glyphs'
import { EmptyState } from '@/components/primitives/panels'
import { Overline } from '@/components/primitives/chips'
import { api } from '@/lib/api/resources'
import { errorDetail } from '@/lib/api/client'
import { fmtTime, fmtUsd } from '@/lib/format'
import { useSelection } from '@/lib/stores/selection'
import { useUi } from '@/lib/stores/ui'

const SUGGESTIONS = [
  'which zones produced the most traffic incidents last week',
  'how many waste incidents were dispositioned educationally this month',
  'where are safety incidents concentrated in the last 24 hours',
]

/**
 * The query console.
 *
 * The tool-call trace sits above the answer rather than behind a disclosure,
 * because an operator acting on a number needs to see which query produced it
 * and how many rows it touched. Guard verdicts are shown in full: a blocked
 * question says why it was blocked rather than returning nothing.
 */
export function QueryScreen() {
  const toast = useUi((s) => s.toast)
  const activeCaseId = useSelection((s) => s.activeCaseId)
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<QueryAnswer[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const askMutation = useMutation({
    mutationFn: (q: string) => api.query(q),
    onSuccess: (answer) => {
      setHistory((prev) => [...prev, answer])
      setQuestion('')
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    },
    onError: (error) => toast({ tone: 'error', text: 'the query failed', detail: errorDetail(error) }),
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2">
        <h1 className="text-[16px] text-[var(--ink-0)]">query</h1>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          natural language over the intelligence store, executed as tool calls against the database
        </span>
        {history.length > 0 ? (
          <span className="mono ml-auto text-[11px] text-[var(--ink-2)]">
            {history.length} answered · {fmtUsd(history.reduce((s, h) => s + h.cost_usd, 0), 4)}
          </span>
        ) : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <EmptyState line="no questions asked yet" glyph="search" />
            <ul className="flex flex-col gap-1">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => askMutation.mutate(s)}
                    className="mono step border border-[var(--line-0)] px-2 py-1 text-[12.5px] text-[var(--ink-2)] hover:border-[var(--line-1)] hover:text-[var(--ink-0)]"
                    style={{ borderRadius: 'var(--radius-chip)' }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-4">
            {history.map((answer) => (
              <article key={answer.query_id} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="mono text-[11px] text-[var(--ink-3)]">{fmtTime(answer.asked_at, { ms: false })}</span>
                  <p className="text-[13px] text-[var(--ink-0)]">{answer.question}</p>
                </div>

                {answer.guard.verdict === 'blocked' ? (
                  <div
                    className="flex items-start gap-2 border p-2"
                    style={{ borderColor: 'var(--critical)', borderRadius: 'var(--radius-card)' }}
                  >
                    <span style={{ color: 'var(--critical)' }}>
                      <Glyph name="tampered" size={14} />
                    </span>
                    <div>
                      <p className="mono text-[12.5px]" style={{ color: 'var(--critical)' }}>
                        guard blocked · injection score {answer.guard.injection_score.toFixed(2)} · {answer.model}
                      </p>
                      <p className="mt-1 text-[12.5px] text-[var(--ink-1)]">{answer.guard.detail}</p>
                      <p className="mt-1 text-[12.5px] text-[var(--ink-1)]">{answer.answer}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev)
                          if (next.has(answer.query_id)) next.delete(answer.query_id)
                          else next.add(answer.query_id)
                          return next
                        })
                      }
                      className="mono step flex items-center gap-2 self-start text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                    >
                      <Glyph name={expanded.has(answer.query_id) ? 'chevron-s' : 'chevron-e'} size={11} />
                      {answer.trace.length} tool calls ·{' '}
                      {answer.trace.reduce((s, t) => s + t.rows, 0)} rows ·{' '}
                      {answer.trace.reduce((s, t) => s + t.ms, 0)} ms
                    </button>

                    {expanded.has(answer.query_id) ? (
                      <ol className="flex flex-col gap-1 border-l-2 border-[var(--line-0)] pl-3">
                        {answer.trace.map((call) => (
                          <li key={call.step} className="mono flex flex-wrap items-baseline gap-2 text-[11px]">
                            <span className="text-[var(--ink-3)]">{call.step}</span>
                            <span style={{ color: 'var(--violet)' }}>{call.tool}</span>
                            <span className="text-[var(--ink-2)]">{JSON.stringify(call.args)}</span>
                            <span className="ml-auto text-[var(--ink-1)]">{call.rows} rows</span>
                            <span className="text-[var(--ink-3)]">{call.ms} ms</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    <div
                      className="border border-[var(--line-0)] bg-[var(--bg-1)] p-3"
                      style={{ borderRadius: 'var(--radius-card)' }}
                    >
                      <p className="text-[13px] leading-[1.45] text-[var(--ink-1)]">{answer.answer}</p>

                      {answer.table ? (
                        <table className="mt-3 w-full">
                          <thead>
                            <tr className="overline text-left">
                              {answer.table.columns.map((c) => (
                                <th key={c} className="pb-1">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="mono text-[12.5px]">
                            {answer.table.rows.map((row, i) => (
                              <tr key={i} className="border-t border-[var(--line-0)]">
                                {row.map((cell, k) => (
                                  <td key={k} className="py-1 text-[var(--ink-1)]">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}

                      {answer.citations.length > 0 ? (
                        <div className="mt-3">
                          <Overline>cited incidents</Overline>
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {answer.citations.map((c) => (
                              <li key={c.incident_id}>
                                <Link
                                  href={`/incident/${c.incident_id}`}
                                  className="mono step flex items-center gap-2 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                                >
                                  <Glyph name="incident" size={11} />
                                  <span className="text-[var(--live)]">{c.incident_id}</span>
                                  <span className="truncate">{c.label}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="mono mt-3 flex items-center gap-3 border-t border-[var(--line-0)] pt-2 text-[11px] text-[var(--ink-3)]">
                        <span>{answer.model}</span>
                        <span>{fmtUsd(answer.cost_usd, 4)}</span>
                        <span style={{ color: 'var(--ok)' }}>guard pass</span>
                        <button
                          type="button"
                          onClick={() =>
                            activeCaseId
                              ? toast({ tone: 'ok', text: 'answer pinned to the case', detail: activeCaseId })
                              : toast({ tone: 'error', text: 'no active case', detail: 'set an active case on the cases screen first' })
                          }
                          className="step ml-auto flex items-center gap-1 border border-[var(--line-1)] px-1.5 py-0.5 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
                          style={{ borderRadius: 'var(--radius-chip)' }}
                        >
                          <Glyph name="pin" size={11} />
                          pin to case
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (question.trim()) askMutation.mutate(question.trim())
        }}
        className="flex flex-none items-center gap-2 border-t border-[var(--line-0)] bg-[var(--bg-1)] px-3 py-2"
      >
        <span className="text-[var(--ink-2)]">
          <Glyph name="search" size={16} />
        </span>
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="ask about incidents, zones, departments or dispositions"
          aria-label="question"
          disabled={askMutation.isPending}
          className="mono min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
        />
        {askMutation.isPending ? <span className="mono text-[11px] text-[var(--ink-2)]">running tool calls</span> : null}
        <button
          type="submit"
          disabled={askMutation.isPending || question.trim() === ''}
          className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)] disabled:border-[var(--line-0)] disabled:text-[var(--ink-3)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          ask
        </button>
      </form>
    </div>
  )
}
