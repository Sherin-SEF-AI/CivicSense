/**
 * Pilot-area geography for Bengaluru.
 *
 * These are hand-placed waypoints for the corridors, water bodies and wards the
 * pilot covers. They are schematic, not survey grade: enough for a keyless
 * basemap, for zone assignment and for putting incidents on roads rather than
 * in the middle of blocks. The build plan names Bengaluru as the pilot city and
 * the spec's own worked example sits at Silk Board, so the geometry is real
 * where it matters and approximate everywhere else.
 */

export const BENGALURU_BBOX: readonly [number, number, number, number] = [77.45, 12.83, 77.78, 13.11]

export const BENGALURU_CENTER = { lon: 77.6108, lat: 12.9560 }

export interface Corridor {
  id: string
  name: string
  klass: 'arterial' | 'ring' | 'connector'
  /** [lon, lat] waypoints, densified at load. */
  points: readonly (readonly [number, number])[]
}

export const CORRIDORS: readonly Corridor[] = [
  {
    id: 'orr-east',
    name: 'Outer Ring Road east',
    klass: 'ring',
    points: [
      [77.5970, 13.0358], [77.6360, 13.0230], [77.6780, 13.0000], [77.6980, 12.9770],
      [77.7010, 12.9591], [77.6870, 12.9400], [77.6762, 12.9260], [77.6446, 12.9116],
      [77.6229, 12.9172],
    ],
  },
  {
    id: 'orr-west',
    name: 'Outer Ring Road west',
    klass: 'ring',
    points: [
      [77.6229, 12.9172], [77.5938, 12.9080], [77.5560, 12.9180], [77.5300, 12.9450],
      [77.5150, 12.9720], [77.5230, 13.0050], [77.5400, 13.0284], [77.5720, 13.0400],
      [77.5970, 13.0358],
    ],
  },
  {
    id: 'hosur-road',
    name: 'Hosur Road',
    klass: 'arterial',
    points: [[77.6060, 12.9750], [77.6101, 12.9400], [77.6229, 12.9172], [77.6180, 12.9010], [77.6602, 12.8452]],
  },
  {
    id: 'bellary-road',
    name: 'Bellary Road',
    klass: 'arterial',
    points: [[77.5929, 12.9763], [77.5880, 13.0000], [77.5940, 13.0200], [77.5970, 13.0358], [77.6000, 13.0700]],
  },
  {
    id: 'old-airport-road',
    name: 'Old Airport Road',
    klass: 'arterial',
    points: [[77.6060, 12.9750], [77.6387, 12.9609], [77.6600, 12.9600], [77.6974, 12.9591], [77.7500, 12.9698]],
  },
  {
    id: 'sarjapur-road',
    name: 'Sarjapur Road',
    klass: 'arterial',
    points: [[77.6245, 12.9352], [77.6446, 12.9280], [77.6762, 12.9260], [77.7100, 12.9100]],
  },
  {
    id: 'bannerghatta-road',
    name: 'Bannerghatta Road',
    klass: 'arterial',
    points: [[77.5848, 12.9507], [77.5900, 12.9200], [77.5851, 12.9077], [77.5900, 12.8800]],
  },
  {
    id: 'kanakapura-road',
    name: 'Kanakapura Road',
    klass: 'arterial',
    points: [[77.5757, 12.9633], [77.5650, 12.9350], [77.5560, 12.9100], [77.5480, 12.8850]],
  },
  {
    id: 'mysore-road',
    name: 'Mysore Road',
    klass: 'arterial',
    points: [[77.5757, 12.9633], [77.5450, 12.9520], [77.5150, 12.9420], [77.4800, 12.9350]],
  },
  {
    id: 'magadi-road',
    name: 'Magadi Road',
    klass: 'arterial',
    points: [[77.5713, 12.9767], [77.5400, 12.9800], [77.5100, 12.9830], [77.4750, 12.9860]],
  },
  {
    id: 'tumkur-road',
    name: 'Tumkur Road',
    klass: 'arterial',
    points: [[77.5713, 12.9767], [77.5520, 12.9915], [77.5400, 13.0284], [77.5200, 13.0550]],
  },
  {
    id: 'whitefield-road',
    name: 'Whitefield Road',
    klass: 'arterial',
    points: [[77.6408, 12.9784], [77.6800, 12.9880], [77.7100, 12.9800], [77.7500, 12.9698]],
  },
  {
    id: 'mg-road',
    name: 'MG Road and Cantonment',
    klass: 'connector',
    points: [[77.5929, 12.9763], [77.6060, 12.9750], [77.6205, 12.9820], [77.6408, 12.9784]],
  },
  {
    id: 'inner-ring',
    name: 'Inner Ring Road',
    klass: 'ring',
    points: [
      [77.6060, 12.9750], [77.6387, 12.9609], [77.6245, 12.9352], [77.6101, 12.9400],
      [77.5938, 12.9500], [77.5848, 12.9700], [77.5929, 12.9763],
    ],
  },
]

export interface WaterBody {
  id: string
  name: string
  center: readonly [number, number]
  /** Radii in degrees, so the ellipse is drawn without a projection step. */
  rx: number
  ry: number
  rot: number
}

export const WATER: readonly WaterBody[] = [
  { id: 'bellandur-lake', name: 'Bellandur Lake', center: [77.6700, 12.9300], rx: 0.017, ry: 0.008, rot: 0.4 },
  { id: 'varthur-lake', name: 'Varthur Lake', center: [77.7220, 12.9400], rx: 0.011, ry: 0.005, rot: 0.2 },
  { id: 'ulsoor-lake', name: 'Ulsoor Lake', center: [77.6205, 12.9820], rx: 0.005, ry: 0.003, rot: 1.1 },
  { id: 'hebbal-lake', name: 'Hebbal Lake', center: [77.5900, 13.0450], rx: 0.008, ry: 0.004, rot: 0.1 },
  { id: 'sankey-tank', name: 'Sankey Tank', center: [77.5720, 13.0080], rx: 0.004, ry: 0.0025, rot: 0.9 },
  { id: 'madiwala-lake', name: 'Madiwala Lake', center: [77.6180, 12.9210], rx: 0.007, ry: 0.0035, rot: 0.3 },
  { id: 'agara-lake', name: 'Agara Lake', center: [77.6420, 12.9230], rx: 0.005, ry: 0.003, rot: 0.6 },
]

export const GREEN: readonly WaterBody[] = [
  { id: 'cubbon-park', name: 'Cubbon Park', center: [77.5929, 12.9763], rx: 0.008, ry: 0.005, rot: 0.3 },
  { id: 'lalbagh', name: 'Lalbagh', center: [77.5848, 12.9507], rx: 0.007, ry: 0.005, rot: 0.1 },
  { id: 'bannerghatta-green', name: 'Turahalli Forest', center: [77.5400, 12.8900], rx: 0.010, ry: 0.007, rot: 0.5 },
]

export type ZoneKind =
  | 'school'
  | 'hospital'
  | 'market'
  | 'residential'
  | 'industrial'
  | 'religious'
  | 'transit-hub'
  | 'highway'

export interface ZoneSeed {
  id: string
  label: string
  kind: ZoneKind
  center: readonly [number, number]
  radius: number
  sensitivity: number
}

/** Fourteen wards covering the pilot area, each with the profile that weights its severity. */
export const ZONE_SEEDS: readonly ZoneSeed[] = [
  { id: 'SB-04', label: 'Silk Board junction', kind: 'highway', center: [77.6229, 12.9172], radius: 0.016, sensitivity: 0.78 },
  { id: 'KR-11', label: 'Koramangala 6th block', kind: 'market', center: [77.6245, 12.9352], radius: 0.014, sensitivity: 0.62 },
  { id: 'HS-07', label: 'HSR Layout sector 2', kind: 'residential', center: [77.6446, 12.9116], radius: 0.015, sensitivity: 0.34 },
  { id: 'IN-02', label: 'Indiranagar 100ft road', kind: 'market', center: [77.6408, 12.9784], radius: 0.013, sensitivity: 0.66 },
  { id: 'MJ-01', label: 'Majestic transit hub', kind: 'transit-hub', center: [77.5713, 12.9767], radius: 0.012, sensitivity: 0.88 },
  { id: 'MG-03', label: 'MG Road cantonment', kind: 'market', center: [77.6060, 12.9750], radius: 0.011, sensitivity: 0.71 },
  { id: 'HB-09', label: 'Hebbal flyover', kind: 'highway', center: [77.5970, 13.0358], radius: 0.016, sensitivity: 0.74 },
  { id: 'WF-12', label: 'Whitefield ITPL', kind: 'industrial', center: [77.7500, 12.9698], radius: 0.018, sensitivity: 0.38 },
  { id: 'MR-05', label: 'Marathahalli bridge', kind: 'highway', center: [77.6974, 12.9591], radius: 0.015, sensitivity: 0.69 },
  { id: 'JN-06', label: 'Jayanagar 4th block', kind: 'residential', center: [77.5938, 12.9250], radius: 0.014, sensitivity: 0.42 },
  { id: 'KM-08', label: 'KR Market', kind: 'market', center: [77.5757, 12.9633], radius: 0.011, sensitivity: 0.83 },
  { id: 'ML-10', label: 'Malleshwaram 8th cross', kind: 'religious', center: [77.5709, 13.0035], radius: 0.012, sensitivity: 0.64 },
  { id: 'BL-13', label: 'Bellandur ORR', kind: 'highway', center: [77.6762, 12.9260], radius: 0.016, sensitivity: 0.72 },
  { id: 'VN-14', label: 'Victoria hospital approach', kind: 'hospital', center: [77.5745, 12.9630], radius: 0.009, sensitivity: 0.91 },
]

/** Hotspot centroids used to cluster synthetic incidents where a city actually has them. */
export const HOTSPOTS: readonly (readonly [number, number, number])[] = [
  [77.6229, 12.9172, 0.9],
  [77.5713, 12.9767, 0.85],
  [77.6974, 12.9591, 0.7],
  [77.5757, 12.9633, 0.8],
  [77.6408, 12.9784, 0.6],
  [77.5970, 13.0358, 0.65],
  [77.6762, 12.9260, 0.6],
  [77.6245, 12.9352, 0.55],
  [77.6060, 12.9750, 0.5],
  [77.7500, 12.9698, 0.45],
  [77.5938, 12.9250, 0.4],
  [77.5709, 13.0035, 0.4],
]
