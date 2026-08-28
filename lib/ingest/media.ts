import 'server-only'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { EVIDENCE_DIR, appendCustody, get, run } from '@/lib/db'

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

export async function storeEvidence(
  bytes: Buffer,
  mediaType: string,
  originalName: string | null,
  actor: string,
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

  appendCustody(sha256, actor, 'system', 'capture', `ingested ${bytes.byteLength} bytes as ${mediaType}`)

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
