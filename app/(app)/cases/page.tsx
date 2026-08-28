import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { CaseListScreen } from '@/components/cases/CaseListScreen'

export const metadata = { title: 'cases · CivicSense' }

export default function CasesPage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={10} /></div>}>
      <CaseListScreen />
    </Suspense>
  )
}
