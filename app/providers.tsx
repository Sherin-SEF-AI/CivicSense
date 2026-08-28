'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Server state defaults tuned for a control room: data is assumed fresh for
 * 10 seconds (the threshold at which the UI starts showing a "stale" tag rather
 * than a spinner), and refetch-on-focus is off because an operator tabbing back
 * should not trigger a storm across a dozen live panels. Invalidation is driven
 * by SSE instead.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: 0 },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
