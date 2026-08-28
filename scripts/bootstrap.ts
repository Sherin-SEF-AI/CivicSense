/**
 * Prepares an empty deployment.
 *
 * Imports the real ward boundaries from the OpenStreetMap extract into the zone
 * table, and loads the deployment configuration: departments, playbooks and
 * budgets. It creates no incidents, no sources and no observations, because
 * those come from the world rather than from a script.
 *
 * Safe to re-run. Run with `npm run bootstrap`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit, db, get, run } from '../lib/db'
import { upsertZone } from '../lib/store/zones'

interface Config {
  deployment: { name: string; timezone: string; bbox: number[]; center: { lat: number; lon: number } }
  departments: {
    department: string
    label: string
    domains: string[]
    contacts: unknown[]
    sla_seconds: Record<string, number>
    escalation_to: string | null
  }[]
  playbooks: { playbook_id: string; name: string; domain: string; min_priority: string; steps: unknown[] }[]
  budgets: { scope: string; key: string; label: string; daily_usd: number; monthly_usd: number }[]
  zone_profiles: { default_kind: string; default_sensitivity: number; keywords: Record<string, string[]> }
}

const config = JSON.parse(readFileSync(join(process.cwd(), 'config', 'deployment.json'), 'utf8')) as Config

/**
 * Zone kind is inferred from the ward name where the name says what the place is,
 * and defaults otherwise. This is a starting point an administrator edits, not a
 * claim about the ward: the profile drives severity weighting and should be set
 * deliberately.
 */
function kindFor(label: string): { kind: string; sensitivity: number } {
  const lower = label.toLowerCase()
  for (const [kind, keywords] of Object.entries(config.zone_profiles.keywords)) {
    if (keywords.some((k) => lower.includes(k))) {
      const sensitivity = kind === 'hospital' ? 0.9 : kind === 'transit-hub' ? 0.85 : kind === 'market' ? 0.7 : 0.6
      return { kind, sensitivity }
    }
  }
  return { kind: config.zone_profiles.default_kind, sensitivity: config.zone_profiles.default_sensitivity }
}

function main() {
  db()

  const zonesPath = join(process.cwd(), 'public', 'basemap', 'zones.geojson')
  const zones = JSON.parse(readFileSync(zonesPath, 'utf8')) as {
    features: { geometry: { coordinates: [number, number][][] }; properties: { zone_id: string; label: string; osm_id: number } }[]
  }

  let imported = 0
  for (const feature of zones.features) {
    const ring = feature.geometry.coordinates[0]
    if (!ring || ring.length < 4) continue
    const { kind, sensitivity } = kindFor(feature.properties.label)
    /* An existing zone keeps its configured profile: re-running the import must
       not silently undo an administrator's weighting. */
    const existing = get<{ kind: string; sensitivity: number }>('SELECT kind, sensitivity FROM zones WHERE zone_id = ?', [
      feature.properties.zone_id,
    ])
    upsertZone({
      zone_id: feature.properties.zone_id,
      label: feature.properties.label,
      kind: existing?.kind ?? kind,
      sensitivity: existing?.sensitivity ?? sensitivity,
      polygon: ring,
      osm_id: feature.properties.osm_id,
    })
    imported++
  }
  console.log(`zones          ${String(imported).padStart(5)} imported from OpenStreetMap ward boundaries`)

  for (const dept of config.departments) {
    run(
      `INSERT INTO departments (department, label, domains, contacts, sla_seconds, escalation_to)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(department) DO UPDATE SET label = excluded.label, domains = excluded.domains,
         sla_seconds = excluded.sla_seconds, escalation_to = excluded.escalation_to`,
      [
        dept.department,
        dept.label,
        JSON.stringify(dept.domains),
        JSON.stringify(dept.contacts),
        JSON.stringify(dept.sla_seconds),
        dept.escalation_to,
      ],
    )
  }
  console.log(`departments    ${String(config.departments.length).padStart(5)} configured`)

  const now = Date.now()
  for (const playbook of config.playbooks) {
    run(
      `INSERT INTO playbooks (playbook_id, name, domain, min_priority, version, updated_at, steps)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(playbook_id) DO UPDATE SET name = excluded.name, domain = excluded.domain,
         min_priority = excluded.min_priority, steps = excluded.steps, updated_at = excluded.updated_at`,
      [playbook.playbook_id, playbook.name, playbook.domain, playbook.min_priority, now, JSON.stringify(playbook.steps)],
    )
  }
  console.log(`playbooks      ${String(config.playbooks.length).padStart(5)} configured`)

  for (const budget of config.budgets) {
    run(
      `INSERT INTO budgets (scope, key, label, daily_usd, monthly_usd) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET label = excluded.label, daily_usd = excluded.daily_usd,
         monthly_usd = excluded.monthly_usd`,
      [budget.scope, budget.key, budget.label, budget.daily_usd, budget.monthly_usd],
    )
  }

  /* One administrator, taken from the environment. Further users are created by
     an administrator; inventing staff would be inventing people. */
  const email = process.env.CIVICSENSE_ADMIN_EMAIL ?? 'admin@localhost'
  const name = process.env.CIVICSENSE_ADMIN_NAME ?? 'administrator'
  run(
    `INSERT INTO users (user_id, name, email, role, department, investigation_flag, last_active)
     VALUES ('U-ADMIN', ?, ?, 'admin', NULL, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, email = excluded.email, last_active = excluded.last_active`,
    [name, email, now],
  )

  run(
    `INSERT INTO settings (key, value) VALUES ('deployment', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(config.deployment)],
  )

  audit('bootstrap', 'deployment.bootstrapped', 'deployment', `${imported} zones, ${config.departments.length} departments`)

  const counts = {
    zones: get<{ c: number }>('SELECT COUNT(*) c FROM zones')?.c ?? 0,
    sources: get<{ c: number }>('SELECT COUNT(*) c FROM sources')?.c ?? 0,
    observations: get<{ c: number }>('SELECT COUNT(*) c FROM observations')?.c ?? 0,
    incidents: get<{ c: number }>('SELECT COUNT(*) c FROM incidents')?.c ?? 0,
  }
  console.log('\nthe deployment is ready and empty:')
  console.log(`  zones        ${counts.zones}`)
  console.log(`  sources      ${counts.sources}`)
  console.log(`  observations ${counts.observations}`)
  console.log(`  incidents    ${counts.incidents}`)
  console.log('\nregister a source to begin: POST /api/v1/sources, or use the sources screen.')
}

main()
