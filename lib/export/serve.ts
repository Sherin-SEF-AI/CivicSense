import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { appendCustodyTyped, audit, get, verifyCustodyChain } from '@/lib/db'
import { verifyEvidence } from '@/lib/ingest/media'
import type { ForensicsBundle, IntelligencePackage } from '@/lib/api/schemas'

/**
 * Exports, performed on the server so that they leave a record.
 *
 * These used to run entirely in the browser: the renderers are pure functions
 * and the download was a Blob, which meant an operator could take a complete
 * evidence bundle out of the platform and nothing anywhere recorded that it had
 * happened. An export is the single most consequential thing a person does with
 * evidence, and it was the one action with no trace.
 *
 * Now every export verifies each object it is about to cite, appends an `export`
 * custody entry against each of them, writes an audit row, and returns a
 * manifest digest over exactly what was included. If verification fails the
 * export still proceeds, because refusing to export a damaged object would hide
 * the damage; the failure is recorded in the manifest and stated in the file.
 */

export interface ExportedObject {
  sha256: string
  bytes: number
  media_type: string
  content_ok: boolean
  chain_ok: boolean
}

export interface ExportRecord {
  manifest_hash: string
  objects: ExportedObject[]
  verified_ok: number
  verified_failed: number
}

/** Evidence hashes an export will cite, taken from the forensic bundle. */
export function citedObjects(bundle: ForensicsBundle | null): string[] {
  if (!bundle) return []
  return [...new Set(bundle.tree.map((node) => node.evidence_id))]
}

/**
 * Verifies, logs custody, and returns the manifest.
 *
 * The manifest digest covers the export kind, the recipient class and the
 * ordered list of object hashes with their verification results, so two exports
 * of the same material to different recipients do not share a digest and an
 * export containing a damaged object does not share a digest with a clean one.
 */
export async function recordEvidenceExport(input: {
  incidentId: string
  kind: string
  recipient: string
  actor: string
  role: string
  hashes: string[]
}): Promise<ExportRecord> {
  const objects: ExportedObject[] = []

  for (const sha256 of [...input.hashes].sort()) {
    const row = get<{ bytes: number; media_type: string }>('SELECT bytes, media_type FROM evidence WHERE sha256 = ?', [
      sha256,
    ])
    if (!row) continue

    const content = await verifyEvidence(sha256)
    const chain = verifyCustodyChain(sha256)

    appendCustodyTyped(
      sha256,
      input.actor,
      input.role,
      'export',
      `included in a ${input.kind} export for ${input.recipient}${content.ok && chain.valid ? '' : ', verification failed at export time'}`,
    )

    objects.push({
      sha256,
      bytes: row.bytes,
      media_type: row.media_type,
      content_ok: content.ok,
      chain_ok: chain.valid,
    })
  }

  const manifest = objects
    .map((o) => `${o.sha256}|${o.bytes}|${o.content_ok ? 'ok' : 'bad'}|${o.chain_ok ? 'ok' : 'bad'}`)
    .join('\n')
  const manifestHash = createHash('sha256')
    .update(`fis-export/1|${input.kind}|${input.recipient}|${input.incidentId}\n${manifest}`)
    .digest('hex')

  const failed = objects.filter((o) => !o.content_ok || !o.chain_ok).length

  audit(
    input.actor,
    `export.${input.kind}`,
    `incident:${input.incidentId}`,
    `${objects.length} objects to ${input.recipient}, ${failed} failed verification, manifest ${manifestHash.slice(0, 16)}`,
  )

  return {
    manifest_hash: manifestHash,
    objects,
    verified_ok: objects.length - failed,
    verified_failed: failed,
  }
}

/**
 * Reads an evidence object off disk as a data URI.
 *
 * The browser path used fetch plus FileReader, which cannot run here. Reading
 * from disk is also the more honest source: the export embeds the stored bytes
 * rather than whatever the content route happened to serve.
 */
export async function inlineFromVault(sha256: string): Promise<string | null> {
  const row = get<{ stored_path: string; media_type: string }>(
    'SELECT stored_path, media_type FROM evidence WHERE sha256 = ?',
    [sha256],
  )
  if (!row) return null
  try {
    const bytes = await readFile(row.stored_path)
    return `data:${row.media_type};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Board tiles keyed by the URL the renderers expect, resolved from the vault. */
export async function inlineBoard(pkg: IntelligencePackage): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  await Promise.all(
    pkg.board.map(async (tile) => {
      const sha = /\/evidence\/([0-9a-f]{64})\//.exec(tile.full_url)?.[1]
      if (!sha) return
      const data = await inlineFromVault(sha)
      if (data) images.set(tile.full_url, data)
    }),
  )
  return images
}
