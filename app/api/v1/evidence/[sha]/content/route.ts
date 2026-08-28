import { readFile } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { notFound, session } from '../../../_lib/handler'
import { appendCustody, get } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serves stored evidence.
 *
 * Every read appends a custody entry, because "who looked at this and why" is
 * part of the record rather than an optional extra.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ sha: string }> }) {
  const { sha } = await ctx.params
  const row = get<{ stored_path: string; media_type: string; bytes: number }>(
    'SELECT stored_path, media_type, bytes FROM evidence WHERE sha256 = ?',
    [sha],
  )
  if (!row) return notFound('evidence', sha)

  const user = session(req)
  const purpose = req.nextUrl.searchParams.get('purpose') ?? 'viewed in the console'
  appendCustody(sha, user.name, user.role, 'access', purpose)

  try {
    const bytes = await readFile(row.stored_path)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.media_type,
        'Content-Length': String(row.bytes),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-SHA256': sha,
      },
    })
  } catch {
    return notFound('evidence file', sha)
  }
}
