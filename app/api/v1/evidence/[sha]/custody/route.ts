import type { NextRequest } from 'next/server'
import { json, notFound, session } from '../../../_lib/handler'
import { appendCustodyTyped, custodyChain, get, verifyCustodyChain } from '@/lib/db'
import { verifyEvidence } from '@/lib/ingest/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface EvidenceRow {
  sha256: string
  bytes: number
  media_type: string
  stored_path: string
  ingested_at: number
}

/** The chain as stored, with the recomputation result for every entry. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ sha: string }> }) {
  const { sha } = await ctx.params
  const row = get<EvidenceRow>('SELECT * FROM evidence WHERE sha256 = ?', [sha])
  if (!row) return notFound('evidence', sha)

  const chain = verifyCustodyChain(sha)
  const byId = new Map(chain.results.map((r) => [r.id, r.ok]))

  return json({
    evidence_id: sha,
    bytes: row.bytes,
    media_type: row.media_type,
    ingested_at: row.ingested_at,
    hash_chain_valid: chain.valid,
    broken_at: chain.brokenAt,
    chain: custodyChain(sha).map((entry) => ({
      id: entry.id,
      t: entry.t,
      actor: entry.actor,
      role: entry.role,
      action: entry.action,
      purpose: entry.purpose,
      hash_after: entry.hash_after,
      prev_hash: entry.prev_hash,
      recomputes: byId.get(entry.id) ?? false,
    })),
  })
}

/**
 * Verification, performed rather than asserted.
 *
 * Two independent checks. The content check re-reads the bytes from disk and
 * recomputes the digest, which is the only thing that proves the object is the
 * one the hash names. The chain check recomputes every custody entry from the
 * evidence hash forward. Either can fail on its own and they mean different
 * things: bad content means the object was altered or lost, a broken chain means
 * the record of who touched it was.
 *
 * The verification is itself a custody event, so asking the question is on the
 * record next to the answer.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ sha: string }> }) {
  const { sha } = await ctx.params
  const user = session(req)

  const row = get<EvidenceRow>('SELECT stored_path FROM evidence WHERE sha256 = ?', [sha])
  if (!row) return notFound('evidence', sha)

  const content = await verifyEvidence(sha)
  const chain = verifyCustodyChain(sha)

  appendCustodyTyped(
    sha,
    user.name,
    user.role,
    'verify',
    content.ok && chain.valid
      ? 'content and chain recomputed, both intact'
      : `verification failed: ${content.ok ? '' : 'content digest mismatch '}${chain.valid ? '' : `chain broken at entry ${chain.brokenAt}`}`.trim(),
  )

  return json({
    evidence_id: sha,
    content: {
      ok: content.ok,
      recomputed: content.recomputed,
      /* Stated plainly: a null recomputation means the bytes could not be read
         at all, which is a different failure from a mismatch. */
      detail: content.recomputed === null ? 'the stored object could not be read' : content.ok ? 'the bytes on disk hash to the name they are stored under' : 'the bytes on disk do not hash to their stored name',
    },
    chain: {
      ok: chain.valid,
      entries: chain.entries,
      broken_at: chain.brokenAt,
      detail: chain.valid
        ? `${chain.entries} entries recomputed from the evidence hash forward`
        : `chain breaks at entry ${chain.brokenAt}, so that entry and everything after it cannot be trusted`,
    },
    verified_at: Date.now(),
  })
}
