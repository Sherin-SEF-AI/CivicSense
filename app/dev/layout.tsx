import { notFound } from 'next/navigation'
import { IS_DEV } from '@/lib/env'
import { CustodyDrawer } from '@/components/forensics/CustodyDrawer'
import { ToastHost } from '@/components/primitives/Toast'

/** Dev surfaces are development only and return 404 in a production build. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!IS_DEV) notFound()
  return (
    <div className="h-full overflow-auto bg-[var(--bg-0)]">
      {children}
      <CustodyDrawer />
      <ToastHost />
    </div>
  )
}
