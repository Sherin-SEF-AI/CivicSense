'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/resources'
import { qk } from '@/lib/api/keys'
import { useUi } from '@/lib/stores/ui'
import { Glyph } from '@/components/glyphs/Glyph'
import { Overline } from '@/components/primitives/chips'
import { fmtScore } from '@/lib/format'
import type { Zone } from '@/lib/api/schemas'

const KINDS: Zone['kind'][] = [
  'school',
  'hospital',
  'market',
  'residential',
  'industrial',
  'religious',
  'transit-hub',
  'highway',
]

/**
 * The zone profile editor.
 *
 * Kind and sensitivity are the two inputs the severity function reads from the
 * place a thing happened, so editing them changes how every future incident in
 * this ward scores. That is a consequential edit, and the panel says what will
 * change before it is saved rather than after.
 *
 * Boundaries are not editable here. They come from the OpenStreetMap import and
 * redrawing an administrative boundary in an operator console is not a thing
 * this platform should make easy.
 */
export function ZoneEditor({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useUi((s) => s.toast)
  const [label, setLabel] = useState(zone.label)
  const [kind, setKind] = useState<Zone['kind']>(zone.kind)
  const [sensitivity, setSensitivity] = useState(zone.sensitivity)

  const dirty = label !== zone.label || kind !== zone.kind || Math.abs(sensitivity - zone.sensitivity) > 1e-6

  const save = useMutation({
    mutationFn: () => api.updateZone({ zone_id: zone.zone_id, label, kind, sensitivity }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: qk.zones.all() })
      void qc.invalidateQueries({ queryKey: qk.admin.all() })
      toast({ tone: 'ok', text: `${updated.zone_id} saved, new incidents here will score against the updated profile` })
      onClose()
    },
    onError: (error: unknown) => {
      toast({ tone: 'error', text: `zone not saved: ${error instanceof Error ? error.message : String(error)}` })
    },
  })

  const shift = sensitivity - zone.sensitivity

  return (
    <div
      className="flex flex-col gap-2 border bg-[var(--bg-2)] p-2"
      style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--live)' }}
    >
      <div className="flex items-center gap-2">
        <Glyph name="zone" size={12} />
        <span className="mono text-[12.5px] text-[var(--ink-0)]">{zone.zone_id}</span>
        <button
          type="button"
          onClick={onClose}
          className="mono step ml-auto border border-[var(--line-1)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          close
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <Overline>label</Overline>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <Overline>kind</Overline>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Zone['kind'])}
          className="mono border border-[var(--line-1)] bg-[var(--bg-0)] px-2 py-1 text-[12.5px] text-[var(--ink-0)]"
          style={{ borderRadius: 'var(--radius-chip)' }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <Overline>sensitivity {fmtScore(sensitivity)}</Overline>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))}
          aria-label={`sensitivity for ${zone.label}`}
          className="w-full"
        />
      </label>

      {dirty ? (
        <p className="mono text-[11px] text-[var(--ink-2)]">
          {Math.abs(shift) < 0.005
            ? 'profile change only, scores in this zone keep their current weighting'
            : `severity in this zone shifts about ${shift > 0 ? 'up' : 'down'} ${Math.abs(shift * 100).toFixed(0)} percent for future incidents. scores already assigned are not rewritten.`}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          className="mono step border px-2 py-1 text-[12.5px] disabled:opacity-40"
          style={{
            borderRadius: 'var(--radius-chip)',
            borderColor: dirty ? 'var(--live)' : 'var(--line-1)',
            color: dirty ? 'var(--live)' : 'var(--ink-3)',
          }}
        >
          {save.isPending ? 'saving' : 'save profile'}
        </button>
        <span className="mono text-[11px] text-[var(--ink-3)]">
          {zone.polygon.length} boundary points from the import, not editable here
        </span>
      </div>
    </div>
  )
}
