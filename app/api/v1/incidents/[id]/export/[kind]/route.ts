import type { NextRequest } from 'next/server'
import { badRequest, notFound, requires, session } from '../../../../_lib/handler'
import { getIncident, storedPackage } from '@/lib/store/incidents'
import { buildForensics } from '@/lib/store/forensics'
import { recordExport } from '@/lib/store/cases'
import { get } from '@/lib/db'
import { citedObjects, inlineBoard, recordEvidenceExport } from '@/lib/export/serve'
import { renderOfflineBundle } from '@/lib/export/offline'
import { renderDisclosureBundle, type Certificate } from '@/lib/export/disclosure'
import { summaryPdf } from '@/lib/export/summary'
import { IntelligencePackageSchema } from '@/lib/api/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = ['offline', 'summary', 'disclosure'] as const
type Kind = (typeof KINDS)[number]

/**
 * The three exports.
 *
 * Each one leaves the platform carrying evidence, so each one is a capability
 * check, a verification sweep over every object it cites, a custody entry
 * against each of those objects, an audit row, and a manifest digest. The
 * disclosure copy needs the disclosure capability specifically, because it is
 * the one that goes to someone outside the organisation.
 */
const CAPABILITY: Record<Kind, Parameters<typeof requires>[1]> = {
  offline: 'forensics.pull',
  summary: 'forensics.pull',
  disclosure: 'case.disclose',
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params
  if (!KINDS.includes(kind as Kind)) return badRequest('unknown_export_kind', kind)
  const exportKind = kind as Kind

  const user = session(req)
  const denied = requires(user, CAPABILITY[exportKind])
  if (denied) return denied

  const incident = getIncident(id)
  if (!incident) return notFound('incident', id)

  const stored = storedPackage(id)
  if (!stored) {
    return badRequest(
      'no_package',
      'this incident has no intelligence package yet, so there is nothing to export. run the understanding pass first.',
    )
  }
  const parsed = IntelligencePackageSchema.safeParse(stored)
  if (!parsed.success) return badRequest('package_invalid', 'the stored package does not match the current schema')
  const pkg = parsed.data

  const body = (await req.json().catch(() => ({}))) as { case_id?: string; certificate?: Certificate }
  const caseId = body.case_id ?? null
  const investigationFlag = caseId
    ? get<{ investigation_flag: number }>('SELECT investigation_flag FROM cases WHERE case_id = ?', [caseId])
        ?.investigation_flag === 1
    : false

  const bundle = await buildForensics(id, investigationFlag)

  const recipient = exportKind === 'disclosure' ? 'external disclosure' : 'internal'
  const record = await recordEvidenceExport({
    incidentId: id,
    kind: exportKind,
    recipient,
    actor: user.name,
    role: user.role,
    hashes: citedObjects(bundle),
  })

  if (caseId) recordExport(caseId, user.name, exportKind, recipient, record.manifest_hash)

  const headers = (filename: string, type: string) =>
    new Headers({
      'content-type': type,
      'content-disposition': `attachment; filename="${filename}"`,
      'x-manifest-sha256': record.manifest_hash,
      'x-objects-verified': String(record.verified_ok),
      'x-objects-failed': String(record.verified_failed),
      'cache-control': 'no-store',
    })

  if (exportKind === 'summary') {
    const bytes = summaryPdf(pkg, bundle)
    return new Response(new Uint8Array(bytes), {
      headers: headers(`civicsense-${id}-summary.pdf`, 'application/pdf'),
    })
  }

  if (exportKind === 'disclosure') {
    const certificate = body.certificate ?? certificateFor(caseId)
    const html = renderDisclosureBundle(pkg, bundle, certificate)
    return new Response(html, { headers: headers(`civicsense-${id}-disclosure.html`, 'text/html; charset=utf-8') })
  }

  const images = await inlineBoard(pkg)
  if (!bundle) return notFound('forensic bundle', id)
  const html = renderOfflineBundle(pkg, bundle, images, {
    manifestHash: record.manifest_hash,
    objects: record.objects,
    exportedBy: user.name,
  })
  return new Response(html, { headers: headers(`civicsense-${id}.html`, 'text/html; charset=utf-8') })
}

/** The case's issued certificate, if one exists. A draft is not a certificate. */
function certificateFor(caseId: string | null): Certificate | null {
  if (!caseId) return null
  const row = get<{ certificate: string | null }>('SELECT certificate FROM cases WHERE case_id = ?', [caseId])
  if (!row?.certificate) return null
  const parsed = JSON.parse(row.certificate) as {
    issued_by?: string
    role?: string
    device_particulars?: string
  }
  if (!parsed.issued_by || !parsed.role || !parsed.device_particulars) return null
  return { issued_by: parsed.issued_by, role: parsed.role, device_particulars: parsed.device_particulars }
}
