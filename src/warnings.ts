// The loss report. Anything MusicXML expresses that this converter does not
// carry into MNX is reported here, not dropped.
//
// Every warning falls into one of three kinds, and the code's prefix says
// which. A converter gap may close in a later release. A format limit will
// not.
//
//   a converter gap     unsupported:*      MNX can state it; this converter
//                                          does not carry it over yet, and a
//                                          later release may.
//   a format limit      unrepresentable:*  it has no home in MNX, so no
//                                          release will carry it while the
//                                          format stays as it is.
//   a source problem    inconsistent:*     the source disagreeing with
//                       missing:*          itself, or omitting or leaving
//                       unresolved:*       open what reading it needs, and
//                       unclosed:*         what the converter did about it.
//                       redundant:*        No release changes what the source
//                                          says, so these turn on the file,
//                                          not on the converter.
//
// isFormatLimit, isConverterGap and isSourceProblem decide the three in code,
// and categoryOf holds them to covering every code between them.

// Stable, machine-readable codes. A code's meaning must never change once
// released; add a new one instead.
//
// The code alone does not identify a loss. 'unsupported:element' and
// 'unsupported:attribute' cover most of this converter's gaps, and the element
// and attribute fields name what was lost. To detect new losses, key on the
// code, element and attribute together.
export const WARNING_CODES = Object.freeze([
  // --- A converter gap --------------------------------------------------
  // An element carrying notation this converter does not convert yet.
  'unsupported:element',
  // An attribute carrying notation this converter does not convert yet,
  // named with the element it sits on.
  'unsupported:attribute',

  // --- A format limit ---------------------------------------------------
  // An element with no home in MNX.
  'unrepresentable:element',
  // A measure labelled with something other than a number, where MNX's
  // measure number is an integer.
  'unrepresentable:measure-label',
  // The staves of a part are in different keys, or different time signatures,
  // and MNX states one of each for the whole score.
  'unrepresentable:per-staff-key',
  // A part whose staves are transposed by different intervals, or which
  // changes instrument partway. MNX states one transposition for the part.
  'unrepresentable:per-staff-transposition',
  'unrepresentable:transposition-change',
  'unrepresentable:per-staff-time',
  // The parts of the score state different keys, or different time signatures,
  // in the same measure, and MNX states one of each for the whole score.
  'unrepresentable:cross-part-key',
  'unrepresentable:cross-part-time',
  // The parts of the score close the same measure with different barlines,
  // and MNX states one barline for the whole score's measure.
  'unrepresentable:cross-part-barline',
  // The parts of the score state different segnos on the same measure, and
  // MNX states one segno for the whole score's measure.
  'unrepresentable:cross-part-segno',
  // A color with an alpha channel other than fully opaque. MNX's color has no
  // alpha form, so the color is converted opaque and the alpha is not.
  'unrepresentable:color',
  // The parts of the score state different repeats, endings, fermatas, fines,
  // or jumps on the same measure, and MNX states one of each there. The
  // element field names which mark. Segnos have their own code above.
  'unrepresentable:cross-part-mark',
  // A stem that neither points up nor down. MNX states only those two.
  'unrepresentable:stem-direction',
  // A tempo MNX has no value for: one written as one note value equalling
  // another, one with no beats-per-minute number, and one whose number is
  // not above zero. MNX states a tempo as a note value and a positive count
  // of them per minute.
  'unrepresentable:tempo',
  // A verse whose elided syllables each say how they join their word. MNX
  // states one lyric type for the whole event.
  'unrepresentable:lyric-syllabic',
  // A note stating one verse line twice with two different syllables, where
  // MNX keys an event's lyrics by line and holds one of each. The first is
  // the one converted.
  'unrepresentable:lyric-line',
  // An event carrying more than one fermata. MNX states one per event.
  'unrepresentable:fermata',
  // An event carrying two marks of one kind. MNX keys them by name.
  'unrepresentable:marking',
  // A chord marked both as rolled and as struck together at once.
  'unrepresentable:arpeggio',
  // An ending printed with text other than its numbers, such as "Pour
  // finir" or "1st and 2nd Verses". MNX's ending prints its numbers and has
  // no text. The numbers are converted.
  'unrepresentable:ending-text',
  // A barline drawn at the opening edge of a measure. MNX states the one that
  // closes a measure.
  'unrepresentable:barline',
  // Two clefs written at the same point on the same staff, where MNX draws
  // one. The last declared is the one the following notes obey.
  'unrepresentable:clef',
  // Two staff line counts written at the same point on the same staff, where
  // MNX draws the staff one way. The last declared is the one drawn.
  'unrepresentable:staff-config',
  // A measure marked senza misura is unmetered, and MNX states meter as a
  // time signature or nothing. The measure carries no time signature.
  'unrepresentable:senza-misura',
  // A key or time signature stated partway through a measure, or after its
  // notes where no next measure takes it. MNX states one only where a measure
  // begins, so it is converted at the next measure, and not converted where the
  // next measure states its own or there is none.
  'unrepresentable:mid-measure-key',
  'unrepresentable:mid-measure-time',
  // A rest filling a measure that states no time signature, whose length no
  // note value can write. MNX states such a rest on the sequence, which
  // carries no length, so the length the source drew is not converted.
  'unrepresentable:rest-length',
  // A time signature drawn with a symbol other than a common or cut sign,
  // such as a single number or a beat note. MNX draws a C, a cut C, or the
  // numbers, so the numbers are drawn and the other glyphs are not.
  'unrepresentable:time-symbol',
  // A time signature stating a second, interchangeable meter. MNX states one
  // count and unit, so the primary meter is converted and the alternative is
  // not.
  'unrepresentable:interchangeable-time',
  // A clef transposed by more than three octaves, which MNX's ottava amount
  // cannot state. The clef is converted at pitch, without the transposition.
  'unrepresentable:clef-octave',
  // A TAB or jianpu clef, which MNX's clef signs cannot state. The staff is
  // converted without a clef.
  'unrepresentable:clef-sign',
  // A key signature written as individual altered steps rather than a count
  // of fifths, which is all MNX can state. The signature is dropped; the
  // notes still sound right, because each carries its own alteration.
  'unrepresentable:non-traditional-key',
  // A part group drawn with a symbol MNX's staff-symbol enum lacks (line,
  // square). The group is kept with no symbol stated.
  'unrepresentable:group-symbol',
  // Two part groups overlap, which MusicXML allows and an MNX layout, being
  // a tree, cannot hold. The group stopping mid-overlap runs to the end of
  // the part list instead.
  'unrepresentable:part-group-overlap',
  // A part id MNX's id cannot state: an MNX id is 1 to 256 printable ASCII
  // characters, and MusicXML's part id allows more. Also a part id shaped
  // like one the converter generates, which MNX states the same way, so the
  // two would be one id. The part is renamed to a generated id everywhere the
  // score refers to it.
  'unrepresentable:part-id',
  // An instrument id MNX's id cannot state, or one shaped like an id the
  // converter generates. The instrument is renamed, so a kit component can
  // still say what plays it.
  'unrepresentable:instrument-id',
  // A measure states more than one multi-measure rest span, as staves stating
  // different counts do, and MNX states one for the score. The first is the
  // one converted.
  'unrepresentable:multimeasure-rest',
  // The parts of the score state different multi-measure rest spans over the
  // same measure, and MNX states one for the score.
  'unrepresentable:cross-part-multimeasure-rest',
  // A multi-measure rest drawn with the stacked rest symbols rather than the
  // single bar, which MNX has no way to ask for. It is drawn the default way.
  'unrepresentable:multiple-rest-symbols',
  // A measure states more than one measure repeat, as staves stating
  // different patterns do, and MNX states one for the part's measure. The
  // first is the one converted. Also a pattern longer than the four measures
  // MNX states, which is dropped.
  'unrepresentable:measure-repeat',
  // A measure repeat sign drawn with this many slashes, which MNX has no way
  // to ask for. The repeat is converted and drawn the default way.
  'unrepresentable:measure-repeat-slashes',
  // How much time a grace note takes from the note beside it. MNX states
  // which side the time comes from and no amount, so the side is converted
  // and the amount is not. Also a note naming both sides, where MNX states
  // one.
  'unrepresentable:grace-time',
  // A grace note beside a rest filling a measure whose length no note value
  // can write. MNX states such a rest on a sequence that holds nothing, and
  // there is no event to write it as instead, so the rest is written as a
  // space of its length. The rest, and a fermata or position on it, is not
  // drawn. A hidden rest with no fermata loses nothing, and is not reported.
  'unrepresentable:grace-beside-rest',
  // A SMuFL glyph named for a dynamic's wording. A dynamic group's glyphs
  // draw the mark itself, not the words, so the wording goes over as text
  // and the glyph choice is lost.
  'unrepresentable:wording-glyph',
  // Dynamic wording, such as "dolce", that qualifies no mark. MNX states
  // wording only as the prefix or suffix of a dynamic mark, and each kind of
  // mark requires more than its wording, so the words are not converted.
  'unrepresentable:dynamic-wording',
  // Tuplets that cross: a stop marker numbered for a tuplet other than the
  // last opened, which MNX's nested tuplets cannot state. The stop is matched
  // to the innermost open tuplet.
  'unrepresentable:tuplet-crossing',
  // A tuplet bracket that starts in one measure and stops in a later one,
  // which MNX cannot state: a tuplet is an item inside one measure's
  // sequence. The bracket is drawn as far as the barline.
  'unrepresentable:tuplet-span',
  // A tuplet whose content does not fill its ratio, and whose notes and the
  // time they take no pair of note values counts: a quarter sounding a sixth
  // of a whole note is one quarter in the time of two thirds of a quarter, and
  // a note value lasts a power of two of a whole note, dots included. MNX has
  // no other way to state one tuplet over the notes a bracket covers, so the
  // bracket is drawn as the source wrote it and takes the time its ratio
  // states rather than the time its notes sound for.
  'unrepresentable:tuplet-ratio',
  // A tuplet bracket holding nothing that takes any of the measure's time,
  // which a bracket that opens and closes on grace notes holds. MNX states a
  // tuplet as a written length against the time it is played in, and neither
  // is there to state, so the bracket is dropped and what it held is written
  // as it stands.
  'unrepresentable:tuplet-untimed',
  // A <print> detail beyond the system and page breaks, such as a page
  // number or staff spacing, which MNX's pages and systems cannot state.
  'unrepresentable:print-detail',
  // A note altered by a fraction of a semitone, such as a quarter-tone
  // flat. MNX's alter is a whole number of semitones, so the note is
  // converted altered by the nearest whole one.
  'unrepresentable:microtone',
  // An attribute with no schema definition to hold it, such as the side an
  // augmentation dot is drawn on, named with the element it sits on.
  'unrepresentable:attribute',

  // --- The source disagreeing with itself, or omitting what reading it
  //     needs -------------------------------------------------------------
  // The parts and the part list disagree: a part's id has no entry in the
  // list, so its name and any other list detail are unavailable; or the list
  // names a part the score never writes, so no staff of it is drawn.
  'unresolved:part-id',
  // A note naming an instrument the part list does not set up, or naming
  // one with no id. The kit component it strikes is kept, without a name or
  // a sound.
  'unresolved:instrument-id',
  // An attribute whose value is not one MusicXML defines for it, so what the
  // source meant by it cannot be read. The attribute is not converted.
  'unresolved:attribute-value',
  // A note's written value and its measured duration disagree, outside a
  // tuplet where they are meant to. The written value is the one converted.
  'inconsistent:duration',
  // A note of a grace chord names a different side to take its time from
  // than the chord it joins. MNX states one side for the group, and the
  // side the chord already states is the one converted.
  'inconsistent:grace-time',
  // A note of a chord marked as a grace note where the note it joins is not,
  // or the other way round. The chord's own note decides, and the member is
  // converted as a note of that chord.
  'inconsistent:grace',
  // A note of a chord carries a mark the note it joins does not, or carries
  // it another way. MNX states the marks on the event, and the marks of the
  // chord's own note are the ones converted.
  'inconsistent:marking',
  // A note of a chord carries a fermata the note it joins does not, or
  // carries it another way. MNX states one fermata on the event, and the
  // chord's own is the one converted.
  'inconsistent:fermata',
  // A tuplet whose written content does not add up to its stated ratio. The
  // content is converted as written. Also a note of a chord drawing the
  // chord's tuplet bracket another way than the note it joins, whose own
  // drawing is the one converted.
  'inconsistent:tuplet',
  // The two ends of a two-note tremolo count different beams, and the
  // start's count is the one converted. Also a note of a chord carrying a
  // tremolo marker the note it joins does not, or carrying it another way,
  // where the chord's own marker is the one converted.
  'inconsistent:tremolo',
  // A <backup> reaches back further than the measure has run, so the two
  // numbers disagree about how long the measure is. The cursor is taken to
  // the start of the measure.
  'inconsistent:backup',
  // Two barlines close the same measure with different styles. The first is
  // the one converted.
  'inconsistent:barline',
  // A measure states two different key signatures, or two different time
  // signatures, at its start for the same staves. The later one is not
  // converted.
  'inconsistent:key',
  'inconsistent:time',
  // The parts of the score state different tempos at the same point in a
  // measure. MNX holds a list of tempos, so this is not a limit of the format:
  // both would be drawn over one beat. The first stated is the one converted.
  'inconsistent:tempo',
  // A voice sounds two notes at once, which one voice does not: closed-score
  // hymnals write two lines in one <voice>, laid over each other with
  // <backup>. Each line is kept as a sequence of its own, and only the first
  // carries the voice's name.
  'inconsistent:voice',
  // A chord is rolled upwards by one mark and downwards by another. The first
  // is the one converted.
  'inconsistent:arpeggio',
  // A statement about a staff the part does not have: the part says how many
  // staves it is written on, and the statement names one beyond them. There
  // is no staff for it to be about, so it is not carried over.
  'inconsistent:staff',
  // A tie, slur, hairpin or octave shift has only one of its two ends, so
  // there is nothing to join it to. Real scores contain these, so it is
  // reported rather than refused. A hairpin or octave shift with no end is
  // not carried over, because MNX requires one to state where it stops.
  'unclosed:spanner',
  // A first or second time bracket with only one of its two ends.
  'unclosed:ending',
  // A part group with only one of its two edges: a stop nothing opened is
  // dropped, and a start nothing stops runs to the end of the part list.
  // Crossed edges are not this; they are 'unrepresentable:part-group-overlap'.
  'unclosed:part-group',
  // A part holds a different number of measures from the score, so it stops
  // before the score does or runs past the end of it.
  'inconsistent:measure-count',
  // A voice sounds past the end of the time signature in force. The measure
  // is as long as its longest voice, so the others rest through what is left
  // of it, which is not where the source draws the barline.
  'inconsistent:measure-length',
  // The parts of the score number the same measure differently. The first
  // stated is the one converted.
  'inconsistent:measure-number',
  // A duration or offset appears before any <divisions> said how long one
  // is. One division per quarter note is assumed; if that is wrong,
  // 'inconsistent:duration' warnings follow.
  'missing:divisions',
  // A grace note stating no <type>. It carries no <duration> either, so
  // nothing says the value it is drawn with, and MNX states a value for
  // every event. The beams over it are converted as that value, and an
  // eighth where it carries none.
  'missing:note-type',
  // A <tuplet> bracket starts on a note with no <time-modification> beside
  // it, so the source states no ratio for it. The ratio is read from how long
  // the note lasts against how it is written.
  'missing:time-modification',
  // A note omits its <voice> while others in the same measure name theirs.
  // The unnamed notes are kept as a separate line, which may not be the one
  // the source intended.
  'missing:voice',
  // An unpitched note with no usable <display-step> and <display-octave> to
  // place it by, or no clef in force to read them against. MNX states where
  // every kit component sits, so it is written on the middle line.
  'missing:display-step',
  // A rest written over a rest that already fills the same voice's measure.
  // Both are silence, so the measure rest stands and the extra is dropped.
  // Each drawn thing the extra carries, such as a lyric or a fermata, is
  // reported under this code too, naming its element. A rest in another line
  // of the voice, where the voice sounds a note in the measure, is part of
  // that line's music and is kept.
  'redundant:rest',
] as const)

export type WarningCode = (typeof WARNING_CODES)[number]

/** A loss no release of this converter can close. See isFormatLimit. */
export type FormatLimit = Extract<WarningCode, `unrepresentable:${string}`>

/** A loss a later release of this converter may close. See isConverterGap. */
export type ConverterGap = Extract<WarningCode, `unsupported:${string}`>

// The prefixes of the source's own problems. Listed, so a new prefix must be
// classified and does not fall in here by default.
type SourceProblemPrefix = 'inconsistent' | 'missing' | 'unresolved' | 'unclosed' | 'redundant'

/** The source's own problem, which no release changes. See isSourceProblem. */
export type SourceProblem = Extract<WarningCode, `${SourceProblemPrefix}:${string}`>

/** The three kinds a warning falls into, as named at the top of this file. */
export type WarningCategory = 'format-limit' | 'converter-gap' | 'source-problem'

/**
 * True for a loss no release of this converter can close unless MNX itself
 * changes. The `unrepresentable:` prefix is the contract.
 */
export function isFormatLimit(code: WarningCode): code is FormatLimit {
  return code.startsWith('unrepresentable:')
}

/**
 * True for a loss a later release of this converter may close: MNX can hold
 * it, but this converter does not carry it over yet.
 */
export function isConverterGap(code: WarningCode): code is ConverterGap {
  return code.startsWith('unsupported:')
}

/**
 * True for the source disagreeing with itself, or omitting or leaving open
 * what reading it needs. These turn on the file rather than on the converter,
 * so no release changes them.
 */
export function isSourceProblem(code: WarningCode): code is SourceProblem {
  return Object.hasOwn(SOURCE_PROBLEM_PREFIXES, code.slice(0, code.indexOf(':')))
}

// Keyed by the union, so a prefix the union gains and this table lacks does
// not compile.
const SOURCE_PROBLEM_PREFIXES: Record<SourceProblemPrefix, true> = {
  inconsistent: true,
  missing: true,
  unresolved: true,
  unclosed: true,
  redundant: true,
}

/**
 * Which of the three kinds a code names. Every code names one; a new prefix
 * in none of them does not compile.
 */
export function categoryOf(code: WarningCode): WarningCategory {
  if (isFormatLimit(code)) return 'format-limit'
  if (isConverterGap(code)) return 'converter-gap'
  return nameSourceProblem(code)
}

// Takes what the two categories above leave. A code with a fourth prefix is
// not a SourceProblem, so it does not compile here.
function nameSourceProblem(_code: SourceProblem): WarningCategory {
  return 'source-problem'
}

export interface WarningContext {
  /** The MusicXML part id the warning came from, when known. */
  part?: string
  /** Where the measure sits in its part, counting from one, when known. A
   * measure the source labels differently, such as a pickup numbered 0, is
   * still named by its position. */
  measure?: number
  /** Line in the source document, when known. */
  line?: number
}

export interface ConversionWarning {
  readonly code: WarningCode
  readonly message: string
  /**
   * The MusicXML element the loss is about, without its angle brackets, where
   * it is about one. Group a report by this field, not by the message, which
   * is prose for a person.
   */
  readonly element: string | undefined
  /**
   * The attribute the loss is about, where it is about one, beside the
   * element carrying it.
   */
  readonly attribute: string | undefined
  readonly context: WarningContext
}
