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
    baseURL: 'http://localhost:3111',
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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3111/api/v1/system/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
