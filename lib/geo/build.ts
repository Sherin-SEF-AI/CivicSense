import {
  BENGALURU_BBOX,
  CORRIDORS,
  GREEN,
  WATER,
  ZONE_SEEDS,
  type Corridor,
  type WaterBody,
} from './bengaluru'

/**
 * Builds the keyless basemap geometry and the derived structures the fixture
 * world needs. Everything here is a pure function of the seed data plus an
 * integer seed, so the map on one machine is byte-identical to the map on
 * another and an incident that sat on a road yesterday sits on it today.
 */

export type Position = [number, number]

export interface FeatureOf<G, P> {
  type: 'Feature'
  geometry: G
  properties: P
}

export interface LineGeom {
  type: 'LineString'
  coordinates: Position[]
}
export interface PolyGeom {
  type: 'Polygon'
  coordinates: Position[][]
}

export interface Collection<F> {
  type: 'FeatureCollection'
  features: F[]
}

/** Deterministic 32-bit PRNG. Same seed, same city, every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable per-entity seed so entity N is identical regardless of generation order. */
export function subSeed(seed: number, namespace: string, index: number): number {
  let h = seed >>> 0
  const s = `${namespace}:${index}`
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  }
  return h >>> 0
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

/** Inserts intermediate points so a corridor curves instead of cutting corners. */
export function densify(points: readonly (readonly [number, number])[], stepDeg = 0.004): Position[] {
  const out: Position[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dist = Math.hypot(dx, dy)
    const n = Math.max(1, Math.ceil(dist / stepDeg))
    for (let k = 0; k < n; k++) {
      const u = k / n
      out.push([round5(a[0] + dx * u), round5(a[1] + dy * u)])
    }
  }
  const last = points[points.length - 1]!
  out.push([round5(last[0]), round5(last[1])])
  return out
}

/** A corridor with a small perpendicular wobble, so it reads as a road not a ruler. */
export function corridorLine(c: Corridor, seed: number): Position[] {
  const rnd = mulberry32(subSeed(seed, 'corridor', c.points.length + c.id.length))
  const dense = densify(c.points)
  return dense.map((p, i) => {
    if (i === 0 || i === dense.length - 1) return p
    const amp = c.klass === 'ring' ? 0.0009 : 0.0006
    return [round5(p[0] + (rnd() - 0.5) * amp), round5(p[1] + (rnd() - 0.5) * amp)]
  })
}

export function ellipse(w: WaterBody, steps = 28): Position[] {
  const ring: Position[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const x = Math.cos(a) * w.rx
    const y = Math.sin(a) * w.ry
    ring.push([
      round5(w.center[0] + x * Math.cos(w.rot) - y * Math.sin(w.rot)),
      round5(w.center[1] + x * Math.sin(w.rot) + y * Math.cos(w.rot)),
    ])
  }
  ring.push(ring[0]!)
  return ring
}

/** An irregular ward boundary: a jittered ring around the seed centroid. */
export function zonePolygon(centerLon: number, centerLat: number, radius: number, seed: number): Position[] {
  const rnd = mulberry32(seed)
  const steps = 12
  const ring: Position[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const r = radius * (0.72 + rnd() * 0.5)
    ring.push([round5(centerLon + Math.cos(a) * r), round5(centerLat + Math.sin(a) * r * 0.92)])
  }
  ring.push(ring[0]!)
  return ring
}

export function buildRoadsMajor(seed: number): Collection<FeatureOf<LineGeom, { id: string; name: string; klass: string }>> {
  return {
    type: 'FeatureCollection',
    features: CORRIDORS.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: corridorLine(c, seed) },
      properties: { id: c.id, name: c.name, klass: c.klass },
    })),
  }
}

/**
 * A jittered grid of minor streets, thinned away from the centre so the outskirts
 * are sparser than the core. This is texture, not cartography: it gives the map
 * the density gradient a city has without pretending to be a survey.
 */
export function buildRoadsMinor(seed: number): Collection<FeatureOf<LineGeom, { klass: string }>> {
  const rnd = mulberry32(subSeed(seed, 'minor', 0))
  const [w, s, e, n] = BENGALURU_BBOX
  const features: FeatureOf<LineGeom, { klass: string }>[] = []
  const step = 0.0075
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const maxR = Math.hypot(e - w, n - s) / 2

  const keep = (x: number, y: number) => {
    const r = Math.hypot(x - cx, y - cy) / maxR
    return rnd() < 1.05 - r * 1.15
  }

  for (let y = s + step; y < n; y += step) {
    for (let x = w + step; x < e; x += step * 2) {
      if (!keep(x, y)) continue
      const jx = (rnd() - 0.5) * step * 0.5
      const jy = (rnd() - 0.5) * step * 0.5
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [round5(x + jx), round5(y + jy)],
            [round5(x + step * 2 + jx), round5(y + jy + (rnd() - 0.5) * step * 0.3)],
          ],
        },
        properties: { klass: 'minor' },
      })
    }
  }
  for (let x = w + step; x < e; x += step) {
    for (let y = s + step; y < n; y += step * 2) {
      if (!keep(x, y)) continue
      const jx = (rnd() - 0.5) * step * 0.5
      const jy = (rnd() - 0.5) * step * 0.5
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [round5(x + jx), round5(y + jy)],
            [round5(x + jx + (rnd() - 0.5) * step * 0.3), round5(y + step * 2 + jy)],
          ],
        },
        properties: { klass: 'minor' },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function buildWater(): Collection<FeatureOf<PolyGeom, { id: string; name: string }>> {
  return {
    type: 'FeatureCollection',
    features: WATER.map((wb) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [ellipse(wb)] },
      properties: { id: wb.id, name: wb.name },
    })),
  }
}

export function buildGreen(): Collection<FeatureOf<PolyGeom, { id: string; name: string }>> {
  return {
    type: 'FeatureCollection',
    features: GREEN.map((g) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [ellipse(g, 22)] },
      properties: { id: g.id, name: g.name },
    })),
  }
}

export function buildZones(
  seed: number,
): Collection<FeatureOf<PolyGeom, { zone_id: string; label: string; kind: string; sensitivity: number }>> {
  return {
    type: 'FeatureCollection',
    features: ZONE_SEEDS.map((z, i) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [zonePolygon(z.center[0], z.center[1], z.radius, subSeed(seed, 'zone', i))],
      },
      properties: { zone_id: z.id, label: z.label, kind: z.kind, sensitivity: z.sensitivity },
    })),
  }
}

/* ------------------------------------------------------------- geometry ops */

export function pointInRing(lon: number, lat: number, ring: readonly Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > lat !== b[1] > lat && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

/** Samples a point along a polyline by arc length, so incidents land on roads. */
export function sampleAlong(line: readonly Position[], u: number): Position {
  let total = 0
  const lens: number[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const l = Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1])
    lens.push(l)
    total += l
  }
  let target = u * total
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i]!) {
      const t = lens[i]! === 0 ? 0 : target / lens[i]!
      const a = line[i]!
      const b = line[i + 1]!
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    target -= lens[i]!
  }
  return line[line.length - 1]!
}

export function bearingOf(a: Position, b: Position): number {
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
}

/** Metres per degree at Bengaluru's latitude, good enough for FOV wedges. */
export const M_PER_DEG_LAT = 110574
export const M_PER_DEG_LON = 108500

export function offsetMeters(lon: number, lat: number, dxM: number, dyM: number): Position {
  return [lon + dxM / M_PER_DEG_LON, lat + dyM / M_PER_DEG_LAT]
}

/** The ground polygon a camera can speak about, rendered as a translucent wedge. */
export function fovWedge(
  lon: number,
  lat: number,
  headingDeg: number,
  fovDeg: number,
  rangeM: number,
  steps = 10,
): Position[] {
  const ring: Position[] = [[round5(lon), round5(lat)]]
  const start = headingDeg - fovDeg / 2
  for (let i = 0; i <= steps; i++) {
    const a = ((start + (fovDeg * i) / steps) * Math.PI) / 180
    const p = offsetMeters(lon, lat, Math.sin(a) * rangeM, Math.cos(a) * rangeM)
    ring.push([round5(p[0]), round5(p[1])])
  }
  ring.push([round5(lon), round5(lat)])
  return ring
}
