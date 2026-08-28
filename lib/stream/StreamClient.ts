'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { IncidentSummary, PreAlert, PriorityBand, StreamEvent, StreamTopic } from '@/lib/api/schemas'
import { PreAlertSchema, STREAM_EVENT_TYPES, StreamEventSchema } from '@/lib/api/schemas'
import { qk } from '@/lib/api/keys'
import { API_BASE } from '@/lib/env'

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline'

/**
 * The one live connection.
 *
 * Three rules keep it from becoming the thing that melts the app:
 *   - nothing above 2Hz is allowed into the query cache; patrol positions,
 *     source health and spend land in listeners the map and status strip read
 *     imperatively.
 *   - list invalidations coalesce on a 250ms trailing timer, so a burst of two
 *     hundred events is one refetch, not two hundred.
 *   - single-entity updates are patched with setQueryData, not invalidated, so
 *     an acknowledgement does not cost a round trip.
 */
export class StreamClient {
  private source: EventSource | null = null
  private refCount = 0
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private stateListeners = new Set<(s: ConnectionState) => void>()
  private eventListeners = new Set<(e: StreamEvent) => void>()
  private preAlertListeners = new Set<(list: PreAlert[]) => void>()
  private countsListeners = new Set<(c: Record<PriorityBand, number>) => void>()

  private preAlerts: PreAlert[] = []
  private counts: Record<PriorityBand, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
  private state: ConnectionState = 'offline'

  constructor(
    private qc: QueryClient,
    private topics: StreamTopic[],
  ) {}

  getState(): ConnectionState {
    return this.state
  }

  getPreAlerts(): PreAlert[] {
    return this.preAlerts
  }

  getCounts(): Record<PriorityBand, number> {
    return this.counts
  }

  /** Reference counted so React strict mode's double effect does not open two. */
  connect(): () => void {
    this.refCount += 1
    if (this.refCount === 1) {
      this.open()
      void this.hydratePreAlerts()
    }
    return () => {
      this.refCount -= 1
      if (this.refCount === 0) this.close()
    }
  }

  /**
   * Alerts raised before this console connected.
   *
   * The stream only carries what happens from now on, and an operator arriving
   * at a screen mid-event needs to see the banner that is already live rather
   * than wait for the next one.
   */
  private async hydratePreAlerts(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/pre-alerts`, { cache: 'no-store' })
      if (!response.ok) return
      const body = (await response.json()) as { items?: unknown }
      const parsed = PreAlertSchema.array().safeParse(body.items ?? [])
      if (!parsed.success || parsed.data.length === 0) return
      const known = new Set(this.preAlerts.map((p) => p.pre_alert_id))
      this.preAlerts = [...this.preAlerts, ...parsed.data.filter((p) => !known.has(p.pre_alert_id))].slice(0, 4)
      this.emitPreAlerts()
    } catch {
      /* The banner is an enhancement over the stream, not a dependency of it. */
    }
  }

  onState(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn)
    fn(this.state)
    return () => this.stateListeners.delete(fn)
  }

  onEvent(fn: (e: StreamEvent) => void): () => void {
    this.eventListeners.add(fn)
    return () => this.eventListeners.delete(fn)
  }

  onPreAlerts(fn: (list: PreAlert[]) => void): () => void {
    this.preAlertListeners.add(fn)
    fn(this.preAlerts)
    return () => this.preAlertListeners.delete(fn)
  }

  onCounts(fn: (c: Record<PriorityBand, number>) => void): () => void {
    this.countsListeners.add(fn)
    fn(this.counts)
    return () => this.countsListeners.delete(fn)
  }

  private setState(s: ConnectionState) {
    if (this.state === s) return
    this.state = s
    for (const fn of this.stateListeners) fn(s)
  }

  private open() {
    if (typeof window === 'undefined') return
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const url = `${API_BASE}/stream?topics=${this.topics.join(',')}`
    const source = new EventSource(url)
    this.source = source

    source.onopen = () => {
      this.attempt = 0
      this.setState('live')
    }

    /* Every frame the bus writes carries a named `event:` field, and onmessage
       only fires for frames without one. Listening on onmessage alone meant the
       console held an open connection that delivered nothing: no incident
       updates, no counts, no pre-alerts. Each name is attached explicitly, and
       onmessage stays as the fallback for an unnamed frame. */
    for (const type of STREAM_EVENT_TYPES) {
      source.addEventListener(type, (message) => this.handleRaw((message as MessageEvent<string>).data))
    }
    source.onmessage = (message) => this.handleRaw(message.data)

    source.onerror = () => {
      source.close()
      this.source = null
      if (this.refCount === 0) return
      this.setState('reconnecting')
      /* EventSource retries on its own, but only for transport errors. An
         explicit backoff covers the server being down entirely. */
      const delay = Math.min(15_000, 500 * 2 ** this.attempt)
      this.attempt += 1
      if (this.attempt > 6) this.setState('offline')
      this.reconnectTimer = setTimeout(() => this.open(), delay)
    }
  }

  private close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.source?.close()
    this.source = null
    this.setState('offline')
  }

  private handleRaw(data: string) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    const parsed = StreamEventSchema.safeParse(payload)
    if (!parsed.success) return
    this.dispatch(parsed.data)
  }

  private dispatch(event: StreamEvent) {
    for (const fn of this.eventListeners) fn(event)

    switch (event.type) {
      case 'incident.created':
        this.markDirty(qk.incidents.lists())
        break
      case 'incident.updated':
        this.patchIncident(event.payload)
        break
      case 'pre_alert.raised':
        this.preAlerts = [event.payload, ...this.preAlerts.filter((p) => p.pre_alert_id !== event.payload.pre_alert_id)].slice(0, 4)
        this.emitPreAlerts()
        break
      case 'pre_alert.cleared':
        this.preAlerts = this.preAlerts.filter((p) => p.pre_alert_id !== event.payload.pre_alert_id)
        this.emitPreAlerts()
        break
      case 'warning.raised':
        this.markDirty(qk.warnings.all())
        break
      case 'counts':
        this.counts = { ...this.counts, ...event.payload }
        for (const fn of this.countsListeners) fn(this.counts)
        break
      case 'source.health':
      case 'patrol.position':
      case 'spend.tick':
        /* Above 2Hz or map-only: consumed through onEvent, never cached. */
        break
    }
  }

  private emitPreAlerts() {
    for (const fn of this.preAlertListeners) fn(this.preAlerts)
  }

  /** Surgical patch: update the detail entry and every list page holding it. */
  private patchIncident(incident: IncidentSummary) {
    this.qc.setQueryData(qk.incidents.detail(incident.incident_id), incident)
    this.qc.setQueriesData<{ pages: { items: IncidentSummary[] }[] } | undefined>(
      { queryKey: qk.incidents.lists() },
      (old) => {
        if (!old?.pages) return old
        let touched = false
        const pages = old.pages.map((p) => {
          if (!p.items.some((i) => i.incident_id === incident.incident_id)) return p
          touched = true
          return { ...p, items: p.items.map((i) => (i.incident_id === incident.incident_id ? incident : i)) }
        })
        return touched ? { ...old, pages } : old
      },
    )
  }

  private markDirty(key: readonly unknown[]) {
    this.dirty.add(JSON.stringify(key))
    if (this.dirty.size > 50) {
      this.flush()
      return
    }
    this.flushTimer ??= setTimeout(() => this.flush(), 250)
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const serialized of this.dirty) {
      this.qc.invalidateQueries({ queryKey: JSON.parse(serialized) as unknown[], refetchType: 'active' })
    }
    this.dirty.clear()
  }
}
