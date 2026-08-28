import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

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
export const MAP_BASE = 'var(--bg-0)'

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
      { id: 'bg', type: 'background', paint: { 'background-color': '#08090b' } },
      {
        id: 'green',
        type: 'fill',
        source: 'green',
        paint: { 'fill-color': '#0d130f', 'fill-outline-color': '#141b16' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'water',
        paint: { 'fill-color': '#0b1118', 'fill-outline-color': '#152030' },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'roads_minor',
        minzoom: 12,
        paint: {
          'line-color': '#161a1f',
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 12, 0.4, 16, 1.6],
        },
      },
      {
        id: 'roads-major-casing',
        type: 'line',
        source: 'roads_major',
        paint: {
          'line-color': '#0e1114',
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 1.6, 16, 9],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'roads_major',
        paint: {
          'line-color': ['match', ['get', 'klass'], 'ring', '#252c34', 'arterial', '#20262d', '#1b2027'],
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 0.8, 16, 5],
        },
      },
      {
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#58a6ff', 'fill-opacity': 0.04 },
      },
      {
        id: 'zone-line',
        type: 'line',
        source: 'zones',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#2a313a', 'line-width': 1, 'line-dasharray': [2, 3] },
      },
    ],
  }
}
