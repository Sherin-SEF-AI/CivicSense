import 'server-only'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { EVIDENCE_DIR, all, appendCustody, db, get, run } from '@/lib/db'
import { merkleOf } from '@/lib/vault/merkle'
import { verifyCaptureSignature, type SignatureVerdict } from '@/lib/vault/signing'

const exec = promisify(execFile)

/**
 * Evidence storage.
 *
 * The hash is computed over the actual bytes that arrived and the file on disk
 * is named by it, so the store is content addressed by construction: the same
 * bytes uploaded twice are one object, and a file whose name no longer matches
 * its content is detectable without a database lookup.
 *
 * Metadata comes from ffprobe reading the real file, not from what the uploader
 * claimed.
 */

export interface StoredEvidence {
  sha256: string
  bytes: number
  media_type: string
  stored_path: string
  width: number | null
  height: number | null
  duration_ms: number | null
  fps: number | null
  codec: string | null
  captured_at: number | null
  ingested_at: number
  deduplicated: boolean
}

interface FfprobeStream {
  codec_name?: string
  codec_type?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  duration?: string
  tags?: Record<string, string>
}

interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: { duration?: string; format_name?: string; tags?: Record<string, string> }
}

/** Reads real metadata from the stored file. Returns nulls if ffprobe is absent. */
export async function probe(path: string): Promise<Partial<StoredEvidence>> {
  try {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      path,
    ])
    const result = JSON.parse(stdout) as FfprobeResult
    const video = result.streams?.find((s) => s.codec_type === 'video')
    const durationSeconds = Number(result.format?.duration ?? video?.duration ?? 0)

    let fps: number | null = null
    if (video?.avg_frame_rate && video.avg_frame_rate !== '0/0') {
      const [num, den] = video.avg_frame_rate.split('/').map(Number)
      if (num && den) fps = Math.round((num / den) * 1000) / 1000
    }

    /* Capture time, when the container carries one. Nothing is inferred. */
    const created =
      result.format?.tags?.creation_time ?? video?.tags?.creation_time ?? result.format?.tags?.['com.apple.quicktime.creationdate']
    const capturedAt = created ? Date.parse(created) : NaN

    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      duration_ms: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
      fps,
      codec: video?.codec_name ?? result.format?.format_name ?? null,
      captured_at: Number.isFinite(capturedAt) ? capturedAt : null,
    }
  } catch {
    return { width: null, height: null, duration_ms: null, fps: null, codec: null, captured_at: null }
  }
}

/**
 * What the capturing device asserted about these bytes.
 *
 * Optional, because a phone upload or a re-ingest has no device to assert it.
 * When it is present it is checked; when it is absent the object is recorded as
 * unverified rather than quietly treated as trustworthy.
 */
export interface CaptureClaim {
  source_id: string
  t_start: number
  signature: string | null
}

export async function storeEvidence(
  bytes: Buffer,
  mediaType: string,
  originalName: string | null,
  actor: string,
  claim: CaptureClaim | null = null,
): Promise<StoredEvidence> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const existing = get<StoredEvidence>('SELECT * FROM evidence WHERE sha256 = ?', [sha256])
  if (existing) {
    appendCustody(sha256, actor, 'system', 'ingest', 'identical bytes received again, deduplicated to the existing object')
    return { ...existing, deduplicated: true }
  }

  /* Fanned out by the first two hex characters so a directory never holds more
     entries than a filesystem is comfortable with. */
  const shard = sha256.slice(0, 2)
  const dir = join(EVIDENCE_DIR, shard)
  mkdirSync(dir, { recursive: true })
  const extension = extensionFor(mediaType, originalName)
  const storedPath = join(dir, `${sha256}${extension}`)
  writeFileSync(storedPath, bytes)

  const metadata = await probe(storedPath)
  const ingestedAt = Date.now()

  run(
    `INSERT INTO evidence (sha256, bytes, media_type, original_name, stored_path, width, height, duration_ms, fps, codec, captured_at, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sha256,
      bytes.byteLength,
      mediaType,
      originalName,
      storedPath,
      metadata.width ?? null,
      metadata.height ?? null,
      metadata.duration_ms ?? null,
      metadata.fps ?? null,
      metadata.codec ?? null,
      metadata.captured_at ?? null,
      ingestedAt,
    ],
  )

  /* The chunk tree is computed at ingest, not on demand, because it is part of
     the object's identity and a later recomputation would be a claim about
     bytes rather than a record of them. */
  const tree = merkleOf(bytes)
  run(
    'INSERT INTO evidence_merkle (sha256, root, chunk_size, leaf_count, algo, computed_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha256, tree.root, tree.chunkSize, tree.leafCount, tree.algo, ingestedAt],
  )
  const insertChunk = db().prepare(
    'INSERT INTO evidence_chunks (sha256, idx, offset, len, digest) VALUES (?, ?, ?, ?, ?)',
  )
  for (const chunk of tree.chunks) insertChunk.run(sha256, chunk.index, chunk.offset, chunk.length, chunk.digest)

  const signature = verifyClaim(sha256, tree.root, claim, ingestedAt)

  appendCustody(
    sha256,
    actor,
    'system',
    'capture',
    `ingested ${bytes.byteLength} bytes as ${mediaType}, chunk root ${tree.root.slice(0, 16)}, signature ${signature}`,
  )

  return {
    sha256,
    bytes: bytes.byteLength,
    media_type: mediaType,
    stored_path: storedPath,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    duration_ms: metadata.duration_ms ?? null,
    fps: metadata.fps ?? null,
    codec: metadata.codec ?? null,
    captured_at: metadata.captured_at ?? null,
    ingested_at: ingestedAt,
    deduplicated: false,
  }
}

/**
 * Checks the capture claim and records the verdict.
 *
 * Four outcomes, and they are deliberately distinct. `unverified` means nothing
 * was claimed. `no_key` means something was claimed but no enrolled key exists
 * to check it against, which is a deployment gap rather than a failure of the
 * object. `bad_signature` means a claim was made and it does not hold, which is
 * the one that should stop an operator.
 */
function verifyClaim(
  sha256: string,
  merkleRoot: string,
  claim: CaptureClaim | null,
  at: number,
): SignatureVerdict {
  const record = (verdict: SignatureVerdict, detail: string, keyId: string | null) => {
    run(
      'INSERT INTO device_signatures (sha256, key_id, verdict, detail, signed_over, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
      [sha256, keyId, verdict, detail, merkleRoot, at],
    )
    return verdict
  }

  if (!claim?.signature) return record('unverified', 'no capture signature was supplied at ingest', null)

  const keys = all<{ key_id: string; public_key: string }>(
    'SELECT key_id, public_key FROM device_keys WHERE source_id = ? AND revoked_at IS NULL ORDER BY enrolled_at DESC',
    [claim.source_id],
  )
  if (keys.length === 0) {
    return record('no_key', `no enrolled capture key for ${claim.source_id}, so the signature cannot be checked`, null)
  }

  for (const key of keys) {
    const ok = verifyCaptureSignature({
      publicKeyBase64: key.public_key,
      signatureBase64: claim.signature,
      sourceId: claim.source_id,
      tStartMs: claim.t_start,
      merkleRoot,
    })
    if (ok) return record('verified', `signed by ${key.key_id} over the chunk root`, key.key_id)
  }

  return record(
    'bad_signature',
    `a signature was supplied but it does not verify against any of the ${keys.length} enrolled key(s) for ${claim.source_id}`,
    keys[0]!.key_id,
  )
}

function extensionFor(mediaType: string, originalName: string | null): string {
  const fromName = originalName?.match(/\.[a-z0-9]{2,5}$/i)?.[0]
  if (fromName) return fromName.toLowerCase()
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'application/vnd.apple.mpegurl': '.m3u8',
  }
  return map[mediaType] ?? '.bin'
}

/** Recomputes the hash from the bytes on disk. This is what verification means. */
export async function verifyEvidence(sha256: string): Promise<{ ok: boolean; recomputed: string | null }> {
  const row = get<{ stored_path: string }>('SELECT stored_path FROM evidence WHERE sha256 = ?', [sha256])
  if (!row) return { ok: false, recomputed: null }
  try {
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(row.stored_path)
    const recomputed = createHash('sha256').update(bytes).digest('hex')
    return { ok: recomputed === sha256, recomputed }
  } catch {
    return { ok: false, recomputed: null }
  }
}
