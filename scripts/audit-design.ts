/**
 * Design-language audit.
 *
 * The rules in the brief are easy to state and easy to erode, so they are
 * checked rather than trusted: one motion duration, no raw hex outside the token
 * files, no em-dashes in operator copy, and monospace on every numeric readout.
 * Run with `npm run audit:design`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.next', '.git', 'public', 'data', '.osm-cache', 'test-results', 'playwright-report', 'e2e'])

/** tokens.css owns the palette; lib/tokens.ts mirrors it for canvas, which cannot read variables. */
/* tokens.css is the palette. lib/tokens.ts mirrors it for canvas and map
   expressions, neither of which can read a CSS variable. offline.ts carries its
   own copy on purpose: an exported bundle has to open with no stylesheet from
   this application at all, and the disclosure bundle prints on paper, so it is
   the one document in the product with a light palette. */
const HEX_ALLOWED = new Set([
  'styles/tokens.css',
  'lib/tokens.ts',
  'lib/export/offline.ts',
  'lib/export/disclosure.ts',
  'app/icon.svg',
  /* The browser theme-color meta needs a literal; it is chrome, not interface. */
  'app/layout.tsx',
  'scripts/audit-design.ts',
])
const MOTION_ALLOWED = new Set(['styles/globals.css', 'styles/tokens.css', 'scripts/audit-design.ts'])

interface Finding {
  file: string
  line: number
  rule: string
  text: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (['.ts', '.tsx', '.css', '.mjs'].includes(extname(full))) out.push(full)
  }
  return out
}

const findings: Finding[] = []
const files = walk(ROOT)

for (const file of files) {
  const rel = relative(ROOT, file)
  const lines = readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, i) => {
    const at = { file: rel, line: i + 1, text: line.trim().slice(0, 110) }

    if (/[\u2014\u2013]/.test(line) && rel !== 'eslint.config.mjs' && rel !== 'scripts/audit-design.ts') {
      findings.push({ ...at, rule: 'em-dash in copy' })
    }

    if (!HEX_ALLOWED.has(rel) && /#[0-9a-fA-F]{6}\b/.test(line)) {
      findings.push({ ...at, rule: 'raw hex outside the token files' })
    }

    /* One motion duration. Anything else is a curve creeping back in. */
    if (!MOTION_ALLOWED.has(rel)) {
      const duration = /transition[^;\n]*?(\d+)ms|animation[^;\n]*?(\d+)ms/.exec(line)
      const ms = duration?.[1] ?? duration?.[2]
      if (ms && ms !== '120') findings.push({ ...at, rule: `motion duration ${ms}ms, only 120ms is allowed` })
      if (/cubic-bezier|ease-in|ease-out|\bspring\b/.test(line)) {
        findings.push({ ...at, rule: 'easing curve, motion is linear only' })
      }
    }
  })
}

/* Numeric readouts must be monospace.
 *
 * Some components apply mono to their own value slot, and DataTable applies it
 * per cell unless the column is declared prose, so a formatter call inside those
 * is already covered. The check looks for the remainder: formatter output placed
 * directly into markup with no mono in the enclosing element. */
const NUMERIC_FORMATTERS = /fmt(Score|Pct|Usd|Bytes|Duration|Time|Date|Count|Interval|Transport|LatLon|Clock|Age)\(/
const SELF_MONO =
  /(MetricTile|ConfidenceInterval|SLACountdown|TrustBar|Meter|HashChip|ScopeChart|CopyChip|downloadCsv|title=|aria-label=|render:|csv:|sortValue:|values:|detail:|text:|const text =|setGapText\(|\.textContent =|placeholder=)/
for (const file of files.filter((f) => f.endsWith('.tsx'))) {
  const rel = relative(ROOT, file)
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    if (!NUMERIC_FORMATTERS.test(line)) return
    /* Look back to the enclosing block: table bodies and panels commonly set
       mono once for everything inside them. */
    const context = lines.slice(Math.max(0, i - 22), i + 2).join('\n')
    if (SELF_MONO.test(context)) return
    if (/\bmono\b/.test(context)) return
    findings.push({ file: rel, line: i + 1, rule: 'numeric readout may not be monospace', text: line.trim().slice(0, 110) })
  })
}

const byRule = new Map<string, Finding[]>()
for (const f of findings) {
  const list = byRule.get(f.rule) ?? []
  list.push(f)
  byRule.set(f.rule, list)
}

if (findings.length === 0) {
  console.log(`design audit clean across ${files.length} files`)
  process.exit(0)
}

for (const [rule, list] of byRule) {
  console.log(`\n${rule} (${list.length})`)
  for (const f of list.slice(0, 12)) console.log(`  ${f.file}:${f.line}  ${f.text}`)
  if (list.length > 12) console.log(`  and ${list.length - 12} more`)
}
console.log(`\n${findings.length} findings`)
process.exit(1)
