'use client'

import type { PlaybackSource } from '@/lib/api/schemas'
import { SYNC_TOLERANCE_MS } from '@/lib/api/schemas/common'
import { coverageAt, mediaTimeOf } from './coverage'
import { SEEK_SCRUB_ABOVE } from './frames'

/**
 * Keeps one video element on the master clock.
 *
 * Three bands, with hysteresis:
 *   locked  inside max(frame, tolerance), do nothing at all
 *   nudge   absorb the error by trimming playbackRate at 4Hz, which is inaudible
 *   hard    one seek, then suppress corrections for 250ms
 *
 * The rules that stop it stuttering matter more than the bands. Never write
 * currentTime while seeking, never inside the suppression window, and quarantine
 * a source that needs repeated hard seeks instead of fighting it forever, because
 * a source with wrong fps metadata will otherwise ping-pong across the threshold
 * for as long as the stage is open.
 */

const NUDGE_HZ = 4
const NUDGE_INTERVAL_MS = 1000 / NUDGE_HZ
const NUDGE_K_MS = 1500
const NUDGE_CLAMP = 0.06
const SEEK_SUPPRESS_MS = 250
const QUARANTINE_SEEKS = 5
const QUARANTINE_WINDOW_MS = 10_000

export interface SlaveCallbacks {
  onDrift: (ms: number) => void
  onDesync: (desynced: boolean) => void
  onSegmentChange: (index: number | null) => void
}

export class VideoSlave {
  private lastNudge = 0
  private lastSeek = 0
  private seekTimes: number[] = []
  private quarantined = false
  private locked = true
  private currentIndex: number | null = null
  private lastReport = 0

  constructor(
    private video: HTMLVideoElement,
    private source: PlaybackSource,
    private callbacks: SlaveCallbacks,
  ) {}

  setSource(source: PlaybackSource) {
    this.source = source
    this.currentIndex = null
  }

  /** Called from the clock tick. Must stay allocation free. */
  tick(tMaster: number, playing: boolean, rate: number) {
    const video = this.video
    const coverage = coverageAt(this.source, tMaster)

    if (coverage.state !== 'covered') {
      if (this.currentIndex !== null) {
        this.currentIndex = null
        this.callbacks.onSegmentChange(null)
      }
      if (!video.paused) video.pause()
      return
    }

    if (coverage.index !== this.currentIndex) {
      this.currentIndex = coverage.index
      this.callbacks.onSegmentChange(coverage.index)
      const url = coverage.segment.uri
      if (!video.src.endsWith(url)) {
        video.src = url
      }
      this.hardSeek(coverage.localSec)
      return
    }

    const now = performance.now()
    const target = coverage.localSec
    const actual = video.currentTime
    const errorMs = (actual - target) * 1000
    if (now - this.lastReport > 500) {
      this.lastReport = now
      this.callbacks.onDrift(errorMs)
    }

    if (!playing) {
      if (!video.paused) video.pause()
      if (Math.abs(errorMs) > 40 && now - this.lastSeek > SEEK_SUPPRESS_MS) this.hardSeek(target)
      return
    }

    /* Above 4x the browser clamps playbackRate and drops audio, so a correct but
       choppy seek-scrub is more useful than a smooth but wrong picture. */
    if (rate > SEEK_SCRUB_ABOVE) {
      if (!video.paused) video.pause()
      if (now - this.lastSeek > 66) {
        this.lastSeek = now
        video.currentTime = target
      }
      return
    }

    if (video.paused) void video.play().catch(() => undefined)
    video.muted = rate > 2

    if (this.quarantined) {
      video.playbackRate = rate
      return
    }

    const frameMs = 1000 / coverage.segment.fps
    const tolerance = SYNC_TOLERANCE_MS[this.source.sync_quality]
    const lockLimit = Math.max(frameMs, Number.isFinite(tolerance) ? tolerance : frameMs)
    const exitLimit = lockLimit * 1.5
    const hardLimit = Math.max(350, frameMs * 4, lockLimit * 2)
    const absError = Math.abs(errorMs)

    if (absError > hardLimit) {
      if (!video.seeking && now - this.lastSeek > SEEK_SUPPRESS_MS) {
        this.hardSeek(target + frameMs / 2000)
        this.recordSeek(now)
      }
      return
    }

    /* Hysteresis: leaving locked costs more than entering it, so the controller
       cannot chatter across the boundary. */
    if (this.locked ? absError > exitLimit : absError > lockLimit) {
      this.locked = false
      if (now - this.lastNudge > NUDGE_INTERVAL_MS) {
        this.lastNudge = now
        const trim = Math.max(-NUDGE_CLAMP, Math.min(NUDGE_CLAMP, -errorMs / NUDGE_K_MS))
        video.playbackRate = Math.max(0.06, rate * (1 + trim))
      }
      return
    }

    this.locked = true
    if (video.playbackRate !== rate) video.playbackRate = rate
  }

  private hardSeek(seconds: number) {
    this.lastSeek = performance.now()
    try {
      this.video.currentTime = Math.max(0, seconds)
    } catch {
      /* a seek before metadata is ready is retried on the next tick */
    }
  }

  private recordSeek(now: number) {
    this.seekTimes.push(now)
    this.seekTimes = this.seekTimes.filter((t) => now - t < QUARANTINE_WINDOW_MS)
    if (this.seekTimes.length >= QUARANTINE_SEEKS && !this.quarantined) {
      this.quarantined = true
      this.callbacks.onDesync(true)
    }
  }

  /** Explicit stepping while paused: land exactly, no soft correction. */
  seekToMaster(tMaster: number) {
    const coverage = coverageAt(this.source, tMaster)
    if (coverage.state !== 'covered') return
    if (coverage.index !== this.currentIndex) {
      this.currentIndex = coverage.index
      this.video.src = coverage.segment.uri
      this.callbacks.onSegmentChange(coverage.index)
    }
    this.hardSeek(coverage.localSec)
  }

  mediaTime(tMaster: number): number {
    return mediaTimeOf(this.source, tMaster)
  }
}
