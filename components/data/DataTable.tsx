'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Glyph } from '@/components/glyphs'
import { useUi } from '@/lib/stores/ui'

export interface Column<T> {
  key: string
  header: string
  width: number
  minWidth?: number
  align?: 'left' | 'right'
  /** Data cells are monospace unless the column is prose. */
  prose?: boolean
  render: (row: T, index: number) => React.ReactNode
  sortValue?: (row: T) => string | number
  csv?: (row: T) => string
}

/**
 * The virtualized table.
 *
 * Row height is a fixed token, which makes the virtualizer's size estimate exact
 * rather than approximate, and that is the difference between smooth scrolling
 * and the jitter you get when every row has to be measured.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  expandedKey,
  renderExpanded,
  emptyLine = 'nothing matches these filters',
  ariaLabel,
  onSortChange,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  expandedKey?: string | null
  renderExpanded?: (row: T) => React.ReactNode
  emptyLine?: string
  ariaLabel: string
  onSortChange?: (key: string, direction: 'asc' | 'desc') => void
}) {
  const density = useUi((s) => s.density)
  const rowHeight = density === 'compact' ? 32 : 40
  const parentRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.width])),
  )
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const dragging = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    setWidths((prev) => {
      const next = { ...prev }
      let changed = false
      for (const c of columns) {
        if (next[c.key] === undefined) {
          next[c.key] = c.width
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [columns])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragging.current
      if (!d) return
      const column = columns.find((c) => c.key === d.key)
      const min = column?.minWidth ?? 56
      setWidths((w) => ({ ...w, [d.key]: Math.max(min, d.startWidth + (e.clientX - d.startX)) }))
    }
    const onUp = () => {
      dragging.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [columns])

  const sorted = useCallback(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)
      if (av === bv) return 0
      return (av < bv ? -1 : 1) * dir
    })
  }, [rows, sort, columns])()

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  const total = columns.reduce((s, c) => s + (widths[c.key] ?? c.width), 0)

  const toggleSort = (key: string) => {
    setSort((s) => {
      const direction: 'asc' | 'desc' = s?.key === key && s.direction === 'asc' ? 'desc' : 'asc'
      onSortChange?.(key, direction)
      return { key, direction }
    })
  }

  /* An empty grid is not a grid. Rendering the role anyway leaves a container
     that promises rows to a screen reader and has none. */
  if (sorted.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col" aria-label={ariaLabel}>
        <div className="flex flex-none border-b border-[var(--line-0)] bg-[var(--bg-2)]" style={{ minWidth: total }}>
          {columns.map((c) => (
            <div
              key={c.key}
              className="overline flex items-center px-2 py-1.5"
              style={{ width: widths[c.key] ?? c.width, flex: 'none' }}
            >
              {c.header}
            </div>
          ))}
        </div>
        <p className="mono px-3 py-6 text-[12.5px] text-[var(--ink-2)]">{emptyLine}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
    {/* The header and the rows are one grid. They were two siblings, which left
        the header row with no grid parent and the grid with no header. The
        expansion panel below stays outside it, because it is not a row. */}
    <div
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={sorted.length + 1}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div role="rowgroup" className="flex-none">
      <div
        role="row"
        aria-rowindex={1}
        className="flex flex-none border-b border-[var(--line-0)] bg-[var(--bg-2)]"
        style={{ minWidth: total }}
      >
        {columns.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            className="relative flex items-center"
            style={{ width: widths[c.key] ?? c.width, flex: 'none' }}
          >
            <button
              type="button"
              onClick={() => c.sortValue && toggleSort(c.key)}
              className={`overline step flex h-7 w-full items-center gap-1 px-2 ${c.align === 'right' ? 'justify-end' : ''} ${c.sortValue ? 'hover:text-[var(--ink-0)]' : 'cursor-default'}`}
            >
              {c.header}
              {sort?.key === c.key ? (
                <Glyph name="chevron-s" size={10} style={{ transform: sort.direction === 'asc' ? 'rotate(180deg)' : undefined }} />
              ) : null}
            </button>
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`resize ${c.header}`}
              onPointerDown={(e) => {
                dragging.current = { key: c.key, startX: e.clientX, startWidth: widths[c.key] ?? c.width }
              }}
              className="absolute top-0 right-0 bottom-0 w-[3px] cursor-col-resize hover:bg-[var(--line-1)]"
            />
          </div>
        ))}
      </div>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        {(
          <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: total }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = sorted[virtualRow.index]!
              const key = rowKey(row)
              const selected = selectedKey === key
              const expanded = expandedKey === key
              return (
                <div
                  key={key}
                  data-index={virtualRow.index}
                  role="row"
                  /* Virtualized rows must announce their real position, not
                     their position in the handful that happen to be mounted. */
                  aria-rowindex={virtualRow.index + 2}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick?.(row)
                    }
                  }}
                  className="step absolute left-0 flex w-full cursor-default items-stretch border-b border-[var(--line-0)] hover:bg-[var(--bg-3)]"
                  style={{
                    height: expanded ? undefined : rowHeight,
                    transform: `translateY(${virtualRow.start}px)`,
                    background: selected ? 'var(--bg-3)' : undefined,
                  }}
                >
                  {columns.map((c) => (
                    <div
                      key={c.key}
                      role="gridcell"
                      className={`flex items-center overflow-hidden px-2 text-[12.5px] ${c.prose ? '' : 'mono'} ${c.align === 'right' ? 'justify-end' : ''}`}
                      style={{ width: widths[c.key] ?? c.width, flex: 'none' }}
                    >
                      {c.render(row, virtualRow.index)}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
      </div>

      {expandedKey && renderExpanded ? (
        <div className="flex-none border-t border-[var(--line-0)] bg-[var(--bg-1)]">
          {(() => {
            const row = sorted.find((r) => rowKey(r) === expandedKey)
            return row ? renderExpanded(row) : null
          })()}
        </div>
      ) : null}
    </div>
  )
}

/** Every table exports what it shows, with the columns the operator is looking at. */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => JSON.stringify(c.header)).join(',')
  const body = rows
    .map((row) => columns.map((c) => JSON.stringify(c.csv ? c.csv(row) : '')).join(','))
    .join('\n')
  return `${head}\n${body}\n`
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
