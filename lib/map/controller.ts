'use client'

import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { IncidentSummary, RiskCell, SourceDevice } from '@/lib/api/schemas'
import { CANVAS, DOMAIN_GLYPH } from '@/lib/tokens'
import { cellToBoundary } from 'h3-js'
import { fovWedge } from '@/lib/geo/build'
import { BENGALURU_CENTER } from '@/lib/geo/bengaluru'
import { registerArrowImage, registerGlyphImages } from './images'
import { darkMatteStyle } from './style'

/**
 * Owns the MapLibre instance. React mounts it and never touches it again.
 *
 * The rules that keep two thousand markers at sixty frames:
 *   - everything that can be a native style layer is one, so the GPU does the
 *     work and JS does none per frame
 *   - acknowledgement, hover and selection go through feature state, which never
 *     re-tiles, rather than through setData
 *   - setData is deferred until the camera stops, because a re-parse in the
 *     middle of a pan is exactly the dropped frame a user notices
 *   - the CRITICAL blink is two setPaintProperty calls a second on an expression
 *     the GPU re-evaluates, not a per-marker animation
 */

const SRC = {
  incidents: 'incidents',
  clustered: 'incidents-clustered',
  fov: 'fov',
  sensors: 'sensors',
  patrol: 'patrol',
  trails: 'trails',
  risk: 'risk',
} as const

export const LAYER = {
  risk: 'risk-fill',
  fov: 'fov-fill',
  sensors: 'sensor-node',
  trails: 'patrol-trail',
  patrol: 'patrol-arrow',
  clusterCircle: 'cluster-circle',
  incidentRing: 'incident-ring',
  incidentBlink: 'incident-blink',
  incidentGlyph: 'incident-glyph',
  selection: 'incident-selected',
} as const

const PRIORITY_EXPR: ExpressionSpecification = [
  'match',
  ['get', 'priority'],
  'CRITICAL', CANVAS.critical,
  'HIGH', CANVAS.high,
  'MEDIUM', CANVAS.medium,
  'LOW', CANVAS.low,
  CANVAS.info,
]

export interface MapCallbacks {
  onSelect: (incidentId: string | null) => void
  onHover: (incidentId: string | null, screen: { x: number; y: number } | null) => void
  onClusterCounts: (clusters: { id: number; count: number; x: number; y: number }[]) => void
}

/**
 * MapLibre 6 builds its worker URL from import.meta.url, which a bundler turns
 * into a hashed chunk path, so the default resolution 404s and every source
 * stalls silently. The worker is copied to a stable public path by
 * scripts/sync-map-worker.mjs and pinned here before any map is constructed.
 */
let workerPinned = false
function pinWorker() {
  if (workerPinned) return
  workerPinned = true
  setWorkerUrl('/vendor/maplibre-gl-worker.mjs')
}

export class MapController {
  private map: MapLibreMap | null = null
  private ready = false
  private pending = new Map<string, GeoJSON.FeatureCollection>()
  private blinkTimer: ReturnType<typeof setInterval> | null = null
  private blinkOn = true
  private hovered: string | null = null
  private selected: string | null = null
  private incidents: IncidentSummary[] = []
  private clusteringOn = false

  constructor(private callbacks: MapCallbacks) {}

  mount(container: HTMLDivElement) {
    pinWorker()
    const map = new MapLibreMap({
      container,
      style: darkMatteStyle(),
      center: [BENGALURU_CENTER.lon, BENGALURU_CENTER.lat],
      zoom: 11.4,
      minZoom: 9,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
    })
    this.map = map
    map.touchZoomRotate.disableRotation()
    /* Exposed deliberately, not as debug leftovers: the acceptance suite asserts
       that basemap roads, camera wedges and clusters actually rendered, and there
       is no way to ask that question from outside the map instance. */
    ;(window as unknown as { __csmap?: MapLibreMap }).__csmap = map
    map.on('error', (e) => {
      console.error('[map]', e.error?.message ?? String(e))
    })

    /* style.load fires on every setStyle, so installation is idempotent and
       lives in one place. Adding layers from an unrelated effect is how map apps
       end up rendering a bare basemap after a theme change. */
    map.on('style.load', () => {
      this.install(map)
      this.ready = true
      for (const [id, data] of this.pending) this.setSourceData(id, data)
      this.pending.clear()
    })

    map.on('idle', () => this.emitClusters())
    map.on('moveend', () => this.emitClusters())
    map.on('zoomend', () => {
      this.applyClusterPolicy()
      this.emitClusters()
    })
    map.on('move', () => this.emitClusters())

    return () => this.destroy()
  }

  private install(map: MapLibreMap) {
    registerGlyphImages(map, Object.values(DOMAIN_GLYPH))
    registerArrowImage(map)

    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

    map.addSource(SRC.risk, { type: 'geojson', data: empty })
    map.addSource(SRC.fov, { type: 'geojson', data: empty })
    map.addSource(SRC.sensors, { type: 'geojson', data: empty })
    map.addSource(SRC.trails, { type: 'geojson', data: empty, lineMetrics: true })
    map.addSource(SRC.patrol, { type: 'geojson', data: empty })
    map.addSource(SRC.incidents, { type: 'geojson', data: empty, promoteId: 'incident_id' })
    map.addSource(SRC.clustered, {
      type: 'geojson',
      data: empty,
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 16,
    })

    map.addLayer({
      id: LAYER.risk,
      type: 'fill',
      source: SRC.risk,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'risk'], 0, CANVAS.line0, 0.4, CANVAS.medium, 0.7, CANVAS.high, 1, CANVAS.critical],
        'fill-opacity': ['interpolate', ['linear'], ['get', 'risk'], 0, 0.05, 1, 0.35],
      },
    })

    map.addLayer({
      id: LAYER.fov,
      type: 'fill',
      source: SRC.fov,
      paint: { 'fill-color': CANVAS.live, 'fill-opacity': 0.18 },
    })

    map.addLayer({
      id: LAYER.sensors,
      type: 'circle',
      source: SRC.sensors,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 3.4],
        'circle-color': ['case', ['==', ['get', 'state'], 'up'], CANVAS.ok, ['==', ['get', 'state'], 'down'], CANVAS.critical, CANVAS.medium],
        'circle-opacity': 0.9,
      },
    })

    /* The trail fade is a line-gradient over line-progress: the GPU does it, and
       JS only trims points older than fifteen minutes once a second. */
    map.addLayer({
      id: LAYER.trails,
      type: 'line',
      source: SRC.trails,
      paint: {
        'line-width': 1.2,
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0, 'rgba(88,166,255,0)',
          0.7, 'rgba(88,166,255,0.18)',
          1, 'rgba(88,166,255,0.55)',
        ],
      },
    })

    map.addLayer({
      id: LAYER.patrol,
      type: 'symbol',
      source: SRC.patrol,
      layout: {
        'icon-image': 'patrol-arrow',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.42, 16, 0.8],
      },
    })

    map.addLayer({
      id: LAYER.clusterCircle,
      type: 'circle',
      source: SRC.clustered,
      filter: ['has', 'point_count'],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': CANVAS.bg2,
        'circle-stroke-color': CANVAS.line1,
        'circle-stroke-width': 1,
        'circle-radius': ['step', ['get', 'point_count'], 12, 20, 16, 80, 20, 300, 26],
      },
    })

    map.addLayer({
      id: LAYER.selection,
      type: 'circle',
      source: SRC.incidents,
      filter: ['==', ['get', 'incident_id'], ''],
      paint: {
        'circle-radius': 13,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': CANVAS.ink0,
        'circle-stroke-width': 1,
      },
    })

    map.addLayer({
      id: LAYER.incidentBlink,
      type: 'circle',
      source: SRC.incidents,
      filter: ['all', ['==', ['get', 'priority'], 'CRITICAL'], ['==', ['get', 'acknowledged'], false]],
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': CANVAS.critical,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 1,
      },
    })

    map.addLayer({
      id: LAYER.incidentRing,
      type: 'circle',
      source: SRC.incidents,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 11],
        'circle-color': CANVAS.bg1,
        'circle-stroke-color': PRIORITY_EXPR,
        'circle-stroke-width': 2,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.92],
      },
    })

    map.addLayer({
      id: LAYER.incidentGlyph,
      type: 'symbol',
      source: SRC.incidents,
      layout: {
        'icon-image': ['concat', 'glyph-', ['get', 'domain']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 0.72],
      },
    })

    map.on('click', LAYER.incidentRing, (e) => {
      const id = e.features?.[0]?.properties?.incident_id
      if (typeof id === 'string') this.callbacks.onSelect(id)
    })
    map.on('click', LAYER.clusterCircle, (e) => {
      const feature = e.features?.[0]
      const clusterId = feature?.properties?.cluster_id
      if (typeof clusterId !== 'number') return
      const source = map.getSource(SRC.clustered) as GeoJSONSource
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geometry = feature?.geometry
        if (geometry?.type === 'Point') {
          map.easeTo({ center: geometry.coordinates as [number, number], zoom, duration: 120 })
        }
      })
    })

    map.on('mousemove', LAYER.incidentRing, (e) => {
      const id = e.features?.[0]?.properties?.incident_id
      if (typeof id !== 'string') return
      map.getCanvas().style.cursor = 'pointer'
      this.setHover(id)
      this.callbacks.onHover(id, { x: e.point.x, y: e.point.y })
    })
    map.on('mouseleave', LAYER.incidentRing, () => {
      map.getCanvas().style.cursor = ''
      this.setHover(null)
      this.callbacks.onHover(null, null)
    })

    this.startBlink()
  }

  private setHover(id: string | null) {
    const map = this.map
    if (!map || !this.ready) return
    if (this.hovered === id) return
    if (this.hovered) map.setFeatureState({ source: SRC.incidents, id: this.hovered }, { hover: false })
    this.hovered = id
    if (id) map.setFeatureState({ source: SRC.incidents, id }, { hover: true })
  }

  /**
   * One square wave for the whole app: two paint-property writes a second, and
   * the GPU re-evaluates the expression for every feature. A hard step, not a
   * fade, which is what the motion rule asks for.
   */
  private startBlink() {
    if (this.blinkTimer) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    this.blinkTimer = setInterval(() => {
      const map = this.map
      if (!map || !map.getLayer(LAYER.incidentBlink)) return
      this.blinkOn = !this.blinkOn
      map.setPaintProperty(LAYER.incidentBlink, 'circle-stroke-opacity', this.blinkOn ? 1 : 0.15)
    }, 500)
  }

  private setSourceData(id: string, data: GeoJSON.FeatureCollection) {
    const map = this.map
    if (!map || !this.ready) {
      this.pending.set(id, data)
      return
    }
    const source = map.getSource(id) as GeoJSONSource | undefined
    source?.setData(data)
  }

  /** Queued while the camera moves, flushed when it stops. */
  private deferred = new Map<string, GeoJSON.FeatureCollection>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private queueSourceData(id: string, data: GeoJSON.FeatureCollection) {
    const map = this.map
    if (map?.isMoving()) {
      this.deferred.set(id, data)
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flushDeferred(), 2000)
        map.once('moveend', () => this.flushDeferred())
      }
      return
    }
    this.setSourceData(id, data)
  }

  private flushDeferred() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const [id, data] of this.deferred) this.setSourceData(id, data)
    this.deferred.clear()
  }

  setIncidents(incidents: IncidentSummary[]) {
    this.incidents = incidents
    const features: GeoJSON.Feature[] = incidents.map((i) => ({
      type: 'Feature',
      id: i.incident_id,
      geometry: { type: 'Point', coordinates: [i.position.lon, i.position.lat] },
      properties: {
        incident_id: i.incident_id,
        domain: i.domain,
        priority: i.priority,
        acknowledged: i.acknowledged,
        title: i.title,
        css: i.css.value,
        sources: i.source_count,
        detected_at: i.detected_at,
        sync: i.sync_quality,
        zone: i.zone_label,
      },
    }))
    const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    this.queueSourceData(SRC.incidents, collection)
    this.queueSourceData(SRC.clustered, collection)
    this.applyClusterPolicy()
    this.map?.once('idle', () => this.emitClusters())
  }

  /**
   * Beyond forty visible markers the flat layer is swapped for the clustered
   * source. MapLibre cannot toggle clustering on a live source, so both exist and
   * only one group is ever visible.
   */
  private applyClusterPolicy() {
    const map = this.map
    if (!map || !this.ready) return
    const visible = this.incidents.length
    const zoom = map.getZoom()
    const shouldCluster = visible > 40 && zoom < 15
    if (shouldCluster === this.clusteringOn) return
    this.clusteringOn = shouldCluster
    const flat = [LAYER.incidentRing, LAYER.incidentGlyph, LAYER.incidentBlink, LAYER.selection]
    for (const id of flat) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', shouldCluster ? 'none' : 'visible')
    }
    if (map.getLayer(LAYER.clusterCircle)) {
      map.setLayoutProperty(LAYER.clusterCircle, 'visibility', shouldCluster ? 'visible' : 'none')
    }
    this.emitClusters()
  }

  /**
   * Cluster counts are DOM, deliberately. Clusters are few by definition, and
   * this is the one place where using the product's own typography beats
   * self-hosting a font stack just so MapLibre can draw digits.
   */
  private emitClusters() {
    const map = this.map
    if (!map || !this.ready) return
    if (!this.clusteringOn) {
      this.callbacks.onClusterCounts([])
      return
    }
    const features = map.queryRenderedFeatures({ layers: [LAYER.clusterCircle] })
    const clusters = features.slice(0, 60).map((f) => {
      const geometry = f.geometry as GeoJSON.Point
      const point = map.project(geometry.coordinates as [number, number])
      return {
        id: Number(f.properties?.cluster_id ?? 0),
        count: Number(f.properties?.point_count ?? 0),
        x: point.x,
        y: point.y,
      }
    })
    this.callbacks.onClusterCounts(clusters)
  }

  setSources(sources: SourceDevice[]) {
    const wedges: GeoJSON.Feature[] = []
    const sensors: GeoJSON.Feature[] = []
    for (const s of sources) {
      if (s.source_type === 'sensor') {
        sensors.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.position.lon, s.position.lat] },
          properties: { source_id: s.source_id, state: s.state, kind: s.sensor_kind },
        })
        continue
      }
      if (s.heading_deg === null || s.fov_deg === null || s.range_m === null) continue
      if (s.state === 'down') continue
      wedges.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [fovWedge(s.position.lon, s.position.lat, s.heading_deg, s.fov_deg, s.range_m)],
        },
        properties: { source_id: s.source_id, type: s.source_type },
      })
    }
    this.queueSourceData(SRC.fov, { type: 'FeatureCollection', features: wedges })
    this.queueSourceData(SRC.sensors, { type: 'FeatureCollection', features: sensors })
  }

  setPatrols(patrols: SourceDevice[]) {
    const arrows: GeoJSON.Feature[] = patrols.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.position.lon, p.position.lat] },
      properties: { source_id: p.source_id, heading: p.heading_deg ?? 0 },
    }))
    const trails: GeoJSON.Feature[] = patrols
      .filter((p) => p.trail.length > 1)
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.trail.map((t) => [t.lon, t.lat]) },
        properties: { source_id: p.source_id },
      }))
    /* Patrols move at 4Hz: write straight through rather than deferring, since
       a stale arrow is more wrong than a briefly busier frame. */
    this.setSourceData(SRC.patrol, { type: 'FeatureCollection', features: arrows })
    this.setSourceData(SRC.trails, { type: 'FeatureCollection', features: trails })
  }

  setRisk(cells: RiskCell[], visible: boolean) {
    const map = this.map
    if (map?.getLayer(LAYER.risk)) {
      map.setLayoutProperty(LAYER.risk, 'visibility', visible ? 'visible' : 'none')
    }
    if (!visible) return
    const features: GeoJSON.Feature[] = cells.map((c) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        /* cellToBoundary in GeoJSON order returns [lng, lat] and closes the ring. */
        coordinates: [cellToBoundary(c.h3, true)],
      },
      properties: { risk: c.risk, h3: c.h3, baseline: c.baseline },
    }))
    this.queueSourceData(SRC.risk, { type: 'FeatureCollection', features })
  }

  setZonesVisible(visible: boolean) {
    const map = this.map
    if (!map || !this.ready) return
    for (const id of ['zone-fill', 'zone-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }

  setFovVisible(visible: boolean) {
    const map = this.map
    if (map?.getLayer(LAYER.fov)) map.setLayoutProperty(LAYER.fov, 'visibility', visible ? 'visible' : 'none')
  }

  setSelected(id: string | null) {
    const map = this.map
    this.selected = id
    if (!map || !this.ready || !map.getLayer(LAYER.selection)) return
    map.setFilter(LAYER.selection, ['==', ['get', 'incident_id'], id ?? ''])
  }

  flyTo(lon: number, lat: number, zoom = 15) {
    this.map?.easeTo({ center: [lon, lat], zoom, duration: 120 })
  }

  getSelected(): string | null {
    return this.selected
  }

  destroy() {
    if (this.blinkTimer) clearInterval(this.blinkTimer)
    this.blinkTimer = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.map?.remove()
    this.map = null
    this.ready = false
  }
}
