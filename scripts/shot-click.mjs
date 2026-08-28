import { chromium } from '@playwright/test'
const [, , url, out, selector, w = '1600', h = '1000'] = process.argv
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 })
const errors = []
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
p.on('pageerror', e => errors.push(String(e)))
await p.goto(url, { waitUntil: 'load' })
await p.waitForTimeout(3500)
if (selector && selector !== '-') { await p.click(selector); await p.waitForTimeout(2500) }
await p.screenshot({ path: out })
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'console clean')
await b.close()
