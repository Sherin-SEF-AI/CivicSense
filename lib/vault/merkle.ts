import { createHash } from 'node:crypto'

/**
 * The chunk tree over an evidence object.
 *
 * A whole-file digest proves an object is intact and nothing else. It cannot
 * prove that one segment of a two hour recording is the segment that was in the
 * original, which is exactly what a partial disclosure has to prove. So an
 * object is chunked and the chunk digests form a tree; the root is the object's
 * identity for integrity purposes, and any chunk can be proved a member of it
 * without shipping the rest.
 *
 * Two details matter and both are load-bearing:
 *
 * Leaves and internal nodes carry different domain prefixes. Without them a
 * leaf digest could be presented as an internal node, and an attacker who
 * controls chunk content could forge a tree of a different shape with the same
 * root.
 *
 * An odd node at a level is promoted unchanged, never duplicated. Duplicating
 * it is the classic Bitcoin CVE-2012-2459 mistake: two different chunk lists
 * then produce the same root, which makes the root useless as an identity.
 */

export const CHUNK_SIZE = 16 * 1024 * 1024

const LEAF = Buffer.from([0x00])
const NODE = Buffer.from([0x01])

export interface Chunk {
  index: number
  offset: number
  length: number
  digest: string
}

export interface MerkleResult {
  root: string
  chunkSize: number
  leafCount: number
  chunks: Chunk[]
  algo: 'sha256-16m-v1'
}

function leafDigest(chunk: Buffer): Buffer {
  return createHash('sha256').update(LEAF).update(chunk).digest()
}

function nodeDigest(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE).update(left).update(right).digest()
}

export function chunkOf(bytes: Buffer, chunkSize = CHUNK_SIZE): Chunk[] {
  /* A zero byte object still has one chunk, so it still has a defined root. */
  if (bytes.byteLength === 0) {
    return [{ index: 0, offset: 0, length: 0, digest: leafDigest(Buffer.alloc(0)).toString('hex') }]
  }
  const chunks: Chunk[] = []
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkSize, index++) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))
    chunks.push({ index, offset, length: slice.byteLength, digest: leafDigest(slice).toString('hex') })
  }
  return chunks
}

/** Builds every level, bottom up. Level 0 is the leaves. */
function levelsOf(leaves: Buffer[]): Buffer[][] {
  const levels: Buffer[][] = [leaves]
  let current = leaves
  while (current.length > 1) {
    const next: Buffer[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!
      const right = current[i + 1]
      /* Promotion, not duplication. See the note above. */
      next.push(right === undefined ? left : nodeDigest(left, right))
    }
    levels.push(next)
    current = next
  }
  return levels
}

export function merkleOf(bytes: Buffer, chunkSize = CHUNK_SIZE): MerkleResult {
  const chunks = chunkOf(bytes, chunkSize)
  const leaves = chunks.map((c) => Buffer.from(c.digest, 'hex'))
  const levels = levelsOf(leaves)
  return {
    root: levels[levels.length - 1]![0]!.toString('hex'),
    chunkSize,
    leafCount: chunks.length,
    chunks,
    algo: 'sha256-16m-v1',
  }
}

export interface ProofStep {
  side: 'left' | 'right'
  digest: string
}

/**
 * The sibling path proving a chunk belongs to the root.
 *
 * A promoted node contributes no step, because it was carried up unchanged.
 */
export function proofFor(leafDigests: string[], index: number): ProofStep[] {
  const levels = levelsOf(leafDigests.map((d) => Buffer.from(d, 'hex')))
  const steps: ProofStep[] = []
  let position = index

  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level]!
    const isRight = position % 2 === 1
    const siblingIndex = isRight ? position - 1 : position + 1
    const sibling = nodes[siblingIndex]
    if (sibling !== undefined) {
      steps.push({ side: isRight ? 'left' : 'right', digest: sibling.toString('hex') })
    }
    position = Math.floor(position / 2)
  }
  return steps
}

/** Recomputes a root from one chunk and its path. This is what a verifier runs. */
export function verifyProof(chunk: Buffer, proof: ProofStep[], root: string): boolean {
  let current = leafDigest(chunk)
  for (const step of proof) {
    const sibling = Buffer.from(step.digest, 'hex')
    current = step.side === 'left' ? nodeDigest(sibling, current) : nodeDigest(current, sibling)
  }
  return current.toString('hex') === root
}
