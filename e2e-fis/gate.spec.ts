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
    expect(named.has('blocking grid')).toBe(true)

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
