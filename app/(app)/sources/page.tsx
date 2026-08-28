import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { SourcesScreen } from '@/components/sources/SourcesScreen'

export const metadata = { title: 'sources · CivicSense' }

export default function SourcesPage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={12} /></div>}>
      <SourcesScreen />
    </Suspense>
  )
}
