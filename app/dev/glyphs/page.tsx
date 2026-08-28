'use client'

import { useState } from 'react'
import {
  GLYPHS,
  GLYPH_CATEGORIES,
  Glyph,
  glyphsByCategory,
  type GlyphName,
} from '@/components/glyphs'

const SIZES = [14, 16, 20] as const

const CATEGORY_TITLES: Record<(typeof GLYPH_CATEGORIES)[number], string> = {
  domain: 'domains',
  source: 'sources',
  evidence: 'evidence and forensics',
  operations: 'operations',
  system: 'system',
  chrome: 'chrome',
}

export default function GlyphGallery() {
  const [copied, setCopied] = useState<GlyphName | null>(null)

  const copy = async (name: GlyphName) => {
    await navigator.clipboard.writeText(`<Glyph name="${name}" />`)
    setCopied(name)
    window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200)
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-6 border-b border-[var(--line-0)] pb-4">
        <h1 className="text-[20px] font-semibold leading-tight">CS Glyphs</h1>
        <p className="mono mt-2 text-[12.5px] text-[var(--ink-1)]">
          {Object.keys(GLYPHS).length} glyphs · 16x16 viewBox · stroke 1.5 · angles 0/45/90
        </p>
      </header>

      {GLYPH_CATEGORIES.map((category) => {
        const names = glyphsByCategory(category)
        return (
          <section key={category} className="mb-8">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="overline">{CATEGORY_TITLES[category]}</h2>
              <span className="mono text-[11px] text-[var(--ink-3)]">{names.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-px bg-[var(--line-0)]">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void copy(name)}
                  title={`copy <Glyph name="${name}" />`}
                  className="step flex flex-col items-center gap-3 bg-[var(--bg-1)] px-3 py-4 text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                >
                  <div className="flex items-end gap-4">
                    {SIZES.map((size) => (
                      <Glyph key={size} name={name} size={size} />
                    ))}
                  </div>
                  <span className="mono text-[11px] text-[var(--ink-2)]">
                    {copied === name ? 'copied' : name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
