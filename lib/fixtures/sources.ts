import 'server-only'
import type { SourceDevice, SourceState } from '@/lib/api/schemas'
import type { SensorKind } from '@/lib/api/schemas'
import { SENSOR_UNITS } from '@/lib/api/schemas/observation'
import { CORRIDORS, ZONE_SEEDS } from '@/lib/geo/bengaluru'
import { corridorLine, sampleAlong, type Position } from '@/lib/geo/build'
import { chance, gauss, intRange, mulberry32, pick, range, subSeed, weighted } from './rng'

/**
 * The pilot fleet: roughly the deployment the build plan costs out, which is 50
 * to 100 cameras, 5 patrol vehicles, 20 bodycams and 30 sensors. Cameras are
 * placed by arc length along the corridors so their fields of view actually
 * cover roads, which is what makes the coverage map on /sources meaningful.
 */

const FIRMWARE = ['edge-2.4.1', 'edge-2.4.0', 'edge-2.3.7', 'edge-2.5.0-rc2']

const SENSOR_KINDS: readonly (readonly [SensorKind, number])[] = [
  ['noise', 6],
  ['pm25', 5],
  ['pm10', 3],
  ['water-level', 3],
  ['rain', 2],
  ['bin-fill', 7],
  ['loop-count', 3],
  ['aqi', 2],
]

const REPRESENTATIVITY: Record<SensorKind, number> = {
  noise: 100,
  pm25: 400,
  pm10: 400,
  'water-level': 50,
  rain: 800,
  'bin-fill': 0,
  'loop-count': 60,
  aqi: 500,
}

function zoneFor(lon: number, lat: number) {
  let best = ZONE_SEEDS[0]!
  let bestD = Infinity
  for (const z of ZONE_SEEDS) {
    const d = Math.hypot(z.center[0] - lon, z.center[1] - lat)
    if (d < bestD) {
      bestD = d
      best = z
    }
  }
  return best
}

function stateFor(rnd: () => number): SourceState {
  return weighted(rnd, [
    ['up', 86],
    ['degraded', 8],
    ['down', 4],
    ['maintenance', 2],
  ])
}

function trustOf(
  attestation: number,
  calibrationRecency: number,
  learnedPrecision: number,
  quality: number,
): number {
  return Math.min(1, attestation * calibrationRecency * learnedPrecision * quality)
}

interface BuildArgs {
  seed: number
  now: number
}

export function buildSources({ seed, now }: BuildArgs): SourceDevice[] {
  const devices: SourceDevice[] = []
  const lines = CORRIDORS.map((c) => corridorLine(c, seed))

  const push = (d: SourceDevice) => devices.push(d)

  /* Fixed and PTZ cameras along the corridors. */
  const CAMERA_COUNT = 46
  for (let i = 0; i < CAMERA_COUNT; i++) {
    const rnd = mulberry32(subSeed(seed, 'camera', i))
    const line = lines[i % lines.length]!
    const corridor = CORRIDORS[i % CORRIDORS.length]!
    const u = ((i * 0.137) % 1) * 0.9 + 0.05
    const p = sampleAlong(line, u)
    const lon = p[0] + gauss(rnd, 0, 0.0006)
    const lat = p[1] + gauss(rnd, 0, 0.0006)
    const zone = zoneFor(lon, lat)
    const ptz = chance(rnd, 0.18)
    const state = stateFor(rnd)
    /* About a quarter of the fleet is genuinely overdue. Stating the split
       explicitly beats skewing a distribution and hoping, and it keeps an amber
       calibration age meaningful rather than the normal state of the table. */
    const overdue = chance(rnd, 0.26)
    const calibrationAge = overdue ? intRange(rnd, 31, 160) : intRange(rnd, 1, 29)
    const calibratedAt = now - calibrationAge * 86400_000
    const calibAgeDays = (now - calibratedAt) / 86400_000
    const attestation = 1
    const calibrationRecency = Math.max(0.55, 1 - Math.max(0, calibAgeDays - 30) / 180)
    const learnedPrecision = range(rnd, 0.72, 0.98)
    const quality = state === 'up' ? range(rnd, 0.85, 1) : range(rnd, 0.5, 0.8)
    push({
      source_id: `CAM-${String(i + 1).padStart(3, '0')}`,
      source_type: ptz ? 'cctv-ptz' : 'cctv-fixed',
      label: `${corridor.name} ${ptz ? 'PTZ' : 'cam'} ${i + 1}`,
      site: corridor.name,
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat, lon },
      heading_deg: Math.round(range(rnd, 0, 360)),
      fov_deg: ptz ? 62 : intRange(rnd, 42, 78),
      range_m: ptz ? 120 : intRange(rnd, 45, 95),
      state,
      uptime_7d: state === 'up' ? range(rnd, 0.97, 1) : range(rnd, 0.4, 0.95),
      sync_quality: weighted(rnd, [
        ['A', 55],
        ['B', 32],
        ['C', 10],
        ['D', 3],
      ]),
      calibrated_at: calibratedAt,
      calibration_residual_m: Math.round(range(rnd, 0.08, 0.9) * 100) / 100,
      trust: Math.round(trustOf(attestation, calibrationRecency, learnedPrecision, quality) * 100) / 100,
      trust_components: {
        attestation,
        calibration_recency: Math.round(calibrationRecency * 100) / 100,
        learned_precision: Math.round(learnedPrecision * 100) / 100,
        quality: Math.round(quality * 100) / 100,
      },
      last_observation_at: state === 'down' ? now - intRange(rnd, 400, 9000) * 1000 : now - intRange(rnd, 1, 40) * 1000,
      firmware: pick(rnd, FIRMWARE),
      edge_device: `HUB-${String((i % 12) + 1).padStart(2, '0')}`,
      privacy_class: 'public-space',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: `/media/thumbs/cam-${(i % 8) + 1}.jpg`,
      trail: [],
    })
  }

  /* Patrol vehicles, each with a live pose and a fading trail. */
  const PATROL = 7
  for (let i = 0; i < PATROL; i++) {
    const rnd = mulberry32(subSeed(seed, 'patrol', i))
    const bike = i >= 5
    const line = lines[(i * 3) % lines.length]!
    const u = (i * 0.19) % 1
    const trail: SourceDevice['trail'] = []
    for (let k = 15; k >= 0; k--) {
      const uu = Math.max(0, Math.min(1, u - k * 0.0006))
      const a = sampleAlong(line, uu)
      const b = sampleAlong(line, Math.min(1, uu + 0.0004))
      trail.push({
        t: now - k * 60_000,
        lat: a[1],
        lon: a[0],
        heading: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI,
      })
    }
    const head = trail[trail.length - 1]!
    const zone = zoneFor(head.lon, head.lat)
    push({
      source_id: `${bike ? 'PBK' : 'PTL'}-${String(i + 1).padStart(2, '0')}`,
      source_type: bike ? 'patrol-bike' : 'patrol-car',
      label: `${bike ? 'Patrol bike' : 'Patrol car'} ${i + 1}`,
      site: 'mobile',
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat: head.lat, lon: head.lon },
      heading_deg: head.heading,
      fov_deg: 96,
      range_m: 80,
      state: 'up',
      uptime_7d: range(rnd, 0.9, 1),
      sync_quality: 'A',
      calibrated_at: now - intRange(rnd, 1, 20) * 86400_000,
      calibration_residual_m: Math.round(range(rnd, 0.05, 0.4) * 100) / 100,
      trust: 0.94,
      trust_components: { attestation: 1, calibration_recency: 0.98, learned_precision: 0.95, quality: 0.99 },
      last_observation_at: now - intRange(rnd, 1, 8) * 1000,
      firmware: pick(rnd, FIRMWARE),
      edge_device: `VEH-${String(i + 1).padStart(2, '0')}`,
      privacy_class: 'public-space',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: `/media/thumbs/patrol-${(i % 3) + 1}.jpg`,
      trail,
    })
  }

  /* Bodycams. Docked ones report an older last observation by design. */
  for (let i = 0; i < 20; i++) {
    const rnd = mulberry32(subSeed(seed, 'bodycam', i))
    const active = chance(rnd, 0.35)
    const zone = ZONE_SEEDS[i % ZONE_SEEDS.length]!
    const lon = zone.center[0] + gauss(rnd, 0, 0.004)
    const lat = zone.center[1] + gauss(rnd, 0, 0.004)
    push({
      source_id: `BWC-${String(i + 1).padStart(2, '0')}`,
      source_type: 'bodycam',
      label: `Bodycam ${i + 1}`,
      site: active ? 'on shift' : 'dock',
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat, lon },
      heading_deg: Math.round(range(rnd, 0, 360)),
      fov_deg: 110,
      range_m: 25,
      state: active ? 'up' : 'maintenance',
      uptime_7d: range(rnd, 0.6, 0.99),
      sync_quality: active ? 'B' : 'C',
      calibrated_at: null,
      calibration_residual_m: null,
      trust: Math.round(range(rnd, 0.8, 0.95) * 100) / 100,
      trust_components: { attestation: 1, calibration_recency: 1, learned_precision: 0.9, quality: 0.95 },
      last_observation_at: active ? now - intRange(rnd, 1, 120) * 1000 : now - intRange(rnd, 3, 20) * 3600_000,
      firmware: pick(rnd, FIRMWARE),
      edge_device: null,
      privacy_class: 'bodycam-sensitive',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: null,
      trail: [],
    })
  }

  /* Community and shop USB cameras, plus two event drones. */
  for (let i = 0; i < 6; i++) {
    const rnd = mulberry32(subSeed(seed, 'usb', i))
    const zone = ZONE_SEEDS[(i * 3) % ZONE_SEEDS.length]!
    const lon = zone.center[0] + gauss(rnd, 0, 0.003)
    const lat = zone.center[1] + gauss(rnd, 0, 0.003)
    push({
      source_id: `USB-${String(i + 1).padStart(2, '0')}`,
      source_type: 'usb-cam',
      label: `Shop camera ${zone.label}`,
      site: zone.label,
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat, lon },
      heading_deg: Math.round(range(rnd, 0, 360)),
      fov_deg: 68,
      range_m: 30,
      state: stateFor(rnd),
      uptime_7d: range(rnd, 0.7, 0.98),
      sync_quality: 'C',
      calibrated_at: now - intRange(rnd, 20, 200) * 86400_000,
      calibration_residual_m: Math.round(range(rnd, 0.4, 1.6) * 100) / 100,
      trust: Math.round(range(rnd, 0.55, 0.78) * 100) / 100,
      trust_components: { attestation: 0.7, calibration_recency: 0.8, learned_precision: 0.85, quality: 0.9 },
      last_observation_at: now - intRange(rnd, 2, 300) * 1000,
      firmware: 'rpi5-hailo-1.9.2',
      edge_device: `RPI-${String(i + 1).padStart(2, '0')}`,
      privacy_class: 'public-space',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: `/media/thumbs/usb-${(i % 3) + 1}.jpg`,
      trail: [],
    })
  }

  for (let i = 0; i < 2; i++) {
    const rnd = mulberry32(subSeed(seed, 'drone', i))
    const zone = ZONE_SEEDS[i === 0 ? 4 : 10]!
    push({
      source_id: `DRN-${String(i + 1).padStart(2, '0')}`,
      source_type: 'drone',
      label: `Event drone ${i + 1}`,
      site: zone.label,
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat: zone.center[1], lon: zone.center[0] },
      heading_deg: Math.round(range(rnd, 0, 360)),
      fov_deg: 84,
      range_m: 200,
      state: i === 0 ? 'up' : 'maintenance',
      uptime_7d: range(rnd, 0.3, 0.7),
      sync_quality: 'B',
      calibrated_at: now - intRange(rnd, 1, 30) * 86400_000,
      calibration_residual_m: 0.6,
      trust: 0.82,
      trust_components: { attestation: 1, calibration_recency: 0.95, learned_precision: 0.88, quality: 0.98 },
      last_observation_at: now - intRange(rnd, 30, 4000) * 1000,
      firmware: 'drone-1.2.0',
      edge_device: null,
      privacy_class: 'public-space',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: null,
      trail: [],
    })
  }

  /* Sensors: the trio the build plan calls highest value, plus air and water. */
  for (let i = 0; i < 32; i++) {
    const rnd = mulberry32(subSeed(seed, 'sensor', i))
    const kind = weighted(rnd, SENSOR_KINDS)
    const zone = ZONE_SEEDS[i % ZONE_SEEDS.length]!
    const lon = zone.center[0] + gauss(rnd, 0, 0.005)
    const lat = zone.center[1] + gauss(rnd, 0, 0.005)
    const state = stateFor(rnd)
    push({
      source_id: `SEN-${String(i + 1).padStart(3, '0')}`,
      source_type: 'sensor',
      label: `${kind} ${SENSOR_UNITS[kind]} ${zone.label}`,
      site: zone.label,
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat, lon },
      heading_deg: null,
      fov_deg: null,
      range_m: null,
      state,
      uptime_7d: range(rnd, 0.85, 1),
      sync_quality: 'C',
      calibrated_at: now - intRange(rnd, 5, 260) * 86400_000,
      calibration_residual_m: null,
      trust: Math.round(range(rnd, 0.7, 0.96) * 100) / 100,
      trust_components: { attestation: 0.9, calibration_recency: 0.85, learned_precision: 0.92, quality: 0.95 },
      last_observation_at: now - intRange(rnd, 5, 120) * 1000,
      firmware: 'mqtt-node-3.1',
      edge_device: null,
      privacy_class: 'non-personal',
      sensor_kind: kind,
      representativity_m: REPRESENTATIVITY[kind],
      thumb_url: null,
      trail: [],
    })
  }

  /* Municipal fleet reporting over CAN. Vehicle identity only, never the driver. */
  const FLEET = ['garbage truck', 'water tanker', 'ambulance', 'fire tender', 'city bus']
  for (let i = 0; i < 6; i++) {
    const rnd = mulberry32(subSeed(seed, 'fleet', i))
    const line = lines[(i * 5) % lines.length]!
    const p = sampleAlong(line, (i * 0.23) % 1)
    const zone = zoneFor(p[0], p[1])
    push({
      source_id: `VEH-${String(i + 1).padStart(2, '0')}`,
      source_type: 'vehicle-bus',
      label: `${pick(rnd, FLEET)} ${i + 1}`,
      site: 'fleet',
      zone_id: zone.id,
      zone_label: zone.label,
      position: { lat: p[1], lon: p[0] },
      heading_deg: Math.round(range(rnd, 0, 360)),
      fov_deg: null,
      range_m: null,
      state: 'up',
      uptime_7d: range(rnd, 0.9, 1),
      sync_quality: 'B',
      calibrated_at: null,
      calibration_residual_m: null,
      trust: 0.88,
      trust_components: { attestation: 0.95, calibration_recency: 1, learned_precision: 0.93, quality: 1 },
      last_observation_at: now - intRange(rnd, 1, 60) * 1000,
      firmware: 'can-gw-2.0.4',
      edge_device: null,
      privacy_class: 'operational',
      sensor_kind: null,
      representativity_m: null,
      thumb_url: null,
      trail: [],
    })
  }

  return devices
}

export function cameraLines(seed: number): Position[][] {
  return CORRIDORS.map((c) => corridorLine(c, seed))
}
