'use client'

import { create } from 'zustand'
import type { GlyphName } from '@/components/glyphs'

export type Density = 'compact' | 'comfortable'

export interface Toast {
  id: number
  tone: 'info' | 'ok' | 'error'
  text: string
  detail?: string
  /** Errors never auto-dismiss: an operator has to have seen them. */
  sticky: boolean
}

interface UiState {
  density: Density
  setDensity: (d: Density) => void

  toasts: Toast[]
  toast: (t: Omit<Toast, 'id' | 'sticky'> & { sticky?: boolean }) => void
  dismissToast: (id: number) => void

  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void

  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void

  /** The custody drawer is global: any hash chip anywhere can open it. */
  custodyHash: string | null
  openCustody: (hash: string | null) => void

  /** Queued actions taken while offline, replayed when the stream returns. */
  queued: { id: number; label: string; glyph: GlyphName; run: () => Promise<unknown> }[]
  enqueue: (item: { label: string; glyph: GlyphName; run: () => Promise<unknown> }) => void
  drainQueue: () => Promise<void>
}

let nextId = 1

export const useUi = create<UiState>((set, get) => ({
  density: 'compact',
  setDensity: (density) => {
    set({ density })
    if (typeof document !== 'undefined') document.documentElement.dataset.density = density
    try {
      window.localStorage.setItem('cs.density', density)
    } catch {
      /* a density preference that does not persist is a minor loss */
    }
  },

  toasts: [],
  toast: (t) => {
    const sticky = t.sticky ?? t.tone === 'error'
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { ...t, id, sticky }].slice(-3) }))
    if (!sticky) {
      setTimeout(() => get().dismissToast(id), 4000)
    }
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  custodyHash: null,
  openCustody: (custodyHash) => set({ custodyHash }),

  queued: [],
  enqueue: (item) => set((s) => ({ queued: [...s.queued, { ...item, id: nextId++ }] })),
  drainQueue: async () => {
    const items = get().queued
    set({ queued: [] })
    for (const item of items) {
      try {
        await item.run()
      } catch {
        get().toast({ tone: 'error', text: `queued action failed: ${item.label}` })
      }
    }
  },
}))
