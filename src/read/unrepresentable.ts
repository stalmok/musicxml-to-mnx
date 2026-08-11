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
  // A text instruction such as "dolce" or "rit.". The schema's only free text
  // is a dynamic's prefix and suffix, and the lyrics; it has no text
  // direction.
  'words',
  // The dashed line that continues an instruction such as "cresc." The schema
  // has no such line; its "dashed" is a line style of a slur.
  'dashes',
  // The coda sign, and the D.C. and to-coda navigation a <sound> carries as
  // attributes, which readSound reports through this list by attribute name.
  // The schema has segno and fine, and its jump-type is only "dsalfine" and
  // "segno"; nothing names or jumps to a coda.
  'coda',
  'dacapo',
  'tocoda',
  // The shape a notehead is drawn as, such as a diamond or a cross. The
  // schema's note states pitch, accidental, staff and ties, and nothing about
  // how the head is drawn.
  'notehead',
  // The mark that a note is a cue. The schema's only small note is a grace.
  'cue',
  // The ornament family. The schema's event-markings holds a tremolo and no
  // other ornament: no trill, turn, mordent, wavy line or ornament accidental.
  'trill-mark',
  'turn',
  'inverted-turn',
  'mordent',
  'inverted-mordent',
  'wavy-line',
  'accidental-mark',
  // A slide between two notes. The schema's only note-to-note line is a slur.
  'slide',
  // The line drawn under a melisma, and the one under a held figured bass.
  // MNX's event-lyric-line is a text and a type, with nowhere for either.
  'extend',
  // What a key signature carries beyond its fifths: the mode, the courtesy
  // naturals of a cancelled signature, and the octave an accidental is drawn
  // in. MNX's key states a count of fifths and nothing else.
  'mode',
  'cancel',
  'key-octave',
  // The work and movement naming the document. The schema has no header:
  // scores[].name names a score rendering, not the work.
  'work',
  'movement-title',
  'movement-number',
  // The free text printed on a page, such as the title or the composer's
  // name. The schema's layouts state staves and systems, and hold no text.
  'credit',
  // Page size, scaling and margins. The schema's layouts state no dimensions.
  'defaults',
  // The spacing a <print> restates mid-score, and the numbering style. The
  // schema's pages and systems state where a system starts and nothing about
  // spacing or numbering.
  'page-layout',
  'system-layout',
  'staff-layout',
  'measure-layout',
  'measure-numbering',
  // What the part list states about an instrument beyond its name: the
  // taxonomy id, the abbreviation, the synthesizer setup and the playback
  // device. The schema's sound states a name and a midiNumber, which its
  // docs define as a MIDI pitch backing a percussion kit, so a
  // <midi-program> naming a patch has no home either; <midi-unpitched> is
  // the one with a home there, and stays a converter gap.
  'instrument-sound',
  'instrument-abbreviation',
  'virtual-instrument',
  'midi-device',
  'midi-channel',
  'midi-bank',
  'midi-program',
  'volume',
  'pan',
  'elevation',
])

// Attributes with no schema definition to hold them, keyed as
// "element attribute". The bar is the same as for elements. Anything else
// the sweep reports is a converter gap by default; a gray case stays there
// until it is decided against the schema.
const NO_HOME_ATTRIBUTES: ReadonlySet<string> = new Set([
  // The side an augmentation dot is drawn on. The schema's note value is a
  // base and a count of dots, and nothing about how they are drawn.
  'dot placement',
  // A cue-sized note value. The schema has no cue or size concept anywhere.
  'type size',
  // A playback velocity. The schema's perform options hold nothing.
  'note dynamics',
  // A clef drawn after the barline it changes at. The schema's clef states
  // its sign and position, and nothing about where it is drawn.
  'clef after-barline',
  // A dashed tie. The schema's slur states a lineType; its tie does not.
  'tied line-type',
  // A metronome mark drawn in parentheses. The schema's tempo states a bpm
  // and a value, and nothing about how the mark is drawn.
  'metronome parentheses',
])

/**
 * How to report an attribute the sweep found unread, mirroring elementLoss.
 */
export function attributeLoss(
  element: string,
  name: string,
): {
  code: 'unsupported:attribute' | 'unrepresentable:attribute'
  ending: string
} {
  return NO_HOME_ATTRIBUTES.has(`${element} ${name}`)
    ? { code: 'unrepresentable:attribute', ending: 'cannot be expressed in MNX.' }
    : { code: 'unsupported:attribute', ending: 'is not converted yet.' }
}

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
