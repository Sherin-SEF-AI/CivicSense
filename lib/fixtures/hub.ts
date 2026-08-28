import 'server-only'
import type { StreamEvent, StreamTopic } from '@/lib/api/schemas'
import { TOPIC_OF } from '@/lib/api/schemas/stream'

/**
 * The SSE hub.
 *
 * One process-wide fan-out with a replay buffer. The buffer is what makes a two
 * second network blip survivable: the browser sends Last-Event-ID on reconnect
 * and gets everything it missed, so an acknowledgement raised while the
 * connection was down does not leave the UI showing stale state.
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

class Hub {
  private clients = new Map<number, Client>()
  private ring: Framed[] = []
  private nextId = 1
  private nextClientId = 1
  private onFirstClient?: () => void
  private onLastClient?: () => void

  setLifecycle(onFirst: () => void, onLast: () => void) {
    this.onFirstClient = onFirst
    this.onLastClient = onLast
  }

  get clientCount(): number {
    return this.clients.size
  }

  attach(topics: StreamTopic[], lastEventId: string | null, send: (chunk: string) => void, close: () => void): number {
    const id = this.nextClientId++
    const client: Client = { id, topics: new Set(topics), send, close }
    this.clients.set(id, client)

    send('retry: 3000\n\n')

    const from = lastEventId === null ? null : Number.parseInt(lastEventId, 10)
    if (from !== null && Number.isFinite(from)) {
      for (const framed of this.ring) {
        if (framed.id > from && client.topics.has(TOPIC_OF[framed.event.type])) {
          send(frame(framed))
        }
      }
    }

    if (this.clients.size === 1) this.onFirstClient?.()
    return id
  }

  detach(id: number) {
    this.clients.delete(id)
    if (this.clients.size === 0) this.onLastClient?.()
  }

  publish(event: StreamEvent) {
    const framed: Framed = { id: this.nextId++, event }
    this.ring.push(framed)
    if (this.ring.length > RING_SIZE) this.ring.shift()
    const topic = TOPIC_OF[event.type]
    const chunk = frame(framed)
    for (const client of this.clients.values()) {
      if (!client.topics.has(topic)) continue
      try {
        client.send(chunk)
      } catch {
        this.detach(client.id)
      }
    }
  }

  /** Comment frames keep proxies from closing an idle connection. */
  heartbeat() {
    for (const client of this.clients.values()) {
      try {
        client.send(': hb\n\n')
      } catch {
        this.detach(client.id)
      }
    }
  }

  closeAll() {
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
  }
}

function frame(framed: Framed): string {
  return `id: ${framed.id}\nevent: ${framed.event.type}\ndata: ${JSON.stringify(framed.event)}\n\n`
}

const KEY = '__civicsense_hub__'

interface GlobalWithHub {
  [KEY]?: Hub
}

export function getHub(): Hub {
  const g = globalThis as GlobalWithHub
  if (!g[KEY]) g[KEY] = new Hub()
  return g[KEY]
}

export type { Hub }
