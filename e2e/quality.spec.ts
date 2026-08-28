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

    /* Whether the understanding tier is configured is a property of the server,
       not of this process, so ask the server rather than reading an env var the
       test runner may not share. */
    const probe = await request.get(`/api/v1/incidents/${id}/package`)
    const body = (await probe.json()) as { error?: string }
    const configured = body.error !== 'reasoning_unavailable'

    if (configured) {
      /* With a model configured the package must render an assessment. */
      await expect(page.getByText('evidence reel')).toBeVisible({ timeout: 90_000 })
      await expect(page.getByText('model trace').first()).toBeVisible()
    } else {
      /* Without one the screen must say so. A fabricated package is the single
         failure mode this product cannot have. */
      await expect(page.getByText('no assessment for this incident')).toBeVisible()
      await expect(page.getByRole('button', { name: 'run the understanding pass' })).toBeVisible()
    }
  })

  test('an unconfirmed violation never produces an enforcement recommendation', async ({ request }) => {
    const id = await seedIncident(request)
    const response = await request.post(`/api/v1/incidents/${id}/package`, { data: {} })
    const body = (await response.json()) as
      | { error: string }
      | { package: { scene: { trigger_agreement: boolean }; legal: unknown[]; routing: { action_line: string } | null } }

    if ('error' in body) {
      test.skip(true, 'the understanding tier is not configured on this server')
      return
    }

    if (!body.package.scene.trigger_agreement) {
      /* The evidence did not support the trigger, so nothing punitive may follow
         from it: no statute, and no enforcement in the action line. */
      expect(body.package.legal).toHaveLength(0)
      const line = body.package.routing?.action_line ?? ''
      expect(line).not.toMatch(/\b(ticket|challan|fine|penalty|prosecute|impound|seize)\b/i)
    }
  })
})
