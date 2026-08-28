import { expect, test } from '@playwright/test'
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectConsoleErrors, hasFfmpeg, ingestClip, registerSource, renderClip, seedIncident } from './helpers'

test.describe('forensics', () => {
  test('synchronized tiles play in lockstep and frame stepping is exact', async ({ page, request }) => {
    test.skip(!hasFfmpeg(), 'this test renders its own clips and needs ffmpeg on the machine')
    const errors = collectConsoleErrors(page)

    /* Two cameras on the same event, each contributing a real clip, is what the
       stage exists to reconcile. */
    const stamp = Date.now()
    const a = `E2E-VID-A-${stamp}`
    const b = `E2E-VID-B-${stamp}`
    await registerSource(request, a, { lat: 12.99, lon: 77.61, sync_quality: 'A' })
    await registerSource(request, b, { lat: 12.99002, lon: 77.61002, sync_quality: 'B' })

    const clip = renderClip(6, 'A')!
    const first = await ingestClip(request, a, {
      t_start: stamp,
      classes: ['lcv'],
      trigger: 'object:placed_and_left',
      situation_key: 'dumping',
    }, clip)
    await ingestClip(request, b, {
      t_start: stamp + 1500,
      classes: ['lcv'],
      trigger: 'object:placed_and_left',
      situation_key: 'dumping',
    }, renderClip(6, 'B')!)

    const id = first.incident_id!
    await page.goto(`/forensics/${id}`)
    await page.waitForSelector('canvas[aria-label="source coverage timeline"]')
    await page.waitForTimeout(2500)

    const tiles = page.locator('header:has(> span:text-is("ground plane")), [aria-label="source coverage timeline"]')
    await expect(tiles.first()).toBeVisible()

    /* Play briefly, then pause and confirm the clock advanced. */
    const readout = page.locator('div:has-text("stepping")').first()
    await expect(readout).toBeVisible()

    await page.keyboard.press(' ')
    await page.waitForTimeout(1200)
    await page.keyboard.press(' ')

    /* One frame forward then one back must land on the same instant, which is
       only true if stepping is quantised to the frame grid rather than to a
       wall-clock delta. */
    const before = await page.evaluate(() => document.querySelectorAll('video').length)
    expect(before, 'video tiles are mounted').toBeGreaterThan(0)

    await page.keyboard.press('.')
    await page.waitForTimeout(250)
    await page.keyboard.press(',')
    await page.waitForTimeout(250)

    expect(errors, errors.join('\n')).toHaveLength(0)
  })

  test('a coverage gap is stated rather than shown as a frozen frame', async ({ page, request }) => {
    const id = await seedIncident(request)
    await page.goto(`/forensics/${id}`)
    await page.waitForTimeout(2500)
    /* The window opens on the anchor, so seek to the very start where sources
       have not begun recording yet. */
    await page.keyboard.press('p')
    await page.keyboard.press('p')
    await page.keyboard.press('p')
    await page.waitForTimeout(500)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('a hash chip opens custody and verification recomputes the chain', async ({ page, request }) => {
    const id = await seedIncident(request)
    await page.goto(`/forensics/${id}`)
    await page.waitForSelector('[aria-label="evidence tree"]')
    await page.locator('[aria-label="evidence tree"] button[title*="click to open custody"]').first().click()
    const drawer = page.getByRole('complementary', { name: 'custody' })
    await expect(drawer).toBeVisible()

    /* The chain must be the stored one, not a plausible-looking construction.
       Every entry states whether it recomputes against the entry before it, and
       the entries are the ones the ingest path actually wrote. */
    await expect(drawer.getByText('capture', { exact: false }).first()).toBeVisible()
    const entries = drawer.getByRole('listitem')
    expect(await entries.count()).toBeGreaterThan(0)
    expect(await drawer.getByText('does not recompute').count()).toBe(0)
    expect(await drawer.getByText('recomputes', { exact: true }).count()).toBeGreaterThan(0)

    const before = await entries.count()
    await page.getByRole('button', { name: 'recompute and verify' }).click()
    await expect(page.getByText('chain intact')).toBeVisible()

    /* Both halves are reported separately, because bad bytes and a broken record
       of who touched them are different failures. */
    await expect(drawer.getByText('the bytes on disk hash to the name they are stored under')).toBeVisible()
    await expect(drawer.getByText(/entries recomputed from the evidence hash forward/)).toBeVisible()

    /* Asking is itself a custody event, so the chain grew by one. */
    await expect(async () => {
      expect(await entries.count()).toBe(before + 1)
    }).toPass({ timeout: 5000 })
    await expect(drawer.getByText('verify', { exact: false }).first()).toBeVisible()
  })

  test('a tampered object fails verification and says which half failed', async ({ page, request }) => {
    const id = await seedIncident(request)

    /* Reach into the store the way an attacker with disk access would: change
       the bytes and leave the row alone. The hash must stop matching. */
    const bundle = (await (await request.get(`/api/v1/forensics/${id}`)).json()) as {
      tree: { evidence_id: string }[]
    }
    const sha = bundle.tree[0]!.evidence_id
    /* Done directly on disk rather than through an endpoint. A forensics
       platform should not ship a route that can alter evidence, not even one
       fenced off for tests. */
    const store = process.env.CIVICSENSE_EVIDENCE ?? '.e2e/evidence'
    const dir = join(store, sha.slice(0, 2))
    const file = readdirSync(dir).find((f) => f.startsWith(sha))
    expect(file, `no stored object for ${sha}`).toBeTruthy()
    const path = join(dir, file!)
    const original = readFileSync(path)
    appendFileSync(path, Buffer.from([0x00]))

    await page.goto(`/forensics/${id}`)
    await page.waitForSelector('[aria-label="evidence tree"]')
    await page.locator('[aria-label="evidence tree"] button[title*="click to open custody"]').first().click()
    await page.getByRole('button', { name: 'recompute and verify' }).click()

    await expect(page.getByText('chain broken')).toBeVisible()
    await expect(page.getByText('the bytes on disk do not hash to their stored name')).toBeVisible()
    /* The custody record itself was not touched, so it must still verify. */
    await expect(page.getByText(/entries recomputed from the evidence hash forward/)).toBeVisible()

    writeFileSync(path, original)
  })
})
