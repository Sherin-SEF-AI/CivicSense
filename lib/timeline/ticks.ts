import { fmtClock } from '@/lib/format'

/**
 * Tick spacing walks a ladder of real time units rather than powers of ten,
 * because an operator reads 15 seconds and 5 minutes, never 1.024 seconds.
 */
const LADDER: readonly { step: number; precision: 'ms' | 's' | 'm' | 'h' | 'd' }[] = [
  { step: 100, precision: 'ms' },
  { step: 250, precision: 'ms' },
  { step: 500, precision: 'ms' },
  { step: 1_000, precision: 's' },
  { step: 2_000, precision: 's' },
  { step: 5_000, precision: 's' },
  { step: 10_000, precision: 's' },
  { step: 15_000, precision: 's' },
  { step: 30_000, precision: 's' },
  { step: 60_000, precision: 'm' },
  { step: 120_000, precision: 'm' },
  { step: 300_000, precision: 'm' },
  { step: 600_000, precision: 'm' },
  { step: 900_000, precision: 'm' },
  { step: 1_800_000, precision: 'm' },
  { step: 3_600_000, precision: 'h' },
  { step: 7_200_000, precision: 'h' },
  { step: 21_600_000, precision: 'h' },
  { step: 43_200_000, precision: 'h' },
  { step: 86_400_000, precision: 'd' },
]

/** Widest label at 11px mono plus padding, measured once rather than guessed. */
const MIN_LABEL_PX = 88

export function chooseStep(msPerPx: number): { step: number; precision: 'ms' | 's' | 'm' | 'h' | 'd' } {
  for (const rung of LADDER) {
    if (rung.step / msPerPx >= MIN_LABEL_PX) return rung
  }
  return LADDER[LADDER.length - 1]!
}

export function minorStep(step: number): number {
  const index = LADDER.findIndex((r) => r.step === step)
  return index > 0 ? LADDER[index - 1]!.step : step / 2
}

export function tickLabel(t: number, precision: 'ms' | 's' | 'm' | 'h' | 'd'): string {
  return fmtClock(t, precision)
}

/** Aligned to the IST wall clock, so a tick lands on the minute, not on t0. */
const IST_OFFSET_MS = 5.5 * 3600_000

export function firstTickAtOrAfter(t: number, step: number): number {
  const shifted = t + IST_OFFSET_MS
  return Math.ceil(shifted / step) * step - IST_OFFSET_MS
}
