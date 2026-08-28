import type { CSSProperties } from 'react'
import { GLYPHS, type GlyphName } from './glyph-paths'

export interface GlyphProps {
  name: GlyphName
  /** Optical size in px. 14 is the product default. */
  size?: number
  className?: string
  style?: CSSProperties
  /**
   * Glyphs are decorative by default because they sit next to a text label
   * almost everywhere. Pass a label only where the glyph is the sole content of
   * a control, and the control has no other accessible name.
   */
  label?: string
}

/**
 * Renders one CS Glyph from the sprite mounted once in the root layout.
 *
 * Stroke width is scaled so the drafted 1.5px stroke stays 1.5px at any optical
 * size rather than growing with the box, which is what keeps a 20px glyph in a
 * page title looking like the same instrument as a 14px glyph in a table row.
 */
export function Glyph({ name, size = 14, className, style, label }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flex: 'none', ...style }}
      strokeWidth={(1.5 * 16) / size}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <use href={`#cs-${name}`} />
    </svg>
  )
}

/**
 * The sprite itself. Mounted once, server-rendered, so glyphs never flash and
 * never cost a network request. Symbols carry no stroke-width of their own so
 * the referencing <svg> controls it.
 */
export function GlyphSprite() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {(Object.keys(GLYPHS) as GlyphName[]).map((name) => (
          <symbol
            key={name}
            id={`cs-${name}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeLinecap="square"
            strokeLinejoin="miter"
          >
            {GLYPHS[name].d.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </symbol>
        ))}
      </defs>
    </svg>
  )
}
