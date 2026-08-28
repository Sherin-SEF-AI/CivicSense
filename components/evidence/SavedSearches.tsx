'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/resources'
import { qk } from '@/lib/api/keys'
import { useUi } from '@/lib/stores/ui'
import { Glyph } from '@/components/glyphs'
import { Overline } from '@/components/primitives/chips'
import { errorDetail } from '@/lib/api/client'
import { fmtDate } from '@/lib/format'

/**
 * Standing searches.
 *
 * The counter is the point. A saved search that only re-runs when someone opens
 * the screen is a bookmark, so these are evaluated against every observation as
 * it arrives and the new hit count is what an investigator comes back to.
 */
export function SavedSearches({ onRun }: { onRun: (query: string) => void }) {
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const query = useQuery({ queryKey: qk.savedSearches.all(), queryFn: ({ signal }) => api.savedSearches(signal) })

  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.savedSearches.all() })

  const toggle = useMutation({
    mutationFn: (input: { id: string; rerun: boolean }) =>
      api.updateSavedSearch(input.id, { rerun_on_new_evidence: input.rerun }),
    onSuccess: invalidate,
    onError: (error) => toast({ tone: 'error', text: 'could not update the search', detail: errorDetail(error) }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSavedSearch(id),
    onSuccess: invalidate,
    onError: (error) => toast({ tone: 'error', text: 'could not delete the search', detail: errorDetail(error) }),
  })

  const items = query.data?.items ?? []
  if (items.length === 0) return null

  return (
    <div className="mt-4 flex flex-col gap-1">
      <Overline>standing searches</Overline>
      <p className="mono mb-1 text-[11px] text-[var(--ink-3)]">
        each of these is evaluated against evidence as it arrives. the count is what has matched since you last ran it.
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((search) => (
          <li
            key={search.saved_search_id}
            className="flex items-center gap-2 border border-[var(--line-0)] bg-[var(--bg-1)] px-2 py-1.5"
            style={{ borderRadius: 'var(--radius-card)' }}
          >
            <Glyph name="pin" size={12} />
            <button
              type="button"
              onClick={() => onRun(search.query)}
              className="min-w-0 flex-1 truncate text-left text-[12.5px] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
              title={search.query}
            >
              {search.name}
            </button>
            {search.new_hits > 0 ? (
              <span
                className="mono flex-none border px-1.5 py-0.5 text-[11px]"
                style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--live)', color: 'var(--live)' }}
              >
                {search.new_hits} new
              </span>
            ) : (
              <span className="mono flex-none text-[11px] text-[var(--ink-3)]">nothing new</span>
            )}
            <span className="mono flex-none text-[11px] text-[var(--ink-3)]">saved {fmtDate(search.created_at)}</span>
            <label className="mono flex flex-none items-center gap-1 text-[11px] text-[var(--ink-2)]">
              <input
                type="checkbox"
                checked={search.rerun_on_new_evidence}
                onChange={(e) => toggle.mutate({ id: search.saved_search_id, rerun: e.target.checked })}
                aria-label={`re-run ${search.name} on new evidence`}
              />
              re-run
            </label>
            <button
              type="button"
              onClick={() => remove.mutate(search.saved_search_id)}
              aria-label={`delete ${search.name}`}
              className="mono step flex-none border px-1.5 py-0.5 text-[11px]"
              style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--line-1)', color: 'var(--high)' }}
            >
              delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
