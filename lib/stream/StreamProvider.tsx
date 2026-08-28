'use client'

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { STREAM_TOPICS, type PreAlert, type PriorityBand, type StreamEvent } from '@/lib/api/schemas'
import { StreamClient, type ConnectionState } from './StreamClient'

const StreamContext = createContext<StreamClient | null>(null)

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const client = useMemo(() => new StreamClient(qc, [...STREAM_TOPICS]), [qc])

  useEffect(() => client.connect(), [client])

  return <StreamContext.Provider value={client}>{children}</StreamContext.Provider>
}

export function useStream(): StreamClient {
  const client = useContext(StreamContext)
  if (!client) throw new Error('useStream must be used inside StreamProvider')
  return client
}

export function useConnectionState(): ConnectionState {
  const client = useStream()
  return useSyncExternalStore(
    (cb) => client.onState(() => cb()),
    () => client.getState(),
    () => 'connecting' as const,
  )
}

export function usePreAlerts(): PreAlert[] {
  const client = useStream()
  return useSyncExternalStore(
    (cb) => client.onPreAlerts(() => cb()),
    () => client.getPreAlerts(),
    () => EMPTY_PRE_ALERTS,
  )
}

const EMPTY_PRE_ALERTS: PreAlert[] = []

export function useLiveCounts(): Record<PriorityBand, number> {
  const client = useStream()
  return useSyncExternalStore(
    (cb) => client.onCounts(() => cb()),
    () => client.getCounts(),
    () => EMPTY_COUNTS,
  )
}

const EMPTY_COUNTS: Record<PriorityBand, number> = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFO: 0,
}

/** Subscribe to raw events. Used by the map and the status strip, never for cache writes. */
export function useStreamEvents(handler: (event: StreamEvent) => void): void {
  const client = useStream()
  useEffect(() => client.onEvent(handler), [client, handler])
}
