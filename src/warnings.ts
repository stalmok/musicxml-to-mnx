// The loss report. Anything MusicXML expresses that this converter does not
// carry into MNX is reported here rather than dropped. A pipeline can then
// gate on "zero warnings" and have that mean something.
//
// Every warning falls into one of three kinds, and the code's prefix says
// which. That distinction is the point of the report rather than a detail: a
// gap in the converter may close in a later release, a limit of MNX will not,
// and anyone deciding whether a file is worth reconverting later has to be
// able to tell them apart without reading the prose.
//
//   a gap here          unsupported:*      MNX can state it; this converter
//                                          does not carry it over yet, and a
//                                          later release may.
//   a limit of MNX      unrepresentable:*  there is nowhere in the output
//                                          format to put it, so no release
//                                          will carry it while the format
//                                          stays as it is.
//   a source problem    inconsistent:*     the source disagreeing with
//                       missing:*          itself, or omitting or leaving
//                       unresolved:*       open what reading it needs, and
//                       unclosed:*         what the converter did about it.
//                       redundant:*        No release changes what the source
//                                          says, so these turn on the file,
//                                          not on the converter.
//
// isFormatLimit and isConverterGap decide the first two in code; a prefix in
// neither is a source problem.

// Stable, machine-readable codes. Consumers match on these, so a code's
// meaning must never change once released; add a new one instead.
export type WarningCode =
  // --- A gap in this converter ------------------------------------------
  // An element carrying notation this converter does not convert yet.
  | 'unsupported:element'
  // An attribute carrying notation this converter does not convert yet,
  // named with the element it sits on.
  | 'unsupported:attribute'

  // --- A limit of MNX ---------------------------------------------------
  // An element MNX has nowhere to put at all.
  | 'unrepresentable:element'
  // A measure labelled with something other than a number, where MNX's
  // measure number is an integer.
  | 'unrepresentable:measure-label'
  // The staves of a part are in different keys, or different time signatures,
  // and MNX states one of each for the whole score.
  | 'unrepresentable:per-staff-key'
  | 'unrepresentable:per-staff-time'
  // The parts of the score state different keys, or different time signatures,
  // in the same measure, and MNX states one of each for the whole score.
  | 'unrepresentable:cross-part-key'
  | 'unrepresentable:cross-part-time'
  // The parts of the score close the same measure with different barlines,
  // and MNX states one barline for the whole score's measure.
  | 'unrepresentable:cross-part-barline'
  // The parts of the score state different segnos on the same measure, and
  // MNX states one segno for the whole score's measure.
  | 'unrepresentable:cross-part-segno'
  // A color with an alpha channel other than fully opaque. MNX's color has no
  // alpha form, so the color is converted opaque and the alpha is not.
  | 'unrepresentable:color'
  // The parts of the score state different repeats, endings, fermatas, fines,
  // or jumps on the same measure, and MNX states one of each there. The
  // element field names which mark. Segnos have their own code above.
  | 'unrepresentable:cross-part-mark'
  // A stem that neither points up nor down. MNX states only those two.
  | 'unrepresentable:stem-direction'
  // A tempo MNX has no value for: one written as one note value equalling
  // another, one with no beats-per-minute number, and one whose number is
  // not above zero. MNX states a tempo as a note value and a positive count
  // of them per minute.
  | 'unrepresentable:tempo'
  // A verse whose elided syllables each say how they join their word. MNX
  // states one lyric type for the whole event.
  | 'unrepresentable:lyric-syllabic'
  // A note stating one verse line twice with two different syllables, where
  // MNX keys an event's lyrics by line and holds one of each. The first is
  // the one converted.
  | 'unrepresentable:lyric-line'
  // An event carrying more than one fermata. MNX states one per event.
  | 'unrepresentable:fermata'
  // An event carrying two marks of one kind. MNX keys them by name.
  | 'unrepresentable:marking'
  // A chord marked both as rolled and as struck together at once.
  | 'unrepresentable:arpeggio'
  // A barline drawn at the opening edge of a measure. MNX states the one that
  // closes a measure.
  | 'unrepresentable:barline'
  // Two clefs written at the same point on the same staff, where MNX draws
  // one. The last declared is the one the following notes obey.
  | 'unrepresentable:clef'
  // A measure marked senza misura is unmetered, and MNX states meter as a
  // time signature or nothing. The measure carries no time signature.
  | 'unrepresentable:senza-misura'
  // A time signature drawn with a symbol other than a common or cut sign,
  // such as a single number or a beat note. MNX draws a C, a cut C, or the
  // numbers, so the numbers are drawn and the other glyphs are not.
  | 'unrepresentable:time-symbol'
  // A time signature stating a second, interchangeable meter. MNX states one
  // count and unit, so the primary meter is converted and the alternative is
  // not.
  | 'unrepresentable:interchangeable-time'
  // A clef transposed by more than three octaves, which MNX's ottava amount
  // cannot state. The clef is converted at pitch, without the transposition.
  | 'unrepresentable:clef-octave'
  // A key signature written as individual altered steps rather than a count
  // of fifths, which is all MNX can state. The signature is dropped; the
  // notes still sound right, because each carries its own alteration.
  | 'unrepresentable:non-traditional-key'
  // A part group drawn with a symbol MNX's staff-symbol enum lacks (line,
  // square). The group is kept with no symbol stated.
  | 'unrepresentable:group-symbol'
  // Two part groups overlap, which MusicXML allows and an MNX layout, being
  // a tree, cannot hold. The group stopping mid-overlap runs to the end of
  // the part list instead.
  | 'unrepresentable:part-group-overlap'
  // A part id MNX's id cannot state: an MNX id is 1 to 256 printable ASCII
  // characters, and MusicXML's part id allows more. Also a part id the
  // converter gives an event, note, measure or layout, which MNX states the
  // same way, so the two would be one id. The part is renamed to a generated
  // id everywhere the score refers to it.
  | 'unrepresentable:part-id'
  // A measure states more than one multi-measure rest span, as staves stating
  // different counts do, and MNX states one for the score. The first is the
  // one converted.
  | 'unrepresentable:multimeasure-rest'
  // The parts of the score state different multi-measure rest spans over the
  // same measure, and MNX states one for the score.
  | 'unrepresentable:cross-part-multimeasure-rest'
  // A multi-measure rest drawn with the stacked rest symbols rather than the
  // single bar, which MNX has no way to ask for. It is drawn the default way.
  | 'unrepresentable:multiple-rest-symbols'
  // A measure states more than one measure repeat, as staves stating
  // different patterns do, and MNX states one for the part's measure. The
  // first is the one converted. Also a pattern longer than the four measures
  // MNX states, which is dropped.
  | 'unrepresentable:measure-repeat'
  // A measure repeat sign drawn with this many slashes, which MNX has no way
  // to ask for. The repeat is converted and drawn the default way.
  | 'unrepresentable:measure-repeat-slashes'
  // A SMuFL glyph named for a dynamic's wording. A dynamic group's glyphs
  // draw the mark itself, not the words, so the wording goes over as text
  // and the glyph choice is lost.
  | 'unrepresentable:wording-glyph'
  // Tuplets that cross: a stop marker numbered for a tuplet other than the
  // last opened, which MNX's nested tuplets cannot state. The stop is matched
  // to the innermost open tuplet.
  | 'unrepresentable:tuplet-crossing'
  // A <print> detail beyond the system and page breaks, such as a page
  // number or staff spacing, which MNX's pages and systems cannot state.
  | 'unrepresentable:print-detail'
  // An attribute with no schema definition to hold it, such as the side an
  // augmentation dot is drawn on, named with the element it sits on.
  | 'unrepresentable:attribute'

  // --- The source disagreeing with itself, or omitting what reading it
  //     needs -------------------------------------------------------------
  // The parts and the part list disagree: a part's id has no entry in the
  // list, so its name and any other list detail are unavailable; or the list
  // names a part the score never writes, so no staff of it is drawn.
  | 'unresolved:part-id'
  // An attribute whose value is not one MusicXML defines for it, so what the
  // source meant by it cannot be read. The attribute is not converted.
  | 'unresolved:attribute-value'
  // A note's written value and its measured duration disagree, outside a
  // tuplet where they are meant to. The written value is the one converted.
  | 'inconsistent:duration'
  // A tuplet whose written content does not add up to its stated ratio. The
  // content is converted as written.
  | 'inconsistent:tuplet'
  // The two ends of a two-note tremolo count different beams. The start's
  // count is the one converted.
  | 'inconsistent:tremolo'
  // A <backup> reaches back further than the measure has run, so the two
  // numbers disagree about how long the measure is. The cursor is taken to
  // the start of the measure.
  | 'inconsistent:backup'
  // Two barlines close the same measure with different styles. The first is
  // the one converted.
  | 'inconsistent:barline'
  // The parts of the score state different tempos at the same point in a
  // measure. MNX holds a list of them, so this is the parts disagreeing
  // rather than a limit of the format: both would be drawn over one beat.
  // The first stated is the one converted.
  | 'inconsistent:tempo'
  // A chord is rolled upwards by one mark and downwards by another. The first
  // is the one converted.
  | 'inconsistent:arpeggio'
  // A tie or slur has only one of its two ends, so there is nothing to join
  // it to. Real scores contain these, so it is reported rather than refused.
  | 'unclosed:spanner'
  // A first or second time bracket with only one of its two ends.
  | 'unclosed:ending'
  // A part group with only one of its two edges: a stop nothing opened is
  // dropped, and a start nothing stops runs to the end of the part list.
  // Crossed edges are not this; they are 'unrepresentable:part-group-overlap'.
  | 'unclosed:part-group'
  // A part holds a different number of measures from the score, so it stops
  // before the score does or runs past the end of it.
  | 'inconsistent:measure-count'
  // The parts of the score number the same measure differently. The first
  // stated is the one converted.
  | 'inconsistent:measure-number'
  // A duration or offset appears before any <divisions> said how long one
  // is. One division per quarter note is assumed; if that is wrong, the
  // written values disagree with the measured ones and say so.
  | 'missing:divisions'
  // A <tuplet> bracket starts on a note with no <time-modification> beside
  // it, so the source states no ratio for it. The ratio is read from how long
  // the note lasts against how it is written.
  | 'missing:time-modification'
  // A note omits its <voice> while others in the same measure name theirs.
  // The unnamed notes are kept as a separate line, which may not be the one
  // the source intended.
  | 'missing:voice'
  // A rest written over a rest that already fills the same voice's measure.
  // Both are silence, so the measure rest stands and the extra is dropped.
  | 'redundant:rest'

/**
 * True for a loss no release of this converter can close, short of MNX itself
 * gaining somewhere to put it. The prefix is the contract; this saves every
 * consumer writing the same string test.
 */
export function isFormatLimit(code: WarningCode): boolean {
  return code.startsWith('unrepresentable:')
}

/**
 * True for a loss a later release of this converter may close: MNX can hold
 * it, but this converter does not carry it over yet. The mirror of
 * isFormatLimit; a code that is neither is the source's own problem, which no
 * release changes.
 */
export function isConverterGap(code: WarningCode): boolean {
  return code.startsWith('unsupported:')
}

export interface WarningContext {
  /** The MusicXML part id the warning came from, when known. */
  part?: string
  /** The measure number as written in the source, when known. */
  measure?: number
  /** Line in the source document, when known. */
  line?: number
}

export interface ConversionWarning {
  readonly code: WarningCode
  readonly message: string
  /**
   * The MusicXML element the loss is about, without its angle brackets, where
   * it is about one. A field rather than something to be recovered from the
   * message, because grouping a report by what was lost is the first thing
   * anyone does with it, and the message is prose written for a person.
   */
  readonly element: string | undefined
  /**
   * The attribute the loss is about, where it is about one, beside the
   * element carrying it. A field for the same reason the element is one.
   */
  readonly attribute: string | undefined
  readonly context: WarningContext
}

export class WarningCollector {
  readonly #warnings: ConversionWarning[] = []

  add(
    code: WarningCode,
    message: string,
    context: WarningContext,
    element?: string,
    attribute?: string,
  ): void {
    this.#warnings.push({ code, message, element, attribute, context })
  }

  /** A copy, so the report cannot be mutated from outside. */
  list(): readonly ConversionWarning[] {
    return [...this.#warnings]
  }
}
