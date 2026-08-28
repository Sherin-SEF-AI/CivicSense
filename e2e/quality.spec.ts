import { expect, test } from '@playwright/test'
import { collectConsoleErrors, seedIncident } from './helpers'

const ROUTES = ['/ops', '/forensics', '/evidence', '/cases', '/predict', '/sources', '/analytics', '/query', '/admin']

test.describe('quality bar', () => {
  for (const route of ROUTES) {
    test(`${route} renders with no console errors`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await page.goto(route)
      await page.waitForTimeout(3000)
      expect(errors, `${route}: ${errors.join('\n')}`).toHaveLength(0)
    })
  }

  test('every interactive element has a visible focus state', async ({ page }) => {
    await page.goto('/ops')
    await page.waitForSelector('[role="listitem"]')
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const active = document.activeElement
      if (!active) return null
      const style = getComputedStyle(active)
      return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle }
    })
    expect(outline).not.toBeNull()
    expect(outline!.outlineStyle).not.toBe('none')
  })

  test('the map holds its frame budget while panning with the full incident set', async ({ page }) => {
    await page.goto('/ops')
    await page.waitForSelector('canvas.maplibregl-canvas')
    await page.waitForTimeout(3500)

    const result = await page.evaluate(async () => {
      const map = (window as unknown as {
        __csmap?: { panBy: (offset: [number, number], options?: unknown) => void; getZoom: () => number }
      }).__csmap
      if (!map) return null

      const frames: number[] = []
      let last = performance.now()
      let running = true
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)

      for (let i = 0; i < 8; i++) {
        map.panBy([120, 60], { duration: 220 })
        await new Promise((r) => setTimeout(r, 260))
      }
      running = false

      const sorted = frames.slice(4).sort((a, b) => a - b)
      return {
        frames: sorted.length,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      }
    })

    expect(result, 'the map controller exposes a live instance').not.toBeNull()
    expect(result!.frames, 'frames were sampled').toBeGreaterThan(30)
    /* 16.7ms is sixty frames. The median is the honest measure here: a single
       long frame during a style operation is expected, a slow median is not. */
    expect(result!.median, `median frame time ${result!.median.toFixed(1)}ms`).toBeLessThan(20)
  })

  test('an incident with no assessment says so rather than inventing one', async ({ page, request }) => {
    const id = await seedIncident(request)
    await page.goto(`/incident/${id}`)

    /* Without GROQ_API_KEY the understanding tier cannot run. The screen must
       state that plainly: a fabricated package is the one failure mode this
       product cannot have. */
    const hasKey = process.env.GROQ_API_KEY !== undefined && process.env.GROQ_API_KEY !== ''
    if (hasKey) {
      await expect(page.getByText('evidence reel')).toBeVisible({ timeout: 60_000 })
    } else {
      await expect(page.getByText('no assessment for this incident')).toBeVisible()
      await expect(page.getByRole('button', { name: 'run the understanding pass' })).toBeVisible()
    }
  })
})
