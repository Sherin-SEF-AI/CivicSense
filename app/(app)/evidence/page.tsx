import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { EvidenceScreen } from '@/components/evidence/EvidenceScreen'

export const metadata = { title: 'evidence · CivicSense' }

export default function EvidencePage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={10} height={48} /></div>}>
      <EvidenceScreen />
    </Suspense>
  )
}
