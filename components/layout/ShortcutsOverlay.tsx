'use client'

import { Glyph } from '@/components/glyphs'
import { KeyHint } from '@/components/primitives/chips'
import { useBindingList } from '@/lib/keyboard/useKeys'
import { useUi } from '@/lib/stores/ui'

/** Generated from the key registry, so the reference cannot drift from reality. */
export function ShortcutsOverlay() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  const bindings = useBindingList()

  if (!open) return null

  const groups = new Map<string, typeof bindings>()
  for (const b of bindings) {
    const list = groups.get(b.group) ?? []
    list.push(b)
    groups.set(b.group, list)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,9,11,0.8)]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col border border-[var(--line-1)] bg-[var(--bg-1)]"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--overlay-shadow)' }}
      >
        <header className="flex flex-none items-center gap-2 border-b border-[var(--line-0)] px-3 py-2">
          <span className="text-[16px] text-[var(--ink-0)]">keyboard</span>
          <span className="mono text-[11px] text-[var(--ink-2)]">{bindings.length} bindings in the active scopes</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="close" className="step ml-auto text-[var(--ink-2)] hover:text-[var(--ink-0)]">
            <Glyph name="close" size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {groups.size === 0 ? (
            <p className="mono text-[12.5px] text-[var(--ink-2)]">no bindings are active on this screen</p>
          ) : (
            [...groups.entries()].map(([group, list]) => (
              <section key={group} className="mb-4">
                <h3 className="overline mb-1.5">{group}</h3>
                <ul className="flex flex-col gap-1">
                  {list.map((b) => (
                    <li key={b.id} className="flex items-center gap-3">
                      <KeyHint keys={b.keys} />
                      <span className="text-[12.5px] text-[var(--ink-1)]">{b.label}</span>
                      <span className="mono ml-auto text-[11px] text-[var(--ink-3)]">{b.scope}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
