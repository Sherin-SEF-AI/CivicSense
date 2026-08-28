import { chromium } from '@playwright/test'

const [, , url, out, w = '1600', h = '1000', full = '0'] = process.argv
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(3500)
await page.screenshot({ path: out, fullPage: full === '1' })
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'console clean')
await browser.close()
