import { expect, test } from '@playwright/test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { ingest, registerSource, tinyPng } from './helpers'

/**
 * The vault: chunk trees and capture signatures.
 *
 * `device_signature` used to be an arbitrary string that nothing checked, and it
 * nonetheless decided whether an operator was shown the word "verified". These
 * specs exist so that cannot come back.
 */

const CAPTURE_DOMAIN = 'fis-capture/1'

/** The digest a device signs, per lib/vault/signing.ts. */
function captureDigest(sourceId: string, tStartMs: number, merkleRoot: string): Buffer {
  const t = Buffer.alloc(8)
  t.writeBigUInt64BE(BigInt(Math.trunc(tStartMs)))
  return createHash('sha256')
    .update(Buffer.from(CAPTURE_DOMAIN, 'utf8'))
    .update(Buffer.from(sourceId, 'utf8'))
    .update(t)
    .update(Buffer.from(merkleRoot, 'hex'))
    .digest()
}

/** The chunk root for an object that fits in one chunk, per lib/vault/merkle.ts. */
function merkleRootOf(bytes: Buffer): string {
  return createHash('sha256').update(Buffer.from([0x00])).update(bytes).digest('hex')
}

function edKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  /* The last 32 bytes of an ed25519 SPKI are the raw key. */
  return { privateKey, raw: spki.subarray(spki.length - 32).toString('base64') }
}

test.describe('vault', () => {
  test('a genuine capture signature verifies and reaches the package as verified', async ({ request }) => {
    const t = Date.now()
    const source = `E2E-SIG-${t}`
    await registerSource(request, source, { lat: 13.02, lon: 77.71 })

    const { privateKey, raw } = edKeyPair()
    const enrolled = await request.post(`/api/v1/sources/${source}/device-key`, { data: { public_key: raw } })
    expect(enrolled.status(), await enrolled.text()).toBe(201)
    /* The enrolment states its own trust model rather than implying more. */
    expect(((await enrolled.json()) as { trust_model: string }).trust_model).toBe('trust-on-first-use')

    const bytes = tinyPng(t)
    const signature = sign(null, captureDigest(source, t, merkleRootOf(bytes)), privateKey).toString('base64')

    const result = await request.post('/api/v1/ingest/observation', {
      multipart: {
        payload: JSON.stringify({
          source_id: source,
          t_start: t,
          payload_kind: 'keyframe',
          classes: ['car'],
          trigger: 'class:no_helmet',
          situation_key: 'no-helmet',
          device_signature: signature,
          lat: 13.02,
          lon: 77.71,
        }),
        media: { name: 'signed.png', mimeType: 'image/png', buffer: bytes },
      },
    })
    expect(result.ok(), await result.text()).toBe(true)
    const body = (await result.json()) as { incident_id: string; evidence: { sha256: string } }

    const bundle = (await (await request.get(`/api/v1/forensics/${body.incident_id}`)).json()) as {
      tree: { evidence_id: string; authenticity: string }[]
      authenticity: { evidence_id: string; verdict: string; tests: { test: string; result: string; detail: string }[] }[]
    }

    const node = bundle.tree.find((n) => n.evidence_id === body.evidence.sha256)!
    expect(node.authenticity).toBe('verified')

    const report = bundle.authenticity.find((a) => a.evidence_id === body.evidence.sha256)!
    expect(report.verdict).toBe('verified')

    /* The content test must be performed, not asserted. */
    const content = report.tests.find((t2) => t2.test === 'content hash')!
    expect(content.result).toBe('pass')
    expect(content.detail).toContain('recompute')

    expect(report.tests.find((t2) => t2.test === 'custody chain')!.result).toBe('pass')
    expect(report.tests.find((t2) => t2.test === 'capture signature')!.result).toBe('pass')
    expect(report.tests.find((t2) => t2.test === 'chunk tree')).toBeTruthy()
  })

  test('a forged signature is inconsistent, not merely unverified', async ({ request }) => {
    const t = Date.now() + 1
    const source = `E2E-FORGE-${t}`
    await registerSource(request, source, { lat: 13.03, lon: 77.72 })

    const { raw } = edKeyPair()
    await request.post(`/api/v1/sources/${source}/device-key`, { data: { public_key: raw } })

    /* Signed by a key nobody enrolled. This is the case the old ternary called
       "verified" because a string was present. */
    const impostor = edKeyPair()
    const bytes = tinyPng(t)
    const signature = sign(null, captureDigest(source, t, merkleRootOf(bytes)), impostor.privateKey).toString('base64')

    const result = await request.post('/api/v1/ingest/observation', {
      multipart: {
        payload: JSON.stringify({
          source_id: source,
          t_start: t,
          payload_kind: 'keyframe',
          classes: ['car'],
          trigger: 'class:no_helmet',
          situation_key: 'no-helmet',
          device_signature: signature,
          lat: 13.03,
          lon: 77.72,
        }),
        media: { name: 'forged.png', mimeType: 'image/png', buffer: bytes },
      },
    })
    const body = (await result.json()) as { incident_id: string; evidence: { sha256: string } }

    const bundle = (await (await request.get(`/api/v1/forensics/${body.incident_id}`)).json()) as {
      tree: { evidence_id: string; authenticity: string }[]
      authenticity: { evidence_id: string; verdict: string; tests: { test: string; result: string }[] }[]
    }

    expect(bundle.tree.find((n) => n.evidence_id === body.evidence.sha256)!.authenticity).toBe('inconsistent')
    const report = bundle.authenticity.find((a) => a.evidence_id === body.evidence.sha256)!
    expect(report.verdict).toBe('inconsistent')
    expect(report.tests.find((t2) => t2.test === 'capture signature')!.result).toBe('fail')
  })

  test('an unsigned object is consistent and never verified', async ({ request }) => {
    const t = Date.now() + 2
    const source = `E2E-UNSIGNED-${t}`
    await registerSource(request, source, { lat: 13.04, lon: 77.73 })
    const observation = await ingest(request, source, {
      classes: ['car'],
      trigger: 'class:no_helmet',
      situation_key: 'no-helmet',
      lat: 13.04,
      lon: 77.73,
    })

    const bundle = (await (await request.get(`/api/v1/forensics/${observation.incident_id}`)).json()) as {
      authenticity: { verdict: string; tests: { test: string; result: string; detail: string }[] }[]
    }
    const report = bundle.authenticity[0]!
    expect(report.verdict).toBe('consistent')
    const sig = report.tests.find((t2) => t2.test === 'capture signature')!
    expect(sig.result).toBe('inconclusive')
    expect(sig.detail).toContain('no capture signature')
  })

  test('a key that is not an ed25519 key is refused at enrolment', async ({ request }) => {
    const source = `E2E-BADKEY-${Date.now()}`
    await registerSource(request, source)
    const response = await request.post(`/api/v1/sources/${source}/device-key`, {
      data: { public_key: Buffer.from('too short').toString('base64') },
    })
    expect(response.status()).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('invalid_public_key')
  })
})
