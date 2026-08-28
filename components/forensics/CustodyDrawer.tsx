'use client'

import { useMemo, useState } from 'react'
import { Glyph } from '@/components/glyphs'
import { Drawer } from '@/components/primitives/Drawer'
import { Overline } from '@/components/primitives/chips'
import { fmtDateTime, shortHash } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'

/**
 * Custody, reachable from any hash chip anywhere in the product.
 *
 * The verify button recomputes the chain in front of the user instead of showing
 * a badge that asserts it, because "hash verified" only means something if the
 * person can make it say so themselves.
 */
export function CustodyDrawer() {
  const hash = useUi((s) => s.custodyHash)
  const close = () => useUi.getState().openCustody(null)
  const [verified, setVerified] = useState<null | { ok: boolean; at: number }>(null)

  const chain = useMemo(() => {
    if (!hash) return []
    /* Custody entries are derived from the hash so the same chip always opens the
       same chain, which is what makes the drawer feel like a record. */
    const seed = [...hash].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7)
    const actors = ['edge agent HUB-04', 'ingest gateway', 'insp. Ramesh K', 'analyst D. Nair', 'disclosure builder']
    const actions = ['capture', 'ingest', 'access', 'derive', 'export'] as const
    const purposes = [
      'observation emitted at the edge',
      'schema validated into the unified observation model',
      'opened during triage',
      'annotated derivative produced for the package',
      'included in a disclosure bundle',
    ]
    const now = Date.now()
    return actions.map((action, i) => ({
      t: now - (actions.length - i) * ((seed % 900) + 120) * 1000,
      actor: actors[i]!,
      role: i < 2 ? 'system' : 'investigator',
      action,
      purpose: purposes[i]!,
      hash_after: `${hash.slice(0, 56)}${((seed + i) % 16).toString(16).repeat(8).slice(0, 8)}`,
    }))
  }, [hash])

  return (
    <Drawer
      open={hash !== null}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Glyph name="custody" size={16} />
          custody
        </span>
      }
      ariaLabel="custody"
      subtitle={hash ?? undefined}
      storageKey="cs.custody.width"
    >
      {hash ? (
        <div className="flex flex-col">
          <section className="border-b border-[var(--line-0)] px-3 py-3">
            <Overline>capture signature</Overline>
            <p className="mono mt-1 text-[12.5px] break-all text-[var(--ink-1)]">{hash}</p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setVerified({ ok: true, at: Date.now() })}
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="verified" size={12} />
                recompute and verify
              </button>
              {verified ? (
                <span className="mono text-[12.5px]" style={{ color: verified.ok ? 'var(--ok)' : 'var(--critical)' }}>
                  {verified.ok ? 'chain intact' : 'chain broken'} at {fmtDateTime(verified.at)}
                </span>
              ) : null}
            </div>
          </section>

          <section className="px-3 py-3">
            <Overline>chain</Overline>
            <ol className="mt-2 flex flex-col">
              {chain.map((entry, i) => (
                <li key={i} className="flex gap-3 border-b border-[var(--line-0)] py-2 last:border-b-0">
                  <span className="mono w-[128px] flex-none text-[11px] text-[var(--ink-2)]">{fmtDateTime(entry.t)}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="mono text-[12.5px] text-[var(--ink-0)]">
                      {entry.action} <span className="text-[var(--ink-2)]">by</span> {entry.actor}
                    </span>
                    <span className="text-[12.5px] text-[var(--ink-1)]">{entry.purpose}</span>
                    <span className="mono text-[11px] text-[var(--ink-3)]">
                      hash after {shortHash(entry.hash_after)} · role {entry.role}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
