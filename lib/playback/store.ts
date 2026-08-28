'use client'

import { create } from 'zustand'
import type { PlaybackRate } from './frames'

export type TileSlot = 0 | 1 | 2 | 3

/**
 * Only discrete transport state lives here. The clock itself is deliberately
 * outside React: writing t into a store at 60Hz would notify every subscribed
 * component sixty times a second, which is the exact failure this design exists
 * to avoid.
 */
interface TransportState {
  playing: boolean
  rate: PlaybackRate
  focusedSourceId: string | null
  /** Sources shown on the stage, up to four. */
  tiles: string[]
  /** Range selected on the deck, drives export and re-analysis. */
  selection: [number, number] | null
  /** Per-source measured drift, written at 2Hz for the sync badges. */
  drift: Record<string, number>
  desynced: Record<string, boolean>
  annotations: boolean
  measuring: boolean

  setPlaying: (playing: boolean) => void
  setRate: (rate: PlaybackRate) => void
  focus: (sourceId: string | null) => void
  setTiles: (tiles: string[]) => void
  toggleTile: (sourceId: string) => void
  setSelection: (range: [number, number] | null) => void
  reportDrift: (sourceId: string, ms: number) => void
  markDesynced: (sourceId: string, desynced: boolean) => void
  setAnnotations: (on: boolean) => void
  setMeasuring: (on: boolean) => void
  reset: () => void
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  rate: 1,
  focusedSourceId: null,
  tiles: [],
  selection: null,
  drift: {},
  desynced: {},
  annotations: true,
  measuring: false,

  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  focus: (focusedSourceId) => set({ focusedSourceId }),
  setTiles: (tiles) => set({ tiles: tiles.slice(0, 4) }),
  toggleTile: (sourceId) =>
    set((s) => {
      if (s.tiles.includes(sourceId)) {
        const tiles = s.tiles.filter((id) => id !== sourceId)
        return { tiles, focusedSourceId: s.focusedSourceId === sourceId ? (tiles[0] ?? null) : s.focusedSourceId }
      }
      if (s.tiles.length >= 4) return s
      return { tiles: [...s.tiles, sourceId] }
    }),
  setSelection: (selection) => set({ selection }),
  reportDrift: (sourceId, ms) => set((s) => ({ drift: { ...s.drift, [sourceId]: ms } })),
  markDesynced: (sourceId, desynced) => set((s) => ({ desynced: { ...s.desynced, [sourceId]: desynced } })),
  setAnnotations: (annotations) => set({ annotations }),
  setMeasuring: (measuring) => set({ measuring }),
  reset: () =>
    set({
      playing: false,
      rate: 1,
      focusedSourceId: null,
      tiles: [],
      selection: null,
      drift: {},
      desynced: {},
      measuring: false,
    }),
}))
