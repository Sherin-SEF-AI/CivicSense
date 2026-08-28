/**
 * A small PDF writer.
 *
 * A court-bound summary has to be a file that opens in any reader without the
 * platform, which rules out printing a web page and calling it an export. This
 * emits a real PDF: base fourteen fonts, no compression, byte offsets computed
 * for the cross reference table, so the output is verifiable and no dependency
 * is pulled in to produce it.
 *
 * Text only, by design. Images belong in the evidence bundle where their hashes
 * travel with them, not embedded in a summary where they cannot be checked.
 */

export type Style = 'title' | 'heading' | 'body' | 'mono' | 'small' | 'rule' | 'gap'

export interface Line {
  style: Style
  text: string
}

const PAGE_W = 595.28 // A4 points
const PAGE_H = 841.89
const MARGIN = 56

const FONT_OF: Record<Style, { font: 'F1' | 'F2' | 'F3'; size: number; leading: number }> = {
  title: { font: 'F2', size: 17, leading: 24 },
  heading: { font: 'F2', size: 11, leading: 20 },
  body: { font: 'F1', size: 10, leading: 14 },
  mono: { font: 'F3', size: 9, leading: 13 },
  small: { font: 'F1', size: 8, leading: 11 },
  rule: { font: 'F1', size: 10, leading: 10 },
  gap: { font: 'F1', size: 10, leading: 8 },
}

/* Base fourteen widths are close enough for wrapping; a character over the
   margin is a cosmetic issue, a crash is not. */
const AVG_WIDTH: Record<'F1' | 'F2' | 'F3', number> = { F1: 0.5, F2: 0.54, F3: 0.6 }

function escape(text: string): string {
  return text
    /* WinAnsi only: anything else becomes a question mark rather than corrupting
       the stream. */
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrap(text: string, style: Style): string[] {
  const spec = FONT_OF[style]
  const max = Math.floor((PAGE_W - MARGIN * 2) / (spec.size * AVG_WIDTH[spec.font]))
  if (text.length <= max) return [text]

  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current === '') current = word
    else if (current.length + 1 + word.length <= max) current += ` ${word}`
    else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

export function renderPdf(lines: Line[], title: string): Uint8Array {
  const pages: string[] = []
  let content = ''
  let y = PAGE_H - MARGIN

  const flush = () => {
    if (content !== '') pages.push(content)
    content = ''
    y = PAGE_H - MARGIN
  }

  for (const line of lines) {
    const spec = FONT_OF[line.style]
    const wrapped = line.style === 'rule' || line.style === 'gap' ? [''] : wrap(line.text, line.style)

    for (const piece of wrapped) {
      if (y - spec.leading < MARGIN) flush()
      y -= spec.leading

      if (line.style === 'rule') {
        content += `0.75 w 0.6 0.6 0.6 RG ${MARGIN} ${y + 4} m ${PAGE_W - MARGIN} ${y + 4} l S\n`
        continue
      }
      if (line.style === 'gap' || piece === '') continue

      content += `BT /${spec.font} ${spec.size} Tf ${MARGIN} ${y} Td (${escape(piece)}) Tj ET\n`
    }
  }
  flush()
  if (pages.length === 0) pages.push('')

  /* Object 1 catalog, 2 pages, 3..n+2 page objects, then content streams, then
     the three fonts and the document info. */
  const pageCount = pages.length
  const firstPage = 3
  const firstContent = firstPage + pageCount
  const fontBase = firstContent + pageCount

  const objects: string[] = []
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objects.push(
    `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, i) => `${firstPage + i} 0 R`).join(' ')}] >>`,
  )
  pages.forEach((_, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase + 1} 0 R /F3 ${fontBase + 2} 0 R >> >> ` +
        `/Contents ${firstContent + i} 0 R >>`,
    )
  })
  pages.forEach((stream) => {
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`)
  })
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Title (${escape(title)}) /Producer (CivicSense) /CreationDate (D:${stamp()}) >>`)

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefAt = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}
