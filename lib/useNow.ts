'use client'

import { useEffect, useState } from 'react'

/**
 * Wall time that only exists after mount.
 *
 * Anything derived from the clock differs between the server render and the
 * first client render, so this returns null until mounted and every caller
 * renders a placeholder for that one frame. It also keeps ages and countdowns
 * ticking, which a raw Date.now() in render would not.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
