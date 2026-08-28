/**
 * CS Glyphs: the product's own icon system.
 *
 * Rules, enforced by review and by the shape of the data here:
 *   - 16x16 viewBox, optical size 14px, stroke 1.5, currentColor, fill none
 *   - square caps and joins
 *   - angles restricted to 0, 45 and 90 degrees
 *   - corner radius 0 or 1
 *
 * The restriction is the style. Everything looks drafted, not drawn. Curves are
 * deliberately absent, so chamfers stand in for rounding and diamonds stand in
 * for dots. Filled shapes are reserved for state dots and priority markers,
 * which are CSS primitives rather than glyphs.
 */

export const GLYPH_CATEGORIES = [
  'domain',
  'source',
  'evidence',
  'operations',
  'system',
  'chrome',
] as const

export type GlyphCategory = (typeof GLYPH_CATEGORIES)[number]

interface GlyphDef {
  readonly category: GlyphCategory
  /** Human label used in the dev gallery and in aria-label fallbacks. */
  readonly label: string
  /** Path data drawn with stroke only. */
  readonly d: readonly string[]
}

export const GLYPHS = {
  /* ---------------------------------------------------------------- domains */
  traffic: {
    category: 'domain',
    label: 'traffic',
    d: ['M4 14V4', 'M2 6l2-2 2 2', 'M12 2v10', 'M14 10l-2 2-2-2'],
  },
  waste: {
    category: 'domain',
    label: 'waste',
    d: ['M6 3h4v2', 'M3 5h10', 'M4.5 5v9h7V5', 'M8 7l2 2.5-2 2.5-2-2.5z'],
  },
  safety: {
    category: 'domain',
    label: 'safety',
    d: ['M3 4l5-2 5 2v5l-5 5-5-5z'],
  },
  nuisance: {
    category: 'domain',
    label: 'nuisance',
    d: ['M2 6h3l4-3v10l-4-3H2z', 'M12 5l2 3-2 3'],
  },
  infrastructure: {
    category: 'domain',
    label: 'infrastructure',
    d: ['M1 5h14', 'M1 11h14', 'M5 5v6', 'M11 5v6', 'M5 11l6-6'],
  },
  environment: {
    category: 'domain',
    label: 'environment',
    d: ['M13 3v5l-5 5H4V8l5-5z', 'M6 11L3 14'],
  },
  vehicle: {
    category: 'domain',
    label: 'vehicle',
    d: ['M1 10h14', 'M2 10V7l2-3h7l3 3v3', 'M4 10v2h2v-2', 'M10 10v2h2v-2'],
  },
  disaster: {
    category: 'domain',
    label: 'disaster',
    d: ['M2 13h12', 'M2 10h12', 'M2 7h7', 'M12 6V2', 'M10 4l2-2 2 2'],
  },

  /* ---------------------------------------------------------------- sources */
  'cctv-fixed': {
    category: 'source',
    label: 'fixed cctv',
    d: ['M3 5h8v4H3z', 'M11 6l2-1v3l-2-1z', 'M7 9v3', 'M5 12h4'],
  },
  'cctv-ptz': {
    category: 'source',
    label: 'ptz dome',
    d: ['M2 9h12', 'M4 9V6l2-2h4l2 2v3', 'M8 10.5l1 1-1 1-1-1z', 'M2 12h1', 'M13 12h1'],
  },
  'patrol-car': {
    category: 'source',
    label: 'patrol car',
    d: ['M1 10h14', 'M2 10V8l2-3h8l2 3v2', 'M4 10v2h2v-2', 'M10 10v2h2v-2', 'M7 5V3h2v2'],
  },
  'patrol-bike': {
    category: 'source',
    label: 'patrol bike',
    d: ['M2 11l2-2 2 2-2 2z', 'M10 11l2-2 2 2-2 2z', 'M4 11l3-5h4', 'M12 11L11 6', 'M11 6V4', 'M9 4h3'],
  },
  bodycam: {
    category: 'source',
    label: 'bodycam',
    d: ['M4 4h8v8H4z', 'M8 6.5l1.5 1.5L8 9.5 6.5 8z', 'M12 6h2v4h-2', 'M6 13h4'],
  },
  'usb-cam': {
    category: 'source',
    label: 'usb camera',
    d: ['M4 3h8v5H4z', 'M8 4.5l1.5 1.5L8 7.5 6.5 6z', 'M8 8v3', 'M5 14h6', 'M8 11l-3 3', 'M8 11l3 3'],
  },
  phone: {
    category: 'source',
    label: 'phone',
    d: ['M5 2h6v12H5z', 'M7 3.5h2', 'M6.5 12h3'],
  },
  drone: {
    category: 'source',
    label: 'drone',
    d: ['M6 7h4v2H6z', 'M6 7L3 4', 'M10 7l3-3', 'M6 9l-3 3', 'M10 9l3 3', 'M1.5 4h3', 'M11.5 4h3', 'M1.5 12h3', 'M11.5 12h3'],
  },
  sensor: {
    category: 'source',
    label: 'sensor',
    d: ['M6 6h4v4H6z', 'M8 6V2', 'M6.5 9.5L4 12', 'M9.5 9.5L12 12'],
  },
  'vehicle-bus': {
    category: 'source',
    label: 'vehicle bus',
    d: ['M3 6l1-1h8l1 1v4H3z', 'M5 10v2', 'M8 10v2', 'M11 10v2', 'M8 5V2'],
  },

  /* -------------------------------------------------- evidence and forensics */
  keyframe: {
    category: 'evidence',
    label: 'keyframe',
    d: ['M3 4h10v8H3z', 'M3 6H1', 'M3 10H1', 'M13 6h2', 'M13 10h2', 'M8 7l1 1-1 1-1-1z'],
  },
  clip: {
    category: 'evidence',
    label: 'clip',
    d: ['M2 4h12v8H2z', 'M7 6l3 2-3 2z'],
  },
  storyboard: {
    category: 'evidence',
    label: 'storyboard',
    d: ['M2 3h12v10H2z', 'M6 3v10', 'M10 3v10', 'M2 8h12'],
  },
  'audio-segment': {
    category: 'evidence',
    label: 'audio segment',
    d: ['M2 4v8', 'M14 4v8', 'M5 6v4', 'M7 4v8', 'M9 5v6', 'M11 3v10'],
  },
  transcript: {
    category: 'evidence',
    label: 'transcript',
    d: ['M4 2h6l2 2v10H4z', 'M10 2v2h2', 'M6 7h4', 'M6 9h4', 'M6 11h2'],
  },
  hash: {
    category: 'evidence',
    label: 'hash',
    d: ['M2 5h6v6H2z', 'M8 5h6v6H8z', 'M5 3v2', 'M11 11v2'],
  },
  custody: {
    category: 'evidence',
    label: 'custody',
    d: ['M2 6h9', 'M9 4l2 2-2 2', 'M14 10H5', 'M7 8l-2 2 2 2'],
  },
  verified: {
    category: 'evidence',
    label: 'verified',
    d: ['M4 3H2v10h2', 'M12 3h2v10h-2', 'M5 8l2 2 4-4'],
  },
  tampered: {
    category: 'evidence',
    label: 'tampered',
    d: ['M4 3H2v3', 'M2 10v3h2', 'M12 3h2v3', 'M14 10v3h-2', 'M5 11l6-6'],
  },
  timeline: {
    category: 'evidence',
    label: 'timeline',
    d: ['M2 11h12', 'M4 11V9', 'M8 11V9', 'M12 11V9', 'M8 3.5l1.5 1.5L8 6.5 6.5 5z'],
  },
  scrubber: {
    category: 'evidence',
    label: 'scrubber',
    d: ['M2 8h12', 'M2 6v4', 'M14 6v4', 'M7 4h2v8H7z'],
  },
  kinematics: {
    category: 'evidence',
    label: 'kinematics',
    d: ['M2 12h2v2H2z', 'M4 12L12 4', 'M9 4h3v3'],
  },
  trajectory: {
    category: 'evidence',
    label: 'trajectory',
    d: ['M2 12l4-4 3 3 5-5', 'M1 11h2v2H1z', 'M12 5h2v2h-2z'],
  },
  'causal-graph': {
    category: 'evidence',
    label: 'causal graph',
    d: ['M2 3h3v3H2z', 'M11 3h3v3h-3z', 'M6.5 10h3v3h-3z', 'M5 4.5h6', 'M4 6l3 4', 'M12.5 6L9.5 10'],
  },
  'reconstruction-3d': {
    category: 'evidence',
    label: '3d reconstruction',
    d: ['M3 6h7v7H3z', 'M3 6l3-3h7v7l-3 3', 'M10 6l3-3'],
  },
  redaction: {
    category: 'evidence',
    label: 'redaction',
    d: ['M2 4h12v8H2z', 'M2 9l5-5', 'M5 12l5-5', 'M9 12l5-5'],
  },

  /* ------------------------------------------------------------- operations */
  incident: {
    category: 'operations',
    label: 'incident',
    d: ['M8 2l6 6-6 6-6-6z', 'M8 5v4', 'M8 10.5v1'],
  },
  'pre-alert': {
    category: 'operations',
    label: 'pre-alert',
    d: ['M7 7h2v2H7z', 'M4.5 4.5h7v7h-7z', 'M2 6V2h4', 'M14 10v4h-4'],
  },
  acknowledge: {
    category: 'operations',
    label: 'acknowledge',
    d: ['M3 8l3 3 7-7', 'M3 14h10'],
  },
  dispatch: {
    category: 'operations',
    label: 'dispatch',
    d: ['M2 3h6', 'M2 3v11h11V8', 'M8 8l6-6', 'M10 2h4v4'],
  },
  escalate: {
    category: 'operations',
    label: 'escalate',
    d: ['M4 12l4-4 4 4', 'M4 8l4-4 4 4'],
  },
  resolve: {
    category: 'operations',
    label: 'resolve',
    d: ['M2 3h12v10H2z', 'M5 8l2 2 4-4'],
  },
  reopen: {
    category: 'operations',
    label: 'reopen',
    d: ['M4 10V6h6', 'M8 4l2 2-2 2', 'M12 6v4H6', 'M8 12l-2-2 2-2'],
  },
  'sla-timer': {
    category: 'operations',
    label: 'sla timer',
    d: ['M3 4h10v10H3z', 'M8 6v3h3', 'M6 2h4', 'M8 2v2'],
  },
  playbook: {
    category: 'operations',
    label: 'playbook',
    d: ['M3 2h8l2 2v10H3z', 'M11 2v2h2', 'M5 7h2', 'M8 7h3', 'M5 10h2', 'M8 10h3'],
  },
  department: {
    category: 'operations',
    label: 'department',
    d: ['M3 13V5l5-3 5 3v8', 'M2 13h12', 'M6 7h1', 'M9 7h1', 'M6 10h1', 'M9 10h1'],
  },
  responder: {
    category: 'operations',
    label: 'responder',
    d: ['M6.5 2h3v3h-3z', 'M4 14v-3l4-3 4 3v3'],
  },
  route: {
    category: 'operations',
    label: 'route',
    d: ['M3 13V8h5V3h5', 'M2 12h2v2H2z', 'M12 2h2v2h-2z'],
  },
  zone: {
    category: 'operations',
    label: 'zone',
    d: ['M5 2h6l3 3v6l-3 3H5l-3-3V5z'],
  },
  'h3-cell': {
    category: 'operations',
    label: 'h3 cell',
    d: ['M5 3h4l2 2v4l-2 2H5L3 9V5z', 'M13 4l-2 1', 'M13 10l-2-1', 'M8 13v-2'],
  },

  /* ----------------------------------------------------------------- system */
  model: {
    category: 'system',
    label: 'model',
    d: ['M5 5h6v6H5z', 'M7 5V3', 'M9 5V3', 'M7 11v2', 'M9 11v2', 'M5 7H3', 'M5 9H3', 'M11 7h2', 'M11 9h2'],
  },
  'groq-role-health': {
    category: 'system',
    label: 'role health',
    d: ['M1 7h2v2H1z', 'M4 7h2v2H4z', 'M7 7h2v2H7z', 'M10 7h2v2h-2z', 'M13 7h2v2h-2z'],
  },
  budget: {
    category: 'system',
    label: 'budget',
    d: ['M2 6h12v4H2z', 'M4 6v4', 'M6 6v4', 'M10 4v8'],
  },
  'edge-device': {
    category: 'system',
    label: 'edge device',
    d: ['M3 6h10v6H3z', 'M8 6V3', 'M6 3h4', 'M5 12v2', 'M8 12v2', 'M11 12v2'],
  },
  heartbeat: {
    category: 'system',
    label: 'heartbeat',
    d: ['M1 8h3l2-4 2 8 2-6 2 2h3'],
  },
  ota: {
    category: 'system',
    label: 'ota update',
    d: ['M8 1v7', 'M5 5l3 3 3-3', 'M2 11h12v3H2z', 'M4 12.5h1'],
  },
  calibration: {
    category: 'system',
    label: 'calibration',
    d: ['M8 1v4', 'M8 11v4', 'M1 8h4', 'M11 8h4', 'M5 5h6v6H5z'],
  },
  trust: {
    category: 'system',
    label: 'trust',
    d: ['M2 4h12v8H2z', 'M4 6h5v4H4z'],
  },
  'warning-level': {
    category: 'system',
    label: 'warning level',
    d: ['M1 11h2v3H1z', 'M5 8h2v6H5z', 'M9 5h2v9H9z', 'M13 2h2v12h-2z'],
  },
  prediction: {
    category: 'system',
    label: 'prediction',
    d: ['M4 2l5 6-5 6', 'M12 2v12'],
  },
  search: {
    category: 'system',
    label: 'search',
    d: ['M3 3h7v7H3z', 'M10 10l3 3'],
  },
  filter: {
    category: 'system',
    label: 'filter',
    d: ['M2 3h12l-5 5v6l-2-2V8z'],
  },
  export: {
    category: 'system',
    label: 'export',
    d: ['M2 9v5h12V9', 'M8 11V2', 'M5 5l3-3 3 3'],
  },
  settings: {
    category: 'system',
    label: 'settings',
    d: ['M2 4h12', 'M2 8h12', 'M2 12h12', 'M5 2.5h2v3H5z', 'M9 6.5h2v3H9z', 'M4 10.5h2v3H4z'],
  },

  /* ----------------------------------------------------------------- chrome */
  close: {
    category: 'chrome',
    label: 'close',
    d: ['M4 4l8 8', 'M12 4l-8 8'],
  },
  'chevron-s': {
    category: 'chrome',
    label: 'chevron down',
    d: ['M4 6l4 4 4-4'],
  },
  'chevron-e': {
    category: 'chrome',
    label: 'chevron right',
    d: ['M6 4l4 4-4 4'],
  },
  expand: {
    category: 'chrome',
    label: 'expand',
    d: ['M2 6V2h4', 'M14 10v4h-4', 'M2 2l5 5', 'M14 14l-5-5'],
  },
  collapse: {
    category: 'chrome',
    label: 'collapse',
    d: ['M6 2v4H2', 'M10 14v-4h4', 'M2 2l4 4', 'M14 14l-4-4'],
  },
  pin: {
    category: 'chrome',
    label: 'pin',
    d: ['M8 14V9', 'M5 2h6', 'M6 2v5l-2 2h8l-2-2V2'],
  },
  copy: {
    category: 'chrome',
    label: 'copy',
    d: ['M5 5h8v8H5z', 'M3 11V3h8'],
  },
  external: {
    category: 'chrome',
    label: 'external',
    d: ['M12 8v5H3V4h5', 'M9 2h5v5', 'M14 2L7 9'],
  },
  kebab: {
    category: 'chrome',
    label: 'more',
    d: ['M7 2h2v2H7z', 'M7 7h2v2H7z', 'M7 12h2v2H7z'],
  },
  drag: {
    category: 'chrome',
    label: 'drag',
    d: ['M5 3h2v2H5z', 'M9 3h2v2H9z', 'M5 7h2v2H5z', 'M9 7h2v2H9z', 'M5 11h2v2H5z', 'M9 11h2v2H9z'],
  },
} as const satisfies Record<string, GlyphDef>

export type GlyphName = keyof typeof GLYPHS

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[]

export function glyphsByCategory(category: GlyphCategory): GlyphName[] {
  return GLYPH_NAMES.filter((name) => GLYPHS[name].category === category)
}
