import 'server-only'
import type { StreamEvent, StreamTopic } from '@/lib/api/schemas'
import { TOPIC_OF } from '@/lib/api/schemas/stream'

/**
 * The live event bus.
 *
 * Real changes only. Something is published here when a row actually changes: an
 * observation arrives, an incident is created or acted on, a source reports
 * health, spend accrues. Nothing is emitted on a timer to make the console look
 * busy.
 *
 * A ring buffer backs Last-Event-ID replay, so a short network drop does not
 * lose an acknowledgement and leave the console showing stale state.
 */

const RING_SIZE = 500

interface Client {
  id: number
  topics: Set<StreamTopic>
  send: (chunk: string) => void
  close: () => void
}

interface Framed {
  id: number
  event: StreamEvent
}

class Bus {
  private clients = new Map<number, Client>()
  private ring: Framed[] = []
  private nextEventId = 1
  private nextClientId = 1
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  get clientCount(): number {
    return this.clients.size
  }

  attach(topics: StreamTopic[], lastEventId: string | null, send: (chunk: string) => void, close: () => void): number {
    const id = this.nextClientId++
    this.clients.set(id, { id, topics: new Set(topics), send, close })
    send('retry: 3000\n\n')

    const from = lastEventId === null ? null : Number.parseInt(lastEventId, 10)
    if (from !== null && Number.isFinite(from)) {
      for (const framed of this.ring) {
        if (framed.id > from && this.clients.get(id)?.topics.has(TOPIC_OF[framed.event.type])) {
          send(frame(framed))
        }
      }
    }

    if (this.clients.size === 1) this.startHeartbeat()
    return id
  }

  detach(id: number): void {
    this.clients.delete(id)
    if (this.clients.size === 0) this.stopHeartbeat()
  }

  publish(event: StreamEvent): void {
    const framed: Framed = { id: this.nextEventId++, event }
    this.ring.push(framed)
    if (this.ring.length > RING_SIZE) this.ring.shift()

    const topic = TOPIC_OF[event.type]
    const chunk = frame(framed)
    for (const client of [...this.clients.values()]) {
      if (!client.topics.has(topic)) continue
      try {
        client.send(chunk)
      } catch {
        this.detach(client.id)
      }
    }
  }

  /** Comment frames, so an idle proxy does not close a quiet connection. */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      for (const client of [...this.clients.values()]) {
        try {
          client.send(': hb\n\n')
        } catch {
          this.detach(client.id)
        }
      }
    }, 15_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

function frame(framed: Framed): string {
  return `id: ${framed.id}\nevent: ${framed.event.type}\ndata: ${JSON.stringify(framed.event)}\n\n`
}

const KEY = '__civicsense_bus__'

interface GlobalWithBus {
  [KEY]?: Bus
}

export function bus(): Bus {
  const g = globalThis as GlobalWithBus
  if (!g[KEY]) g[KEY] = new Bus()
  return g[KEY]
}

export function publish(event: StreamEvent): void {
  bus().publish(event)
}
