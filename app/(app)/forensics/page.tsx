import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { ForensicsIndex } from '@/components/forensics/ForensicsIndex'

export const metadata = { title: 'forensics · CivicSense' }

export default function ForensicsIndexPage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={10} /></div>}>
      <ForensicsIndex />
    </Suspense>
  )
}
