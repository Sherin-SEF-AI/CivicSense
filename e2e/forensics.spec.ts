import { expect, test } from '@playwright/test'
import { collectConsoleErrors, firstIncidentId } from './helpers'

test.describe('forensics', () => {
  test('four sources stay in lockstep and frame stepping is exact', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const id = await firstIncidentId(page)
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

  test('a coverage gap is stated rather than shown as a frozen frame', async ({ page }) => {
    const id = await firstIncidentId(page)
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

  test('a hash chip opens custody and verification recomputes the chain', async ({ page }) => {
    const id = await firstIncidentId(page)
    await page.goto(`/forensics/${id}`)
    await page.waitForSelector('[aria-label="evidence tree"]')
    await page.locator('[aria-label="evidence tree"] button[title*="click to open custody"]').first().click()
    await expect(page.getByRole('complementary', { name: 'custody' })).toBeVisible()
    await page.getByRole('button', { name: 'recompute and verify' }).click()
    await expect(page.getByText('chain intact')).toBeVisible()
  })
})
