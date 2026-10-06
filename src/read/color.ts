// MusicXML's color attribute, read into MNX's color string.
//
// MusicXML writes a color as #RRGGBB, or as #AARRGGBB with an alpha channel
// first. MNX's color is a string of no stated form. The one color form the
// schema states elsewhere is #rrggbb, with no alpha. The six-digit form is
// carried as written. A fully opaque alpha says nothing and is dropped. Any
// other alpha is reported, and the color is converted opaque.

import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'

const RGB = /^#[0-9A-Fa-f]{6}$/
const ARGB = /^#[0-9A-Fa-f]{8}$/

/** The color an element is drawn in, or undefined where none survives. */
export function readColor(
  element: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): string | undefined {
  const written = attribute(element, 'color')
  if (written === undefined) return undefined

  if (RGB.test(written)) return written

  if (ARGB.test(written)) {
    const opaque = `#${written.slice(3)}`
    if (written.slice(1, 3).toUpperCase() === 'FF') return opaque
    warnings.add(
      'unrepresentable:color',
      `A color of "${written}" has an alpha channel, and MNX states no form for one. ` +
        'The color is converted opaque.',
      context,
      element,
      'color',
    )
    return opaque
  }

  warnings.add(
    'unresolved:attribute-value',
    `A color of "${written}" is not a MusicXML color, and is not carried over.`,
    context,
    element,
    'color',
  )
  return undefined
}
