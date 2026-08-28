import type { Page } from '@playwright/test'

/** Console errors are a failure condition, so every spec collects them. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

export async function firstIncidentId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/incidents?limit=1')
  const body = (await response.json()) as { items: { incident_id: string }[] }
  const id = body.items[0]?.incident_id
  if (!id) throw new Error('the fixture world returned no incidents')
  return id
}
