import { CaseDetailScreen } from '@/components/cases/CaseDetailScreen'

export const metadata = { title: 'case · CivicSense' }

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CaseDetailScreen caseId={id} />
}
