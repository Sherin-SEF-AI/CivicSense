import type { Domain, PriorityBand, SourceType, WarningLevel } from '@/lib/api/schemas'
import type { GlyphName } from '@/components/glyphs'

/**
 * The bridge from domain values to design tokens.
 *
 * Priority is always double-encoded: a hue and a glyph or a label, never a hue
 * alone. Domain hues exist only for 14px glyphs and 2px accents, so this module
 * hands out CSS variables and nothing here is ever used as a fill.
 */

export const PRIORITY_COLOR: Record<PriorityBand, string> = {
  CRITICAL: 'var(--critical)',
  HIGH: 'var(--high)',
  MEDIUM: 'var(--medium)',
  LOW: 'var(--low)',
  INFO: 'var(--info)',
}

/** The label carries the meaning when colour cannot: printouts, colour vision. */
export const PRIORITY_MARK: Record<PriorityBand, string> = {
  CRITICAL: 'C1',
  HIGH: 'H2',
  MEDIUM: 'M3',
  LOW: 'L4',
  INFO: 'I5',
}

export const DOMAIN_COLOR: Record<Domain, string> = {
  traffic: 'var(--domain-traffic)',
  waste: 'var(--domain-waste)',
  safety: 'var(--domain-safety)',
  nuisance: 'var(--domain-nuisance)',
  infrastructure: 'var(--domain-infrastructure)',
  environment: 'var(--domain-environment)',
  vehicle: 'var(--domain-vehicle)',
  disaster: 'var(--domain-disaster)',
}

export const DOMAIN_GLYPH: Record<Domain, GlyphName> = {
  traffic: 'traffic',
  waste: 'waste',
  safety: 'safety',
  nuisance: 'nuisance',
  infrastructure: 'infrastructure',
  environment: 'environment',
  vehicle: 'vehicle',
  disaster: 'disaster',
}

export const SOURCE_GLYPH: Record<SourceType, GlyphName> = {
  'cctv-fixed': 'cctv-fixed',
  'cctv-ptz': 'cctv-ptz',
  'patrol-car': 'patrol-car',
  'patrol-bike': 'patrol-bike',
  bodycam: 'bodycam',
  'usb-cam': 'usb-cam',
  phone: 'phone',
  drone: 'drone',
  sensor: 'sensor',
  'vehicle-bus': 'vehicle-bus',
}

export const WARNING_COLOR: Record<WarningLevel, string> = {
  WATCH: 'var(--info)',
  ADVISORY: 'var(--medium)',
  WARNING: 'var(--high)',
  CRITICAL: 'var(--critical)',
}

export const STATE_COLOR = {
  up: 'var(--ok)',
  degraded: 'var(--medium)',
  down: 'var(--critical)',
  maintenance: 'var(--info)',
} as const

export const AUTHENTICITY_COLOR = {
  verified: 'var(--ok)',
  consistent: 'var(--live)',
  unverifiable: 'var(--info)',
  inconsistent: 'var(--critical)',
} as const

export const AUTHENTICITY_GLYPH: Record<keyof typeof AUTHENTICITY_COLOR, GlyphName> = {
  verified: 'verified',
  consistent: 'hash',
  unverifiable: 'kebab',
  inconsistent: 'tampered',
}

export const SYNC_COLOR: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'var(--ok)',
  B: 'var(--live)',
  C: 'var(--medium)',
  D: 'var(--critical)',
}

/**
 * Canvas cannot resolve CSS custom properties: assigning `var(--live)` to
 * strokeStyle silently keeps the previous value, which is how a chart ends up
 * drawing black on black with no error. Anything that reaches a 2D context has
 * to be a literal, so these mirror the tokens and are the only place a hex may
 * appear outside tokens.css.
 */
export const CANVAS = {
  bg0: '#08090b',
  bg1: '#0e1013',
  bg2: '#14171b',
  bg3: '#1a1e23',
  line0: '#1f242b',
  line1: '#2a313a',
  ink0: '#e8eaed',
  ink1: '#9aa3ad',
  ink2: '#5c6570',
  ink3: '#3a4048',
  critical: '#f85149',
  high: '#db6d28',
  medium: '#d29922',
  low: '#8b949e',
  info: '#6e7681',
  ok: '#3fb950',
  live: '#58a6ff',
  violet: '#bc8cff',
  liveFill: 'rgba(88,166,255,0.16)',
  /* Basemap and deck surfaces. These are map and canvas only, and exist here so
     the palette has exactly one home. */
  mapGreen: '#0d130f',
  mapGreenEdge: '#141b16',
  mapWater: '#0b1118',
  mapWaterEdge: '#152030',
  mapRoadMinor: '#161a1f',
  mapRoadRing: '#252c34',
  mapRoadArterial: '#20262d',
  mapRoadOther: '#1b2027',
  deckBlock: '#1d232a',
  deckLaneAlt: '#101317',
  violetFill: 'rgba(188,140,255,0.16)',
  okFill: 'rgba(63,185,80,0.16)',
} as const
