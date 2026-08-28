import { expect, test } from '@playwright/test'

/**
 * The forensic tier, when it is attached.
 *
 * These specs are separate from the main suite on purpose. The console must stay
 * fully testable on a machine with no Docker, because the forensic tier being
 * detached is a supported configuration rather than a broken one.
 */
test.describe('forensic tier', () => {
  test('the console reports the tier as attached and names the registry', async ({ request }) => {
    const health = (await (await request.get('/api/v1/fis/health')).json()) as {
      available: boolean
      health?: { postgres: string; operators: number; registry_digest: string }
      reason?: string
    }
    expect(health.available, health.reason).toBe(true)
    expect(health.health!.postgres).toBe('up')
    expect(health.health!.operators).toBeGreaterThan(0)
    /* The registry digest is what a recipe cites, so it has to be a real digest. */
    expect(health.health!.registry_digest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('every published operator declares a class, and class E is cpu and deterministic', async ({ request }) => {
    const body = (await (await request.get('/api/v1/fis/operators')).json()) as {
      items: { operator_id: string; class: string; gpu: boolean; deterministic: boolean; summary: string }[]
    }
    expect(body.items.length).toBeGreaterThan(0)

    for (const operator of body.items) {
      expect(['E', 'I', 'D']).toContain(operator.class)
      expect(operator.summary.length).toBeGreaterThan(10)
      if (operator.class === 'E') {
        /* A gpu float reduction is not reproducible across driver versions, so
           an evidentiary operator cannot use one. The database refuses the
           combination too; this checks the published contract agrees. */
        expect(operator.gpu, `${operator.operator_id} is class E and declares gpu`).toBe(false)
        expect(operator.deterministic, `${operator.operator_id} is class E and not deterministic`).toBe(true)
      }
    }
  })
})
