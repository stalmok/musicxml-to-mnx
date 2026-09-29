// MusicXML elements with no home in MNX.
//
// An element is listed only where the vendored schema has no definition that
// could hold it. Everything else is a gap in this converter and is reported
// as one.
//
// A pedal mark qualifies: the schema has no pedal anywhere. Articulations,
// hairpins, octave shifts, barlines, endings, arpeggios and fermatas do not,
// because it has event-markings, wedge-type, ottava, barline, ending,
// arpeggio and fermata for them.

import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'

/**
 * Report an element the source hides with print-object="no", which is drawn
 * anyway. Elements with a home for their invisibility, such as a part name or
 * a clef, honour it and do not call this.
 */
export function reportHidden(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
  holds?: string,
): void {
  if (attribute(element, 'print-object') !== 'no') return
  const rest = element.name === 'note' && element.children.some((one) => one.name === 'rest')
  // A hidden rest is time with nothing drawn in it, which a space holds.
  const code = rest ? 'unsupported:attribute' : attributeLoss(element.name, 'print-object').code
  warnings.add(
    code,
    `A <${element.name}> hidden with print-object="no" is drawn anyway` +
      (rest
        ? '. Writing it as a space is not converted yet.'
        : ', because MNX cannot mark it invisible.') +
      // Named so a consumer can tell what kind of notation the hiding
      // covers without reading the source.
      (holds !== undefined ? ` The block holds <${holds}>.` : ''),
    { ...context, line: element.line },
    element.name,
    'print-object',
  )
}

// Exported for the conformance test, which checks each entry against the
// schema fact its comment states.
export const NO_HOME_IN_MNX: ReadonlySet<string> = new Set([
  // Sustain, sostenuto and una corda. The schema has no pedalling of any kind.
  'pedal',
  // A text instruction such as "dolce" or "rit.". The schema's only free text
  // is a dynamic's prefix and suffix, and the lyrics; it has no text
  // direction.
  'words',
  // The dashed line that continues an instruction such as "cresc." The schema
  // has no such line; its "dashed" is a line style of a slur.
  'dashes',
  // The horizontal bracket line over a passage: the same construct as
  // <dashes> with a different line end, and the schema has no such line
  // either. Its only brackets are a staff symbol and a tuplet's.
  'bracket',
  // The boxed rehearsal mark. The schema's measure holds no label or mark,
  // and nothing else can carry one.
  'rehearsal',
  // The coda sign. The schema has segno and fine, and its jump-type is only
  // "dsalfine" and "segno"; nothing names or jumps to a coda.
  'coda',
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
  // How a note is played on the instrument, beyond which way the bow travels.
  // The schema's event-markings are accent, bow direction, breath, caesura,
  // soft accent, spiccato, staccatissimo, staccato, stress, strong accent,
  // tenuto, tremolo and unstress, and nothing anywhere else holds a fingering, a
  // string, a fret, a mute or a way of plucking. Up-bow and down-bow are the
  // two <technical> children that do have a home, and are converted.
  'harmonic',
  'open-string',
  'thumb-position',
  'fingering',
  'pluck',
  'double-tongue',
  'triple-tongue',
  'stopped',
  'snap-pizzicato',
  'fret',
  'string',
  'hammer-on',
  'pull-off',
  'bend',
  'tap',
  'heel',
  'toe',
  'fingernails',
  'hole',
  'arrow',
  'handbell',
  'brass-bend',
  'flip',
  'smear',
  'open',
  'half-muted',
  'harmon-mute',
  'golpe',
  'other-technical',
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
  // How a staff is drawn beyond its line count, which a measure's
  // staffConfigs carries: the ossia or cue marking, the per-line
  // detailing, the size, a tablature tuning and a capo. The schema's
  // staff-config states a line count and nothing else, and its staff states
  // a label, a labelref, sources, a symbol and a type, where the type is the
  // constant naming it a staff.
  'staff-type',
  'line-detail',
  'staff-tuning',
  'capo',
  'staff-size',
  // The free text printed on a page, such as the title or the composer's
  // name. The schema's layouts state staves and systems, and hold no text.
  'credit',
  // The composer, the rights and the encoding notes. The schema has no
  // header for any of them. The supports declarations inside its <encoding>
  // are read apart before this decision applies: their accidental and beam
  // halves are the schema's support flags, which the writer restates.
  'identification',
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
  // What the part list states about an instrument beyond its name and the
  // MIDI pitch that sounds it: the taxonomy id, the abbreviation, the
  // synthesizer setup and the playback device. The schema's sound states a
  // name and a midiNumber, which its docs define as a MIDI pitch backing a
  // percussion kit, so a <midi-program> naming a patch has no home there.
  // <midi-unpitched> is the one that does, and is converted.
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
// "element attribute". The rule is the same as for elements. Anything else
// the sweep reports is a converter gap.
export const NO_HOME_ATTRIBUTES: ReadonlySet<string> = new Set([
  // The side an augmentation dot is drawn on. The schema's note value is a
  // base and a count of dots, and nothing about how they are drawn.
  'dot placement',
  // A cue-sized note value. The schema has no cue or size concept anywhere.
  'type size',
  // A playback velocity, written on a note or on the <sound> beside it. The
  // schema's perform options hold nothing.
  'note dynamics',
  'sound dynamics',
  // The D.C. and to-coda navigation a <sound> carries. The schema's jump-type
  // is only "dsalfine" and "segno"; nothing names or jumps to a coda.
  'sound dacapo',
  'sound tocoda',
  'sound coda',
  // Where a playback device places the sound in the stereo field, and how high
  // above the listener. The schema's sound states a name and a midiNumber.
  'sound pan',
  'sound elevation',
  // The three piano pedals, as playback. The schema has no pedalling of any
  // kind, which is why <pedal> is on the element list above.
  'sound damper-pedal',
  'sound soft-pedal',
  'sound sostenuto-pedal',
  // An element hidden with print-object="no". The schema has no visibility
  // of any kind. A hidden rest is not listed: a space holds it.
  'note print-object',
  'notations print-object',
  'key print-object',
  'time print-object',
  'ending print-object',
  'lyric print-object',
  // Plucked rather than bowed. The schema's event-markings are accent, bow
  // direction, breath, caesura, soft accent, spiccato, staccatissimo,
  // staccato, stress, strong accent, tenuto, tremolo and unstress; nothing
  // plucks.
  'sound pizzicato',
  // What the source calls the segno drawn beside it, so a jump can name the
  // sign it goes back to. The schema's segno states a location, a colour and
  // a glyph, and has no label.
  'sound segno',
  // Whether a tablature staff draws its fret numbers. The schema has no
  // tablature, which is why <staff-tuning>, <capo>, <fret> and
  // <string> are on the element list above.
  'staff-details show-frets',
  // The side a caesura is drawn on. The schema's caesura states a stroke
  // count and a shape.
  'caesura placement',
  // A clef drawn after the barline it changes at. The schema's clef states
  // its sign and position, and nothing about where it is drawn.
  'clef after-barline',
  // A dashed tie. The schema's slur states a lineType; its tie does not.
  'tied line-type',
  // A metronome mark drawn in parentheses. The schema's tempo states a bpm
  // and a value, and nothing about how the mark is drawn.
  'metronome parentheses',
  // Whether an instruction prints on every system or only the top one of a
  // page. The schema's only visibility properties are an accidental's, a
  // clef's octave, a hidden clef, and a tuplet's number and value; its system
  // holds a layout, layout changes and a measure.
  'direction system',
  // A pickup or courtesy measure excluded from the numbering. The schema's
  // measure number is a plain integer override, so a measure can be
  // renumbered but not stated unnumbered.
  'measure implicit',
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
