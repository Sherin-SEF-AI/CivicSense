/**
 * MapLibre 6 resolves its worker as `./maplibre-gl-worker.mjs` relative to
 * import.meta.url. Under a bundler that is a hashed chunk path, so the worker
 * 404s, no source ever finishes loading, and the map renders only its background
 * with no error anywhere. Copying the worker to a stable public path and calling
 * setWorkerUrl is the fix; this script keeps that copy in sync with the package.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const from = join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist')
const to = join(process.cwd(), 'public', 'vendor')
mkdirSync(to, { recursive: true })

const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']
for (const file of files) {
  copyFileSync(join(from, file), join(to, file))
}
const version = JSON.parse(readFileSync(join(process.cwd(), 'node_modules', 'maplibre-gl', 'package.json'), 'utf8')).version
console.log(`synced maplibre worker ${version} into public/vendor`)
