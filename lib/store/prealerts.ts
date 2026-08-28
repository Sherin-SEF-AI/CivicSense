import 'server-only'
import { randomUUID } from 'node:crypto'
import { all, audit, get, run } from '@/lib/db'
import { publish } from '@/lib/events/bus'
import { zoneAt } from '@/lib/store/zones'
import type { SituationType } from '@/lib/config/situations'
import type { PreAlert } from '@/lib/api/schemas'

/**
 * Life-safety pre-alerts: dispatch first, understand second.
 *
 * For the situations the catalogue marks life_safety, waiting for the
 * understanding pass before telling anyone is the wrong trade. The deterministic
 * trigger is enough to get a crew moving, and being wrong about a fire costs an
 * unnecessary run while being slow about one costs something else entirely.
 *
 * So this fires on the edge trigger alone, before any media is hashed and before
 * any model is called. It carries elapsed_ms from the moment of detection, so
 * the console shows the operator how stale the alert already is rather than
 * implying it is instantaneous. The reasoning layer supersedes it later, and
 * that supersession is a visible event rather than a silent replacement.
 */

interface PreAlertRow {
  pre_alert_id: string
  incident_id: string | null
  domain: string
  trigger: string
  headline: string
  lat: number
  lon: number
  zone_label: string
  detected_at: number
  raised_at: number
  elapsed_ms: number
  corroborating: number
  superseded_at: number | null
}

function toPreAlert(row: PreAlertRow): PreAlert {
  return {
    pre_alert_id: row.pre_alert_id,
    incident_id: row.incident_id,
    domain: row.domain as PreAlert['domain'],
    trigger: row.trigger,
    headline: row.headline,
    position: { lat: row.lat, lon: row.lon },
    zone_label: row.zone_label,
    detected_at: row.detected_at,
    elapsed_ms: row.elapsed_ms,
    corroborating_sources: row.corroborating,
    superseded_by_package: row.superseded_at !== null,
  }
}

/**
 * Raises a pre-alert if the situation warrants one.
 *
 * Returns null for everything else, which is most things. A pre-alert that fires
 * on a parking violation trains operators to ignore the banner, and then it is
 * worth nothing on the day it matters.
 */
export function raisePreAlert(input: {
  situation: SituationType
  source_id: string
  detected_at: number
  lat: number | null
  lon: number | null
}): PreAlert | null {
  if (!input.situation.life_safety) return null
  if (input.lat === null || input.lon === null) return null

  const now = Date.now()
  const zone = zoneAt(input.lat, input.lon)

  /* A second device already reporting the same situation nearby inside the
     window is corroboration, and the banner says so. */
  const corroborating = get<{ n: number }>(
    `SELECT COUNT(DISTINCT source_id) AS n FROM pre_alerts
     WHERE trigger = ? AND superseded_at IS NULL AND detected_at > ?`,
    [input.situation.trigger, now - 120_000],
  )
  const nearby = get<{ pre_alert_id: string; source_id: string }>(
    `SELECT pre_alert_id, source_id FROM pre_alerts
     WHERE trigger = ? AND superseded_at IS NULL AND detected_at > ?
       AND ABS(lat - ?) < 0.003 AND ABS(lon - ?) < 0.003
     ORDER BY raised_at DESC LIMIT 1`,
    [input.situation.trigger, now - 120_000, input.lat, input.lon],
  )

  /* The same event seen twice raises one alert with a higher corroboration
     count, not two banners competing for the same screen. */
  if (nearby) {
    if (nearby.source_id !== input.source_id) {
      run('UPDATE pre_alerts SET corroborating = corroborating + 1 WHERE pre_alert_id = ?', [nearby.pre_alert_id])
    }
    const row = get<PreAlertRow>('SELECT * FROM pre_alerts WHERE pre_alert_id = ?', [nearby.pre_alert_id])
    if (!row) return null
    const alert = toPreAlert(row)
    publish({ type: 'pre_alert.raised', ts: now, payload: alert })
    return alert
  }

  const id = `PA-${randomUUID().slice(0, 8).toUpperCase()}`
  const alert: PreAlert = {
    pre_alert_id: id,
    incident_id: null,
    domain: input.situation.domain,
    trigger: input.situation.trigger,
    headline: `${input.situation.title} at ${zone?.label ?? 'an unmapped location'}`,
    position: { lat: input.lat, lon: input.lon },
    zone_label: zone?.label ?? 'outside any configured zone',
    detected_at: input.detected_at,
    elapsed_ms: Math.max(0, now - input.detected_at),
    corroborating_sources: Math.max(1, corroborating?.n ?? 1),
    superseded_by_package: false,
  }

  run(
    `INSERT INTO pre_alerts
       (pre_alert_id, incident_id, source_id, domain, trigger, headline, lat, lon, zone_label,
        detected_at, raised_at, elapsed_ms, corroborating)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, null, input.source_id, alert.domain, alert.trigger, alert.headline, alert.position.lat, alert.position.lon,
      alert.zone_label, alert.detected_at, now, alert.elapsed_ms, alert.corroborating_sources,
    ],
  )
  audit('edge', 'pre_alert.raised', id, `${input.situation.key} from ${input.source_id} in ${alert.elapsed_ms} ms`)
  publish({ type: 'pre_alert.raised', ts: now, payload: alert })
  return alert
}

/** Binds the alert to the incident the fusion step formed from the same trigger. */
export function bindPreAlert(preAlertId: string, incidentId: string): void {
  run('UPDATE pre_alerts SET incident_id = ? WHERE pre_alert_id = ?', [incidentId, preAlertId])
}

/**
 * Clears the alert once a package exists.
 *
 * This is what makes the banner honest: it disappears because something replaced
 * it, and the audit trail records which package did.
 */
export function supersedePreAlert(incidentId: string): void {
  const rows = all<{ pre_alert_id: string }>(
    'SELECT pre_alert_id FROM pre_alerts WHERE incident_id = ? AND superseded_at IS NULL',
    [incidentId],
  )
  for (const row of rows) {
    run('UPDATE pre_alerts SET superseded_at = ? WHERE pre_alert_id = ?', [Date.now(), row.pre_alert_id])
    audit('system', 'pre_alert.superseded', row.pre_alert_id, `package for ${incidentId}`)
    publish({ type: 'pre_alert.cleared', ts: Date.now(), payload: { pre_alert_id: row.pre_alert_id } })
  }
}

/** Open alerts, so a page loaded after the event still shows what is live. */
export function openPreAlerts(): PreAlert[] {
  return all<PreAlertRow>(
    'SELECT * FROM pre_alerts WHERE superseded_at IS NULL AND raised_at > ? ORDER BY raised_at DESC LIMIT 8',
    [Date.now() - 30 * 60_000],
  ).map(toPreAlert)
}
