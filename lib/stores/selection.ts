'use client'

import { create } from 'zustand'

/**
 * What the operator is looking at. Kept separate from filters and viewport
 * because selection changes on every arrow key and the other two do not.
 */
interface SelectionState {
  incidentId: string | null
  select: (id: string | null) => void

  hoverIncidentId: string | null
  hover: (id: string | null) => void

  /** The case that scopes evidence search and the investigation flag. */
  activeCaseId: string | null
  setActiveCase: (id: string | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  incidentId: null,
  select: (incidentId) => set({ incidentId }),
  hoverIncidentId: null,
  hover: (hoverIncidentId) => set({ hoverIncidentId }),
  activeCaseId: null,
  setActiveCase: (activeCaseId) => set({ activeCaseId }),
}))
