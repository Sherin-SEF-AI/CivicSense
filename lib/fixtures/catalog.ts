import 'server-only'
import type { Domain } from '@/lib/api/schemas'

/**
 * The civic situation catalogue.
 *
 * Each entry is a situation type the pipeline can recognise, with the inherent
 * severity the severity function starts from, the department that owns it, and
 * the statutes counsel has cleared for selection. The model may only pick from
 * this list, which is the rule the build plan sets for legal mapping, so the
 * fixture world follows the same rule.
 */

export interface SituationType {
  key: string
  domain: Domain
  /** Rendered into the incident title with the location. */
  title: string
  trigger: string
  inherent: number
  department: string
  /** Statutes that may be cited for this situation, none invented at runtime. */
  legal: readonly { statute: string; section: string; title: string; verified: boolean }[]
  /** Situation types that a life-safety pre-alert can fire on. */
  life_safety: boolean
  classes: readonly string[]
}

const MV = 'Motor Vehicles Act 1988'
const SWM = 'Solid Waste Management Rules 2016'
const NOISE = 'Noise Pollution (Regulation and Control) Rules 2000'
const AIR = 'Air (Prevention and Control of Pollution) Act 1981'
const BNS = 'Bharatiya Nyaya Sanhita 2023'
const BYE = 'BBMP Bye-laws'

export const SITUATIONS: readonly SituationType[] = [
  {
    key: 'no-helmet',
    domain: 'traffic',
    title: 'rider without helmet',
    trigger: 'class:no_helmet',
    inherent: 0.42,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '129 r/w 194D', title: 'Wearing of protective headgear', verified: true }],
    life_safety: false,
    classes: ['motorcycle', 'person'],
  },
  {
    key: 'triple-riding',
    domain: 'traffic',
    title: 'triple riding',
    trigger: 'class:triple_riding',
    inherent: 0.48,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '128 r/w 194C', title: 'Safety measures for drivers and pillion riders', verified: true }],
    life_safety: false,
    classes: ['motorcycle', 'person'],
  },
  {
    key: 'wrong-way',
    domain: 'traffic',
    title: 'wrong-way movement',
    trigger: 'trajectory:against_lane_vector',
    inherent: 0.62,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '119 r/w 177', title: 'Duty to obey traffic signs', verified: true }],
    life_safety: false,
    classes: ['car', 'lcv', 'motorcycle'],
  },
  {
    key: 'signal-jump',
    domain: 'traffic',
    title: 'signal violation',
    trigger: 'zone:stop_line_crossed_on_red',
    inherent: 0.58,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '119 r/w 177', title: 'Duty to obey traffic signs', verified: true }],
    life_safety: false,
    classes: ['car', 'motorcycle', 'lcv'],
  },
  {
    key: 'footpath-parking',
    domain: 'traffic',
    title: 'footpath obstruction by parked vehicles',
    trigger: 'zone:stationary_in_no_parking',
    inherent: 0.38,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '122 r/w 177', title: 'Leaving vehicle in dangerous position', verified: true }],
    life_safety: false,
    classes: ['car', 'motorcycle'],
  },
  {
    key: 'bus-stop-discipline',
    domain: 'traffic',
    title: 'bus stopping mid-carriageway',
    trigger: 'zone:stop_outside_bay',
    inherent: 0.44,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '122 r/w 177', title: 'Leaving vehicle in dangerous position', verified: false }],
    life_safety: false,
    classes: ['bus'],
  },
  {
    key: 'collision',
    domain: 'safety',
    title: 'possible injury collision',
    trigger: 'class:sudden_stop+fallen_rider',
    inherent: 0.92,
    department: 'emergency-112',
    legal: [{ statute: BNS, section: '106', title: 'Causing death by negligence', verified: false }],
    life_safety: true,
    classes: ['car', 'motorcycle', 'person'],
  },
  {
    key: 'person-down',
    domain: 'safety',
    title: 'person down in carriageway',
    trigger: 'pose:person_down',
    inherent: 0.9,
    department: 'emergency-112',
    legal: [],
    life_safety: true,
    classes: ['person'],
  },
  {
    key: 'crowd-risk',
    domain: 'safety',
    title: 'crowd growth above safe rate',
    trigger: 'density:growth_3x_baseline',
    inherent: 0.78,
    department: 'city-police',
    legal: [],
    life_safety: true,
    classes: ['crowd'],
  },
  {
    key: 'night-corridor',
    domain: 'safety',
    title: 'poorly lit corridor with loitering',
    trigger: 'composite:lighting+dwell+isolation',
    inherent: 0.56,
    department: 'city-police',
    legal: [],
    life_safety: false,
    classes: ['person'],
  },
  {
    key: 'stray-cattle',
    domain: 'safety',
    title: 'stray cattle on carriageway',
    trigger: 'class:cattle_on_road',
    inherent: 0.64,
    department: 'animal-control',
    legal: [{ statute: BYE, section: 'Ch. VII', title: 'Stray cattle on public roads', verified: false }],
    life_safety: false,
    classes: ['cattle'],
  },
  {
    key: 'dumping',
    domain: 'waste',
    title: 'waste dumping',
    trigger: 'object:placed_and_left',
    inherent: 0.52,
    department: 'sanitation',
    legal: [
      { statute: SWM, section: 'Rule 4(1)', title: 'Duties of waste generators', verified: true },
      { statute: BYE, section: 'Ch. IV', title: 'Prohibition of littering', verified: true },
    ],
    life_safety: false,
    classes: ['lcv', 'person', 'waste'],
  },
  {
    key: 'bin-overflow',
    domain: 'waste',
    title: 'bin overflow with missed collection',
    trigger: 'sensor:bin_fill_over_90',
    inherent: 0.4,
    department: 'sanitation',
    legal: [{ statute: SWM, section: 'Rule 15', title: 'Duties of local authorities', verified: true }],
    life_safety: false,
    classes: ['waste'],
  },
  {
    key: 'open-burning',
    domain: 'environment',
    title: 'open burning of waste',
    trigger: 'class:smoke+pm_rise',
    inherent: 0.7,
    department: 'pollution-control',
    legal: [
      { statute: AIR, section: '31A', title: 'Power to give directions', verified: true },
      { statute: SWM, section: 'Rule 4(2)', title: 'Prohibition on burning of waste', verified: true },
    ],
    life_safety: false,
    classes: ['smoke', 'fire'],
  },
  {
    key: 'construction-dust',
    domain: 'environment',
    title: 'uncovered construction material',
    trigger: 'class:uncovered_material',
    inherent: 0.46,
    department: 'pollution-control',
    legal: [{ statute: AIR, section: '31A', title: 'Power to give directions', verified: true }],
    life_safety: false,
    classes: ['debris', 'truck'],
  },
  {
    key: 'noise-nuisance',
    domain: 'nuisance',
    title: 'noise above zone limit',
    trigger: 'sensor:leq_over_limit_10min',
    inherent: 0.44,
    department: 'city-police',
    legal: [{ statute: NOISE, section: 'Rule 5', title: 'Restrictions on use of loudspeakers', verified: true }],
    life_safety: false,
    classes: ['crowd', 'speaker'],
  },
  {
    key: 'spitting',
    domain: 'nuisance',
    title: 'spitting on public footpath',
    trigger: 'pose:spitting',
    inherent: 0.16,
    department: 'sanitation',
    legal: [{ statute: BYE, section: 'Ch. IV', title: 'Prohibition of spitting in public places', verified: true }],
    life_safety: false,
    classes: ['person'],
  },
  {
    key: 'illegal-hoarding',
    domain: 'nuisance',
    title: 'unauthorised hoarding',
    trigger: 'class:hoarding_without_permit',
    inherent: 0.28,
    department: 'pwd',
    legal: [{ statute: BYE, section: 'Ch. IX', title: 'Advertisement and hoarding control', verified: true }],
    life_safety: false,
    classes: ['hoarding'],
  },
  {
    key: 'open-manhole',
    domain: 'infrastructure',
    title: 'open manhole',
    trigger: 'class:open_manhole',
    inherent: 0.74,
    department: 'pwd',
    legal: [],
    life_safety: true,
    classes: ['manhole'],
  },
  {
    key: 'pothole',
    domain: 'infrastructure',
    title: 'pothole cluster on carriageway',
    trigger: 'survey:pothole_measured',
    inherent: 0.48,
    department: 'pwd',
    legal: [],
    life_safety: false,
    classes: ['pothole'],
  },
  {
    key: 'dangling-cable',
    domain: 'infrastructure',
    title: 'low-hanging electric cable',
    trigger: 'class:dangling_cable',
    inherent: 0.68,
    department: 'bescom',
    legal: [],
    life_safety: false,
    classes: ['cable'],
  },
  {
    key: 'street-light-out',
    domain: 'infrastructure',
    title: 'street light outage',
    trigger: 'external:controller_fault',
    inherent: 0.24,
    department: 'bescom',
    legal: [],
    life_safety: false,
    classes: ['light'],
  },
  {
    key: 'water-logging',
    domain: 'disaster',
    title: 'water logging with depth estimate',
    trigger: 'sensor:water_level+class:water',
    inherent: 0.72,
    department: 'disaster-cell',
    legal: [],
    life_safety: true,
    classes: ['water'],
  },
  {
    key: 'fire',
    domain: 'disaster',
    title: 'fire with visible flame',
    trigger: 'class:fire',
    inherent: 0.95,
    department: 'fire-services',
    legal: [],
    life_safety: true,
    classes: ['fire', 'smoke'],
  },
  {
    key: 'tree-fall-risk',
    domain: 'disaster',
    title: 'leaning tree over carriageway',
    trigger: 'survey:tree_lean',
    inherent: 0.6,
    department: 'bbmp-forest',
    legal: [],
    life_safety: false,
    classes: ['tree'],
  },
  {
    key: 'unregistered-vehicle',
    domain: 'vehicle',
    title: 'vehicle without valid registration plate',
    trigger: 'alpr:no_plate_match',
    inherent: 0.5,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '39 r/w 192', title: 'Necessity for registration', verified: true }],
    life_safety: false,
    classes: ['car', 'lcv'],
  },
  {
    key: 'overloaded-goods',
    domain: 'vehicle',
    title: 'overloaded goods vehicle',
    trigger: 'class:overloaded_lcv',
    inherent: 0.56,
    department: 'transport-dept',
    legal: [{ statute: MV, section: '113 r/w 194', title: 'Use of vehicle in contravention of weight limits', verified: true }],
    life_safety: false,
    classes: ['lcv', 'truck'],
  },
  {
    key: 'emergency-corridor',
    domain: 'vehicle',
    title: 'ambulance corridor obstructed',
    trigger: 'telemetry:ambulance_speed_low+lane_blocked',
    inherent: 0.86,
    department: 'traffic-police',
    legal: [{ statute: MV, section: '194E', title: 'Failure to allow free passage to emergency vehicles', verified: true }],
    life_safety: true,
    classes: ['ambulance', 'car'],
  },
]

export const SITUATION_BY_KEY = new Map(SITUATIONS.map((s) => [s.key, s]))

export const DEPARTMENTS = [
  { department: 'traffic-police', label: 'Traffic Police' },
  { department: 'city-police', label: 'City Police' },
  { department: 'sanitation', label: 'BBMP Sanitation' },
  { department: 'pwd', label: 'Public Works' },
  { department: 'bescom', label: 'BESCOM' },
  { department: 'pollution-control', label: 'KSPCB' },
  { department: 'disaster-cell', label: 'Disaster Cell' },
  { department: 'fire-services', label: 'Fire Services' },
  { department: 'emergency-112', label: 'Emergency 112' },
  { department: 'animal-control', label: 'Animal Control' },
  { department: 'bbmp-forest', label: 'BBMP Forest' },
  { department: 'transport-dept', label: 'Transport Department' },
] as const

export const DEPARTMENT_LABEL = new Map(DEPARTMENTS.map((d) => [d.department, d.label]))
