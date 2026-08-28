import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { ingest, ingestSensor, registerSource, tinyPng } from './helpers'

test.describe('ingest', () => {
  test('a registered source lands in a real ward and stays down until it reports', async ({ request }) => {
    const id = `E2E-WARD-${Date.now()}`
    await registerSource(request, id, { lat: 12.9716, lon: 77.5946 })

    const response = await request.get(`/api/v1/sources/${id}`)
    expect(response.ok()).toBe(true)
    const detail = (await response.json()) as { device: { zone_label: string; state: string } }

    /* The ward comes from the OpenStreetMap boundary the position falls inside. */
    expect(detail.device.zone_label).not.toBe('outside any configured zone')
    expect(detail.device.state).toBe('down')
  })

  test('uploaded bytes are hashed, served back, and recompute to the same hash', async ({ request }) => {
    const source = `E2E-HASH-${Date.now()}`
    await registerSource(request, source)

    const seed = Date.now()
    const bytes = tinyPng(seed)
    const expected = createHash('sha256').update(bytes).digest('hex')

    const result = await ingest(request, source, { classes: ['car'] }, seed)
    expect(result.evidence?.sha256).toBe(expected)
    expect(result.evidence?.deduplicated).toBe(false)

    const served = await request.get(`/api/v1/evidence/${expected}/content?purpose=acceptance%20suite`)
    expect(served.ok()).toBe(true)
    expect(served.headers()['x-content-sha256']).toBe(expected)
    expect(createHash('sha256').update(await served.body()).digest('hex')).toBe(expected)

    /* The same bytes again are one object, not two. */
    const again = await ingest(request, source, { classes: ['car'] }, seed)
    expect(again.evidence?.deduplicated).toBe(true)
  })

  test('a trigger forms an incident and a second source corroborates it', async ({ request }) => {
    const t = Date.now()
    const first = `E2E-FUSE-A-${t}`
    const second = `E2E-FUSE-B-${t}`
    await registerSource(request, first, { lat: 12.98, lon: 77.6 })
    await registerSource(request, second, { lat: 12.98005, lon: 77.60005 })

    const now = Date.now()
    const a = await ingest(
      request,
      first,
      { t_start: now, classes: ['lcv'], trigger: 'object:placed_and_left', situation_key: 'dumping' },
      now,
    )
    expect(a.incident_id).not.toBeNull()

    /* Same H3 neighbourhood, inside the fusion window: this must join the
       existing incident rather than create a second one. */
    const b = await ingest(
      request,
      second,
      { t_start: now + 4000, classes: ['lcv'], trigger: 'object:placed_and_left', situation_key: 'dumping' },
      now + 1,
    )
    expect(b.incident_id).toBe(a.incident_id)

    const incident = (await (await request.get(`/api/v1/incidents/${a.incident_id}`)).json()) as {
      source_count: number
      corroboration: number
    }
    expect(incident.source_count).toBe(2)
    expect(incident.corroboration).toBeGreaterThan(0)
  })

  test('sensor readings are stored and returned as min and max buckets', async ({ request }) => {
    const id = `E2E-SEN-${Date.now()}`
    await registerSource(request, id, { source_type: 'sensor', sensor_kind: 'noise', representativity_m: 100 })

    const now = Date.now()
    const readings = Array.from({ length: 40 }, (_, i) => ({
      t: now - (39 - i) * 60_000,
      value: 50 + i * 0.4,
      unit: 'dB(A)',
    }))
    await ingestSensor(request, id, readings)

    const series = (await (
      await request.get(`/api/v1/sensors/${id}/series?from=${now - 40 * 60_000}&to=${now}&buckets=20`)
    ).json()) as { buckets: [number, number, number][]; unit: string; limit: number | null }

    expect(series.buckets.length).toBeGreaterThan(0)
    expect(series.unit).toBe('dB(A)')
    expect(series.limit).toBe(55)
    for (const [, lo, hi] of series.buckets) expect(hi).toBeGreaterThanOrEqual(lo)
  })

  test('an unknown source is refused', async ({ request }) => {
    const response = await request.post('/api/v1/ingest/sensor', {
      data: { source_id: 'does-not-exist', readings: [{ t: Date.now(), value: 1, unit: 'x' }] },
    })
    expect(response.status()).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('unknown_source')
  })

  test('the audit chain verifies after all of this activity', async ({ request }) => {
    const admin = (await (await request.get('/api/v1/admin')).json()) as {
      audit_chain: { valid: boolean; brokenAt: number | null; entries: number }
    }
    expect(admin.audit_chain.entries).toBeGreaterThan(0)
    expect(admin.audit_chain.valid, `chain broken at ${admin.audit_chain.brokenAt}`).toBe(true)
  })
})
