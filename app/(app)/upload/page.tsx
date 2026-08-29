import type { Metadata } from 'next'
import { UploadScreen } from '@/components/upload/UploadScreen'

export const metadata: Metadata = { title: 'intake · CivicSense' }

export default function Page() {
  return <UploadScreen />
}
