import 'server-only'
import type {
  AuthenticityReport,
  CausalGraph,
  ConflictMetric,
  EntityDossier,
  EvidenceTreeNode,
  ForensicsBundle,
  Hypothesis,
  IncidentSummary,
  MediaSegment,
  PlaybackSource,
  SourceDevice,
  TimelineEntry,
  TimelineEventTick,
  TrackKinematics,
} from '@/lib/api/schemas'
import { chainFor } from './causal'
import { situationOf } from './incidents'
import { hashString } from './packages'
import { chance, hex, intRange, mulberry32, pick, range, subSeed } from './rng'

/** Clip assets rendered by scripts/gen-media.sh. Sixty seconds, 25fps, timecoded. */
const CLIP_COUNT = 4
const CLIP_DURATION_MS = 60_000
const CLIP_FPS = 25

const WINDOW_BEFORE = 120_000
const WINDOW_AFTER = 180_000

const TEST_LIBRARY = [
  ['frame-timestamp continuity', 'no discontinuity across the segment', 'SWGDE video analysis'],
  ['optical-flow discontinuity', 'no insertion or deletion signature detected', 'SWGDE video analysis'],
  ['double-compression detection', 'single compression consistent with capture', 'ASTM E2825'],
  ['PRNU sensor fingerprint', 'matches the enrolled fingerprint for this device', 'ASTM E2825'],
  ['metadata consistency', 'EXIF, GPS and clock skew mutually consistent', 'ISO/IEC 27037'],
  ['replayed-screen screening', 'no moire or bezel cues present', 'SWGDE image authentication'],
] as const

/**
 * Assembles the forensic bundle for an incident: the synchronized replay set,
 * the reconstructed timeline, the measurements with their uncertainty, the why
 * graph, the hypothesis ledger and the authenticity verdicts.
 *
 * The one rule this generator never breaks is that every claim carries the ids
 * it rests on. A timeline entry with no evidence would be an assertion, and the
 * whole point of the package is that there are none.
 */
export function buildForensics(
  seed: number,
  incident: IncidentSummary,
  sources: SourceDevice[],
  investigationFlag: boolean,
): ForensicsBundle {
  const rnd = mulberry32(subSeed(seed, 'forensics', hashString(incident.incident_id)))
  const situation = situationOf(incident)
  const t0 = incident.detected_at - WINDOW_BEFORE
  const t1 = incident.detected_at + WINDOW_AFTER

  /* The sources that actually saw it: nearest devices of the recorded types,
     plus a sensor for the scope lane and the vehicle that carried a bodycam. */
  const byDistance = [...sources].sort(
    (a, b) =>
      Math.hypot(a.position.lon - incident.position.lon, a.position.lat - incident.position.lat) -
      Math.hypot(b.position.lon - incident.position.lon, b.position.lat - incident.position.lat),
  )
  const cameras = byDistance.filter((s) => ['cctv-fixed', 'cctv-ptz', 'usb-cam'].includes(s.source_type)).slice(0, 2)
  const mobile = byDistance.filter((s) => ['patrol-car', 'patrol-bike', 'bodycam'].includes(s.source_type)).slice(0, 1)
  const sensors = byDistance.filter((s) => s.source_type === 'sensor').slice(0, 1)
  const chosen = [...cameras, ...mobile, ...sensors]

  const playback: PlaybackSource[] = chosen.map((s, i) => {
    const isSensor = s.source_type === 'sensor'
    const segments: MediaSegment[] = []
    if (!isSensor) {
      /* One to three segments with real gaps, because coverage gaps are the
         thing the deck exists to make visible. */
      const segCount = intRange(rnd, 1, 3)
      let cursor = t0 + intRange(rnd, 0, 40_000)
      for (let k = 0; k < segCount; k++) {
        const duration = Math.min(CLIP_DURATION_MS, intRange(rnd, 24_000, 58_000))
        if (cursor + duration > t1) break
        segments.push({
          t_start: cursor,
          t_end: cursor + duration,
          fps: CLIP_FPS,
          uri: `/media/clips/clip-${((hashString(s.source_id) + k) % CLIP_COUNT) + 1}.mp4`,
          kind: 'mp4',
        })
        cursor += duration + intRange(rnd, 6_000, 34_000)
      }
      /* One bodycam per incident streams live over HLS during the response, so
         the streaming path is exercised rather than only described. */
      if (s.source_type === 'bodycam' && segments.length > 0) {
        const last = segments[segments.length - 1]!
        segments[segments.length - 1] = { ...last, uri: '/media/hls/live.m3u8', kind: 'hls' }
      }
      if (segments.length === 0) {
        segments.push({
          t_start: incident.detected_at - 20_000,
          t_end: incident.detected_at + 30_000,
          fps: CLIP_FPS,
          uri: `/media/clips/clip-${(hashString(s.source_id) % CLIP_COUNT) + 1}.mp4`,
          kind: 'mp4',
        })
      }
    }
    return {
      source_id: s.source_id,
      label: s.label,
      source_type: s.source_type,
      tile_kind: isSensor ? 'scope' : i === chosen.length - 1 && chosen.length > 3 ? 'video' : 'video',
      sync_quality: s.sync_quality,
      clock_offset_ms:
        s.sync_quality === 'A'
          ? intRange(rnd, -8, 8)
          : s.sync_quality === 'B'
            ? intRange(rnd, -90, 90)
            : s.sync_quality === 'C'
              ? intRange(rnd, -800, 800)
              : intRange(rnd, -4000, 4000),
      segments,
      sensor_kind: s.sensor_kind,
      homography:
        s.calibration_residual_m === null
          ? null
          : [1.02, 0.03, -12.4, 0.01, 0.98, 8.7, 0.0002, 0.0011, 1],
      calibration_residual_m: s.calibration_residual_m,
    }
  })

  /* A map trajectory tile always exists, because the ground truth of where
     things moved is the one view no single camera provides. */
  playback.push({
    source_id: 'MAP-TRAJ',
    label: 'ground-plane trajectories',
    source_type: 'cctv-fixed',
    tile_kind: 'map',
    sync_quality: 'A',
    clock_offset_ms: 0,
    segments: [],
    sensor_kind: null,
    homography: null,
    calibration_residual_m: null,
  })

  const tree: EvidenceTreeNode[] = chosen.flatMap((s, i) => {
    const src = playback[i]
    const nodes: EvidenceTreeNode[] = []
    const segs = src?.segments ?? []
    segs.forEach((seg, k) => {
      nodes.push({
        evidence_id: `EV-${s.source_id}-C${k}`,
        source_id: s.source_id,
        source_type: s.source_type,
        label: `clip ${k + 1}`,
        kind: 'clip',
        t_start: seg.t_start,
        t_end: seg.t_end,
        hash: hex(rnd, 64),
        authenticity: chance(rnd, 0.85) ? 'verified' : chance(rnd, 0.6) ? 'consistent' : 'inconsistent',
        bytes: Math.round(((seg.t_end - seg.t_start) / 1000) * 380_000),
        thumb_url: `/media/frames/cam-${((hashString(s.source_id) + k) % 6) + 1}.jpg`,
      })
    })
    nodes.push({
      evidence_id: `EV-${s.source_id}-K`,
      source_id: s.source_id,
      source_type: s.source_type,
      label: 'keyframe at anchor',
      kind: 'keyframe',
      t_start: incident.detected_at,
      t_end: incident.detected_at,
      hash: hex(rnd, 64),
      authenticity: 'verified',
      bytes: intRange(rnd, 180_000, 620_000),
      thumb_url: `/media/frames/cam-${(hashString(s.source_id) % 6) + 1}.jpg`,
    })
    if (s.source_type === 'bodycam') {
      nodes.push({
        evidence_id: `EV-${s.source_id}-T`,
        source_id: s.source_id,
        source_type: s.source_type,
        label: 'voice note transcript',
        kind: 'transcript',
        t_start: incident.detected_at + 90_000,
        t_end: incident.detected_at + 104_000,
        hash: hex(rnd, 64),
        authenticity: 'consistent',
        bytes: intRange(rnd, 900, 4200),
        thumb_url: null,
      })
    }
    if (s.source_type === 'sensor') {
      nodes.push({
        evidence_id: `EV-${s.source_id}-R`,
        source_id: s.source_id,
        source_type: s.source_type,
        label: `${s.sensor_kind ?? 'sensor'} readings`,
        kind: 'reading',
        t_start: t0,
        t_end: t1,
        hash: hex(rnd, 64),
        authenticity: 'verified',
        bytes: intRange(rnd, 2000, 9000),
        thumb_url: null,
      })
    }
    return nodes
  })

  const ticks: TimelineEventTick[] = []
  for (const s of chosen) {
    const n = intRange(rnd, 1, 4)
    for (let k = 0; k < n; k++) {
      ticks.push({
        t: t0 + Math.round(range(rnd, 0.05, 0.95) * (t1 - t0)),
        source_id: s.source_id,
        kind: pick(rnd, ['trigger', 'audio', 'sensor-threshold', 'arrival', 'annotation'] as const),
        label: pick(rnd, [
          situation.trigger,
          'sound event: horn',
          'sound event: tyre screech',
          'threshold crossed',
          'officer arrival',
          'operator annotation',
        ]),
        evidence_id: chance(rnd, 0.6) ? tree[intRange(rnd, 0, tree.length - 1)]?.evidence_id ?? null : null,
      })
    }
  }
  ticks.sort((a, b) => a.t - b.t)

  const timeline: TimelineEntry[] = []
  const pushEntry = (t: number, lane: TimelineEntry['lane'], text: string, sourceIdx: number) => {
    const s = chosen[sourceIdx % Math.max(1, chosen.length)] ?? chosen[0]
    if (!s) return
    timeline.push({
      entry_id: `TL-${timeline.length}`,
      t,
      lane,
      source_id: s.source_id,
      source_type: s.source_type,
      text,
      evidence_ids: [tree[timeline.length % Math.max(1, tree.length)]?.evidence_id ?? 'EV-0'],
      confidence: Math.round(range(rnd, 0.5, 0.97) * 100) / 100,
    })
  }

  pushEntry(t0 + 12_000, 'backward', 'the approach is clear, flow matches the weekday baseline for this hour', 0)
  pushEntry(incident.detected_at - 48_000, 'backward', pick(rnd, [
    'a patrol pass-by records the same location with nothing present',
    'the upstream signal completes a normal cycle',
    'the bin at this stop is already at full fill according to the sensor',
  ]), 1)
  pushEntry(incident.detected_at - 6_000, 'backward', 'the subject enters the field of view from the northern approach', 0)
  pushEntry(incident.detected_at, 'anchor', `trigger ${situation.trigger} fires on the edge rule engine`, 0)
  pushEntry(incident.detected_at + 2_500, 'anchor', 'a second source corroborates within the fusion window', 1)
  pushEntry(incident.detected_at + 26_000, 'forward', 'the package is dispatched to the owning department', 0)
  if (chosen.some((s) => s.source_type === 'bodycam')) {
    pushEntry(incident.detected_at + 96_000, 'forward', 'bodycam attaches to the incident by geofence, arrival timestamped automatically', 2)
    pushEntry(incident.detected_at + 104_000, 'forward', 'voice note transcribed and entered on the timeline', 2)
  }
  pushEntry(incident.detected_at - 900_000, 'lateral', pick(rnd, [
    'the scheduled collection window for this stop closed without the truck entering the geofence',
    'the street light controller reported a fault on this pole',
    'rain accumulation crossed 12 mm in the preceding hour',
  ]), 3)
  timeline.sort((a, b) => a.t - b.t)

  /* Kinematics. Speeds carry intervals, never point values, and the grade drops
     to indicative when the uncertainty is wider than the tolerance. */
  const trackCount = intRange(rnd, 1, 3)
  const kinematics: TrackKinematics[] = Array.from({ length: trackCount }, (_, i) => {
    const s = chosen[i % Math.max(1, chosen.length)] ?? chosen[0]!
    const base = range(rnd, 18, 62)
    const braking = chance(rnd, 0.6) ? incident.detected_at - intRange(rnd, 1200, 4200) : null
    const samples = Array.from({ length: 40 }, (_, k) => {
      const t = incident.detected_at - 8000 + k * 400
      const decel = braking !== null && t > braking ? Math.max(0, 1 - (t - braking) / 4000) : 1
      const speed = Math.max(0, base * decel + Math.sin(k / 4) * 2.2)
      const err = range(rnd, 1.4, 4.8)
      return {
        t,
        speed: Math.round(speed * 10) / 10,
        speed_lo: Math.round((speed - err) * 10) / 10,
        speed_hi: Math.round((speed + err) * 10) / 10,
        accel: Math.round((braking !== null && t > braking ? -range(rnd, 1.5, 4.5) : range(rnd, -0.4, 0.6)) * 100) / 100,
        lat: incident.position.lat + (k - 20) * 0.00004,
        lon: incident.position.lon + (k - 20) * 0.00005,
      }
    })
    const peak = Math.max(...samples.map((x) => x.speed))
    const widest = Math.max(...samples.map((x) => x.speed_hi - x.speed_lo))
    return {
      track_id: `T${intRange(rnd, 100, 999)}`,
      entity_ref: `E-${hex(rnd, 6)}`,
      descriptor: pick(rnd, [
        'white light commercial vehicle',
        'dark hatchback',
        'two-wheeler with pillion',
        'pedestrian crossing outside the marked crossing',
      ]),
      source_id: s.source_id,
      samples,
      peak_speed: {
        value: Math.round(peak * 10) / 10,
        lo: Math.round((peak - widest / 2) * 10) / 10,
        hi: Math.round((peak + widest / 2) * 10) / 10,
      },
      braking_onset_t: braking,
      measurement_grade: widest > 7 ? 'indicative' : 'measured',
      validated_against_can: chance(rnd, 0.4),
    }
  })

  const conflicts: ConflictMetric[] = kinematics.length > 1
    ? [
        {
          pair: [kinematics[0]!.track_id, kinematics[1]!.track_id],
          ttc_s: { value: 1.8, lo: 1.3, hi: 2.4 },
          pet_s: { value: 0.9, lo: 0.6, hi: 1.3 },
          drac: { value: 3.4, lo: 2.6, hi: 4.3 },
          t: incident.detected_at - 1200,
          severity: 'serious',
        },
      ]
    : []

  const causal = buildCausal(rnd, incident, situation.key, timeline)

  const hypotheses: Hypothesis[] = Array.from({ length: intRange(rnd, 2, 3) }, (_, i) => {
    const prior = Math.round(range(rnd, 0.2, 0.6) * 100) / 100
    const posterior = Math.round(Math.min(0.97, Math.max(0.03, prior + range(rnd, -0.35, 0.45))) * 100) / 100
    return {
      hypothesis_id: `H-${i + 1}`,
      statement: pick(rnd, [
        'the vehicle stopped deliberately to unload rather than breaking down',
        'the missed collection is the proximate cause of the accumulation',
        'the rider entered the wrong way to avoid the enforcement point upstream',
        'the pedestrian was occluded from the driver until the last two seconds',
        'the water accumulation follows the blocked drain rather than the rainfall alone',
      ]),
      prior,
      posterior,
      status: posterior > 0.75 ? 'supported' : posterior < 0.15 ? 'refuted' : chance(rnd, 0.3) ? 'budget-exhausted' : 'open',
      requests: Array.from({ length: intRange(rnd, 1, 3) }, (_, k) => ({
        request_id: `RQ-${i}-${k}`,
        what: pick(rnd, [
          'additional clip from the edge ring buffer',
          'sensor history for the preceding thirty minutes',
          'adjacent camera frames at the same instant',
          'fleet telemetry for the hashed plate',
          'patrol pass-by imagery for this chainage',
        ]),
        source_id: (chosen[k % Math.max(1, chosen.length)] ?? chosen[0]!).source_id,
        window: [incident.detected_at - 600_000, incident.detected_at] as [number, number],
        state: pick(rnd, ['queued', 'pulled', 'returned', 'unavailable'] as const),
        delta: chance(rnd, 0.6) ? Math.round(range(rnd, -0.3, 0.4) * 100) / 100 : null,
      })),
      evidence_ids: tree.slice(0, 2).map((n) => n.evidence_id),
    }
  })

  const authenticity: AuthenticityReport[] = tree.map((node) => {
    const failing = node.authenticity === 'inconsistent'
    const tests = TEST_LIBRARY.slice(0, intRange(rnd, 3, 6)).map(([test, detail, standard], i) => ({
      test,
      result: (failing && i === 1 ? 'fail' : chance(rnd, 0.9) ? 'pass' : 'inconclusive') as 'pass' | 'fail' | 'inconclusive',
      detail: failing && i === 1 ? 'a flow discontinuity is present at 00:00:12, consistent with a removed segment' : detail,
      standard,
    }))
    return {
      evidence_id: node.evidence_id,
      verdict: node.authenticity,
      tests,
      hash: node.hash,
      device_signature: chance(rnd, 0.7) ? hex(rnd, 32) : null,
    }
  })

  const entities: EntityDossier[] = Array.from({ length: intRange(rnd, 1, 3) }, (_, i) => {
    const isPerson = situation.classes.includes('person') && i === 0
    return {
      entity_ref: kinematics[i]?.entity_ref ?? `E-${hex(rnd, 6)}`,
      kind: isPerson ? 'person' : chance(rnd, 0.75) ? 'vehicle' : 'object',
      descriptor: kinematics[i]?.descriptor ?? 'object left in the pedestrian desire line',
      plate_hash: isPerson ? null : chance(rnd, 0.7) ? hex(rnd, 16) : null,
      appearance_strip: Array.from({ length: 4 }, (_, k) => `/media/frames/cam-${((i + k) % 6) + 1}.jpg`),
      path: Array.from({ length: 6 }, (_, k) => ({
        t: incident.detected_at - 12_000 + k * 4000,
        lat: incident.position.lat + (k - 3) * 0.0004,
        lon: incident.position.lon + (k - 3) * 0.0005,
        source_id: (chosen[k % Math.max(1, chosen.length)] ?? chosen[0]!).source_id,
      })),
      prior_incidents: intRange(rnd, 0, 6),
      investigation_flag: investigationFlag,
      first_seen: incident.detected_at - intRange(rnd, 20, 90) * 86400_000,
      last_seen: incident.detected_at,
    }
  })

  return {
    incident_id: incident.incident_id,
    window: [t0, t1],
    tree,
    playback,
    ticks,
    timeline,
    kinematics,
    conflicts,
    causal,
    hypotheses,
    authenticity,
    entities,
    investigation_flag: investigationFlag,
  }
}

function buildCausal(
  rnd: () => number,
  incident: IncidentSummary,
  situationKey: string,
  timeline: TimelineEntry[],
): CausalGraph {
  const steps = chainFor(situationKey, incident.domain)
  const nodes = steps.map((step, i) => ({
    id: `N${i + 1}`,
    label: step.label,
    kind: step.kind,
    t: i < timeline.length ? timeline[i]!.t : null,
    evidence_ids: [timeline[i % Math.max(1, timeline.length)]?.evidence_ids[0] ?? 'EV-0'],
    root_cause_class: step.root_cause_class,
  }))
  const edges = nodes.slice(0, -1).map((n, i) => ({
    from: n.id,
    to: nodes[i + 1]!.id,
    confidence: Math.round(range(rnd, 0.55, 0.95) * 100) / 100,
    evidence_ids: n.evidence_ids,
    counterfactual: i === 0,
  }))
  const rootNodes = nodes.filter((n) => n.root_cause_class !== null)
  const root_causes = rootNodes.map((n, i) => ({
    node_id: n.id,
    label: n.label,
    class: n.root_cause_class!,
    rank: i + 1,
    share: Math.round((1 / rootNodes.length) * 100) / 100,
  }))
  return { nodes, edges, root_causes }
}
