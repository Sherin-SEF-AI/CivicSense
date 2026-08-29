/**
 * The accessibility gate.
 *
 * Runs against a production build, never the dev server: the dev server serves
 * CSS through a script that had not applied when the audit measured the page,
 * which produced a false failure on every screen and hid two real defects
 * behind it. It also uses the desktop preset, because this is a desktop
 * operator console and measuring it under a phone viewport tests a layout the
 * product does not have.
 *
 *   npm run build && npm start -- -p 3115
 *   node scripts/lighthouse.mjs http://localhost:3115
 *
 * Both write to and read from .next-prod, so neither disturbs a dev server that
 * happens to be running.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:3115'
const THRESHOLD = 95

const SCREENS = ['ops', 'upload', 'evidence', 'cases', 'predict', 'sources', 'analytics', 'query', 'admin', 'forensics']

const out = mkdtempSync(join(tmpdir(), 'civicsense-lh-'))

async function firstIncident() {
  try {
    const response = await fetch(`${base}/api/v1/incidents?limit=1`)
    const body = await response.json()
    return body.items?.[0]?.incident_id ?? null
  } catch {
    return null
  }
}

function audit(path, label) {
  const file = join(out, `${label.replace(/\W/g, '-')}.json`)
  execFileSync(
    'npx',
    [
      'lighthouse', `${base}${path}`,
      '--preset=desktop', '--only-categories=accessibility',
      '--output=json', `--output-path=${file}`, '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
    ],
    { stdio: 'ignore' },
  )
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const score = Math.round(report.categories.accessibility.score * 100)
  const failed = Object.values(report.audits)
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'notApplicable')
    .map((a) => a.id)
  console.log(`${label.padEnd(16)} ${String(score).padStart(3)}  ${failed.length > 0 ? failed.join(', ') : 'clean'}`)
  return { score, failed }
}

const incident = await firstIncident()
const targets = [
  ...SCREENS.map((s) => [`/${s}`, s]),
  ...(incident ? [[`/incident/${incident}`, 'incident/[id]'], [`/forensics/${incident}`, 'forensics/[id]']] : []),
]

if (!incident) {
  console.log('no incident in the store, so the two detail routes are not audited\n')
}

let worst = 100
for (const [path, label] of targets) {
  const result = audit(path, label)
  worst = Math.min(worst, result.score)
}

console.log()
if (worst < THRESHOLD) {
  console.error(`the lowest score is ${worst}, below the ${THRESHOLD} threshold`)
  process.exit(1)
}
console.log(`every route scores at least ${worst}, above the ${THRESHOLD} threshold`)
