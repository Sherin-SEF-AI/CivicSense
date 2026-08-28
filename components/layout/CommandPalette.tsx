'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Glyph, type GlyphName } from '@/components/glyphs'
import { KeyHint } from '@/components/primitives/chips'
import { api } from '@/lib/api/resources'
import { qk } from '@/lib/api/keys'
import { useUi } from '@/lib/stores/ui'
import { useSelection } from '@/lib/stores/selection'

export interface Command {
  id: string
  label: string
  group: string
  glyph: GlyphName
  keys?: string
  run: () => void | Promise<void>
}

/**
 * Cmd/Ctrl+K. Navigation, saved searches, and actions on whatever is focused,
 * which is what makes the keyboard path complete: an operator never has to reach
 * for the mouse to act on the incident they are looking at.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const toast = useUi((s) => s.toast)
  const router = useRouter()
  const qc = useQueryClient()
  const selectedIncident = useSelection((s) => s.incidentId)
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      ['operations', '/ops', 'incident'],
      ['evidence search', '/evidence', 'keyframe'],
      ['cases', '/cases', 'playbook'],
      ['predict', '/predict', 'prediction'],
      ['sources', '/sources', 'cctv-fixed'],
      ['analytics', '/analytics', 'trust'],
      ['query console', '/query', 'search'],
      ['admin', '/admin', 'settings'],
    ].map(([label, href, glyph]) => ({
      id: `nav:${href}`,
      label: `go to ${label}`,
      group: 'navigate',
      glyph: glyph as GlyphName,
      run: () => router.push(href as string),
    }))

    const onSelection: Command[] = selectedIncident
      ? [
          {
            id: 'act:ack',
            label: `acknowledge ${selectedIncident}`,
            group: 'focused incident',
            glyph: 'acknowledge',
            keys: 'a',
            run: async () => {
              await api.incidentAction(selectedIncident, 'ack')
              await qc.invalidateQueries({ queryKey: qk.incidents.all() })
              toast({ tone: 'ok', text: 'acknowledged', detail: selectedIncident })
            },
          },
          {
            id: 'act:dispatch',
            label: `dispatch ${selectedIncident}`,
            group: 'focused incident',
            glyph: 'dispatch',
            keys: 'd',
            run: async () => {
              await api.incidentAction(selectedIncident, 'dispatch')
              await qc.invalidateQueries({ queryKey: qk.incidents.all() })
              toast({ tone: 'ok', text: 'dispatched', detail: selectedIncident })
            },
          },
          {
            id: 'act:forensics',
            label: 'open in forensics',
            group: 'focused incident',
            glyph: 'timeline',
            keys: 'f',
            run: () => router.push(`/forensics/${selectedIncident}`),
          },
          {
            id: 'act:package',
            label: 'open the intelligence package',
            group: 'focused incident',
            glyph: 'playbook',
            run: () => router.push(`/incident/${selectedIncident}`),
          },
          {
            id: 'act:case',
            label: 'create a case from this incident',
            group: 'focused incident',
            glyph: 'custody',
            run: async () => {
              const created = await api.caseCreate(`case from ${selectedIncident}`, [selectedIncident])
              await qc.invalidateQueries({ queryKey: qk.cases.all() })
              router.push(`/case/${created.case_id}`)
            },
          },
        ]
      : []

    const utility: Command[] = [
      {
        id: 'util:refresh',
        label: 'refetch every active query',
        group: 'utility',
        glyph: 'ota',
        run: async () => {
          await qc.invalidateQueries()
          toast({ tone: 'info', text: 'refetched active queries' })
        },
      },
      {
        id: 'util:shortcuts',
        label: 'show keyboard shortcuts',
        group: 'utility',
        glyph: 'settings',
        keys: '?',
        run: () => useUi.getState().setShortcutsOpen(true),
      },
    ]

    return [...nav, ...onSelection, ...utility]
  }, [router, qc, selectedIncident, toast])

  const jumpId = value.trim().length >= 6 && /^[0-9A-Z-]+$/i.test(value.trim()) ? value.trim() : null

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    const base = q === '' ? commands : commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.includes(q))
    if (jumpId) {
      return [
        {
          id: 'jump',
          label: `open incident ${jumpId}`,
          group: 'jump',
          glyph: 'incident' as GlyphName,
          run: () => router.push(`/incident/${jumpId}`),
        },
        ...base,
      ]
    }
    return base
  }, [commands, value, jumpId, router])

  useEffect(() => {
    if (open) {
      setValue('')
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  if (!open) return null

  const run = async (command: Command) => {
    setOpen(false)
    try {
      await command.run()
    } catch (error) {
      toast({ tone: 'error', text: 'command failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(8,9,11,0.7)] pt-[12vh]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[560px] max-w-[92vw] flex-col border border-[var(--line-1)] bg-[var(--bg-1)]"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--overlay-shadow)' }}
      >
        <div className="flex items-center gap-2 border-b border-[var(--line-0)] px-3 py-2">
          <span className="text-[var(--ink-2)]">
            <Glyph name="search" size={14} />
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(filtered.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const command = filtered[cursor]
                if (command) void run(command)
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder="command, or an incident id to jump to"
            aria-label="command"
            className="mono w-full bg-transparent text-[13px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
          />
          <KeyHint keys="esc" />
        </div>

        <ul ref={listRef} className="max-h-[46vh] overflow-y-auto py-1" role="listbox" aria-label="commands">
          {filtered.length === 0 ? (
            <li className="mono px-3 py-3 text-[12.5px] text-[var(--ink-2)]">no command matches that</li>
          ) : (
            filtered.map((command, i) => (
              <li key={command.id} data-index={i} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void run(command)}
                  className="step flex w-full items-center gap-2 px-3 py-1.5 text-left"
                  style={{ background: i === cursor ? 'var(--bg-3)' : undefined }}
                >
                  <span className="text-[var(--ink-2)]">
                    <Glyph name={command.glyph} size={14} />
                  </span>
                  <span className="flex-1 truncate text-[12.5px] text-[var(--ink-0)]">{command.label}</span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">{command.group}</span>
                  {command.keys ? <KeyHint keys={command.keys} /> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
