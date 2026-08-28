/**
 * Writes the cross-language golden vectors for the chunk tree.
 *
 * Node computes them here and the Python vault implementation is tested against
 * the same file. A divergence between the two implementations would be silent,
 * would only appear when an export was verified by the other side, and would be
 * catastrophic at that point, so it is pinned before either is trusted.
 *
 * Run with `npm run merkle:vectors`.
 */
import { writeFileSync } from 'node:fs'
import { CHUNK_SIZE, merkleOf, proofFor, verifyProof } from '../lib/vault/merkle'

/* A small chunk size so the tree shapes that matter are reachable in a test. */
const SMALL = 1024

function pattern(length: number): Buffer {
  /* Non-periodic across chunk boundaries. A plain (i * 37 + 11) has period 256,
     which made every full 1024 byte chunk identical and the vectors vacuous:
     a proof for one chunk verified against another because the bytes matched. */
  const out = Buffer.alloc(length)
  for (let i = 0; i < length; i++) out[i] = (i * 37 + 11 + (i >>> 8) * 97) & 0xff
  return out
}

const CASES: { name: string; bytes: number; chunkSize: number }[] = [
  { name: 'empty', bytes: 0, chunkSize: SMALL },
  { name: 'one_byte', bytes: 1, chunkSize: SMALL },
  { name: 'exactly_one_chunk', bytes: SMALL, chunkSize: SMALL },
  { name: 'one_chunk_plus_one', bytes: SMALL + 1, chunkSize: SMALL },
  { name: 'two_chunks', bytes: SMALL * 2, chunkSize: SMALL },
  /* Three and five leaves are where promotion happens. */
  { name: 'three_leaves', bytes: SMALL * 2 + 7, chunkSize: SMALL },
  { name: 'four_leaves', bytes: SMALL * 4, chunkSize: SMALL },
  { name: 'five_leaves', bytes: SMALL * 4 + 1, chunkSize: SMALL },
  { name: 'seven_leaves', bytes: SMALL * 6 + 512, chunkSize: SMALL },
  { name: 'eight_leaves', bytes: SMALL * 8, chunkSize: SMALL },
  { name: 'default_chunk_small_object', bytes: 4096, chunkSize: CHUNK_SIZE },
]

const vectors = CASES.map((testCase) => {
  const bytes = pattern(testCase.bytes)
  const tree = merkleOf(bytes, testCase.chunkSize)
  const digests = tree.chunks.map((c) => c.digest)
  const proofs = tree.chunks.map((chunk) => {
    const proof = proofFor(digests, chunk.index)
    const slice = bytes.subarray(chunk.offset, chunk.offset + chunk.length)
    if (!verifyProof(slice, proof, tree.root)) {
      throw new Error(`proof for ${testCase.name} chunk ${chunk.index} does not verify against its own root`)
    }
    return { index: chunk.index, steps: proof }
  })

  return {
    name: testCase.name,
    /* The pattern is specified rather than embedded so the file stays small and
       the other implementation has to generate the same bytes to match. */
    pattern: 'byte i = (i * 37 + 11 + (i >>> 8) * 97) & 0xff',
    length: testCase.bytes,
    chunk_size: testCase.chunkSize,
    leaf_count: tree.leafCount,
    chunk_digests: digests,
    root: tree.root,
    proofs,
  }
})

writeFileSync(
  'fis/spec/merkle-vectors.json',
  `${JSON.stringify(
    {
      algo: 'sha256-16m-v1',
      leaf_prefix: '0x00',
      node_prefix: '0x01',
      odd_node: 'promoted unchanged to the next level, never duplicated',
      default_chunk_size: CHUNK_SIZE,
      vectors,
    },
    null,
    2,
  )}\n`,
)

console.log(`wrote ${vectors.length} vectors, roots:`)
for (const v of vectors) console.log(`  ${v.name.padEnd(26)} ${v.leaf_count} leaves  ${v.root.slice(0, 16)}`)
