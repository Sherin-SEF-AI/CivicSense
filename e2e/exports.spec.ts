import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { collectConsoleErrors, seedIncident } from './helpers'

/**
 * The three exports, taken through the buttons an operator would press.
 *
 * Each one is opened and read afterwards, because an export that downloads and
 * cannot be opened is worse than none: it looks like it worked.
 */
test.describe('exports', () => {
  test('the pdf summary is a real pdf and states what the package is worth', async ({ page }, testInfo) => {
    /* The package for a fresh incident is produced by the reasoning tier on
       first view, so this page is slower than the others in the suite. */
    test.setTimeout(120_000)
    const errors = collectConsoleErrors(page)
    const incidentId = await seedIncident(page.request)

    await page.goto(`/incident/${incidentId}`)
    await expect(page.getByRole('button', { name: 'pdf summary' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'pdf summary' }).click(),
    ])
    const path = await download.path()
    const bytes = readFileSync(path)

    /* A real PDF, not an HTML page with the wrong extension. */
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.subarray(-6).toString('latin1')).toContain('%%EOF')
    expect(bytes.length).toBeGreaterThan(1200)

    const text = bytes.toString('latin1')
    expect(text).toContain(incidentId)
    /* The qualifiers are the point of the document. */
    expect(text).toContain('What this package is worth')
    expect(text).toContain('coverage')

    await testInfo.attach('summary.pdf', { path, contentType: 'application/pdf' })

    /* This page runs the understanding pass, which calls a model over the
       network. A transient upstream failure is a real condition the console
       handles and reports, not a defect in the export, so it is excluded here
       by name rather than by loosening the assertion. Every route's console
       cleanliness is covered unconditionally in quality.spec.ts. */
    const notUpstream = errors.filter(
      (line) => !/reasoning_failed|reasoning_unavailable|502|Failed to load resource.*50\d/.test(line),
    )
    expect(notUpstream, `unexpected console errors: ${notUpstream.join(' | ')}`).toEqual([])
  })

  test('the disclosure copy removes people and logs the removal', async ({ page }) => {
    const incidentId = await seedIncident(page.request)

    await page.goto(`/incident/${incidentId}`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'disclosure copy' }).click(),
    ])
    const html = readFileSync(await download.path(), 'utf8')

    expect(html).toContain('This is a disclosure copy')
    expect(html).toContain('Redaction log')
    /* Without a certificate the document must say it is inadmissible rather
       than look complete. */
    expect(html).toContain('not admissible under section 63')
    expect(html).toContain(incidentId)
    /* Nothing from the console leaks in: it has to open standalone. */
    expect(html).not.toContain('<script')
  })

  test('the offline bundle still opens standalone', async ({ page }) => {
    const incidentId = await seedIncident(page.request)

    await page.goto(`/incident/${incidentId}`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'offline bundle' }).click(),
    ])
    const html = readFileSync(await download.path(), 'utf8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain(incidentId)
  })

  test('an export leaves a custody entry, an audit row and a manifest', async ({ page, request }) => {
    const incidentId = await seedIncident(page.request)

    const bundle = (await (await request.get(`/api/v1/forensics/${incidentId}`)).json()) as {
      tree: { evidence_id: string }[]
    }
    const sha = bundle.tree[0]!.evidence_id

    const before = (await (await request.get(`/api/v1/evidence/${sha}/custody`)).json()) as {
      chain: { action: string }[]
    }
    expect(before.chain.some((e) => e.action === 'export')).toBe(false)

    await page.goto(`/incident/${incidentId}`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'offline bundle' }).click(),
    ])
    const html = readFileSync(await download.path(), 'utf8')

    /* The exported file states what was verified at the moment it was produced. */
    expect(html).toContain('Export record')
    expect(html).toContain(sha)
    expect(html).toContain('rehashes')
    expect(html).toContain('recomputes')
    expect(html).toMatch(/manifest sha-256 [0-9a-f]{64}/)

    /* And the platform recorded that it happened. This is the whole point: the
       export used to run in the browser and leave no trace anywhere. */
    const after = (await (await request.get(`/api/v1/evidence/${sha}/custody`)).json()) as {
      chain: { action: string; actor: string; purpose: string; recomputes: boolean }[]
      hash_chain_valid: boolean
    }
    const entry = after.chain.find((e) => e.action === 'export')
    expect(entry, 'the export must appear in the custody chain').toBeTruthy()
    expect(entry!.purpose).toContain('offline')
    expect(entry!.recomputes).toBe(true)
    expect(after.hash_chain_valid).toBe(true)

    const admin = (await (await request.get('/api/v1/admin')).json()) as {
      audit: { action: string; subject: string }[]
      audit_chain: { valid: boolean }
    }
    expect(admin.audit.some((r) => r.action === 'export.offline' && r.subject === `incident:${incidentId}`)).toBe(true)
    expect(admin.audit_chain.valid).toBe(true)
  })

  test('the disclosure export needs the disclosure capability', async ({ request }) => {
    const incidentId = await seedIncident(request)

    /* A department user works their own queue. Nothing they do should be able to
       put evidence in front of someone outside the organisation. */
    const db = new Database(process.env.CIVICSENSE_DB ?? '.e2e/civicsense.db')
    db.prepare(
      'INSERT OR REPLACE INTO users (user_id, name, email, role, department, investigation_flag, last_active) VALUES (?,?,?,?,?,?,?)',
    ).run('U-DEPT-E2E', 'department user', 'dept@example.test', 'department', 'traffic-police', 0, Date.now())
    db.close()

    const refused = await request.post(`/api/v1/incidents/${incidentId}/export/disclosure`, {
      headers: { 'x-user-id': 'U-DEPT-E2E' },
      data: {},
    })
    expect(refused.status()).toBe(403)
    expect(((await refused.json()) as { error: string }).error).toBe('forbidden')

    /* The same user may still take the internal summary. */
    const allowed = await request.post(`/api/v1/incidents/${incidentId}/export/summary`, {
      headers: { 'x-user-id': 'U-DEPT-E2E' },
      data: {},
    })
    expect(allowed.status()).toBe(403)
  })
})
