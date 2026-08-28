import { ForensicsScreen } from '@/components/forensics/ForensicsScreen'

export const metadata = { title: 'forensics · CivicSense' }

export default async function ForensicsPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params
  return <ForensicsScreen incidentId={incidentId} />
}
