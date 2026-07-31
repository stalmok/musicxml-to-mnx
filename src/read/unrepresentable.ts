// MusicXML elements MNX has nowhere to put.
//
// The bar for entry is a fact about the vendored schema, not an impression:
// there must be no definition in it that could hold the element, so that no
// amount of work here would carry it over. Everything else is a gap in this
// converter and is reported as one, even where nobody intends to close it
// soon. Getting that the wrong way round would tell a reader that something
// is permanently lost when it is only unfinished.
//
// A pedal mark qualifies: the schema has no pedal anywhere. Articulations,
// hairpins, octave shifts, barlines, endings, arpeggios and fermatas all do
// not, because it has event-markings, wedge-type, ottava, barline, ending,
// arpeggio and fermata waiting for them.

import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'

/**
 * Report an element the source hides with print-object="no". MNX has no way to
 * mark an element invisible, so it is drawn regardless; the hiding is a loss
 * and is reported rather than dropped in silence. Grouped under one
 * "print-object" code so the loss report counts the hiding, whatever carries
 * it. Elements with a home for their invisibility, like a part name, honour it
 * instead and do not call this.
 */
export function reportHidden(
  element: XmlElement,
  carrier: string,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  if (attribute(element, 'print-object') !== 'no') return
  warnings.add(
    'unsupported:element',
    `A <${carrier}> hidden with print-object="no" is drawn anyway, because MNX cannot ` +
      'mark it invisible.',
    { ...context, line: element.line },
    'print-object',
  )
}

const NO_HOME_IN_MNX: ReadonlySet<string> = new Set([
  // Sustain, sostenuto and una corda. The schema has no pedalling of any kind.
  'pedal',
  // The line drawn under a melisma, and the one under a held figured bass.
  // MNX's event-lyric-line is a text and a type, with nowhere for either.
  'extend',
  // What a key signature carries beyond its fifths: the mode, the courtesy
  // naturals of a cancelled signature, and the octave an accidental is drawn
  // in. MNX's key states a count of fifths and nothing else.
  'mode',
  'cancel',
  'key-octave',
])

/**
 * How to report an element the reader passed over: which code it falls under,
 * and how a sentence naming it should end. The ending rather than the whole
 * message, because each level names the element its own way, and the two have
 * to agree about which of them applies.
 */
export function elementLoss(name: string): {
  code: 'unsupported:element' | 'unrepresentable:element'
  ending: string
} {
  return NO_HOME_IN_MNX.has(name)
    ? { code: 'unrepresentable:element', ending: 'cannot be expressed in MNX.' }
    : { code: 'unsupported:element', ending: 'is not converted yet.' }
}
