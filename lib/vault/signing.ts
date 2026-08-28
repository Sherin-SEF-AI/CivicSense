import 'server-only'
import { createHash, createPublicKey, verify } from 'node:crypto'

/**
 * Capture signatures.
 *
 * A device signs what it captured at the moment it captured it. The platform
 * verifies that signature against a key enrolled for that source, and records
 * the verdict. Before this, `device_signature` was an arbitrary string the
 * uploader chose, stored without inspection, and used to decide whether an
 * operator was told an object was "verified". That is the opposite of what the
 * word means.
 *
 * The signature covers the source, the capture time and the chunk tree root,
 * bound to a version tag. Binding all three is what stops a signature being
 * lifted from one object and replayed onto another, or the same object being
 * re-presented as having come from a different camera at a different time.
 */

export const CAPTURE_DOMAIN = 'fis-capture/1'

export type SignatureVerdict = 'verified' | 'bad_signature' | 'no_key' | 'unverified'

/** The digest a device signs. Specified here so both sides can compute it. */
export function captureDigest(sourceId: string, tStartMs: number, merkleRoot: string): Buffer {
  const t = Buffer.alloc(8)
  t.writeBigUInt64BE(BigInt(Math.trunc(tStartMs)))
  return createHash('sha256')
    .update(Buffer.from(CAPTURE_DOMAIN, 'utf8'))
    .update(Buffer.from(sourceId, 'utf8'))
    .update(t)
    .update(Buffer.from(merkleRoot, 'hex'))
    .digest()
}

/* Ed25519 SubjectPublicKeyInfo is a fixed 12 byte prefix followed by the raw
   32 byte key, so a device can enrol the raw key and node can still use it. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function publicKeyFromRaw(base64Key: string) {
  const raw = Buffer.from(base64Key, 'base64')
  if (raw.byteLength !== 32) throw new Error(`an ed25519 public key is 32 bytes, got ${raw.byteLength}`)
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

export function verifyCaptureSignature(input: {
  publicKeyBase64: string
  signatureBase64: string
  sourceId: string
  tStartMs: number
  merkleRoot: string
}): boolean {
  try {
    const key = publicKeyFromRaw(input.publicKeyBase64)
    const signature = Buffer.from(input.signatureBase64, 'base64')
    if (signature.byteLength !== 64) return false
    return verify(null, captureDigest(input.sourceId, input.tStartMs, input.merkleRoot), key, signature)
  } catch {
    return false
  }
}
