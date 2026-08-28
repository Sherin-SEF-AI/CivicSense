/**
 * Asserts that a live build contains no fixture code.
 *
 * The guarantee rests on three things: `import 'server-only'` at the top of the
 * fixture modules, a build-time constant the minifier folds, and a lint rule on
 * the import path. This checks the outcome rather than the mechanism, because
 * the outcome is what ships.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* Fixture data, not exported names.
 *
 * In a live build the fixture modules are replaced by a stub that re-exports the
 * same identifiers, so checking for names would always match. These strings only
 * exist inside the generators themselves. Bengaluru geography and the legal
 * reference are deliberately absent from this list: they are product data used
 * by the client, and the route shells legitimately remain to answer 404. */
const NEEDLES = [
  'no bin or spittoon within 60 m',
  'rider without helmet',
  'bagged waste placed beside the bin',
  'safeguard_policy.md',
  'the scheduled collection for this stop',
  'CS/2026/',
]

const ROOTS = ['.next/static/chunks', '.next/server/chunks', '.next/server/app']

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.js')) out.push(full)
  }
  return out
}

const hits = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8')
    for (const needle of NEEDLES) {
      if (source.includes(needle)) hits.push(`${file}: ${needle}`)
    }
  }
}

if (hits.length > 0) {
  console.error('fixture code found in a live build:')
  for (const hit of hits) console.error(`  ${hit}`)
  process.exit(1)
}
console.log('live build contains no fixture code')
