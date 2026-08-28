import { json } from '../../_lib/handler'
import { fis, FisUnavailable } from '@/lib/fis/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The published operator contracts, which is what a workbench builds forms from. */
export async function GET() {
  try {
    return json(await fis<{ registry_digest: string; items: unknown[] }>('/v1/operators'))
  } catch (error) {
    if (error instanceof FisUnavailable) {
      return json({ error: 'fis_unavailable' as const, detail: error.reason, items: [] })
    }
    throw error
  }
}
