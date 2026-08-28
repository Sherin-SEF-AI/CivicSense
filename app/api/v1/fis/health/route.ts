import { json } from '../../_lib/handler'
import { fisHealth } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Whether the forensic tier is attached.
 *
 * Answered as 200 with a typed body either way. An unattached tier is an
 * expected configuration that the console renders, not a transport failure, and
 * a non-2xx would show up as a console error on a perfectly healthy page.
 */
export async function GET() {
  return json(await fisHealth())
}
