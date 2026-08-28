import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
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
    expect(errors).toEqual([])
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
})
