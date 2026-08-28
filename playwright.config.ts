import { defineConfig, devices } from '@playwright/test'

/**
 * The acceptance criteria as executable specs.
 *
 * Chrome is used through its stable channel rather than a downloaded build,
 * because Playwright does not ship a chromium for this distribution. Software
 * WebGL is forced on so the map renders headlessly and the sixty frame budget is
 * measured against something real rather than skipped.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3112',
    trace: 'retain-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  /**
   * The suite runs against its own database and evidence store.
   *
   * It creates real sources and ingests real bytes through the production
   * endpoints, so it must not write into the deployment's store. reuseExistingServer
   * is off for the same reason: a server already running on the dev database would
   * be the wrong target.
   *
   * The store is deleted first. Several specs assert exact counts, and a record
   * left behind by the previous run fuses with the one this run creates, which
   * makes those assertions fail for a reason that has nothing to do with the
   * code under test.
   */
  webServer: {
    command: 'rm -rf .e2e && npm run bootstrap && next dev -p 3112',
    url: 'http://localhost:3112/api/v1/system/health',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      CIVICSENSE_DB: '.e2e/civicsense.db',
      CIVICSENSE_EVIDENCE: '.e2e/evidence',
    },
    /* next dev reads .env.local, so the suite's server picks up GROQ_API_KEY if
       one is set and exercises the configured branch. */
  },
})
