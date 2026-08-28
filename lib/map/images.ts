import type { Map as MapLibreMap } from 'maplibre-gl'
import { GLYPHS, type GlyphName } from '@/components/glyphs'
import { CANVAS } from '@/lib/tokens'

/**
 * Turns CS Glyphs into map images.
 *
 * Two thousand incident markers have to be one symbol layer, not two thousand
 * DOM nodes, so the glyphs are rasterized once and registered with addImage. The
 * glyph is drawn in ink and the priority hue lives on the ring circle beneath
 * it, which avoids registering a separate image for every glyph and band pair.
 */
const SIZE = 22

function rasterize(name: GlyphName, color: string, dpr: number): ImageData | null {
  const canvas = document.createElement('canvas')
  const px = SIZE * dpr
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const scale = px / 16
  ctx.scale(scale, scale)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.lineCap = 'square'
  ctx.lineJoin = 'miter'
  for (const d of GLYPHS[name].d) {
    ctx.stroke(new Path2D(d))
  }
  return ctx.getImageData(0, 0, px, px)
}

export function registerGlyphImages(map: MapLibreMap, names: GlyphName[], color = CANVAS.ink0) {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  for (const name of names) {
    const id = `glyph-${name}`
    if (map.hasImage(id)) continue
    const data = rasterize(name, color, dpr)
    if (!data) continue
    map.addImage(id, { width: data.width, height: data.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: dpr })
  }
}

/** A filled triangle for patrol heading, drawn the same way for consistency. */
export function registerArrowImage(map: MapLibreMap, id = 'patrol-arrow', color = CANVAS.live) {
  if (map.hasImage(id)) return
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  const px = 18 * dpr
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(px / 18, px / 18)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(9, 1)
  ctx.lineTo(15, 16)
  ctx.lineTo(9, 12)
  ctx.lineTo(3, 16)
  ctx.closePath()
  ctx.fill()
  const data = ctx.getImageData(0, 0, px, px)
  map.addImage(id, { width: data.width, height: data.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: dpr })
}
