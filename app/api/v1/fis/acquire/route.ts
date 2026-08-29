import type { NextRequest } from 'next/server'
import { badRequest, json, requires, session } from '../../_lib/handler'
import { audit } from '@/lib/db'
import { fisConfigured, FisUnavailable } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 512 * 1024 * 1024

/**
 * Acquisition of material a normal demuxer refuses.
 *
 * A recorder export with proprietary framing, a raw dump off a disk, a partial
 * file recovered from unallocated space. The tier walks it directly and reports
 * what it had to do, and both digests come back so the relationship between the
 * original and the master is checkable rather than asserted.
 *
 * The original is never modified here and never stored by this route. Bringing
 * the result into the vault is a separate, deliberate act.
 */
export async function POST(req: NextRequest) {
  const user = session(req)
  const denied = requires(user, 'forensics.pull')
  if (denied) return denied

  if (!fisConfigured()) {
    return json({
      error: 'fis_unavailable' as const,
      detail: 'the forensic tier is not attached, so material a demuxer refuses cannot be walked here',
    })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return badRequest('file_required', 'post the recorder export as multipart form data')
  if (file.size > MAX_BYTES) return badRequest('too_large', `the limit for this path is ${MAX_BYTES} bytes`)

  const upstream = new FormData()
  upstream.append('file', file, file.name || 'export.bin')
  upstream.append('integrity', 'true')

  try {
    const response = await fetch(`${process.env.FIS_BASE_URL}/v1/acquire`, { method: 'POST', body: upstream })
    if (!response.ok) throw new FisUnavailable(`the forensic tier answered ${response.status}`)
    const result = (await response.json()) as {
      opened: boolean
      refused: string | null
      original_sha256: string
      container: string
      dropped_units?: number
    }

    /* Attempting an acquisition is part of the record whether or not it worked.
       A refusal is as much a finding about the material as a success. */
    audit(
      user.name,
      result.opened ? 'acquisition.opened' : 'acquisition.refused',
      `object:${result.original_sha256.slice(0, 16)}`,
      `${file.name || 'unnamed'} detected as ${result.container}${result.refused ? `, refused: ${result.refused}` : ''}`,
    )

    return json(result)
  } catch (error) {
    if (error instanceof FisUnavailable) return json({ error: 'fis_unavailable' as const, detail: error.reason })
    throw error
  }
}
