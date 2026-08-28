import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { CANVAS } from '@/lib/tokens'

/**
 * The keyless dark matte basemap.
 *
 * There is no tile server and no API key: the sources are the GeoJSON files
 * generated into public/basemap, so the map works with no network at all. That
 * matters for a control room, and it also means every layer colour is ours
 * rather than a vendor style we have to fight.
 *
 * Deliberately absent: a `sprite` key and any `text-field`. Images are registered
 * imperatively with addImage, and labels are DOM, because self-hosting glyph
 * PBFs for a handful of cluster counts is not worth the build step.
 */
export function darkMatteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      green: { type: 'geojson', data: '/basemap/green.geojson' },
      water: { type: 'geojson', data: '/basemap/water.geojson' },
      roads_minor: { type: 'geojson', data: '/basemap/roads_minor.geojson' },
      roads_major: { type: 'geojson', data: '/basemap/roads_major.geojson' },
      zones: { type: 'geojson', data: '/basemap/zones.geojson' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': CANVAS.bg0 } },
      {
        id: 'green',
        type: 'fill',
        source: 'green',
        paint: { 'fill-color': CANVAS.mapGreen, 'fill-outline-color': CANVAS.mapGreenEdge },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'water',
        paint: { 'fill-color': CANVAS.mapWater, 'fill-outline-color': CANVAS.mapWaterEdge },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'roads_minor',
        minzoom: 12,
        paint: {
          'line-color': CANVAS.mapRoadMinor,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 12, 0.4, 16, 1.6],
        },
      },
      {
        id: 'roads-major-casing',
        type: 'line',
        source: 'roads_major',
        paint: {
          'line-color': CANVAS.bg1,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 1.6, 16, 9],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'roads_major',
        paint: {
          'line-color': ['match', ['get', 'klass'], 'ring', CANVAS.mapRoadRing, 'arterial', CANVAS.mapRoadArterial, CANVAS.mapRoadOther],
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 0.8, 16, 5],
        },
      },
      {
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        layout: { visibility: 'none' },
        paint: { 'fill-color': CANVAS.live, 'fill-opacity': 0.04 },
      },
      {
        id: 'zone-line',
        type: 'line',
        source: 'zones',
        layout: { visibility: 'none' },
        paint: { 'line-color': CANVAS.line1, 'line-width': 1, 'line-dasharray': [2, 3] },
      },
    ],
  }
}
