'use client'

import { Glyph } from '@/components/glyphs'
import { useUi } from '@/lib/stores/ui'

const TONE = {
  info: { color: 'var(--live)', glyph: 'pre-alert' },
  ok: { color: 'var(--ok)', glyph: 'acknowledge' },
  error: { color: 'var(--critical)', glyph: 'tampered' },
} as const

/** Bottom left, at most three, errors stay until dismissed. */
export function ToastHost() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-3 left-[52px] z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const tone = TONE[t.tone]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-[380px] items-start gap-2 border bg-[var(--bg-2)] px-3 py-2"
            style={{
              borderColor: tone.color,
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--overlay-shadow)',
            }}
          >
            <span style={{ color: tone.color, marginTop: 1 }}>
              <Glyph name={tone.glyph} size={14} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[12.5px] text-[var(--ink-0)]">{t.text}</span>
              {t.detail ? <span className="mono text-[11px] text-[var(--ink-2)]">{t.detail}</span> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="dismiss"
              className="step ml-auto text-[var(--ink-2)] hover:text-[var(--ink-0)]"
            >
              <Glyph name="close" size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
