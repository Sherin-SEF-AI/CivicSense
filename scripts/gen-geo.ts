/**
 * Emits the keyless basemap. Run with `npm run geo`. Output is committed so the
 * app has no build-time dependency on this script and works fully offline.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGreen,
  buildRoadsMajor,
  buildRoadsMinor,
  buildWater,
  buildZones,
} from '../lib/geo/build'

const SEED = 20260828
const out = join(process.cwd(), 'public', 'basemap')
mkdirSync(out, { recursive: true })

const files = {
  'roads_major.geojson': buildRoadsMajor(SEED),
  'roads_minor.geojson': buildRoadsMinor(SEED),
  'water.geojson': buildWater(),
  'green.geojson': buildGreen(),
  'zones.geojson': buildZones(SEED),
}

for (const [name, data] of Object.entries(files)) {
  const json = JSON.stringify(data)
  writeFileSync(join(out, name), json)
  console.log(`${name.padEnd(22)} ${String(data.features.length).padStart(5)} features  ${(json.length / 1024).toFixed(1)} kB`)
}
