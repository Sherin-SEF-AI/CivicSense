import { notFound } from 'next/navigation'
import { IS_FIXTURES } from '@/lib/env'

/**
 * Dev surfaces exist only alongside the fixture backend. In a live build these
 * routes return 404 and the pages below are never reachable.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!IS_FIXTURES) notFound()
  return <div className="h-full overflow-auto bg-[var(--bg-0)]">{children}</div>
}
