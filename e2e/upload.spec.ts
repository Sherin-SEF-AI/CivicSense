import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, hasFfmpeg, tinyPng } from './helpers'

/**
 * Intake for material handed over rather than captured.
 *
 * The properties asserted here are the ones that keep an upload from being
 * mistaken for a capture: it is hashed and put under custody, what the uploader
 * asserted is kept apart from what the platform established, the source it is
 * attributed to can support no measurement, and nothing becomes an incident
 * without a person ruling on it.
 */
test.describe('intake', () => {
  test('a file is hashed, attributed, and given a source that can measure nothing', async ({ request }) => {
    const png = tinyPng(Date.now())
    const response = await request.post('/api/v1/uploads', {
      multipart: {
        file: { name: 'handed-in.png', mimeType: 'image/png', buffer: png },
        source_kind: 'phone',
        purpose: 'still handed in at the front desk by a complainant',
        lat: '12.9611',
        lon: '77.6387',
        note: 'complainant says this is the junction',
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const body = (await response.json()) as {
      upload_id: string
      sha256: string
      analysis: { provenance: { device_signature: null; note: string } }
    }

    /* Hashed on arrival, like anything else. */
    const { createHash } = await import('node:crypto')
    expect(body.sha256).toBe(createHash('sha256').update(png).digest('hex'))

    /* And the custody chain starts, so the object is accounted for from the
       moment it was handed over. */
    const custody = (await (await request.get(`/api/v1/evidence/${body.sha256}/custody`)).json()) as {
      hash_chain_valid: boolean
      chain: { action: string; purpose: string }[]
    }
    expect(custody.hash_chain_valid).toBe(true)
    expect(custody.chain.some((e) => e.action === 'capture' || e.action === 'ingest')).toBe(true)

    /* The provenance note is the whole point: an uploaded object can never be
       verified, and the source it is attributed to has no calibration. */
    expect(body.analysis.provenance.device_signature).toBeNull()
    expect(body.analysis.provenance.note).toContain('never read verified')

    const uploads = (await (await request.get('/api/v1/uploads')).json()) as {
      items: { upload_id: string; source_id: string }[]
    }
    const record = uploads.items.find((u) => u.upload_id === body.upload_id)!
    const source = (await (await request.get(`/api/v1/sources/${record.source_id}`)).json()) as {
      device: { calibration_residual_m: number | null }
    }
    /* No calibration, so metrology from this source is refused rather than
       estimated. */
    expect(source.device.calibration_residual_m).toBeNull()
  })

  test('a reason is required, because a blank custody entry is worse than none', async ({ request }) => {
    const response = await request.post('/api/v1/uploads', {
      multipart: {
        file: { name: 'x.png', mimeType: 'image/png', buffer: tinyPng(1) },
        source_kind: 'phone',
        purpose: 'x',
      },
    })
    expect(response.status()).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('purpose_required')
  })

  test('sensor readings are parsed and stored as a trend, not a compliance measurement', async ({ request }) => {
    const base = Date.now() - 3600_000
    const rows = Array.from({ length: 30 }, (_, i) => `${new Date(base + i * 60_000).toISOString()},${50 + i * 0.3}`)
    const response = await request.post('/api/v1/uploads', {
      multipart: {
        file: { name: 'noise-log.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) },
        source_kind: 'sensor',
        sensor_kind: 'noise',
        unit: 'dB(A)',
        purpose: 'noise log supplied with a residents association complaint',
        lat: '12.97',
        lon: '77.60',
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const body = (await response.json()) as { readings: number; source_id: string; note: string }
    expect(body.readings).toBe(30)
    /* Stated, not implied: an uncalibrated log supports a trend and nothing more. */
    expect(body.note).toContain('not a compliance measurement')

    const series = (await (
      await request.get(`/api/v1/sensors/${body.source_id}/series?from=${base - 60_000}&to=${Date.now()}&buckets=10`)
    ).json()) as { buckets: [number, number, number][] }
    expect(series.buckets.length).toBeGreaterThan(0)
  })

  test('a detection never becomes an incident without a person ruling on it', async ({ request }) => {
    test.skip(!hasFfmpeg(), 'ffmpeg is needed to build a clip')

    const dir = mkdtempSync(join(tmpdir(), 'civicsense-upload-'))
    const clip = join(dir, 'clip.mp4')
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x202428:s=320x240:r=10:d=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', clip,
    ])

    const response = await request.post('/api/v1/uploads', {
      multipart: {
        file: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(clip) },
        source_kind: 'patrol-car',
        purpose: 'dashcam clip handed in after a near miss report',
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const body = (await response.json()) as {
      upload_id: string
      detection_id: string | null
      needs_adjudication: boolean
      analysis: { sampling?: string; detection?: { proposed_situation: string | null } }
    }

    /* Which frames were looked at is part of the finding, because a thing
       between two sampled frames was not examined. */
    if (body.analysis.sampling) expect(body.analysis.sampling).toContain('not looked at')

    /* Whatever the model said, no incident exists yet. */
    const uploads = (await (await request.get('/api/v1/uploads')).json()) as {
      items: { upload_id: string; state: string; detection: { adjudication: string; incident_id: string | null } | null }[]
    }
    const record = uploads.items.find((u) => u.upload_id === body.upload_id)!
    expect(record.state).not.toBe('confirmed')
    if (record.detection) {
      expect(record.detection.adjudication).toBe('open')
      expect(record.detection.incident_id).toBeNull()
    }

    /* And a ruling without reasoning is refused, so the record carries why. */
    if (body.detection_id) {
      const thin = await request.post('/api/v1/uploads/adjudicate', {
        data: { detection_id: body.detection_id, decision: 'rejected', note: 'no' },
      })
      expect(thin.status()).toBe(400)
      expect(((await thin.json()) as { error: string }).error).toBe('note_required')

      const ruled = await request.post('/api/v1/uploads/adjudicate', {
        data: {
          detection_id: body.detection_id,
          decision: 'rejected',
          note: 'the frames show an empty carriageway and nothing that supports the reported situation',
        },
      })
      expect(ruled.ok()).toBe(true)
      expect(((await ruled.json()) as { incident_id: string | null }).incident_id).toBeNull()
    }
  })

  test('the intake screen keeps what was asserted apart from what was established', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto('/upload')

    await expect(page.getByRole('heading', { name: 'intake' })).toBeVisible()
    /* The distinction the whole screen is built around. */
    await expect(page.getByText('stated by you, not measured')).toBeVisible()
    await expect(page.getByText(/nothing corroborates any of this/)).toBeVisible()
    /* And the reason field explains why it is mandatory. */
    await expect(page.getByText(/formally complete and useless/)).toBeVisible()

    expect(errors).toEqual([])
  })
})
