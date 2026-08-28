import type { NextRequest } from 'next/server'
import { STREAM_TOPICS, type StreamTopic } from '@/lib/api/schemas'
import { bus } from '@/lib/events/bus'
import { countsByBand } from '@/lib/store/incidents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The single live connection.
 *
 * Everything the console needs to stay current arrives here, and only when a row
 * actually changed. Named events plus a redundant type field in the payload: the
 * name lets a consumer attach a targeted listener, the type keeps the payload a
 * self-describing discriminated union for the router.
 */
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('topics')
  const topics: StreamTopic[] = requested
    ? requested.split(',').filter((t): t is StreamTopic => (STREAM_TOPICS as readonly string[]).includes(t))
    : [...STREAM_TOPICS]

  const encoder = new TextEncoder()
  const b = bus()
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
          /* the runtime may have closed it already */
        }
      }

      clientId = b.attach(topics, req.headers.get('last-event-id'), send, close)

      /* Seed the connection with the current counts so a fresh client is not
         blank until something happens. */
      send(
        `id: 0\nevent: counts\ndata: ${JSON.stringify({ type: 'counts', ts: Date.now(), payload: countsByBand() })}\n\n`,
      )

      req.signal.addEventListener('abort', () => {
        b.detach(clientId)
        close()
      })
    },
    cancel() {
      b.detach(clientId)
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
