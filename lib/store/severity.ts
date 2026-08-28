import 'server-only'
import type { PriorityBand, SeverityBreakdown } from '@/lib/api/schemas'
import { bandForScore } from '@/lib/api/schemas/common'
import type { SituationType } from '@/lib/config/situations'

/**
 * The composite severity score.
 *
 * This is arithmetic, not judgement. The model contributes bounded amplifiers
 * and nothing else; everything here is computed from the situation catalogue,
 * the zone profile, the clock and the counts the sources actually reported. That
 * separation is what makes a score inspectable rather than pronounced.
 */

export interface SeverityWeights {
  inherent: number
  contextual: number
  temporal: number
  population: number
  escalation: number
  infrastructure: number
}

/** Weight profiles per zone kind. A hospital approach weighs context higher. */
export const ZONE_WEIGHTS: Record<string, SeverityWeights> = {
  hospital: { inherent: 0.3, contextual: 0.26, temporal: 0.1, population: 0.16, escalation: 0.12, infrastructure: 0.06 },
  school: { inherent: 0.3, contextual: 0.24, temporal: 0.14, population: 0.16, escalation: 0.1, infrastructure: 0.06 },
  'transit-hub': { inherent: 0.3, contextual: 0.22, temporal: 0.12, population: 0.2, escalation: 0.1, infrastructure: 0.06 },
  market: { inherent: 0.32, contextual: 0.2, temporal: 0.12, population: 0.18, escalation: 0.12, infrastructure: 0.06 },
  highway: { inherent: 0.36, contextual: 0.16, temporal: 0.12, population: 0.12, escalation: 0.16, infrastructure: 0.08 },
  residential: { inherent: 0.36, contextual: 0.18, temporal: 0.12, population: 0.12, escalation: 0.12, infrastructure: 0.1 },
  industrial: { inherent: 0.36, contextual: 0.16, temporal: 0.1, population: 0.12, escalation: 0.16, infrastructure: 0.1 },
  religious: { inherent: 0.3, contextual: 0.22, temporal: 0.14, population: 0.18, escalation: 0.1, infrastructure: 0.06 },
  default: { inherent: 0.34, contextual: 0.2, temporal: 0.12, population: 0.14, escalation: 0.12, infrastructure: 0.08 },
}

const IST_OFFSET_MS = 5.5 * 3600_000

export function istHour(t: number): number {
  return ((t + IST_OFFSET_MS) % 86400_000) / 3600_000
}

/** Temporal urgency from the hour of day, which is a fact about the clock. */
export function temporalUrgency(hour: number): number {
  if (hour >= 7 && hour <= 10) return 0.8
  if (hour >= 17 && hour <= 21) return 0.9
  if (hour >= 22 || hour <= 5) return 0.55
  return 0.4
}

export interface SeverityInputs {
  situation: SituationType
  zoneKind: string
  zoneSensitivity: number
  t: number
  /** Count of people or vehicles the sources actually reported in the area. */
  affected: number
  /** Bounded amplifiers from the context pass, or zero when it has not run. */
  amplifiers: { escalation: number; infrastructure: number }
}

export function computeSeverity(input: SeverityInputs): { score: number; band: PriorityBand; breakdown: SeverityBreakdown } {
  const weights = ZONE_WEIGHTS[input.zoneKind] ?? ZONE_WEIGHTS.default!
  const hour = istHour(input.t)

  const raw = {
    inherent: input.situation.inherent,
    contextual: input.zoneSensitivity,
    temporal: temporalUrgency(hour),
    population: Math.min(1, input.affected / 40),
    escalation: clamp01(input.amplifiers.escalation),
    infrastructure: clamp01(input.amplifiers.infrastructure),
  }

  const labels: Record<keyof typeof raw, string> = {
    inherent: 'inherent severity',
    contextual: 'contextual amplifiers',
    temporal: 'temporal urgency',
    population: 'affected population',
    escalation: 'escalation potential',
    infrastructure: 'infrastructure risk',
  }

  const notes: Record<keyof typeof raw, string> = {
    inherent: `${input.situation.title} base severity from the situation catalogue`,
    contextual: `${input.zoneKind} zone, configured sensitivity ${input.zoneSensitivity}`,
    temporal: `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} IST`,
    population: `${input.affected} counted in the exposure area`,
    escalation: 'bounded amplifier from the context pass',
    infrastructure: 'bounded amplifier from the context pass',
  }

  const components = (Object.keys(raw) as (keyof typeof raw)[]).map((key) => ({
    key: key as SeverityBreakdown['components'][number]['key'],
    label: labels[key],
    raw: round3(raw[key]),
    weight: weights[key],
    contribution: round3(raw[key] * weights[key]),
    note: notes[key],
  }))

  const score = Math.min(0.99, round3(components.reduce((sum, c) => sum + c.contribution, 0)))

  return {
    score,
    band: bandForScore(score),
    breakdown: { score, band: bandForScore(score), zone_profile: `${input.zoneKind} weight profile`, components },
  }
}

/**
 * The reported interval.
 *
 * Width comes from what is actually uncertain: a single uncorroborated source at
 * poor sync tells you less than three agreeing ones, and the interval says so
 * rather than presenting a point value the evidence does not support.
 */
export function severityInterval(score: number, corroboration: number, sourceCount: number): { lo: number; hi: number } {
  const base = 0.11
  const fromCorroboration = base * (1 - clamp01(corroboration))
  const fromSources = base * (1 / Math.max(1, sourceCount))
  const half = Math.max(0.01, round3((fromCorroboration + fromSources) / 2))
  return { lo: Math.max(0, round3(score - half)), hi: Math.min(1, round3(score + half)) }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const round3 = (n: number) => Math.round(n * 1000) / 1000

export const SLA_SECONDS: Record<PriorityBand, number> = {
  CRITICAL: 300,
  HIGH: 1800,
  MEDIUM: 7200,
  LOW: 28800,
  INFO: 86400,
}
