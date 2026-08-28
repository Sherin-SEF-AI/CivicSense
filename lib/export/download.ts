import { API_BASE } from '@/lib/env'

/**
 * Asks the server for an export and saves what comes back.
 *
 * The rendering used to happen here in the browser, which meant the platform
 * never learned that an export had occurred. Now the client only asks; the
 * server verifies the objects, records custody and audit, and returns the file
 * with the manifest digest in a header so the operator can be told what they
 * just took out.
 */
export interface ExportResult {
  filename: string
  manifestHash: string | null
  verified: number
  failed: number
}

export async function requestExport(
  incidentId: string,
  kind: 'offline' | 'summary' | 'disclosure',
  body: Record<string, unknown> = {},
): Promise<ExportResult> {
  const response = await fetch(`${API_BASE}/incidents/${encodeURIComponent(incidentId)}/export/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const parsed = (await response.json()) as { error?: string; detail?: string }
      detail = parsed.detail ?? parsed.error ?? detail
    } catch {
      /* A non-JSON error body is still an error; the status carries it. */
    }
    throw new Error(detail)
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `civicsense-${incidentId}-${kind}`

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)

  return {
    filename,
    manifestHash: response.headers.get('x-manifest-sha256'),
    verified: Number(response.headers.get('x-objects-verified') ?? 0),
    failed: Number(response.headers.get('x-objects-failed') ?? 0),
  }
}
