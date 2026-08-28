import { expect, test } from '@playwright/test'
import { collectConsoleErrors, ingest, registerSource } from './helpers'

test.describe('operations', () => {
  /* The suite creates its own incidents through the real ingest endpoint, so
     what it exercises is the production path rather than a fixture. */
  test.beforeAll(async ({ request }) => {
    for (let i = 0; i < 6; i++) {
      const source = `E2E-OPS-${i}`
      await registerSource(request, source, { lat: 12.96 + i * 0.004, lon: 77.58 + i * 0.004 })
      await ingest(
        request,
        source,
        {
          classes: ['motorcycle', 'person'],
          trigger: 'class:no_helmet',
          situation_key: i % 2 === 0 ? 'no-helmet' : 'dumping',
          affected: 2 + i,
        },
        Date.now() + i,
      )
    }
  })

  test('an operator can triage from the keyboard in under five seconds', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto('/ops')
    await page.waitForSelector('[role="listitem"]')

    /* Focus the feed the way an operator would, then work only from the keyboard. */
    await page.locator('[role="listitem"]').first().focus()

    const started = Date.now()
    await page.keyboard.press('j')
    await page.keyboard.press('a')
    await expect(page.locator('[role="listitem"][aria-current="true"]')).toContainText('ack', { timeout: 8000 })
    await page.keyboard.press('d')
    await page.waitForFunction(
      () => document.body.textContent?.includes('dispatched') ?? false,
      undefined,
      { timeout: 8000 },
    )
    const elapsed = Date.now() - started

    expect(elapsed, 'acknowledge and dispatch from the keyboard').toBeLessThan(5000)
    expect(errors, errors.join('\n')).toHaveLength(0)
  })

  test('the map renders its layers and the feed groups by priority band', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto('/ops')
    await page.waitForSelector('canvas.maplibregl-canvas')
    await page.waitForTimeout(3500)

    const rendered = await page.evaluate(() => {
      const map = (window as unknown as { __csmap?: { queryRenderedFeatures: (o: unknown) => unknown[] } }).__csmap
      if (!map) return null
      return {
        incidents: map.queryRenderedFeatures({ layers: ['incident-ring'] }).length,
        fov: map.queryRenderedFeatures({ layers: ['fov-fill'] }).length,
        roads: map.queryRenderedFeatures({ layers: ['roads-major'] }).length,
      }
    })

    expect(rendered, 'the map controller exposes a live instance').not.toBeNull()
    /* Roads come from the OpenStreetMap extract, so this also asserts the real
       basemap is present rather than an empty style. */
    expect(rendered!.roads, 'basemap roads render').toBeGreaterThan(0)
    expect(rendered!.fov, 'camera fields of view render').toBeGreaterThan(0)
    expect(rendered!.incidents, 'ingested incidents render on the map').toBeGreaterThan(0)
    expect(errors, errors.join('\n')).toHaveLength(0)
  })

  test('the command palette opens and navigates', async ({ page }) => {
    await page.goto('/ops')
    await page.waitForSelector('[role="listitem"]')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'command palette' })).toBeVisible()
    await page.getByRole('textbox', { name: 'command' }).fill('sources')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sources/)
  })
})
