/**
 * Min and max pyramid for sensor lanes.
 *
 * A twenty-four hour series at 1Hz is 86,400 points. Drawing it directly is the
 * difference between a deck that pans at sixty frames and one that does not. The
 * pyramid makes the draw cost proportional to viewport width instead of series
 * length, so a long window costs the same as a short one.
 */
export interface Pyramid {
  baseMs: number
  levels: { bucketMs: number; t0: number; min: Float32Array; max: Float32Array }[]
  range: [number, number]
}

export function buildPyramid(buckets: readonly (readonly [number, number, number])[], baseMs: number): Pyramid {
  if (buckets.length === 0) {
    return { baseMs, levels: [], range: [0, 1] }
  }
  const t0 = buckets[0]![0]
  let min = new Float32Array(buckets.length)
  let max = new Float32Array(buckets.length)
  let lo = Infinity
  let hi = -Infinity
  buckets.forEach((b, i) => {
    min[i] = b[1]
    max[i] = b[2]
    if (b[1] < lo) lo = b[1]
    if (b[2] > hi) hi = b[2]
  })

  const levels: Pyramid['levels'] = [{ bucketMs: baseMs, t0, min, max }]
  let bucketMs = baseMs
  while (min.length > 8) {
    const n = Math.ceil(min.length / 2)
    const nextMin = new Float32Array(n)
    const nextMax = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = i * 2
      const b = Math.min(a + 1, min.length - 1)
      nextMin[i] = Math.min(min[a]!, min[b]!)
      nextMax[i] = Math.max(max[a]!, max[b]!)
    }
    bucketMs *= 2
    min = nextMin
    max = nextMax
    levels.push({ bucketMs, t0, min, max })
  }

  const pad = (hi - lo) * 0.08 || 1
  return { baseMs, levels, range: [lo - pad, hi + pad] }
}

export function levelFor(pyramid: Pyramid, msPerPx: number): Pyramid['levels'][number] | null {
  for (const level of pyramid.levels) {
    if (level.bucketMs >= msPerPx) return level
  }
  return pyramid.levels[pyramid.levels.length - 1] ?? null
}
