import { Suspense } from 'react'
import { LoadingBlocks } from '@/components/primitives/panels'
import { PredictScreen } from '@/components/predict/PredictScreen'

export const metadata = { title: 'predict · CivicSense' }

export default function PredictPage() {
  return (
    <Suspense fallback={<div className="p-3"><LoadingBlocks rows={10} /></div>}>
      <PredictScreen />
    </Suspense>
  )
}
