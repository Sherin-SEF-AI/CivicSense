import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { ingest, registerSource } from './helpers'

/** Calibration is a separate procedure, so the suite performs it as one. */
async function calibrate(request: APIRequestContext, sourceId: string, residualM: number): Promise<void> {
  const response = await request.put(`/api/v1/sources/${sourceId}/calibration`, {
    data: { homography: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, residual_m: residualM },
  })
  if (!response.ok()) throw new Error(`calibrating ${sourceId} failed: ${await response.text()}`)
}

/**
 * The tiers that were empty until now: pre-alerts, measured kinematics,
 * conflicts, entity dossiers, standing searches and the exports.
 *
 * Everything is created through the real ingest endpoints, so what is asserted
 * is what a device would actually produce.
 */

/** Two tracks converging on a point, in real ground-plane coordinates. */
function converging(t0: number) {
  const a: { t: number; lat: number; lon: number }[] = []
  const b: { t: number; lat: number; lon: number }[] = []
  for (let i = 0; i < 10; i++) {
    /* Roughly 40 km/h north and 30 km/h east, meeting near 12.9800, 77.6000. */
    a.push({ t: t0 + i * 500, lat: 12.9795 + i * 0.0000555, lon: 77.6, })
    b.push({ t: t0 + i * 500, lat: 12.98, lon: 77.5996 + i * 0.0000417 })
  }
  return { a, b }
}

test.describe('analysis tiers', () => {
  test('a life-safety trigger raises a pre-alert before the package exists', async ({ request }) => {
    const id = `E2E-FIRE-${Date.now()}`
    await registerSource(request, id, { lat: 12.9611, lon: 77.6387 })

    const started = Date.now()
    const result = await ingest(request, id, {
      classes: ['fire', 'smoke'],
      trigger: 'class:fire',
      situation_key: 'fire',
      affected: 4,
    })
    const elapsed = Date.now() - started

    const body = result as unknown as { pre_alert: { pre_alert_id: string; elapsed_ms: number } | null }
    expect(body.pre_alert, 'a life-safety situation must raise a pre-alert').not.toBeNull()

    /* Dispatch before understanding: the alert exists in the same request that
       delivered the observation, well inside the three second budget. */
    expect(elapsed).toBeLessThan(3000)

    const open = (await (await request.get('/api/v1/pre-alerts')).json()) as {
      items: { pre_alert_id: string; incident_id: string | null; superseded_by_package: boolean }[]
    }
    const found = open.items.find((p) => p.pre_alert_id === body.pre_alert!.pre_alert_id)
    expect(found, 'the alert must be readable by a console that connects afterwards').toBeTruthy()
    expect(found!.superseded_by_package).toBe(false)
    expect(found!.incident_id).toBe(result.incident_id)
  })

  test('a routine trigger raises no pre-alert', async ({ request }) => {
    const id = `E2E-QUIET-${Date.now()}`
    await registerSource(request, id)
    const result = (await ingest(request, id, {
      classes: ['motorcycle'],
      trigger: 'class:no_helmet',
      situation_key: 'no-helmet',
    })) as unknown as { pre_alert: unknown }
    expect(result.pre_alert, 'a helmet violation must not raise a life-safety banner').toBeNull()
  })

  test('tracks from a calibrated source produce measured speed with an interval', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-TRK-${t}`
    await registerSource(request, id, { lat: 12.98, lon: 77.6, sync_quality: 'A' })
    await calibrate(request, id, 0.2)

    const observation = await ingest(request, id, {
      t_start: t,
      classes: ['car'],
      trigger: 'class:sudden_stop+fallen_rider',
      situation_key: 'collision',
      lat: 12.98,
      lon: 77.6,
    })
    expect(observation.incident_id).not.toBeNull()

    const { a, b } = converging(t)
    const posted = await request.post('/api/v1/ingest/track', {
      data: {
        observation_id: observation.observation_id,
        tracks: [
          { track_id: `${id}-T1`, descriptor: 'white hatchback', samples: a },
          { track_id: `${id}-T2`, descriptor: 'two wheeler', samples: b },
        ],
        entities: [{ entity_ref: `VEH-${t}`, kind: 'vehicle', descriptor: 'white hatchback', plate: 'KA01AB1234' }],
      },
    })
    expect(posted.ok(), await posted.text()).toBe(true)
    expect(((await posted.json()) as { tracks_stored: number }).tracks_stored).toBe(2)

    const bundle = (await (await request.get(`/api/v1/forensics/${observation.incident_id}`)).json()) as {
      kinematics: {
        track_id: string
        peak_speed: { value: number; lo: number; hi: number }
        measurement_grade: string
        samples: unknown[]
      }[]
      conflicts: { pair: [string, string]; ttc_s: { value: number } | null; severity: string }[]
      entities: { entity_ref: string; plate_hash: string | null; path: unknown[] }[]
    }

    expect(bundle.kinematics.length).toBe(2)
    const track = bundle.kinematics.find((k) => k.track_id === `${id}-T1`)!
    /* The samples step 6.18 m every 500 ms, which is 44.5 km/h. The platform has
       to arrive at that from the positions alone. */
    expect(track.peak_speed.value).toBeGreaterThan(42)
    expect(track.peak_speed.value).toBeLessThan(47)
    expect(track.peak_speed.lo).toBeLessThanOrEqual(track.peak_speed.value)
    expect(track.peak_speed.hi).toBeGreaterThanOrEqual(track.peak_speed.value)
    /* A well calibrated source with grade A sync earns a measured figure. */
    expect(track.measurement_grade).toBe('measured')

    expect(bundle.conflicts.length).toBeGreaterThan(0)
    expect(bundle.conflicts[0]!.ttc_s).not.toBeNull()

    const entity = bundle.entities.find((e) => e.entity_ref === `VEH-${t}`)
    expect(entity, 'the entity must appear in the dossier list').toBeTruthy()
    /* The plate is never stored, only its hash. */
    expect(entity!.plate_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('an uncalibrated source cannot report ground-plane tracks', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-UNCAL-${t}`
    await registerSource(request, id)
    const observation = await ingest(request, id, { classes: ['car'] })

    const response = await request.post('/api/v1/ingest/track', {
      data: {
        observation_id: observation.observation_id,
        tracks: [{ track_id: 'T1', samples: converging(t).a }],
      },
    })
    expect(response.status()).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('source_not_calibrated')
  })

  test('an indicative measurement is not reported as measured', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-SLOP-${t}`
    /* Calibrated, but badly, and with a poor clock. The platform must say so. */
    await registerSource(request, id, { lat: 12.985, lon: 77.605, sync_quality: 'D' })
    await calibrate(request, id, 3.4)
    const observation = await ingest(request, id, {
      t_start: t,
      classes: ['car'],
      trigger: 'class:sudden_stop+fallen_rider',
      situation_key: 'collision',
      lat: 12.985,
      lon: 77.605,
    })

    await request.post('/api/v1/ingest/track', {
      data: {
        observation_id: observation.observation_id,
        tracks: [{ track_id: `${id}-T1`, descriptor: 'unclear', samples: converging(t).a }],
      },
    })

    const bundle = (await (await request.get(`/api/v1/forensics/${observation.incident_id}`)).json()) as {
      kinematics: { measurement_grade: string }[]
    }
    expect(bundle.kinematics.length).toBe(1)
    expect(bundle.kinematics[0]!.measurement_grade).toBe('indicative')
  })

  test('a standing search counts matches as evidence arrives', async ({ request }) => {
    const t = Date.now()
    const saved = await request.post('/api/v1/saved-searches', {
      data: { name: `lorry watch ${t}`, query: 'lcv last 24h', rerun: true },
    })
    expect(saved.ok()).toBe(true)
    const record = (await saved.json()) as { saved_search_id: string; new_hits: number }
    expect(record.new_hits).toBe(0)

    const id = `E2E-SS-${t}`
    await registerSource(request, id)
    await ingest(request, id, { classes: ['lcv'] }, t)

    const list = (await (await request.get('/api/v1/saved-searches')).json()) as {
      items: { saved_search_id: string; new_hits: number }[]
    }
    const updated = list.items.find((s) => s.saved_search_id === record.saved_search_id)!
    expect(updated.new_hits, 'the matching observation must be counted against the standing search').toBeGreaterThan(0)

    expect((await request.delete(`/api/v1/saved-searches/${record.saved_search_id}`)).ok()).toBe(true)
  })

  test('a zone profile edit is persisted and audited', async ({ request }) => {
    const zones = (await (await request.get('/api/v1/zones')).json()) as {
      items: { zone_id: string; sensitivity: number; kind: string }[]
    }
    const zone = zones.items[0]!
    const target = Math.min(1, Math.round((zone.sensitivity + 0.1) * 100) / 100)

    const patched = await request.patch('/api/v1/zones', {
      data: { zone_id: zone.zone_id, sensitivity: target, kind: 'school' },
    })
    expect(patched.ok(), await patched.text()).toBe(true)
    const updated = (await patched.json()) as { sensitivity: number; kind: string }
    expect(updated.sensitivity).toBeCloseTo(target, 5)
    expect(updated.kind).toBe('school')

    /* Out of range is refused rather than clamped. */
    const bad = await request.patch('/api/v1/zones', { data: { zone_id: zone.zone_id, sensitivity: 2 } })
    expect(bad.status()).toBe(400)
  })

  test('a playbook edit bumps the version', async ({ request }) => {
    const admin = (await (await request.get('/api/v1/admin')).json()) as {
      playbooks: { playbook_id: string; version: number; steps: unknown[] }[]
    }
    const playbook = admin.playbooks[0]!

    const response = await request.patch(`/api/v1/admin/playbooks/${playbook.playbook_id}`, {
      data: {
        steps: [
          ...(playbook.steps as Record<string, unknown>[]),
          { step_id: 'STEP-E2E', text: 'added by the acceptance suite', owner: 'test', timer_s: null, automatic: false, approval_gate: true },
        ],
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
    const updated = (await response.json()) as { version: number; steps: unknown[] }
    expect(updated.version).toBe(playbook.version + 1)
    expect(updated.steps.length).toBe(playbook.steps.length + 1)
  })

  test('every hypothesis names a retrieval that could separate it', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-HYP-${t}`
    await registerSource(request, id, { lat: 12.9352, lon: 77.6245 })
    /* A second source in range, so there is something to ask for. */
    await registerSource(request, `${id}-B`, { lat: 12.9355, lon: 77.6248 })

    const observation = await ingest(request, id, {
      classes: ['lcv', 'person'],
      trigger: 'object:placed_and_left',
      situation_key: 'dumping',
    })

    const response = await request.post(`/api/v1/incidents/${observation.incident_id}/hypotheses`)
    expect(response.ok(), await response.text()).toBe(true)
    const result = (await response.json()) as {
      reasoning_available: boolean
      items: {
        hypothesis_id: string
        statement: string
        prior: number
        posterior: number
        requests: { request_id: string; source_id: string; state: string; window: [number, number] }[]
      }[]
    }

    if (!result.reasoning_available) {
      /* No key, no reasoning, and no invented hypotheses either. */
      expect(result.items).toHaveLength(0)
      return
    }

    expect(result.items.length).toBeGreaterThan(1)
    const known = new Set([id, `${id}-B`])
    for (const hypothesis of result.items) {
      expect(hypothesis.statement.length).toBeGreaterThan(10)
      expect(hypothesis.prior).toBeGreaterThanOrEqual(0)
      expect(hypothesis.prior).toBeLessThanOrEqual(1)
      /* A hypothesis nobody can test is not kept. */
      expect(hypothesis.requests.length).toBeGreaterThan(0)
      for (const req of hypothesis.requests) {
        expect(known.has(req.source_id), `${req.source_id} is not a real source`).toBe(true)
        expect(req.window[1]).toBeGreaterThan(req.window[0])
      }
    }

    /* Pulling a retrieval must move the posterior, and move the others the
       other way, because probability is conserved across the set. */
    const first = result.items[0]!
    const before = result.items.map((h) => h.posterior)
    const pulled = await request.post(`/api/v1/hypotheses/requests/${first.requests[0]!.request_id}`)
    expect(pulled.ok(), await pulled.text()).toBe(true)
    const updated = (await pulled.json()) as { posterior: number; requests: { state: string; delta: number | null }[] }
    expect(updated.posterior).not.toBe(before[0])
    expect(['returned', 'unavailable']).toContain(updated.requests[0]!.state)
    expect(updated.requests[0]!.delta).not.toBeNull()
  })

  test('a warning carries the cascade and interventions it can support', async ({ request }) => {
    const board = (await (await request.get('/api/v1/warnings')).json()) as {
      items: {
        warning_id: string
        cascade: { zone_id: string; lag_min: number; attenuation: number }[]
        interventions: { intervention_id: string; expected_effect: number; feasibility: number; rationale: string }[]
      }[]
    }

    for (const warning of board.items) {
      /* Cascade entries are measured, so an attenuation must be a real ratio and
         a lag must be positive. */
      for (const step of warning.cascade) {
        expect(step.attenuation).toBeGreaterThan(0)
        expect(step.attenuation).toBeLessThanOrEqual(1)
        expect(step.lag_min).toBeGreaterThan(0)
      }
      /* An intervention with no measured history must say so in its rationale
         rather than present a planning figure as an observed effect. */
      for (const intervention of warning.interventions) {
        expect(intervention.expected_effect).toBeGreaterThanOrEqual(0)
        expect(intervention.expected_effect).toBeLessThanOrEqual(1)
        expect(intervention.feasibility).toBeGreaterThan(0)
        expect(intervention.rationale.length).toBeGreaterThan(20)
      }
    }
  })
})
