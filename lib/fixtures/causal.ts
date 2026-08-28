import 'server-only'
import type { Domain } from '@/lib/api/schemas'

/**
 * Causal chains, keyed by situation first and domain second.
 *
 * Keying only by domain produced packages that read wrong: a leaning tree came
 * with a drain-blockage chain because both are disaster domain. The chain is the
 * part of the package a department actually acts on, so it has to belong to the
 * situation, not to its category.
 */
export interface CausalStep {
  label: string
  kind: 'event' | 'state' | 'condition' | 'outcome'
  root_cause_class: 'infrastructure' | 'behavioural' | 'environmental' | 'regulatory' | 'systemic' | null
}

const chain = (...steps: [string, CausalStep['kind'], CausalStep['root_cause_class']][]): CausalStep[] =>
  steps.map(([label, kind, root_cause_class]) => ({ label, kind, root_cause_class }))

export const SITUATION_CHAINS: Record<string, CausalStep[]> = {
  dumping: chain(
    ['scheduled collection not made', 'event', 'systemic'],
    ['bin at full fill since the evening', 'state', 'infrastructure'],
    ['no alternative disposal within 60 m', 'condition', 'infrastructure'],
    ['dumping beside the bin', 'outcome', 'behavioural'],
  ),
  'bin-overflow': chain(
    ['route adherence below target on this shift', 'state', 'systemic'],
    ['stop skipped in the collection window', 'event', 'systemic'],
    ['fill crosses the overflow threshold', 'event', null],
    ['waste on the footpath', 'outcome', 'infrastructure'],
  ),
  'wrong-way': chain(
    ['fixed-time signal plan at the upstream junction', 'state', 'systemic'],
    ['queue spillback into the junction mouth', 'event', null],
    ['no enforcement presence on the corridor', 'condition', 'regulatory'],
    ['wrong-way movement to clear the queue', 'outcome', 'behavioural'],
  ),
  'signal-jump': chain(
    ['cycle time out of step with observed demand', 'state', 'systemic'],
    ['long wait on the minor approach', 'condition', null],
    ['stop line crossed on red', 'outcome', 'behavioural'],
  ),
  'no-helmet': chain(
    ['no enforcement point on this corridor at this hour', 'condition', 'regulatory'],
    ['repeat riders from the same lane within ten minutes', 'event', 'behavioural'],
    ['unprotected rider on a high-speed corridor', 'outcome', 'behavioural'],
  ),
  collision: chain(
    ['approach speed above the corridor mean', 'state', 'behavioural'],
    ['sight line obstructed by a parked vehicle', 'condition', 'infrastructure'],
    ['late braking onset', 'event', null],
    ['injury collision', 'outcome', 'behavioural'],
  ),
  'person-down': chain(
    ['pedestrian route blocked, desire line into the carriageway', 'condition', 'infrastructure'],
    ['no signalised crossing within 140 m', 'state', 'infrastructure'],
    ['person down in the carriageway', 'outcome', null],
  ),
  'crowd-risk': chain(
    ['arrival rate above the weekend baseline at this gate', 'event', null],
    ['one exit occupied by parked two-wheelers', 'state', 'infrastructure'],
    ['density approaching the safe capacity', 'condition', null],
    ['crowd risk at the gate', 'outcome', 'infrastructure'],
  ),
  'night-corridor': chain(
    ['street light out for several days', 'state', 'infrastructure'],
    ['reduced natural surveillance after dark', 'condition', 'environmental'],
    ['dwell above the corridor baseline', 'event', 'behavioural'],
    ['safety risk on the night corridor', 'outcome', 'infrastructure'],
  ),
  'stray-cattle': chain(
    ['unfenced grazing land adjacent to the corridor', 'state', 'infrastructure'],
    ['no impounding round on this beat this week', 'condition', 'systemic'],
    ['cattle on the carriageway at speed', 'outcome', null],
  ),
  'open-burning': chain(
    ['no collection at this stop', 'state', 'systemic'],
    ['accumulation of dry waste', 'condition', null],
    ['open burning to clear it', 'event', 'behavioural'],
    ['particulate rise at the nearest monitor', 'outcome', 'environmental'],
  ),
  'construction-dust': chain(
    ['no dust barrier at the site boundary', 'state', 'regulatory'],
    ['uncovered material on the haul vehicle', 'event', 'behavioural'],
    ['spillage and particulate on the carriageway', 'outcome', 'environmental'],
  ),
  'noise-nuisance': chain(
    ['event without a permit on file', 'state', 'regulatory'],
    ['amplification directed at the residential frontage', 'condition', 'behavioural'],
    ['sustained exceedance of the zone limit', 'outcome', null],
  ),
  spitting: chain(
    ['no bin or spittoon within 60 m', 'state', 'infrastructure'],
    ['high footfall on a hospital approach', 'condition', null],
    ['repeat observations at the same frontage', 'outcome', 'behavioural'],
  ),
  'illegal-hoarding': chain(
    ['no permit plate on the structure', 'state', 'regulatory'],
    ['fixing to public railing without approval', 'event', 'behavioural'],
    ['obstruction of the pedestrian route', 'outcome', 'infrastructure'],
  ),
  'open-manhole': chain(
    ['cover displaced during the last works', 'event', 'systemic'],
    ['no barricade reinstated afterwards', 'state', 'systemic'],
    ['open shaft on a pedestrian route', 'outcome', 'infrastructure'],
  ),
  pothole: chain(
    ['deferred surface maintenance', 'state', 'systemic'],
    ['monsoon loading on a weakened layer', 'condition', 'environmental'],
    ['defect reaching the severity threshold', 'outcome', 'infrastructure'],
  ),
  'dangling-cable': chain(
    ['unauthorised overhead stringing', 'event', 'regulatory'],
    ['no pole audit since the last storm', 'state', 'systemic'],
    ['live cable below head height', 'outcome', 'infrastructure'],
  ),
  'street-light-out': chain(
    ['controller fault reported by the feeder', 'event', 'infrastructure'],
    ['no restoration within the maintenance window', 'state', 'systemic'],
    ['unlit stretch on a night corridor', 'outcome', 'infrastructure'],
  ),
  'water-logging': chain(
    ['rain accumulation above the hourly threshold', 'condition', 'environmental'],
    ['drain recorded as blocked in the last survey', 'state', 'infrastructure'],
    ['water level crosses the carriageway threshold', 'event', null],
    ['carriageway water logging', 'outcome', 'infrastructure'],
  ),
  fire: chain(
    ['combustible material stored against the boundary', 'state', 'regulatory'],
    ['ignition source in the immediate area', 'event', null],
    ['flame spread with smoke across the carriageway', 'outcome', 'behavioural'],
  ),
  'tree-fall-risk': chain(
    ['root plate undercut by adjacent excavation', 'state', 'infrastructure'],
    ['no pre-monsoon pruning round on this stretch', 'condition', 'systemic'],
    ['lean angle increasing across survey passes', 'event', 'environmental'],
    ['tree overhanging the carriageway', 'outcome', 'infrastructure'],
  ),
  'unregistered-vehicle': chain(
    ['plate absent or unreadable at the enforcement point', 'event', 'behavioural'],
    ['no registration match through the authorised api', 'state', 'regulatory'],
    ['vehicle operating without valid registration', 'outcome', 'behavioural'],
  ),
  'overloaded-goods': chain(
    ['no weighbridge check on this route', 'state', 'systemic'],
    ['load above the permitted axle weight', 'event', 'behavioural'],
    ['surface damage and braking risk on the corridor', 'outcome', 'infrastructure'],
  ),
  'emergency-corridor': chain(
    ['no corridor pre-clearing request raised', 'state', 'systemic'],
    ['lane blocked by stationary vehicles', 'event', 'behavioural'],
    ['ambulance speed below walking pace', 'outcome', null],
  ),
  'footpath-parking': chain(
    ['no designated parking within the block', 'state', 'infrastructure'],
    ['no enforcement round at this hour', 'condition', 'regulatory'],
    ['footpath obstructed, pedestrians in the carriageway', 'outcome', 'behavioural'],
  ),
  'bus-stop-discipline': chain(
    ['bay occupied by parked vehicles', 'state', 'infrastructure'],
    ['stop made in the running lane', 'event', 'behavioural'],
    ['through traffic obstructed at the stop', 'outcome', null],
  ),
  'triple-riding': chain(
    ['no enforcement point on this corridor at this hour', 'condition', 'regulatory'],
    ['three occupants on a two-wheeler at speed', 'event', 'behavioural'],
    ['unprotected occupants on a high-speed corridor', 'outcome', 'behavioural'],
  ),
}

const DOMAIN_FALLBACK: Record<Domain, CausalStep[]> = {
  traffic: SITUATION_CHAINS['wrong-way']!,
  waste: SITUATION_CHAINS.dumping!,
  safety: SITUATION_CHAINS['night-corridor']!,
  nuisance: SITUATION_CHAINS['noise-nuisance']!,
  infrastructure: SITUATION_CHAINS.pothole!,
  environment: SITUATION_CHAINS['open-burning']!,
  vehicle: SITUATION_CHAINS['unregistered-vehicle']!,
  disaster: SITUATION_CHAINS['water-logging']!,
}

export function chainFor(situationKey: string, domain: Domain): CausalStep[] {
  return SITUATION_CHAINS[situationKey] ?? DOMAIN_FALLBACK[domain]
}

/** Contributing factors that belong to the situation rather than to any incident. */
export const SITUATION_FACTORS: Record<string, readonly string[]> = {
  dumping: [
    'no bin or spittoon within 60 m of the observed location',
    'the scheduled collection for this stop was not made in the morning window',
    'this frontage has produced repeat observations in the last thirty days',
  ],
  'bin-overflow': [
    'the collection vehicle never entered the stop geofence in the schedule window',
    'the bin has reported full since the previous evening',
  ],
  'wrong-way': [
    'the signal at the upstream junction is running a fixed-time plan, not adaptive',
    'no enforcement presence is visible on this corridor during the observation window',
    'the permitted turn is 400 m further on, past the queue',
  ],
  'no-helmet': [
    'no enforcement presence is visible on this corridor during the observation window',
    'this is the third such rider from the same lane within ten minutes',
    'the corridor is posted at 60 km/h',
  ],
  collision: [
    'the sight line from the minor approach is obstructed by parked vehicles',
    'the pedestrian crossing is 140 m from the observed desire line',
    'the corridor has produced two reported collisions in the last ninety days',
  ],
  'person-down': [
    'the footpath is obstructed for 60 m, pushing pedestrians into the carriageway',
    'the nearest signalised crossing is 140 m away',
  ],
  'crowd-risk': [
    'one exit polygon is occupied by parked two-wheelers',
    'arrival rate is running above the weekend baseline for this gate',
  ],
  'water-logging': [
    'the drain at this chainage was recorded as blocked in the last patrol survey',
    'rain accumulation crossed the hourly threshold in the preceding hour',
  ],
  fire: [
    'combustible material is stored against the compound boundary',
    'the nearest hydrant is beyond the standard hose run',
  ],
  'tree-fall-risk': [
    'the root plate is undercut by adjacent excavation',
    'no pre-monsoon pruning round has been recorded on this stretch',
  ],
  'open-burning': [
    'no collection has been recorded at this stop for three days',
    'the nearest particulate monitor shows a rise over the fifteen minute baseline',
  ],
  'night-corridor': [
    'the adjacent street light has been reported out for four days',
    'the stretch has no active frontage after 21:00',
  ],
  'open-manhole': [
    'no barricade was reinstated after the last works at this chainage',
    'the location sits on a signed pedestrian route',
  ],
  spitting: [
    'no bin or spittoon within 60 m of the observed location',
    'the frontage is a hospital approach with high footfall',
  ],
  'noise-nuisance': [
    'no event permit is on file for this address tonight',
    'the zone limit for this hour is the residential night limit',
  ],
  'emergency-corridor': [
    'no corridor pre-clearing request was raised for this run',
    'the blocking vehicles are stationary in the running lane',
  ],
}

export const GENERIC_FACTORS = [
  'no enforcement presence is visible on this corridor during the observation window',
  'the asset registry shows no maintenance visit at this location this quarter',
  'school dispersal is in progress in the adjacent zone',
  'this location has produced repeat observations in the last thirty days',
]

export function factorsFor(situationKey: string): readonly string[] {
  return SITUATION_FACTORS[situationKey] ?? GENERIC_FACTORS
}
