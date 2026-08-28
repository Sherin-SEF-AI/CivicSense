'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/resources'
import { qk } from '@/lib/api/keys'
import { useUi } from '@/lib/stores/ui'
import { Glyph } from '@/components/glyphs/Glyph'
import { fmtDateTime } from '@/lib/format'
import { DomainGlyph } from '@/components/primitives/indicators'
import type { Playbook, PriorityBand } from '@/lib/api/schemas'

const BANDS: PriorityBand[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
type Step = Playbook['steps'][number]

/**
 * The playbook editor.
 *
 * A playbook is what the platform will do without being asked, so every edit is
 * versioned and the version is what an incident record cites. Two rules are
 * enforced here rather than left to the person editing: an automatic step that
 * is punitive or physical keeps its approval gate, and removing the last step
 * leaves a playbook that would route an incident nowhere.
 */
export function PlaybookEditor({ playbook, onClose }: { playbook: Playbook; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const [name, setName] = useState(playbook.name)
  const [minPriority, setMinPriority] = useState<PriorityBand>(playbook.min_priority)
  const [steps, setSteps] = useState<Step[]>(playbook.steps)

  const dirty =
    name !== playbook.name ||
    minPriority !== playbook.min_priority ||
    JSON.stringify(steps) !== JSON.stringify(playbook.steps)

  const save = useMutation({
    mutationFn: () => api.updatePlaybook(playbook.playbook_id, { name, min_priority: minPriority, steps }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: qk.admin.all() })
      toast({ tone: 'ok', text: `${updated.name} saved as version ${updated.version}` })
      onClose()
    },
    onError: (error: unknown) => {
      toast({ tone: 'error', text: `playbook not saved: ${error instanceof Error ? error.message : String(error)}` })
    },
  })

  const patch = (index: number, change: Partial<Step>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...change } : step)))

  const move = (index: number, delta: number) =>
    setSteps((current) => {
      const next = [...current]
      const target = index + delta
      const a = next[index]
      const b = next[target]
      if (!a || !b) return current
      next[index] = b
      next[target] = a
      return next
    })

  const remove = (index: number) => setSteps((current) => current.filter((_, i) => i !== index))

  const add = () =>
    setSteps((current) => [
      ...current,
      {
        step_id: `STEP-${playbook.playbook_id}-${current.length + 1}-${Date.now().toString(36)}`,
        text: '',
        owner: playbook.domain,
        timer_s: null,
        automatic: false,
        approval_gate: false,
      },
    ])

  const blocked = steps.length === 0 || steps.some((s) => s.text.trim() === '')

  return (
    <section
      className="border bg-[var(--bg-1)] p-3"
      style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--live)' }}
    >
      <div className="flex items-center gap-2">
        <Glyph name="playbook" size={14} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="playbook name"
          className="border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[13px] text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
        <DomainGlyph domain={playbook.domain} size={12} />
        <label className="mono flex items-center gap-1 text-[11px] text-[var(--ink-3)]">
          runs from
          <select
            value={minPriority}
            onChange={(e) => setMinPriority(e.target.value as PriorityBand)}
            aria-label="minimum priority"
            className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-1.5 py-0.5 text-[11px] text-[var(--ink-0)]"
            style={{ borderRadius: 'var(--radius-chip)' }}
          >
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          version {playbook.version} · updated {fmtDateTime(playbook.updated_at)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="mono step ml-auto border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          close
        </button>
      </div>

      <ol className="mt-2 flex flex-col">
        {steps.map((step, i) => (
          <li key={step.step_id} className="flex flex-col gap-1 border-b border-[var(--line-0)] py-2 last:border-b-0">
            <div className="flex items-center gap-2">
              <span className="mono w-[20px] flex-none text-[11px] text-[var(--ink-3)]">{i + 1}</span>
              <input
                value={step.text}
                onChange={(e) => patch(i, { text: e.target.value })}
                aria-label={`step ${i + 1} text`}
                placeholder="what happens at this step"
                className="min-w-0 flex-1 border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-1)]"
                style={{ borderRadius: 'var(--radius-chip)' }}
              />
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`move step ${i + 1} earlier`}
                className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)] disabled:opacity-30"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                up
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                aria-label={`move step ${i + 1} later`}
                className="mono step border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)] disabled:opacity-30"
                style={{ borderRadius: 'var(--radius-chip)' }}
              >
                down
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`remove step ${i + 1}`}
                className="mono step border px-1.5 py-0.5 text-[11px]"
                style={{ borderRadius: 'var(--radius-chip)', borderColor: 'var(--line-1)', color: 'var(--high)' }}
              >
                remove
              </button>
            </div>
            <div className="mono flex flex-wrap items-center gap-3 pl-[28px] text-[11px]">
              <label className="flex items-center gap-1 text-[var(--ink-2)]">
                owner
                <input
                  value={step.owner}
                  onChange={(e) => patch(i, { owner: e.target.value })}
                  aria-label={`step ${i + 1} owner`}
                  className="mono w-[140px] border border-[var(--line-1)] bg-[var(--bg-0)] px-1.5 py-0.5 text-[11px] text-[var(--ink-0)]"
                  style={{ borderRadius: 'var(--radius-chip)' }}
                />
              </label>
              <label className="flex items-center gap-1 text-[var(--ink-2)]">
                timer seconds
                <input
                  type="number"
                  min={0}
                  value={step.timer_s ?? ''}
                  placeholder="none"
                  onChange={(e) => patch(i, { timer_s: e.target.value === '' ? null : Number(e.target.value) })}
                  aria-label={`step ${i + 1} timer in seconds`}
                  className="mono w-[80px] border border-[var(--line-1)] bg-[var(--bg-0)] px-1.5 py-0.5 text-[11px] text-[var(--ink-0)]"
                  style={{ borderRadius: 'var(--radius-chip)' }}
                />
              </label>
              <label className="flex items-center gap-1 text-[var(--ink-2)]">
                <input
                  type="checkbox"
                  checked={step.automatic}
                  onChange={(e) => patch(i, { automatic: e.target.checked })}
                  aria-label={`step ${i + 1} runs automatically`}
                />
                automatic
              </label>
              <label className="flex items-center gap-1 text-[var(--ink-2)]">
                <input
                  type="checkbox"
                  checked={step.approval_gate}
                  onChange={(e) => patch(i, { approval_gate: e.target.checked })}
                  aria-label={`step ${i + 1} needs approval`}
                />
                approval gate
              </label>
              {step.automatic && !step.approval_gate ? (
                <span style={{ color: 'var(--medium)' }}>
                  runs with no person in the loop, check that it cannot penalise anyone
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={add}
          className="mono step border border-[var(--line-1)] px-2 py-1 text-[12.5px] text-[var(--ink-1)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          add step
        </button>
        <button
          type="button"
          disabled={!dirty || blocked || save.isPending}
          onClick={() => save.mutate()}
          className="mono step border px-2 py-1 text-[12.5px] disabled:opacity-40"
          style={{
            borderRadius: 'var(--radius-chip)',
            borderColor: dirty && !blocked ? 'var(--live)' : 'var(--line-1)',
            color: dirty && !blocked ? 'var(--live)' : 'var(--ink-3)',
          }}
        >
          {save.isPending ? 'saving' : `save as version ${playbook.version + 1}`}
        </button>
        {blocked ? (
          <span className="mono text-[11px]" style={{ color: 'var(--medium)' }}>
            {steps.length === 0 ? 'a playbook with no steps would route nothing' : 'every step needs text'}
          </span>
        ) : null}
      </div>
    </section>
  )
}
