/**
 * Formatting. Every number an operator reads goes through here, so the product
 * has one answer for how a timestamp, a score or a duration looks.
 *
 * The deployment is Bengaluru, so wall time is IST and it is labelled as such.
 * Formatting is done by arithmetic on the offset rather than Intl, because these
 * run inside 60Hz readouts where allocating a formatter per frame is not free.
 */

export const IST_OFFSET_MS = 5.5 * 3600_000

const pad = (n: number, width = 2) => String(Math.floor(Math.abs(n))).padStart(width, '0')

interface Parts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
  ms: number
}

export function istParts(t: number): Parts {
  const d = new Date(t + IST_OFFSET_MS)
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  }
}

/** `14:32:07.412 IST`, the product's canonical instant. */
export function fmtTime(t: number, opts: { ms?: boolean; zone?: boolean } = {}): string {
  const { h, mi, s, ms } = istParts(t)
  const showMs = opts.ms ?? true
  const showZone = opts.zone ?? true
  return `${pad(h)}:${pad(mi)}:${pad(s)}${showMs ? `.${pad(ms, 3)}` : ''}${showZone ? ' IST' : ''}`
}

/** `2026-08-28`. */
export function fmtDate(t: number): string {
  const { y, mo, d } = istParts(t)
  return `${y}-${pad(mo)}-${pad(d)}`
}

export function fmtDateTime(t: number): string {
  return `${fmtDate(t)} ${fmtTime(t, { ms: false })}`
}

/** `00:04:31`, always three fields so columns line up. */
export function fmtDuration(ms: number): string {
  const negative = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${negative ? '-' : ''}${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Compact age for feed rows: seconds under a minute, then mm:ss, then h/d. */
export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}:${pad(s % 60)}`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

/** Timeline ruler labels: only the fields the zoom level makes meaningful. */
export function fmtClock(t: number, precision: 'ms' | 's' | 'm' | 'h' | 'd'): string {
  const p = istParts(t)
  switch (precision) {
    case 'ms':
      return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${pad(p.ms, 3)}`
    case 's':
      return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`
    case 'm':
      return `${pad(p.h)}:${pad(p.mi)}`
    case 'h':
      return `${pad(p.h)}:00`
    case 'd':
      return `${pad(p.mo)}-${pad(p.d)}`
  }
}

/** Scores render to two decimals, always, so a column of them is a column. */
export function fmtScore(v: number, digits = 2): string {
  return v.toFixed(digits)
}

export function fmtInterval(value: number, lo: number, hi: number, digits = 2): string {
  return `${value.toFixed(digits)} [${lo.toFixed(digits)}-${hi.toFixed(digits)}]`
}

export function fmtPct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB']

export function fmtBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${BYTE_UNITS[unit]}`
}

/**
 * Money.
 *
 * Below a cent the two-decimal form reads as zero, which is wrong when real
 * calls have been billed. Small amounts get the precision they need instead.
 */
export function fmtUsd(v: number, digits?: number): string {
  if (digits !== undefined) return `$${v.toFixed(digits)}`
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

export function fmtLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

/** First eight hex characters, which is what a hash chip shows. */
export function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

export function fmtCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Zero-allocation clock readout for the 60Hz transport display. */
export function fmtTransport(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const h = Math.floor(total / 3600_000)
  const m = Math.floor((total % 3600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const f = total % 1000
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`
}
