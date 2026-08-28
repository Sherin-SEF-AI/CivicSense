import { defineConfig, devices } from '@playwright/test'

/**
 * The forensic tier suite.
 *
 * Requires Docker and `npm run fis:up`. Kept separate from the main acceptance
 * suite so that suite never acquires an infrastructure dependency: a console
 * running without the forensic tier is a supported deployment, and its tests
 * have to keep proving that.
 */
export default defineConfig({
  testDir: './e2e-fis',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3117', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'rm -rf .e2e-fis && npm run bootstrap && next dev -p 3117',
    url: 'http://localhost:3117/api/v1/system/health',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      CIVICSENSE_DB: '.e2e-fis/civicsense.db',
      CIVICSENSE_EVIDENCE: '.e2e-fis/evidence',
      FIS_BASE_URL: process.env.FIS_BASE_URL ?? 'http://localhost:8099',
    },
  },
})
