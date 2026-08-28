'use client'

import { useEffect, useRef } from 'react'
import { Glyph } from '@/components/glyphs'
import { useResizable } from './panels'

/**
 * The right context drawer. It hosts detail without leaving the screen, which is
 * the whole reason an operator can stay on the map while triaging.
 *
 * It is not modal: the map behind stays live and interactive. Escape closes it,
 * and focus returns to whatever opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  storageKey = 'cs.drawer.width',
  min = 360,
  max = 620,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  storageKey?: string
  min?: number
  max?: number
}) {
  const { width, startDrag } = useResizable(storageKey, 400, min, max)
  const panel = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement
    } else if (restoreFocus.current instanceof HTMLElement) {
      restoreFocus.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const node = panel.current
    node?.addEventListener('keydown', onKey)
    return () => node?.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <aside
      ref={panel}
      aria-label={typeof title === 'string' ? title : 'detail'}
      className="relative flex h-full flex-none flex-col border-l border-[var(--line-0)] bg-[var(--bg-1)]"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="resize drawer"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()
        }}
        className="absolute top-0 bottom-0 left-0 w-[3px] cursor-col-resize hover:bg-[var(--line-1)]"
      />
      <header className="flex flex-none items-start gap-2 border-b border-[var(--line-0)] px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2 text-[16px] leading-[1.2] text-[var(--ink-0)]">{title}</div>
          {subtitle ? <div className="mono truncate text-[11px] text-[var(--ink-2)]">{subtitle}</div> : null}
        </div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label="close drawer"
          title="close (esc)"
          className="step text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name="close" size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}
