'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Glyph, type GlyphName } from '@/components/glyphs'
import { useUi } from '@/lib/stores/ui'

interface RailItem {
  href: string
  glyph: GlyphName
  label: string
  match: (path: string) => boolean
}

const ITEMS: RailItem[] = [
  { href: '/ops', glyph: 'incident', label: 'operations', match: (p) => p.startsWith('/ops') || p.startsWith('/incident') },
  { href: '/forensics', glyph: 'timeline', label: 'forensics', match: (p) => p.startsWith('/forensics') },
  { href: '/evidence', glyph: 'keyframe', label: 'evidence', match: (p) => p.startsWith('/evidence') },
  { href: '/cases', glyph: 'playbook', label: 'cases', match: (p) => p.startsWith('/case') },
  { href: '/predict', glyph: 'prediction', label: 'predict', match: (p) => p.startsWith('/predict') },
  { href: '/sources', glyph: 'cctv-fixed', label: 'sources', match: (p) => p.startsWith('/sources') },
  { href: '/analytics', glyph: 'trust', label: 'analytics', match: (p) => p.startsWith('/analytics') },
  { href: '/query', glyph: 'search', label: 'query', match: (p) => p.startsWith('/query') },
  { href: '/admin', glyph: 'settings', label: 'admin', match: (p) => p.startsWith('/admin') },
]

export function SystemRail() {
  const pathname = usePathname()
  const density = useUi((s) => s.density)
  const setDensity = useUi((s) => s.setDensity)
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)

  return (
    <nav
      aria-label="sections"
      className="flex h-full flex-none flex-col items-center border-r border-[var(--line-0)] bg-[var(--bg-1)]"
      style={{ width: 'var(--rail-w)' }}
    >
      <Link
        href="/ops"
        aria-label="CivicSense home"
        title="CivicSense"
        className="step flex h-9 w-full items-center justify-center text-[var(--live)]"
      >
        <Glyph name="incident" size={18} />
      </Link>

      <ul className="flex w-full flex-1 flex-col items-center gap-0.5 pt-1">
        {ITEMS.map((item) => {
          const active = item.match(pathname)
          return (
            <li key={item.href} className="w-full">
              <Link
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className="step relative flex h-9 w-full items-center justify-center"
                style={{ color: active ? 'var(--ink-0)' : 'var(--ink-2)', background: active ? 'var(--bg-3)' : undefined }}
              >
                {active ? (
                  <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--live)' }} />
                ) : null}
                <Glyph name={item.glyph} size={16} />
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="flex w-full flex-col items-center gap-0.5 border-t border-[var(--line-0)] py-1">
        <button
          type="button"
          onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
          title={`density: ${density}. click for ${density === 'compact' ? 'comfortable' : 'compact'}`}
          aria-label={`density ${density}`}
          className="step flex h-8 w-full items-center justify-center text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <Glyph name={density === 'compact' ? 'collapse' : 'expand'} size={14} />
        </button>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          title="keyboard shortcuts (?)"
          aria-label="keyboard shortcuts"
          className="mono step flex h-8 w-full items-center justify-center text-[12.5px] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          ?
        </button>
        <span
          title="S. Srambickal, administrator"
          className="mono flex h-7 w-7 items-center justify-center border border-[var(--line-1)] text-[11px] text-[var(--ink-1)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          SS
        </span>
      </div>
    </nav>
  )
}
