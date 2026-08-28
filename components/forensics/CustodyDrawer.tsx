'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Glyph } from '@/components/glyphs'
import { Drawer } from '@/components/primitives/Drawer'
import { Overline } from '@/components/primitives/chips'
import { ErrorPanel, LoadingBlocks } from '@/components/primitives/panels'
import { request } from '@/lib/api/client'
import { errorCode, errorDetail } from '@/lib/api/client'
import { fmtDateTime, shortHash } from '@/lib/format'
import { useUi } from '@/lib/stores/ui'

const CustodyResponseSchema = z.object({
  evidence_id: z.string(),
  bytes: z.number(),
  media_type: z.string(),
  ingested_at: z.number(),
  hash_chain_valid: z.boolean(),
  broken_at: z.number().nullable(),
  chain: z.array(
    z.object({
      id: z.number(),
      t: z.number(),
      actor: z.string(),
      role: z.string(),
      action: z.string(),
      purpose: z.string(),
      hash_after: z.string(),
      prev_hash: z.string(),
      recomputes: z.boolean(),
    }),
  ),
})

const VerifySchema = z.object({
  evidence_id: z.string(),
  content: z.object({ ok: z.boolean(), recomputed: z.string().nullable(), detail: z.string() }),
  chain: z.object({ ok: z.boolean(), entries: z.number(), broken_at: z.number().nullable(), detail: z.string() }),
  verified_at: z.number(),
})

type Verification = z.infer<typeof VerifySchema>

/**
 * Custody, reachable from any hash chip anywhere in the product.
 *
 * Every row here is a stored custody entry, and the recomputation column is the
 * result of hashing that entry against the one before it. The verify button
 * performs two real checks on the server: it re-reads the bytes from disk and
 * recomputes their digest, and it recomputes the whole chain from the evidence
 * hash forward. Asking is itself recorded, so the question and the answer sit
 * next to each other in the record.
 */
export function CustodyDrawer() {
  const hash = useUi((s) => s.custodyHash)
  const close = () => useUi.getState().openCustody(null)
  const [verified, setVerified] = useState<Verification | null>(null)
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['custody', hash],
    queryFn: ({ signal }) =>
      request(`/evidence/${encodeURIComponent(hash!)}/custody`, CustodyResponseSchema, { signal }),
    enabled: hash !== null,
  })

  const verify = useMutation({
    mutationFn: () =>
      request(`/evidence/${encodeURIComponent(hash!)}/custody`, VerifySchema, { method: 'POST', body: {} }),
    onSuccess: (result) => {
      setVerified(result)
      /* The verification appended an entry, so the chain shown must refetch. */
      void qc.invalidateQueries({ queryKey: ['custody', hash] })
    },
  })

  const record = query.data ?? null

  return (
    <Drawer
      open={hash !== null}
      onClose={() => {
        setVerified(null)
        close()
      }}
      title="chain of custody"
      ariaLabel="chain of custody"
    >
      {hash ? (
        <div className="flex flex-col">
          <section className="border-b border-[var(--line-0)] px-3 py-3">
            <Overline>evidence object</Overline>
            <p className="mono mt-1 text-[12.5px] break-all text-[var(--ink-1)]">{hash}</p>
            {record ? (
              <p className="mono mt-1 text-[11px] text-[var(--ink-3)]">
                {record.bytes.toLocaleString()} bytes · {record.media_type} · ingested {fmtDateTime(record.ingested_at)}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => verify.mutate()}
                disabled={verify.isPending}
                className="mono step flex items-center gap-1.5 border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)] hover:bg-[var(--bg-3)] hover:text-[var(--ink-0)] disabled:opacity-40"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                <Glyph name="verified" size={12} />
                {verify.isPending ? 'recomputing' : 'recompute and verify'}
              </button>
              {verified ? (
                <span
                  className="mono text-[12.5px]"
                  style={{ color: verified.content.ok && verified.chain.ok ? 'var(--ok)' : 'var(--critical)' }}
                >
                  {verified.content.ok && verified.chain.ok ? 'chain intact' : 'chain broken'} at{' '}
                  {fmtDateTime(verified.verified_at)}
                </span>
              ) : null}
            </div>

            {verified ? (
              <dl className="mono mt-2 flex flex-col gap-1 text-[11px]">
                <div className="flex gap-2">
                  <dt className="w-[76px] flex-none text-[var(--ink-3)]">content</dt>
                  <dd style={{ color: verified.content.ok ? 'var(--ok)' : 'var(--critical)' }}>
                    {verified.content.detail}
                  </dd>
                </div>
                {verified.content.recomputed ? (
                  <div className="flex gap-2">
                    <dt className="w-[76px] flex-none text-[var(--ink-3)]">recomputed</dt>
                    <dd className="break-all text-[var(--ink-2)]">{verified.content.recomputed}</dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="w-[76px] flex-none text-[var(--ink-3)]">chain</dt>
                  <dd style={{ color: verified.chain.ok ? 'var(--ok)' : 'var(--critical)' }}>{verified.chain.detail}</dd>
                </div>
              </dl>
            ) : null}
          </section>

          <section className="px-3 py-3">
            <Overline>chain</Overline>
            {query.isPending ? (
              <div className="mt-2">
                <LoadingBlocks rows={4} height={44} />
              </div>
            ) : query.error ? (
              <div className="mt-2">
                <ErrorPanel
                  code={errorCode(query.error)}
                  detail={errorDetail(query.error)}
                  onRetry={() => void query.refetch()}
                />
              </div>
            ) : record && record.chain.length === 0 ? (
              <p className="mono mt-2 text-[11px] text-[var(--ink-3)]">
                this object has no custody entries, which should not happen for anything that was ingested through the
                platform
              </p>
            ) : (
              <ol className="mt-2 flex flex-col">
                {(record?.chain ?? []).map((entry) => (
                  <li key={entry.id} className="flex gap-3 border-b border-[var(--line-0)] py-2 last:border-b-0">
                    <span className="mono w-[128px] flex-none text-[11px] text-[var(--ink-2)]">
                      {fmtDateTime(entry.t)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="mono text-[12.5px] text-[var(--ink-0)]">
                        {entry.action} <span className="text-[var(--ink-2)]">by</span> {entry.actor}
                      </span>
                      <span className="text-[12.5px] text-[var(--ink-1)]">{entry.purpose}</span>
                      <span className="mono flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-3)]">
                        <span>hash after {shortHash(entry.hash_after)}</span>
                        <span>role {entry.role}</span>
                        <span style={{ color: entry.recomputes ? 'var(--ok)' : 'var(--critical)' }}>
                          {entry.recomputes ? 'recomputes' : 'does not recompute'}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
