'use client'

/**
 * The master clock.
 *
 * It is a virtual clock, not a designated video element. Any candidate master
 * can hit a coverage gap, stall on buffering, or have its playback rate clamped
 * by the browser, and then every other tile freezes with it. A virtual clock has
 * none of those failure modes, and it lets a map tile and a sensor scope be
 * first-class members of the stage rather than passengers on a video.
 *
 * It re-anchors against performance.now() rather than integrating a delta.
 * Integration accumulates float error, and worse, a throttled background tab
 * hands you a single five second delta that you then integrate into a jump.
 * Re-anchoring is idempotent and self-correcting.
 */

export type ClockListener = (t: number, frame: number) => void

export class MasterClock {
  private anchorT: number
  private anchorWall = 0
  private rate = 1
  private playing = false
  private frame = 0
  private raf: number | null = null
  private listeners = new Set<ClockListener>()
  private transportListeners = new Set<() => void>()

  constructor(
    private tMin: number,
    private tMax: number,
  ) {
    this.anchorT = tMin
  }

  setBounds(tMin: number, tMax: number) {
    this.tMin = tMin
    this.tMax = tMax
    this.anchorT = Math.min(Math.max(this.anchorT, tMin), tMax)
    this.emitTransport()
  }

  getBounds(): [number, number] {
    return [this.tMin, this.tMax]
  }

  /** Hot path. Allocation free, called from every tick and every readout. */
  now(): number {
    if (!this.playing) return this.anchorT
    const t = this.anchorT + (performance.now() - this.anchorWall) * this.rate
    if (t >= this.tMax) return this.tMax
    if (t <= this.tMin) return this.tMin
    return t
  }

  isPlaying(): boolean {
    return this.playing
  }

  getRate(): number {
    return this.rate
  }

  private reanchor() {
    this.anchorT = this.now()
    this.anchorWall = performance.now()
  }

  play() {
    if (this.playing) return
    if (this.now() >= this.tMax) this.anchorT = this.tMin
    this.anchorWall = performance.now()
    this.playing = true
    this.emitTransport()
    this.loop()
  }

  pause() {
    if (!this.playing) return
    this.reanchor()
    this.playing = false
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.emitTransport()
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    this.anchorT = Math.min(Math.max(t, this.tMin), this.tMax)
    this.anchorWall = performance.now()
    this.frame += 1
    this.emit()
  }

  nudge(deltaMs: number) {
    this.seek(this.now() + deltaMs)
  }

  setRate(rate: number) {
    this.reanchor()
    this.rate = rate
    this.emitTransport()
  }

  subscribe(fn: ClockListener): () => void {
    this.listeners.add(fn)
    fn(this.now(), this.frame)
    return () => this.listeners.delete(fn)
  }

  /** Discrete transport changes: play, pause, rate. Safe for React. */
  subscribeTransport(fn: () => void): () => void {
    this.transportListeners.add(fn)
    return () => this.transportListeners.delete(fn)
  }

  private emit() {
    const t = this.now()
    for (const fn of this.listeners) fn(t, this.frame)
  }

  private emitTransport() {
    for (const fn of this.transportListeners) fn()
  }

  private loop = () => {
    if (!this.playing) return
    this.frame += 1
    const t = this.now()
    if (t >= this.tMax) {
      this.anchorT = this.tMax
      this.playing = false
      this.emitTransport()
      this.emit()
      return
    }
    this.emit()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.listeners.clear()
    this.transportListeners.clear()
  }
}
