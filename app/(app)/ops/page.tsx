import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { OpsScreen } from '@/components/ops/OpsScreen'

export const metadata = { title: 'operations · CivicSense' }

export default function OpsPage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={10} height={48} /></div>}>
      <OpsScreen />
    </Suspense>
  )
}
