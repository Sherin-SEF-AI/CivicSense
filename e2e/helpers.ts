import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'

/** Console errors are a failure condition, so every spec collects them. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

/**
 * Test data is created through the real ingest path.
 *
 * The suite registers a real source and posts real bytes to the same endpoint an
 * edge agent uses, so what it exercises is the production path rather than a
 * fixture shortcut. The image is generated here rather than committed.
 */
/**
 * A real PNG, encoded here rather than committed.
 *
 * It has to be a valid image of usable size: the vision model rejects anything
 * under two pixels a side, and a fixture that cannot be looked at would test the
 * error path instead of the one we mean. The seed drives the pixels, so two
 * calls give genuinely different bytes and deduplication is testable.
 */
export function tinyPng(seed: number): Buffer {
  const size = 64
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // no per-row filter
    for (let x = 0; x < size; x++) {
      raw[offset++] = (x * 4 + seed) & 0xff
      raw[offset++] = (y * 4 + (seed >> 8)) & 0xff
      raw[offset++] = ((x ^ y) * 4 + (seed >> 16)) & 0xff
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export async function registerSource(
  request: APIRequestContext,
  sourceId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const response = await request.post('/api/v1/sources', {
    data: {
      source_id: sourceId,
      source_type: 'cctv-fixed',
      label: `${sourceId} acceptance suite`,
      lat: 12.9716,
      lon: 77.5946,
      heading_deg: 90,
      fov_deg: 60,
      range_m: 80,
      sync_quality: 'B',
      ...overrides,
    },
  })
  if (!response.ok()) {
    throw new Error(`registering ${sourceId} failed with ${response.status()}: ${await response.text()}`)
  }
}

export interface IngestResult {
  observation_id: string
  incident_id: string | null
  evidence: { sha256: string; bytes: number; deduplicated: boolean } | null
}

export async function ingest(
  request: APIRequestContext,
  sourceId: string,
  payload: Record<string, unknown>,
  seed = Date.now(),
): Promise<IngestResult> {
  const response = await request.post('/api/v1/ingest/observation', {
    multipart: {
      payload: JSON.stringify({ source_id: sourceId, t_start: Date.now(), payload_kind: 'keyframe', ...payload }),
      media: { name: `frame-${seed}.png`, mimeType: 'image/png', buffer: tinyPng(seed) },
    },
  })
  if (!response.ok()) throw new Error(`ingest failed with ${response.status()}: ${await response.text()}`)
  return (await response.json()) as IngestResult
}

export async function ingestSensor(
  request: APIRequestContext,
  sourceId: string,
  readings: { t: number; value: number; unit: string }[],
): Promise<void> {
  const response = await request.post('/api/v1/ingest/sensor', { data: { source_id: sourceId, readings } })
  if (!response.ok()) throw new Error(`sensor ingest failed with ${response.status()}`)
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Renders a short clip for the tests that need real video.
 *
 * The synchronized stage cannot be exercised against a still image, and the
 * product ships no bundled media, so the suite makes its own. Timecode is burned
 * in so a desynced tile is visible rather than merely asserted.
 */
export function renderClip(seconds: number, label: string): Buffer | null {
  if (!hasFfmpeg()) return null
  const dir = mkdtempSync(join(tmpdir(), 'civicsense-e2e-'))
  const out = join(dir, 'clip.mp4')
  const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf'].find(
    (p) => existsSync(p),
  )
  const drawtext = font
    ? `,drawtext=fontfile=${font}:text='%{pts\\:hms} ${label}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`
    : ''
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x14171b:s=320x180:r=25:d=${seconds}`,
      '-vf', `drawbox=x='mod(t*60\,360)-40':y=110:w=40:h=20:color=0x58a6ff:t=fill${drawtext}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '34',
      '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-movflags', '+faststart',
      out,
    ],
    { stdio: 'ignore' },
  )
  return readFileSync(out)
}

export async function ingestClip(
  request: APIRequestContext,
  sourceId: string,
  payload: Record<string, unknown>,
  clip: Buffer,
): Promise<IngestResult> {
  const response = await request.post('/api/v1/ingest/observation', {
    multipart: {
      payload: JSON.stringify({ source_id: sourceId, t_start: Date.now(), payload_kind: 'clip', ...payload }),
      media: { name: `clip-${Date.now()}.mp4`, mimeType: 'video/mp4', buffer: clip },
    },
  })
  if (!response.ok()) throw new Error(`clip ingest failed with ${response.status()}: ${await response.text()}`)
  return (await response.json()) as IngestResult
}

/** Creates an incident through the real path and returns its id. */
export async function seedIncident(request: APIRequestContext, sourceId?: string): Promise<string> {
  const id = sourceId ?? `E2E-CAM-${Date.now()}`
  await registerSource(request, id)
  const result = await ingest(request, id, {
    classes: ['motorcycle', 'person'],
    trigger: 'class:no_helmet',
    situation_key: 'no-helmet',
    affected: 2,
  })
  if (!result.incident_id) throw new Error('the trigger did not form an incident')
  return result.incident_id
}
