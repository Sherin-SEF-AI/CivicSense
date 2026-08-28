import type { NextRequest } from 'next/server'
import { STREAM_TOPICS, type StreamTopic } from '@/lib/api/schemas'
import { IS_FIXTURES } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The single SSE connection everything multiplexes over.
 *
 * Named events plus a redundant type field in the payload: the name lets a
 * consumer attach a targeted listener, the type keeps the payload a
 * self-describing discriminated union for the router. Last-Event-ID replay is
 * served from the hub's ring buffer so a short network drop does not lose an
 * acknowledgement and leave the console showing stale state.
 */
export async function GET(req: NextRequest) {
  if (!IS_FIXTURES) return new Response('not found', { status: 404 })

  const { getHub } = await import('@/lib/fixtures/hub')
  const { startTicker, scheduleStop } = await import('@/lib/fixtures/ticker')
  const { getWorld, countsByBand } = await import('@/lib/fixtures/world')

  const requested = req.nextUrl.searchParams.get('topics')
  const topics: StreamTopic[] = requested
    ? (requested.split(',').filter((t): t is StreamTopic => (STREAM_TOPICS as readonly string[]).includes(t)))
    : [...STREAM_TOPICS]

  const hub = getHub()
  const encoder = new TextEncoder()
  let clientId = -1

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (chunk: string) => {
        if (closed) return
        controller.enqueue(encoder.encode(chunk))
      }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed by the runtime */
        }
      }

      clientId = hub.attach(topics, req.headers.get('last-event-id'), send, close)
      startTicker()

      /* Seed the connection so a fresh client is not blank until the first tick. */
      const w = getWorld()
      hub.publish({ type: 'counts', ts: Date.now(), payload: countsByBand(w) })

      req.signal.addEventListener('abort', () => {
        hub.detach(clientId)
        scheduleStop()
        close()
      })
    },
    cancel() {
      hub.detach(clientId)
      scheduleStop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
