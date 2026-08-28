'use client'

import { Glyph } from '@/components/glyphs'
import type { PreAlert } from '@/lib/api/schemas'
import { DOMAIN_GLYPH } from '@/lib/tokens'
import { fmtTime } from '@/lib/format'
import { useNow } from '@/lib/useNow'

/**
 * Life-safety pre-alerts arrive from the deterministic edge rules before any
 * model has looked at the scene, so they are rendered before any of it: a single
 * strip with the elapsed milliseconds from trigger, which is the number the
 * three second budget is measured against. When the package lands, it replaces
 * this in place rather than stacking a second alert.
 */
export function PreAlertBanner({ alerts, onOpen }: { alerts: PreAlert[]; onOpen: (alert: PreAlert) => void }) {
  const now = useNow(500)

  if (alerts.length === 0 || now === null) return null

  return (
    <div className="flex flex-none flex-col">
      {alerts.slice(0, 2).map((alert) => {
        const sinceMs = now - alert.detected_at
        return (
          <div
            key={alert.pre_alert_id}
            role="alert"
            className="flex items-center gap-3 border-b px-3 py-1.5"
            style={{ background: 'rgba(248,81,73,0.10)', borderColor: 'var(--critical)' }}
          >
            <span className="blink-critical" style={{ color: 'var(--critical)' }}>
              <Glyph name="pre-alert" size={16} />
            </span>
            <span className="mono text-[11px]" style={{ color: 'var(--critical)' }}>
              PRE-ALERT
            </span>
            <span style={{ color: 'var(--critical)' }}>
              <Glyph name={DOMAIN_GLYPH[alert.domain]} size={14} />
            </span>
            <span className="truncate text-[12.5px] text-[var(--ink-0)]">
              {alert.headline}, {alert.zone_label}
            </span>
            <span className="mono text-[11px] text-[var(--ink-2)]">
              trigger {alert.trigger} · edge {alert.elapsed_ms} ms · {fmtTime(alert.detected_at, { ms: false })} ·{' '}
              {alert.corroborating_sources} corroborating
            </span>
            <span className="mono ml-auto text-[12.5px]" style={{ color: sinceMs > 5000 ? 'var(--critical)' : 'var(--ink-1)' }}>
              +{(sinceMs / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={() => onOpen(alert)}
              className="mono step border px-2 py-0.5 text-[12.5px]"
              style={{ borderColor: 'var(--critical)', color: 'var(--critical)', borderRadius: 'var(--radius-chip)' }}
            >
              open
            </button>
          </div>
        )
      })}
    </div>
  )
}
