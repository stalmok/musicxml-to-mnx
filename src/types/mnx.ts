// The MNX wire format, as far as this converter emits it. Hand-written
// against the vendored schema (schema/mnx-schema.json, pinned to a specific
// w3c/mnx commit). That file, not this one, is the authority, and the test
// suite validates every emitted document against it.
//
// Only what we currently produce is modelled here; the format is much larger.
//
// Every name is MNX-prefixed, including the plain ones. These are exported
// wholesale from the package, and `Step`, `ClefSign` and `NoteValueBase` are
// names any notation program is likely to want for itself; taking them in a
// consumer's namespace to describe our wire format would be rude.

export type MNXNoteValueBase =
  | 'duplexMaxima'
  | 'maxima'
  | 'longa'
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'
  | '256th'
  | '512th'
  | '1024th'
  | '2048th'
  | '4096th'

export type MNXStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type MNXClefSign = 'C' | 'F' | 'G'

/** The denominator of a time signature: a power of two up to 128. */
export type MNXTimeSignatureUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface MNXPitch {
  step: MNXStep
  octave: number
  alter?: number
}

/** Which way a curve bends away from the notes it joins. */
export type MNXCurveSide = 'up' | 'down'

/** How a syllable joins the word it is part of. */
export type MNXLyricLineType = 'start' | 'middle' | 'end' | 'whole'

export interface MNXLyricLine {
  text: string
  type?: MNXLyricLineType
}

/** The lyric under an event, its verses keyed by line. */
export interface MNXLyrics {
  lines: Record<string, MNXLyricLine>
}

/** How a tie's target relates to the note it starts from. Absent means the
 * same voice's next note. */
export type MNXTieTargetType = 'nextNote' | 'crossVoice' | 'arpeggio' | 'crossJump'

export interface MNXTie {
  /** Absent for a let-ring tie, which rings out with no ending note. */
  target?: string
  targetType?: MNXTieTargetType
  /** True for a let-ring (l.v.) tie. */
  lv?: boolean
  side?: MNXCurveSide
}

export interface MNXSlur {
  target: string
  side?: MNXCurveSide
  /** The side at the end of an S-shaped slur that bends the other way. */
  sideEnd?: MNXCurveSide
  lineType?: MNXLineType
}

/** How a slur or other line is drawn. */
export type MNXLineType = 'dashed' | 'dotted' | 'solid' | 'wavy'

export type MNXAccidentalEnclosureSymbol = 'parentheses' | 'brackets'

export interface MNXAccidentalDisplay {
  show: boolean
  enclosure?: { symbol: MNXAccidentalEnclosureSymbol }
  /** True where the accidental is forced, as a cautionary or editorial one is. */
  force?: boolean
}

export interface MNXNote {
  /** Present only where something refers to this note. */
  id?: string
  pitch: MNXPitch
  ties?: MNXTie[]
  accidentalDisplay?: MNXAccidentalDisplay
}

export interface MNXNoteValue {
  base: MNXNoteValueBase
  dots?: number
}

/** Which side of the notes a mark is drawn on. */
export type MNXOrientation = 'above' | 'below' | 'auto'

/** A mark written on an event, such as a staccato dot or an accent. */
export interface MNXMarking {
  orient?: MNXOrientation
}

export interface MNXStrongAccent extends MNXMarking {
  pointing?: 'up' | 'down' | 'auto'
}

export interface MNXBreathMark extends MNXMarking {
  /** The glyph it is drawn with, such as a comma or a tick. */
  symbol?: string
}

/** The marks on an event, keyed by name, so at most one of each. */
export interface MNXEventMarkings {
  accent?: MNXMarking
  staccato?: MNXMarking
  staccatissimo?: MNXMarking
  tenuto?: MNXMarking
  spiccato?: MNXMarking
  stress?: MNXMarking
  unstress?: MNXMarking
  softAccent?: MNXMarking
  strongAccent?: MNXStrongAccent
  breath?: MNXBreathMark
  tremolo?: MNXSingleNoteTremolo
}

/** A tremolo on one note, drawn as beams across its stem. */
export interface MNXSingleNoteTremolo {
  /** How many beams the tremolo is drawn with. */
  marks: number
  orient?: 'above' | 'below'
}

export type MNXFermataSymbol =
  | 'normal'
  | 'angled'
  | 'square'
  | 'doubleAngled'
  | 'doubleSquare'
  | 'doubleDot'
  | 'halfCurve'
  | 'curlew'

/** How long a fermata holds, where a document says. */
export type MNXFermataDuration =
  | 'auto'
  | 'none'
  | 'veryLong'
  | 'long'
  | 'normal'
  | 'short'
  | 'veryShort'

export interface MNXFermata {
  symbol?: MNXFermataSymbol
  duration?: MNXFermataDuration
  pointing?: 'up' | 'down' | 'auto'
  orient?: MNXOrientation
}

export interface MNXEvent {
  /** Present only where something refers to this event. */
  id?: string
  /** Present only where this event sits on a staff other than its voice's. */
  staff?: number
  duration: MNXNoteValue
  slurs?: MNXSlur[]
  lyrics?: MNXLyrics
  stemDirection?: 'up' | 'down'
  markings?: MNXEventMarkings
  fermata?: MNXFermata
  notes?: MNXNote[]
  /** Present when the event is a rest. Empty unless the rest states a height. */
  rest?: MNXRest
}

/** A rest, optionally pinned to a height on the staff. */
export interface MNXRest {
  /** Steps from the middle line, where the source fixed the rest's height. */
  staffPosition?: number
}

export interface MNXFullMeasureRest {
  visualDuration?: MNXNoteValue
  fermata?: MNXFermata
  /** Steps from the middle line, where the source fixed the rest's height. */
  staffPosition?: number
}

/** Time a voice passes over without sounding. */
export interface MNXSpace {
  type: 'space'
  /** A [numerator, denominator] pair, as a fraction of a whole note. */
  duration: [number, number]
}

/** A count of note values, as in "three eighths". */
export interface MNXNoteValueQuantity {
  duration: MNXNoteValue
  multiple: number
}

/** Whether a tuplet's number or note value is drawn, and in what form. */
export type MNXTupletDisplaySetting = 'noNumber' | 'inner' | 'both'

/** Notes played in the time of a different number of them. */
export interface MNXTuplet {
  type: 'tuplet'
  /** What is played. */
  inner: MNXNoteValueQuantity
  /** The space it is played in. */
  outer: MNXNoteValueQuantity
  content: MNXSequenceItem[]
  /** Whether the bracket is drawn. */
  bracket?: 'yes' | 'no' | 'auto'
  /** Whether the tuplet number is drawn. */
  showNumber?: MNXTupletDisplaySetting
  /** Whether the tuplet note value is drawn. */
  showValue?: MNXTupletDisplaySetting
  /** Which side of the notes it is drawn on. */
  orient?: MNXOrientation
}

/** Notes squeezed in before the beat, taking none of the measure's time. */
export interface MNXGraceGroup {
  type: 'grace'
  content: MNXEvent[]
  slash?: boolean
}

/** A tremolo written across two notes, played as a rapid alternation. */
export interface MNXMultiNoteTremolo {
  type: 'tremolo'
  content: MNXEvent[]
  /** How many beams join the pair. */
  marks: number
  /** The time the tremolo occupies: one unit per event. */
  outer: MNXNoteValueQuantity
}

export type MNXSequenceItem = MNXEvent | MNXSpace | MNXTuplet | MNXGraceGroup | MNXMultiNoteTremolo

export interface MNXSequence {
  /** The voice this sequence belongs to, where a measure holds more than one. */
  voice?: string
  /** The staff this voice sits on, where the part has more than one. */
  staff?: number
  content: MNXSequenceItem[]
  /** Present when the sequence is a rest filling the whole measure. */
  fullMeasure?: MNXFullMeasureRest
}

export interface MNXClef {
  sign: MNXClefSign
  /** Staff steps from the middle line; negative is below it. */
  staffPosition: number
  /** Octaves the clef is transposed for drawing, as an ottava amount. */
  octave?: number
  /** Whether the octave number is drawn beside the clef. */
  showOctave?: boolean
}

export interface MNXPositionedClef {
  clef: MNXClef
  /** Where in the measure the clef is drawn. Absent means its start. */
  position?: MNXRhythmicPosition
  /** Which staff of the part, where it has more than one. */
  staff?: number
}

/** Which way a hook points away from its note. */
export type MNXBeamHookDirection = 'left' | 'right' | 'auto'

export interface MNXBeam {
  events: string[]
  /** The secondary beams under this one. */
  beams?: MNXBeam[]
  /** Present on a beam of one event, which is a hook. */
  direction?: MNXBeamHookDirection
}

export type MNXDynamicValue =
  | 'pppppp'
  | 'ppppp'
  | 'pppp'
  | 'ppp'
  | 'pp'
  | 'p'
  | 'mp'
  | 'mf'
  | 'f'
  | 'ff'
  | 'fff'
  | 'ffff'
  | 'fffff'
  | 'ffffff'
  | 'n'

export interface MNXRhythmicPosition {
  fraction: [number, number]
}

export type MNXWedgeType = 'increasing' | 'decreasing'

/** A point in the score: which measure, and where within it. */
export interface MNXMeasureRhythmicPosition {
  measure: string
  position: MNXRhythmicPosition
}

export interface MNXDynamic {
  position: MNXRhythmicPosition
  type: 'immediate' | 'gradual' | 'relative' | 'accent'
  value?: MNXDynamicValue
  /** The level a two-stage accent settles to after the attack in `value`. */
  residualValue?: MNXDynamicValue
  /** The letter before an accent's value. Reads as "s" when unstated. */
  accentPrefix?: 's' | 'r' | ''
  /** The letter after an accent's value. Reads as "z" when unstated. */
  accentSuffix?: 'z' | ''
  /** The combined glyph(s) an accent is drawn as, by SMuFL name. */
  glyphs?: string[]
  /** Text drawn before the mark, such as "più". */
  prefix?: string
  /** Text drawn after the mark, such as "sub.". */
  suffix?: string
  /** Which way a hairpin opens. Present only on a gradual mark. */
  wedgeType?: MNXWedgeType
  /** Where a hairpin stops, which may be in a later measure. */
  end?: MNXMeasureRhythmicPosition
  /** Which staff of the part it sits under, where it has more than one. */
  staff?: number
  /** Which side of the staff it is drawn on. */
  orient?: MNXOrientation
}

/** The ids of the two notes a mark runs between. */
export interface MNXIdPair {
  start: string
  end: string
}

export interface MNXArpeggio {
  position: MNXRhythmicPosition
  span: MNXIdPair
  direction?: 'up' | 'down' | 'auto'
  arrow?: boolean
}

/** A bracket saying a chord is struck together rather than rolled. */
export interface MNXNonArpeggio {
  position: MNXRhythmicPosition
  span: MNXIdPair
}

/**
 * How far a stretch of music is drawn from where it sounds. Positive means the
 * written pitch is lower than the sounded one, which is 8va.
 */
export type MNXOttavaAmount = 1 | 2 | 3 | -1 | -2 | -3

export interface MNXOttava {
  position: MNXRhythmicPosition
  end: MNXMeasureRhythmicPosition
  value: MNXOttavaAmount
  staff?: number
  orient?: MNXOrientation
}

/** A simile sign here: repeat the previous `number` measures. */
export interface MNXMeasureRepeat {
  number: number
}

export interface MNXPartMeasure {
  clefs?: MNXPositionedClef[]
  beams?: MNXBeam[]
  dynamics?: MNXDynamic[]
  arpeggios?: MNXArpeggio[]
  nonArpeggios?: MNXNonArpeggio[]
  measureRepeat?: MNXMeasureRepeat
  ottavas?: MNXOttava[]
  sequences: MNXSequence[]
}

export interface MNXPart {
  /** Written on every part once the document writes layouts. */
  id?: string
  name?: string
  /** The abbreviated name, drawn on systems after the first. */
  shortName?: string
  /** How many staves the part is written on. Absent means one. */
  staves?: number
  /** The SMuFL font the part's notation is engraved in. */
  smuflFont?: string
  measures: MNXPartMeasure[]
}

export type MNXStaffSymbol = 'bracket' | 'brace' | 'noSymbol'

export type MNXStaffGroupBarlineStyle = 'individual' | 'instrument' | 'unified' | 'mensurstrich'

/** Which of the part's names a staff draws as its label. */
export type MNXStaffLabelref = 'name' | 'shortName'

export interface MNXStaffSource {
  part: string
  /** Which staff of a multi-staff part, counting from 1. Absent means 1. */
  staff?: number
  label?: string
  labelref?: MNXStaffLabelref
}

export interface MNXLayoutStaff {
  type: 'staff'
  sources: MNXStaffSource[]
  label?: string
  labelref?: MNXStaffLabelref
  symbol?: MNXStaffSymbol
}

export interface MNXStaffGroup {
  type: 'group'
  content: MNXSystemLayoutContent
  label?: string
  symbol?: MNXStaffSymbol
  barlineStyle?: MNXStaffGroupBarlineStyle
}

export type MNXSystemLayoutContent = (MNXStaffGroup | MNXLayoutStaff)[]

export interface MNXSystemLayout {
  id?: string
  content: MNXSystemLayoutContent
}

export interface MNXKey {
  fifths: number
}

export interface MNXTime {
  count: number
  unit: MNXTimeSignatureUnit
  /** The C or cut-C glyph drawn in place of the numbers, where one is. */
  display?: 'common' | 'cut'
}

export interface MNXTempo {
  value: MNXNoteValue
  bpm: number
  location?: MNXRhythmicPosition
}

/** A segno sign on a measure, the point a D.S. jumps back to. */
export interface MNXSegno {
  location: MNXRhythmicPosition
  glyph?: string
  color?: string
}

/** A Fine on a measure, where a D.S. or D.C. repeat stops. */
export interface MNXFine {
  location: MNXRhythmicPosition
}

export type MNXJumpType = 'dsalfine' | 'segno'

/** A jump on a measure, such as D.S., taken once the measure is played. */
export interface MNXJump {
  location: MNXRhythmicPosition
  type: MNXJumpType
}

export type MNXBarlineType =
  | 'regular'
  | 'dotted'
  | 'dashed'
  | 'heavy'
  | 'double'
  | 'final'
  | 'heavyLight'
  | 'heavyHeavy'
  | 'tick'
  | 'short'
  | 'noBarline'

export interface MNXBarline {
  type: MNXBarlineType
}

/** A repeat sign closing a measure. Present and empty opens one. */
export interface MNXRepeatEnd {
  times?: number
}

/** A first or second time bracket, stated on the measure where it starts. */
export interface MNXEnding {
  /** Measures covered, counted inclusively. */
  duration: number
  numbers?: number[]
  /** True where the bracket has no closing hook. */
  open?: boolean
}

export interface MNXGlobalMeasure {
  /** Written only where something points at this measure, as a hairpin's end does. */
  id?: string
  /** Stated only where it differs from the measure's position in the score. */
  number?: number
  key?: MNXKey
  time?: MNXTime
  tempos?: MNXTempo[]
  barline?: MNXBarline
  /** Present, and empty, where the measure opens a repeat. */
  repeatStart?: Record<string, never>
  repeatEnd?: MNXRepeatEnd
  ending?: MNXEnding
  fermata?: MNXFermata
  segno?: MNXSegno
  fine?: MNXFine
  jump?: MNXJump
}

export interface MNXLyricsGlobal {
  /** The verse lines in the order they stack under the notes. */
  lineOrder?: string[]
}

export interface MNXGlobal {
  measures: MNXGlobalMeasure[]
  /** Written only when the document sings more than one verse line. */
  lyrics?: MNXLyricsGlobal
  /** Written only when the source states an instrument setup. */
  sounds?: Record<string, MNXSound>
}

export interface MNXSupport {
  useAccidentalDisplay?: boolean
  useBeams?: boolean
}

/** A multi-measure rest, stated on the score rendering that draws it. */
export interface MNXMultimeasureRest {
  /** The id of the global measure the rest begins in. */
  start: string
  /** How many measures it spans, counting the one it begins in. */
  duration: number
  /** Drawn in place of the count, where one is given. */
  label?: string
}

export interface MNXSystem {
  /** The id of the global measure the system starts at. */
  measure: string
}

export interface MNXPage {
  systems: MNXSystem[]
}

/** One rendering of the score. */
export interface MNXScore {
  name: string
  /**
   * The id of the layout this rendering draws the staves by. A score is the
   * only thing that can name a layout, so a layout no score names is
   * unreachable.
   */
  layout?: string
  multimeasureRests?: MNXMultimeasureRest[]
  pages?: MNXPage[]
  /** Whether to draw the written note values rather than the sounding ones. */
  useWritten?: boolean
}

/** An instrument that plays some of the score. */
export interface MNXSound {
  midiNumber?: number
  name?: string
}

export interface MNXDocument {
  mnx: { version: number; support?: MNXSupport }
  global: MNXGlobal
  /** Written only when the source draws instrument groups. */
  layouts?: MNXSystemLayout[]
  parts: MNXPart[]
  /**
   * Written only when the source draws instrument groups, draws a
   * multi-measure rest, or states a system or page break.
   */
  scores?: MNXScore[]
}
