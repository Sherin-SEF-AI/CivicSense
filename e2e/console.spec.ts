import { expect, test } from '@playwright/test'
import { collectConsoleErrors, ingest, registerSource, seedIncident } from './helpers'

/**
 * The surfaces that had a working endpoint and no way to reach it.
 *
 * An API a person cannot operate is not a feature, so each of these drives the
 * real control rather than the route behind it.
 */
test.describe('console surfaces', () => {
  test('a zone profile can be edited from the admin screen', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto('/admin')

    const firstEdit = page.getByRole('button', { name: /^edit / }).first()
    await expect(firstEdit).toBeVisible()
    await firstEdit.click()

    const slider = page.getByRole('slider', { name: /^sensitivity for / })
    await expect(slider).toBeVisible()
    const before = await slider.inputValue()

    /* The panel must say what the edit changes before it is committed. */
    await slider.fill(String(Math.min(1, Number(before) + 0.2)))
    await expect(page.getByText(/severity in this zone shifts/)).toBeVisible()

    await page.getByRole('button', { name: 'save profile' }).click()
    await expect(page.getByText(/will score against the updated profile/)).toBeVisible()

    expect(errors).toEqual([])
  })

  test('a playbook step can be added and the version bumps', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('tab', { name: 'playbooks' }).click()

    await page.getByRole('button', { name: /^edit / }).first().click()
    await expect(page.getByRole('button', { name: 'add step' })).toBeVisible()

    await page.getByRole('button', { name: 'add step' }).click()
    /* A step with no text cannot be saved, and the reason is on screen. */
    await expect(page.getByText('every step needs text')).toBeVisible()

    const last = page.getByLabel(/^step \d+ text$/).last()
    await last.fill('added by the acceptance suite')
    await page.getByRole('button', { name: /^save as version/ }).click()
    await expect(page.getByText(/saved as version/)).toBeVisible()
  })

  test('a saved search is listed with its match count and can be removed', async ({ page }) => {
    const t = Date.now()
    await page.request.post('/api/v1/saved-searches', {
      data: { name: `console watch ${t}`, query: 'lcv last 24h', rerun: true },
    })
    const source = `E2E-UI-SS-${t}`
    await registerSource(page.request, source)
    await ingest(page.request, source, { classes: ['lcv'] }, t)

    await page.goto('/evidence')
    await expect(page.getByText('standing searches')).toBeVisible()
    const row = page.getByRole('listitem').filter({ hasText: `console watch ${t}` })
    await expect(row).toBeVisible()
    await expect(row.getByText(/\d+ new/)).toBeVisible()
    await expect(row.getByRole('checkbox', { name: /^re-run/ })).toBeChecked()

    await row.getByRole('button', { name: /^delete/ }).click()
    await expect(row).toBeHidden()
  })

  test('the synopsis condenses a source window and says how much was skipped', async ({ page }) => {
    const t = Date.now()
    const source = `E2E-UI-SYN-${t}`
    await registerSource(page.request, source)
    /* Three moments spread over an hour, so there is real dead time between. */
    for (const offset of [0, 20 * 60_000, 40 * 60_000]) {
      await ingest(page.request, source, { t_start: t - offset, classes: ['car'] }, t - offset)
    }

    await page.goto('/sources')
    await page.getByRole('row').filter({ hasText: source }).first().click()

    await expect(page.getByText('synopsis')).toBeVisible()
    await expect(page.getByText(/of coverage condensed to/)).toBeVisible()
    await expect(page.getByLabel('moment')).toBeVisible()

    /* Stepping to the second moment must state the gap that was skipped. */
    await page.getByLabel('moment').fill('1')
    await expect(page.getByText(/skipped$/)).toBeVisible()
  })

  test('the pre-alert banner appears for a life-safety trigger', async ({ page }) => {
    await page.goto('/ops')
    await page.waitForTimeout(1500)

    const id = `E2E-UI-PA-${Date.now()}`
    await registerSource(page.request, id, { lat: 12.9611, lon: 77.6387 })
    await ingest(page.request, id, {
      classes: ['fire'],
      trigger: 'class:fire',
      situation_key: 'fire',
      affected: 3,
    })

    /* The banner arrives over the live stream, not on the next page load. */
    const banner = page.getByRole('alert').first()
    await expect(banner).toBeVisible({ timeout: 10_000 })
    await expect(banner).toContainText('PRE-ALERT')
    /* How stale the alert already is, stated rather than implied. */
    await expect(banner).toContainText(/edge \d+ ms/)
    await expect(banner.getByRole('button', { name: 'open' })).toBeVisible()
  })

  test('hypotheses can be formed from the forensics rail', async ({ page }) => {
    const incidentId = await seedIncident(page.request)
    await page.goto(`/forensics/${incidentId}`)

    await page.getByRole('tab', { name: 'hypotheses' }).click()
    const form = page.getByRole('button', { name: /form competing explanations|form them again/ })
    await expect(form).toBeVisible()

    /* Explicit, because it costs a reasoning call. The copy has to say so. */
    await expect(page.getByText(/costs one reasoning call/)).toBeVisible()
  })

  test('an incident created after the page loaded appears without a reload', async ({ page }) => {
    await page.goto('/ops')
    /* Wait for the stream to actually be live rather than merely opened. */
    await expect(page.getByText('sse live').first()).toBeVisible({ timeout: 15_000 })

    const feed = page.getByLabel('incident feed')
    const before = await feed.getByRole('article').count()

    const id = `E2E-LIVE-${Date.now()}`
    await registerSource(page.request, id, { lat: 12.9352, lon: 77.6245 })
    await ingest(page.request, id, {
      classes: ['lcv'],
      trigger: 'object:placed_and_left',
      situation_key: 'dumping',
    })

    /* This is the whole point of holding the connection open. The client used
       to listen only for unnamed frames, so every named event on the wire was
       discarded and the console sat on a live connection showing stale state. */
    await expect(feed.getByText('waste dumping').first()).toBeVisible({ timeout: 15_000 })
    expect(await feed.getByRole('article').count()).toBeGreaterThanOrEqual(before)
  })
})
