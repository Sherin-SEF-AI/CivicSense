import { IncidentPackageScreen } from '@/components/incident/IncidentPackageScreen'

export const metadata = { title: 'incident package · CivicSense' }

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <IncidentPackageScreen incidentId={id} />
}
