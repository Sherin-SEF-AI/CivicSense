import { expect, test } from '@playwright/test'
import { tinyPng } from '../e2e/helpers'

/**
 * The forensic tier, when it is attached.
 *
 * These specs are separate from the main suite on purpose. The console must stay
 * fully testable on a machine with no Docker, because the forensic tier being
 * detached is a supported configuration rather than a broken one.
 */
test.describe('forensic tier', () => {
  test('the console reports the tier as attached and names the registry', async ({ request }) => {
    const health = (await (await request.get('/api/v1/fis/health')).json()) as {
      available: boolean
      health?: { postgres: string; operators: number; registry_digest: string }
      reason?: string
    }
    expect(health.available, health.reason).toBe(true)
    expect(health.health!.postgres).toBe('up')
    expect(health.health!.operators).toBeGreaterThan(0)
    /* The registry digest is what a recipe cites, so it has to be a real digest. */
    expect(health.health!.registry_digest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('every published operator declares a class, and class E is cpu and deterministic', async ({ request }) => {
    const body = (await (await request.get('/api/v1/fis/operators')).json()) as {
      items: { operator_id: string; class: string; gpu: boolean; deterministic: boolean; summary: string }[]
    }
    expect(body.items.length).toBeGreaterThan(0)

    for (const operator of body.items) {
      expect(['E', 'I', 'D']).toContain(operator.class)
      expect(operator.summary.length).toBeGreaterThan(10)
      if (operator.class === 'E') {
        /* A gpu float reduction is not reproducible across driver versions, so
           an evidentiary operator cannot use one. The database refuses the
           combination too; this checks the published contract agrees. */
        expect(operator.gpu, `${operator.operator_id} is class E and declares gpu`).toBe(false)
        expect(operator.deterministic, `${operator.operator_id} is class E and not deterministic`).toBe(true)
      }
    }
  })
})

test.describe('metrology workbench', () => {
  test('a speed measurement runs, shows its working, and is audited', async ({ page, request }) => {
    /* Created through the real ingest path, like everything else in the suite. */
    const id = `E2E-FIS-MET-${Date.now()}`
    const registered = await request.post('/api/v1/sources', {
      data: { source_id: id, source_type: 'cctv-fixed', label: 'metrology', lat: 12.95, lon: 77.62, sync_quality: 'B' },
    })
    expect(registered.ok()).toBe(true)

    const observation = await request.post('/api/v1/ingest/observation', {
      data: {
        source_id: id,
        t_start: Date.now(),
        payload_kind: 'keyframe',
        classes: ['car'],
        trigger: 'class:no_helmet',
        situation_key: 'no-helmet',
        lat: 12.95,
        lon: 77.62,
      },
    })
    const incidentId = ((await observation.json()) as { incident_id: string }).incident_id

    await page.goto(`/forensics/${incidentId}`)
    await page.getByRole('tab', { name: 'metrology' }).click()
    const rail = page.getByRole('complementary', { name: 'analysis' })
    await expect(rail.getByText(/arithmetic a person can follow/)).toBeVisible()

    await rail.getByRole('button', { name: 'measure' }).click()

    /* Ten metres in 800 ms is 45 km/h, and the interval must be shown with it. */
    await expect(rail.getByText('45.00')).toBeVisible()
    await expect(rail.getByText(/95 percent interval/)).toBeVisible()
    await expect(rail.getByText(/class E/)).toBeVisible()
    /* The working is the point: the number has to be checkable by hand. */
    await expect(rail.getByText('elapsed s')).toBeVisible()
    await expect(rail.getByText(/timing contribution/)).toBeVisible()

    const admin = (await (await request.get('/api/v1/admin')).json()) as {
      audit: { action: string; subject: string }[]
    }
    expect(
      admin.audit.some((row) => row.action === 'measurement.taken' && row.subject === `incident:${incidentId}`),
      'taking a measurement must be on the record',
    ).toBe(true)
  })
})

test.describe('authenticity', () => {
  test('the full battery runs and refuses to decide where it cannot', async ({ request }) => {
    const id = `E2E-FIS-AUTH-${Date.now()}`
    await request.post('/api/v1/sources', {
      data: { source_id: id, source_type: 'cctv-fixed', label: 'authenticity', lat: 12.99, lon: 77.68, sync_quality: 'B' },
    })

    /* A real PNG through the real ingest path, so the battery sees the bytes a
       device would have delivered. */
    const png = tinyPng(Date.now())
    const ingested = await request.post('/api/v1/ingest/observation', {
      multipart: {
        payload: JSON.stringify({
          source_id: id,
          t_start: Date.now(),
          payload_kind: 'keyframe',
          classes: ['car'],
          trigger: 'class:no_helmet',
          situation_key: 'no-helmet',
          lat: 12.99,
          lon: 77.68,
        }),
        media: { name: 'frame.png', mimeType: 'image/png', buffer: png },
      },
    })
    const { incident_id: incidentId, evidence } = (await ingested.json()) as {
      incident_id: string
      evidence: { sha256: string }
    }

    const bundle = (await (await request.get(`/api/v1/forensics/${incidentId}`)).json()) as {
      authenticity: { evidence_id: string; verdict: string; tests: { test: string; result: string; detail: string }[] }[]
    }
    const report = bundle.authenticity.find((a) => a.evidence_id === evidence.sha256)!

    const named = new Map(report.tests.map((t) => [t.test, t]))
    /* The console's own checks. */
    expect(named.get('content hash')!.result).toBe('pass')
    expect(named.get('custody chain')!.result).toBe('pass')
    /* And the tier's, which is the point of attaching it. */
    expect(named.has('container continuity'), 'the picture battery must have run').toBe(true)
    expect(named.has('screen replay')).toBe(true)
    expect(named.has('burned clock')).toBe(true)
    /* The blocking grid test accused untouched footage of a shifted macroblock
       grid, so it is out of the battery until it is rebuilt. A detector that
       cannot be trusted to accuse cannot be trusted to exonerate either. */
    expect(named.has('blocking grid'), 'an unvalidated detector is back in the battery').toBe(false)

    /* A single frame cannot support any of the temporal tests, and every one of
       them must say so rather than return a result it cannot justify. */
    for (const name of ['container continuity', 'content continuity', 'screen replay']) {
      expect(named.get(name)!.result, `${name} on a still image`).toBe('inconclusive')
      expect(named.get(name)!.detail).toMatch(/too few frames|too short/)
    }

    /* Nothing failed, so the object is consistent. It is not verified, because
       nothing signed it. */
    expect(report.verdict).toBe('consistent')
  })
})

test.describe('kinematics', () => {
  test('the filter replaces differencing and says which produced the figure', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-FIS-KIN-${t}`
    await request.post('/api/v1/sources', {
      data: { source_id: id, source_type: 'cctv-fixed', label: 'kinematics', lat: 12.94, lon: 77.66, sync_quality: 'A' },
    })
    /* Calibrated through the real procedure, so ground positions are admissible. */
    await request.put(`/api/v1/sources/${id}/calibration`, {
      data: { homography: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, residual_m: 0.2 },
    })

    const observation = await request.post('/api/v1/ingest/observation', {
      data: {
        source_id: id,
        t_start: t,
        payload_kind: 'keyframe',
        classes: ['car'],
        trigger: 'class:sudden_stop+fallen_rider',
        situation_key: 'collision',
        lat: 12.94,
        lon: 77.66,
      },
    })
    const { observation_id: observationId, incident_id: incidentId } = (await observation.json()) as {
      observation_id: string
      incident_id: string
    }

    /* Twelve samples at 10 Hz along a straight path at about 45 km/h. */
    const samples = Array.from({ length: 12 }, (_, i) => ({
      t: t + i * 100,
      lat: 12.94 + i * 0.0000112,
      lon: 77.66 + i * 0.0000112,
    }))
    const posted = await request.post('/api/v1/ingest/track', {
      data: { observation_id: observationId, tracks: [{ track_id: `${id}-T1`, descriptor: 'car', samples }] },
    })
    expect(posted.ok(), await posted.text()).toBe(true)

    const bundle = (await (await request.get(`/api/v1/forensics/${incidentId}`)).json()) as {
      kinematics: {
        track_id: string
        estimator: string
        peak_speed: { value: number; lo: number; hi: number }
        measurement_grade: string
      }[]
    }

    expect(bundle.kinematics.length).toBe(1)
    const track = bundle.kinematics[0]!

    /* The whole point of attaching the tier. */
    expect(track.estimator, 'the filter must have produced this').toBe('kalman-rts')
    expect(track.measurement_grade).toBe('measured')

    /* The interval must bracket the value and be narrow enough to say something.
       Differencing on the same track gives an interval hundreds wide. */
    expect(track.peak_speed.lo).toBeLessThanOrEqual(track.peak_speed.value)
    expect(track.peak_speed.hi).toBeGreaterThanOrEqual(track.peak_speed.value)
    expect(track.peak_speed.hi - track.peak_speed.lo).toBeLessThan(40)
  })
})

test.describe('recorder clock', () => {
  test('without an overlay record the clock test says it could not run', async ({ request }) => {
    const t = Date.now()
    const id = `E2E-FIS-NOOVL-${t}`
    await request.post('/api/v1/sources', {
      data: { source_id: id, source_type: 'cctv-fixed', label: 'no overlay', lat: 13.01, lon: 77.69, sync_quality: 'B' },
    })
    const ingested = await request.post('/api/v1/ingest/observation', {
      multipart: {
        payload: JSON.stringify({
          source_id: id,
          t_start: t,
          payload_kind: 'keyframe',
          classes: ['car'],
          trigger: 'class:no_helmet',
          situation_key: 'no-helmet',
          lat: 13.01,
          lon: 77.69,
        }),
        media: { name: 'f.png', mimeType: 'image/png', buffer: tinyPng(t) },
      },
    })
    const { incident_id: incidentId } = (await ingested.json()) as { incident_id: string }

    const bundle = (await (await request.get(`/api/v1/forensics/${incidentId}`)).json()) as {
      authenticity: { tests: { test: string; result: string; detail: string }[] }[]
    }
    const clock = bundle.authenticity[0]!.tests.find((x) => x.test === 'burned clock')!
    expect(clock.result).toBe('inconclusive')
    /* The consequence is stated, not left for someone to discover. */
    expect(clock.detail).toContain('no overlay position is recorded')
    expect(clock.detail).toContain('not detectable')
  })

  test('the overlay record is part of calibration and states what it enables', async ({ request }) => {
    const id = `E2E-FIS-OVL-${Date.now()}`
    await request.post('/api/v1/sources', {
      data: { source_id: id, source_type: 'cctv-fixed', label: 'overlay', lat: 13.02, lon: 77.7 },
    })

    const withOverlay = await request.put(`/api/v1/sources/${id}/calibration`, {
      data: {
        homography: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        residual_m: 0.4,
        overlay: { x: 8, y: 8, scale: 2, layout: '####-##-## ##:##:##' },
      },
    })
    expect(withOverlay.ok(), await withOverlay.text()).toBe(true)
    const body = (await withOverlay.json()) as { overlay_recorded: boolean; clock_readable: string }
    expect(body.overlay_recorded).toBe(true)
    expect(body.clock_readable).toContain('detectable')

    /* A layout that is not a digit mask is refused rather than stored. */
    const bad = await request.put(`/api/v1/sources/${id}/calibration`, {
      data: {
        homography: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        residual_m: 0.4,
        overlay: { x: 8, y: 8, scale: 2, layout: 'time is now' },
      },
    })
    expect(bad.status()).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_overlay_layout')
  })
})
