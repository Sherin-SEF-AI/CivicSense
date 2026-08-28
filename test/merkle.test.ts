import { deepStrictEqual, ok, strictEqual, notStrictEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { CHUNK_SIZE, chunkOf, merkleOf, proofFor, verifyProof } from '../lib/vault/merkle'

function pattern(length: number): Buffer {
  /* Non-periodic across chunk boundaries. A plain (i * 37 + 11) has period 256,
     which made every full 1024 byte chunk identical and the vectors vacuous:
     a proof for one chunk verified against another because the bytes matched. */
  const out = Buffer.alloc(length)
  for (let i = 0; i < length; i++) out[i] = (i * 37 + 11 + (i >>> 8) * 97) & 0xff
  return out
}

describe('merkle chunk tree', () => {
  it('matches the committed cross-language vectors', () => {
    const spec = JSON.parse(readFileSync('fis/spec/merkle-vectors.json', 'utf8')) as {
      vectors: {
        name: string
        length: number
        chunk_size: number
        leaf_count: number
        chunk_digests: string[]
        root: string
        proofs: { index: number; steps: { side: 'left' | 'right'; digest: string }[] }[]
      }[]
    }

    for (const vector of spec.vectors) {
      const bytes = pattern(vector.length)
      const tree = merkleOf(bytes, vector.chunk_size)
      strictEqual(tree.root, vector.root, `${vector.name} root`)
      strictEqual(tree.leafCount, vector.leaf_count, `${vector.name} leaf count`)
      deepStrictEqual(
        tree.chunks.map((c) => c.digest),
        vector.chunk_digests,
        `${vector.name} chunk digests`,
      )
      for (const proof of vector.proofs) {
        const chunk = tree.chunks[proof.index]!
        ok(
          verifyProof(bytes.subarray(chunk.offset, chunk.offset + chunk.length), proof.steps, vector.root),
          `${vector.name} proof ${proof.index}`,
        )
      }
    }
  })

  it('gives a zero byte object a defined root', () => {
    const tree = merkleOf(Buffer.alloc(0), 1024)
    strictEqual(tree.leafCount, 1)
    strictEqual(tree.chunks[0]!.length, 0)
    strictEqual(tree.root, createHash('sha256').update(Buffer.from([0x00])).digest('hex'))
  })

  it('separates leaves from internal nodes by domain prefix', () => {
    /* A single leaf digest must not equal the plain sha-256 of the chunk, or a
       chunk could be presented as a node and vice versa. */
    const bytes = pattern(64)
    const tree = merkleOf(bytes, 1024)
    notStrictEqual(tree.chunks[0]!.digest, createHash('sha256').update(bytes).digest('hex'))
  })

  it('promotes an odd node rather than duplicating it', () => {
    /* The CVE-2012-2459 property. With duplication, a three leaf tree [a,b,c]
       and a four leaf tree [a,b,c,c] produce the same root, so the root stops
       identifying the chunk list. With promotion they must differ. */
    const three = pattern(1024 * 2 + 7)
    const treeThree = merkleOf(three, 1024)
    strictEqual(treeThree.leafCount, 3)

    const duplicatedLast = [...treeThree.chunks.map((c) => c.digest), treeThree.chunks[2]!.digest]
    const forged = rootOfDigests(duplicatedLast)
    notStrictEqual(treeThree.root, forged, 'a duplicated last leaf must not reproduce the root')
  })

  it('refuses a proof from a different chunk', () => {
    const bytes = pattern(1024 * 5 + 1)
    const tree = merkleOf(bytes, 1024)
    const digests = tree.chunks.map((c) => c.digest)
    const proof = proofFor(digests, 0)
    const wrongChunk = bytes.subarray(1024, 2048)
    /* The pattern must actually differ between chunks or this proves nothing. */
    ok(!wrongChunk.equals(bytes.subarray(0, 1024)), 'the corpus pattern repeats across chunks')
    ok(!verifyProof(wrongChunk, proof, tree.root))
  })

  it('refuses a tampered chunk', () => {
    const bytes = pattern(1024 * 3)
    const tree = merkleOf(bytes, 1024)
    const proof = proofFor(
      tree.chunks.map((c) => c.digest),
      1,
    )
    const chunk = Buffer.from(bytes.subarray(1024, 2048))
    chunk[0] = (chunk[0]! ^ 0xff) & 0xff
    ok(!verifyProof(chunk, proof, tree.root))
  })

  it('chunks a large object at the declared size', () => {
    const chunks = chunkOf(Buffer.alloc(CHUNK_SIZE + 5), CHUNK_SIZE)
    strictEqual(chunks.length, 2)
    strictEqual(chunks[0]!.length, CHUNK_SIZE)
    strictEqual(chunks[1]!.length, 5)
    strictEqual(chunks[1]!.offset, CHUNK_SIZE)
  })
})

/** Rebuilds a root from leaf digests using duplication, for the negative test. */
function rootOfDigests(digests: string[]): string {
  let level: Buffer[] = digests.map((d) => Buffer.from(d, 'hex'))
  while (level.length > 1) {
    const next: Buffer[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!
      const right = level[i + 1] ?? left
      next.push(createHash('sha256').update(Buffer.from([0x01])).update(left).update(right).digest())
    }
    level = next
  }
  return level[0]!.toString('hex')
}
