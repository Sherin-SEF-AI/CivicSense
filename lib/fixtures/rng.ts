import { mulberry32, subSeed } from '@/lib/geo/build'

export { mulberry32, subSeed }

export type Rng = () => number

export function pick<T>(rnd: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!
}

/** Weighted pick over [item, weight] pairs. */
export function weighted<T>(rnd: Rng, xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((s, x) => s + x[1], 0)
  let r = rnd() * total
  for (const [item, w] of xs) {
    r -= w
    if (r <= 0) return item
  }
  return xs[xs.length - 1]![0]
}

export function range(rnd: Rng, lo: number, hi: number): number {
  return lo + rnd() * (hi - lo)
}

export function intRange(rnd: Rng, lo: number, hi: number): number {
  return Math.floor(range(rnd, lo, hi + 1))
}

/** Box-Muller, clamped, for jitter that looks natural rather than uniform. */
export function gauss(rnd: Rng, mean: number, sd: number): number {
  const u = Math.max(rnd(), 1e-9)
  const v = rnd()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function chance(rnd: Rng, p: number): boolean {
  return rnd() < p
}

const HEX = '0123456789abcdef'

export function hex(rnd: Rng, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += HEX[Math.floor(rnd() * 16)]
  return s
}

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID-shaped identifier: sortable time prefix, random suffix. */
export function ulid(rnd: Rng, t: number): string {
  let time = ''
  let n = Math.floor(t)
  for (let i = 0; i < 10; i++) {
    time = ULID_CHARS[n % 32]! + time
    n = Math.floor(n / 32)
  }
  let rand = ''
  for (let i = 0; i < 16; i++) rand += ULID_CHARS[Math.floor(rnd() * 32)]
  return time + rand
}

/**
 * Diurnal intensity for a non-homogeneous Poisson process. Peaks at the morning
 * and evening commutes, troughs after midnight, which is what makes the feed
 * look like a city rather than a random number generator.
 */
export function diurnal(hourIST: number): number {
  const morning = Math.exp(-((hourIST - 9.5) ** 2) / 6)
  const evening = Math.exp(-((hourIST - 19.5) ** 2) / 8)
  const night = Math.exp(-((hourIST - 1.5) ** 2) / 10) * 0.35
  return 0.18 + morning * 0.9 + evening * 1.0 + night
}

/** Smooth value noise, used for sensor series that must be a pure function of t. */
export function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const h = (n: number) => {
    let v = (n ^ seed) >>> 0
    v = Math.imul(v ^ (v >>> 15), 0x2c1b3c6d) >>> 0
    v = Math.imul(v ^ (v >>> 12), 0x297a2d39) >>> 0
    return ((v ^ (v >>> 15)) >>> 0) / 4294967296
  }
  const a = h(i)
  const b = h(i + 1)
  const t = f * f * (3 - 2 * f)
  return a + (b - a) * t
}
