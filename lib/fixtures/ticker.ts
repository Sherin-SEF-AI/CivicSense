import 'server-only'
import type { IncidentSummary, PreAlert, SourceState, StreamEvent } from '@/lib/api/schemas'
import { bandForScore } from '@/lib/api/schemas/common'
import { SITUATIONS } from './catalog'
import { getHub } from './hub'
import { istHour, severityOf, SLA_SECONDS } from './incidents'
import { chance, intRange, mulberry32, pick, range, ulid } from './rng'
import { countsByBand, getWorld, withMutations } from './world'
import { sampleAlong } from '@/lib/geo/build'
import { ZONE_SEEDS } from '@/lib/geo/bengaluru'

/**
 * Advances the world while anyone is watching.
 *
 * The cadence is tuned so the console feels alive without being noisy: roughly
 * one new incident every twenty seconds, a pre-alert every forty, a warning
 * every three minutes, source health flapping on a couple of devices a minute,
 * patrol positions at 4Hz and spend ticking every second.
 */

const TICK_MS = 250
const HEARTBEAT_MS = 15_000

interface TickerState {
  timer: ReturnType<typeof setInterval> | null
  heartbeat: ReturnType<typeof setInterval> | null
  stopAt: ReturnType<typeof setTimeout> | null
  tick: number
  activePreAlerts: Map<string, PreAlert>
}

const KEY = '__civicsense_ticker__'

interface GlobalWithTicker {
  [KEY]?: TickerState
}

function state(): TickerState {
  const g = globalThis as GlobalWithTicker
  if (!g[KEY]) {
    g[KEY] = { timer: null, heartbeat: null, stopAt: null, tick: 0, activePreAlerts: new Map() }
  }
  return g[KEY]
}

function zoneAtRandom(rnd: () => number) {
  return pick(rnd, ZONE_SEEDS)
}

function spawnIncident(now: number): IncidentSummary {
  const w = getWorld()
  const rnd = mulberry32((now ^ w.seq) >>> 0)
  const situation = pick(rnd, SITUATIONS)
  const line = pick(rnd, w.lines)
  const p = sampleAlong(line, rnd())
  const zone = zoneAtRandom(rnd)
  const hour = istHour(now)
  const affected = Math.max(1, Math.round(situation.life_safety ? range(rnd, 12, 60) : range(rnd, 1, 14)))
  const escalation = situation.life_safety ? range(rnd, 0.45, 0.98) : range(rnd, 0.05, 0.55)
  const infra = situation.life_safety ? range(rnd, 0.25, 0.9) : range(rnd, 0.03, 0.7)
  const { score } = severityOf(situation, zone.sensitivity, hour, affected, escalation, infra)
  const priority = bandForScore(score)
  const spread = range(rnd, 0.03, 0.09)
  return {
    incident_id: ulid(rnd, now),
    title: `${situation.title}, ${zone.label}`,
    domain: situation.domain,
    status: 'detected',
    priority,
    css: {
      value: score,
      lo: Math.max(0, Math.round((score - spread) * 1000) / 1000),
      hi: Math.min(1, Math.round((score + spread) * 1000) / 1000),
    },
    zone_id: zone.id,
    zone_label: zone.label,
    position: { lat: Math.round(p[1] * 1e6) / 1e6, lon: Math.round(p[0] * 1e6) / 1e6 },
    h3: `8a61${(Math.abs(Math.round(p[0] * 1e4)) % 4096).toString(16).padStart(3, '0')}${(Math.abs(Math.round(p[1] * 1e4)) % 4096).toString(16).padStart(3, '0')}ffff`,
    detected_at: now,
    updated_at: now,
    source_count: 1,
    source_types: [situation.domain === 'environment' || situation.domain === 'nuisance' ? 'sensor' : 'cctv-fixed'],
    sync_quality: pick(rnd, ['A', 'A', 'B', 'B', 'C'] as const),
    corroboration: Math.round(range(rnd, 0.2, 0.6) * 100) / 100,
    acknowledged: false,
    department: null,
    sla_due_at: null,
    dismissed_reason: null,
  }
}

function advanceIncident(now: number, incident: IncidentSummary): StreamEvent | null {
  const w = getWorld()
  const rnd = mulberry32((incident.detected_at ^ now) >>> 0)
  const age = now - incident.detected_at
  const next: IncidentSummary = { ...incident }
  if (incident.status === 'detected' && age > 4000) {
    next.status = 'corroborated'
    next.source_count = incident.source_count + 1
    next.corroboration = Math.min(1, incident.corroboration + 0.2)
  } else if (incident.status === 'corroborated' && age > 12_000) {
    next.status = 'understood'
  } else if (incident.status === 'understood' && age > 22_000) {
    const situation = SITUATIONS.find((s) => incident.title.startsWith(s.title))
    next.status = 'dispatched'
    next.department = situation?.department ?? 'traffic-police'
    next.sla_due_at = now + SLA_SECONDS[incident.priority] * 1000
  } else {
    return null
  }
  next.updated_at = now
  const idx = w.incidents.findIndex((i) => i.incident_id === incident.incident_id)
  if (idx >= 0) w.incidents[idx] = next
  w.index.incidentById.set(next.incident_id, next)
  void rnd
  return { type: 'incident.updated', ts: now, payload: withMutations(w, next) }
}

function tick() {
  const s = state()
  const hub = getHub()
  const w = getWorld()
  const now = Date.now()
  s.tick += 1

  /* Patrol positions, 4Hz, straight past the query cache into the map. */
  for (const source of w.sources) {
    if (source.source_type !== 'patrol-car' && source.source_type !== 'patrol-bike') continue
    const rnd = mulberry32((s.tick ^ source.source_id.charCodeAt(4)) >>> 0)
    const line = w.lines[source.source_id.charCodeAt(4) % w.lines.length]!
    const u = ((s.tick * 0.00004 + source.source_id.charCodeAt(5) * 0.07) % 1 + 1) % 1
    const a = sampleAlong(line, u)
    const b = sampleAlong(line, Math.min(1, u + 0.002))
    const heading = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
    source.position = { lat: a[1], lon: a[0] }
    source.heading_deg = heading
    source.trail.push({ t: now, lat: a[1], lon: a[0], heading })
    while (source.trail.length > 0 && now - source.trail[0]!.t > 15 * 60_000) source.trail.shift()
    source.last_observation_at = now
    hub.publish({
      type: 'patrol.position',
      ts: now,
      payload: {
        source_id: source.source_id,
        lat: a[1],
        lon: a[0],
        heading,
        speed_kmh: Math.round(range(rnd, 8, 46)),
      },
    })
  }

  /* Spend accrues about a cent a second at pilot volume. */
  if (s.tick % 4 === 0) {
    w.spend.today_usd = Math.round((w.spend.today_usd + Math.random() * 0.004) * 10000) / 10000
    w.spend.month_usd = Math.round((w.spend.month_usd + Math.random() * 0.004) * 10000) / 10000
    hub.publish({
      type: 'spend.tick',
      ts: now,
      payload: { today_usd: w.spend.today_usd, budget_usd: w.spend.budget_usd, month_usd: w.spend.month_usd },
    })
  }

  /* A new incident roughly every twenty seconds. */
  if (s.tick % 80 === 0) {
    const incident = spawnIncident(now)
    w.incidents.unshift(incident)
    w.index.incidentById.set(incident.incident_id, incident)
    if (w.incidents.length > 4000) w.incidents.length = 4000
    hub.publish({ type: 'incident.created', ts: now, payload: incident })
    hub.publish({ type: 'counts', ts: now, payload: countsByBand(w) })
  }

  /* Push the newest few incidents through the pipeline stages. */
  if (s.tick % 8 === 0) {
    for (const incident of w.incidents.slice(0, 12)) {
      const event = advanceIncident(now, incident)
      if (event) hub.publish(event)
    }
  }

  /* Life-safety pre-alerts, ahead of any understanding pass. */
  if (s.tick % 160 === 40) {
    const rnd = mulberry32((now >>> 3) >>> 0)
    const situation = pick(
      rnd,
      SITUATIONS.filter((x) => x.life_safety),
    )
    const line = pick(rnd, w.lines)
    const p = sampleAlong(line, rnd())
    const zone = zoneAtRandom(rnd)
    const preAlert: PreAlert = {
      pre_alert_id: `PA-${now}`,
      incident_id: null,
      domain: situation.domain,
      trigger: situation.trigger,
      headline: situation.title,
      position: { lat: p[1], lon: p[0] },
      zone_label: zone.label,
      detected_at: now,
      elapsed_ms: intRange(rnd, 900, 2900),
      corroborating_sources: intRange(rnd, 1, 3),
      superseded_by_package: false,
    }
    s.activePreAlerts.set(preAlert.pre_alert_id, preAlert)
    hub.publish({ type: 'pre_alert.raised', ts: now, payload: preAlert })
  }

  /* Pre-alerts are replaced in place once the package lands. */
  for (const [id, pa] of s.activePreAlerts) {
    if (now - pa.detected_at > 45_000) {
      s.activePreAlerts.delete(id)
      hub.publish({ type: 'pre_alert.cleared', ts: now, payload: { pre_alert_id: id } })
    }
  }

  /* Source health flaps on a couple of devices a minute. */
  if (s.tick % 100 === 20) {
    const rnd = mulberry32((now >>> 5) >>> 0)
    const source = pick(rnd, w.sources)
    const nextState: SourceState = chance(rnd, 0.6)
      ? 'up'
      : chance(rnd, 0.6)
        ? 'degraded'
        : 'down'
    source.state = nextState
    source.last_observation_at = nextState === 'down' ? source.last_observation_at : now
    hub.publish({
      type: 'source.health',
      ts: now,
      payload: {
        source_id: source.source_id,
        state: nextState,
        trust: source.trust,
        last_observation_at: source.last_observation_at,
      },
    })
  }

  /* A warning every three minutes, cycling the existing set forward. */
  if (s.tick % 720 === 100 && w.warnings.length > 0) {
    const idx = Math.floor(Math.random() * w.warnings.length)
    const warning = { ...w.warnings[idx]!, issued_at: now, crossing_at: now + intRange(mulberry32(now >>> 2), 10, 180) * 60_000, acknowledged: false }
    w.warnings[idx] = warning
    w.index.warningById.set(warning.warning_id, warning)
    hub.publish({ type: 'warning.raised', ts: now, payload: warning })
  }
}

export function startTicker() {
  const s = state()
  if (s.stopAt) {
    clearTimeout(s.stopAt)
    s.stopAt = null
  }
  if (s.timer) return
  s.timer = setInterval(tick, TICK_MS)
  s.heartbeat = setInterval(() => getHub().heartbeat(), HEARTBEAT_MS)
}

/** Stops sixty seconds after the last subscriber leaves, not immediately. */
export function scheduleStop() {
  const s = state()
  if (s.stopAt) return
  s.stopAt = setTimeout(() => {
    if (getHub().clientCount > 0) return
    if (s.timer) clearInterval(s.timer)
    if (s.heartbeat) clearInterval(s.heartbeat)
    s.timer = null
    s.heartbeat = null
    s.stopAt = null
  }, 60_000)
}

export function activePreAlerts(): PreAlert[] {
  return [...state().activePreAlerts.values()]
}
