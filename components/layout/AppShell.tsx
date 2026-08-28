'use client'

import { useEffect } from 'react'
import { StreamProvider, useConnectionState } from '@/lib/stream/StreamProvider'
import { keys } from '@/lib/keyboard/registry'
import { useBindings } from '@/lib/keyboard/useKeys'
import { useUi } from '@/lib/stores/ui'
import { SystemRail } from './SystemRail'
import { StatusStrip } from './StatusStrip'
import { CommandPalette } from './CommandPalette'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { ToastHost } from '@/components/primitives/Toast'
import { CustodyDrawer } from '@/components/forensics/CustodyDrawer'

function GlobalKeys() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)

  useBindings(
    [
      {
        id: 'global:palette',
        scope: 'global',
        keys: 'mod+k',
        label: 'open the command palette',
        group: 'global',
        allowInInput: true,
        run: () => setPaletteOpen(true),
      },
      {
        id: 'global:shortcuts',
        scope: 'global',
        keys: '?',
        label: 'show this reference',
        group: 'global',
        run: () => setShortcutsOpen(true),
      },
    ],
    [setPaletteOpen, setShortcutsOpen],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keys().handle(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return null
}

/** Actions taken while the stream is down are replayed when it comes back. */
function OfflineQueue() {
  const connection = useConnectionState()
  const queued = useUi((s) => s.queued)
  const drainQueue = useUi((s) => s.drainQueue)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    if (connection !== 'live' || queued.length === 0) return
    void drainQueue().then(() => toast({ tone: 'ok', text: `replayed ${queued.length} queued action(s)` }))
  }, [connection, queued.length, drainQueue, toast, queued])

  if (connection !== 'offline') return null

  return (
    <div
      className="mono flex flex-none items-center gap-2 border-b border-[var(--critical)] bg-[var(--bg-2)] px-3 py-1 text-[12.5px]"
      style={{ color: 'var(--critical)' }}
      role="alert"
    >
      offline. acknowledgements queue and replay when the stream returns; dispatch and escalation are disabled.
      {queued.length > 0 ? <span className="text-[var(--ink-1)]">{queued.length} queued</span> : null}
    </div>
  )
}

function DensityBoot() {
  const setDensity = useUi((s) => s.setDensity)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('cs.density')
      if (stored === 'comfortable' || stored === 'compact') setDensity(stored)
    } catch {
      /* the default density is correct for the common case anyway */
    }
  }, [setDensity])
  return null
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <StreamProvider>
      <DensityBoot />
      <GlobalKeys />
      <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-0)]">
        <SystemRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusStrip />
          <OfflineQueue />
          <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <ShortcutsOverlay />
      <CustodyDrawer />
      <ToastHost />
    </StreamProvider>
  )
}
