import { json } from '../../_lib/handler'
import { buildAnalytics } from '@/lib/store/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return json(buildAnalytics())
}
