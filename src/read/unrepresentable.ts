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

const NO_HOME_IN_MNX: ReadonlySet<string> = new Set([
  // Sustain, sostenuto and una corda. The schema has no pedalling of any kind.
  'pedal',
  // The line drawn under a melisma, and the one under a held figured bass.
  // MNX's event-lyric-line is a text and a type, with nowhere for either.
  'extend',
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
