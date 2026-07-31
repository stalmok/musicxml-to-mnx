// The neutral score model: what the reader understood, in the shape the
// writer needs. It exists so that MusicXML's encoding decisions stop at the
// reader and MNX's start at the writer.
//
// Internal by design: it is not exported from the package, and it is scoped
// to conversion. It is not a general notation model, and should not grow into
// one.

import type { Fraction } from '../fraction.js'

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type NoteValueBase =
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

export type ClefSign = 'C' | 'F' | 'G'

export interface Pitch {
  step: Step
  octave: number
  /** Semitone alteration; 0 for an unaltered pitch. */
  alter: number
}

export interface NoteValue {
  base: NoteValueBase
  dots: number
}

/** Which way a curve bends away from the notes it joins. */
export type CurveSide = 'up' | 'down'

/** How a slur or other line is drawn. */
export type LineType = 'dashed' | 'dotted' | 'solid' | 'wavy'

/**
 * A tie joining this note to a later one of the same pitch. Stated once, on
 * the note where it begins, as a reference to the note where it ends.
 */
export interface Tie {
  /** The note the tie ends on. Absent for a let-ring tie, which rings out. */
  target?: string
  /** True where the tie ends in a different voice from the one it starts in. */
  crossVoice: boolean
  /** True for a let-ring (l.v.) tie, which has no ending note. */
  lv?: boolean
  /** Which side the tie is drawn on, where the source states it. */
  side?: CurveSide
}

/**
 * A syllable of a lyric under an event, on a given verse line. The type says
 * how the syllable joins the word, and is left off where it stands alone.
 */
export interface Lyric {
  line: string
  text: string
  type: 'start' | 'middle' | 'end' | undefined
}

/** A slur joining this event to a later one. */
export interface Slur {
  target: string
  side: CurveSide | undefined
  /** The line it is drawn with, where the source states one other than solid. */
  lineType?: LineType
}

/**
 * Whether a note's accidental is drawn, and how it is enclosed. Set only on
 * the notes whose accidental the source actually draws.
 */
export interface AccidentalDisplay {
  show: boolean
  enclosure: 'parentheses' | 'brackets' | undefined
}

export interface Note {
  /** Unique in the document. Written out only where something refers to it. */
  id: string
  pitch: Pitch
  ties: readonly Tie[]
  accidentalDisplay: AccidentalDisplay | undefined
}

/**
 * The marks written on an event: how it is attacked, and how long it is held.
 * MNX states them as a set keyed by name, so a note carries at most one of
 * each, and the kinds are spelled the way MNX spells them so the writer needs
 * no second table.
 */
export type MarkingKind =
  | 'accent'
  | 'staccato'
  | 'staccatissimo'
  | 'tenuto'
  | 'spiccato'
  | 'stress'
  | 'unstress'
  | 'softAccent'
  | 'strongAccent'
  | 'breath'
  | 'tremolo'

export interface Marking {
  kind: MarkingKind
  /** Which side of the notes it is drawn on, where the source says. */
  orient: 'above' | 'below' | undefined
  /** Which way a strong accent points, where the source says. */
  pointing: 'up' | 'down' | undefined
  /** The symbol a breath mark is drawn with, where the source names one. */
  symbol: string | undefined
  /** How many beams a single-note tremolo is drawn with. */
  marks: number | undefined
}

/**
 * A pause held over an event. MusicXML names the shape as the element's text
 * and which way it faces as its type; MNX states both, plus how long the
 * pause runs, which MusicXML has no way to say.
 */
export type FermataSymbol =
  | 'normal'
  | 'angled'
  | 'square'
  | 'doubleAngled'
  | 'doubleSquare'
  | 'doubleDot'
  | 'halfCurve'
  | 'curlew'

export interface Fermata {
  symbol: FermataSymbol | undefined
  /** Which way it faces, where the source says. */
  pointing: 'up' | 'down' | undefined
  /** Which side of the notes it is drawn on, where the source says. */
  orient: 'above' | 'below' | undefined
}

export interface Event {
  kind: 'event'
  /** Unique in the document. Written out only where something refers to it. */
  id: string
  /** Set only where this event sits on a staff other than its voice's. */
  staff: number | undefined
  value: NoteValue
  slurs: readonly Slur[]
  lyrics: readonly Lyric[]
  stemDirection: 'up' | 'down' | undefined
  markings: readonly Marking[]
  fermata: Fermata | undefined
  /** Empty for a rest. More than one note makes it a chord. */
  notes: readonly Note[]
  isRest: boolean
}

/**
 * Time a voice passes over without sounding. MusicXML leaves such a gap
 * implicit, by moving its cursor; MNX has to state it, because a sequence
 * runs without interruption from wherever it starts.
 */
export interface Space {
  kind: 'space'
  duration: Fraction
}

/** A count of note values, as in "three eighths". */
export interface NoteValueQuantity {
  value: NoteValue
  multiple: number
}

/** Whether a tuplet's number or note value is drawn, and in what form. */
export type TupletDisplay = 'noNumber' | 'inner' | 'both'

/**
 * Notes played in the time of a different number of them. The events inside
 * keep the values they are written with; the ratio says how much time they
 * actually occupy.
 */
export interface Tuplet {
  kind: 'tuplet'
  /** What is played, for example three eighths. */
  inner: NoteValueQuantity
  /** The space they are played in, for example two eighths. */
  outer: NoteValueQuantity
  content: readonly SequenceItem[]
  /** Whether the bracket is drawn. Absent lets the renderer decide. */
  bracket?: 'yes' | 'no'
  /** Whether the tuplet number is drawn. Absent lets the renderer decide. */
  showNumber?: TupletDisplay
  /** Whether the tuplet note value is drawn. Absent lets the renderer decide. */
  showValue?: TupletDisplay
}

/** Notes squeezed in before the beat, taking none of the measure's time. */
export interface GraceGroup {
  kind: 'grace'
  content: readonly Event[]
  /** True when the group is drawn with a slash through it. */
  slashed: boolean
}

/**
 * A tremolo written across two notes, played as a rapid alternation. Each
 * note is drawn with the value of the whole tremolo, and together they
 * occupy that value once.
 */
export interface MultiNoteTremolo {
  kind: 'multiNoteTremolo'
  /** How many beams join the pair. */
  marks: number
  /**
   * The time the tremolo occupies: one unit per event, so a pair of written
   * halves occupies two quarters.
   */
  outer: NoteValueQuantity
  content: readonly Event[]
}

export type SequenceItem = Event | Space | Tuplet | GraceGroup | MultiNoteTremolo

/**
 * A rest that fills its measure, whatever the time signature says that is.
 * It is a property of the sequence rather than an event in it, because that
 * is how MNX states it: the sequence holds no events at all.
 */
export interface FullMeasureRest {
  /** The value actually drawn, when the source says which one. */
  visualDuration: NoteValue | undefined
  /** A pause held over the rest, which is where most fermatas are written. */
  fermata: Fermata | undefined
}

export interface Sequence {
  /** The voice as the source named it, when a measure holds more than one. */
  voice: string | undefined
  /** The staff this voice sits on, where the part has more than one. */
  staff: number | undefined
  content: readonly SequenceItem[]
  fullMeasure: FullMeasureRest | undefined
}

export interface Clef {
  sign: ClefSign
  /** Staff steps from the middle line; negative is below it. */
  staffPosition: number
  /** Which staff of the part, where it has more than one. */
  staff: number | undefined
  /** Where in the measure it is drawn: zero unless the clef changes partway. */
  position: Fraction
  /**
   * Octaves the clef is transposed for drawing, as a treble-8 clef sits an
   * octave below a plain treble. Undefined where the clef is untransposed.
   */
  octave: number | undefined
}

/**
 * A beam over several events, with the secondary beams nested inside it. A
 * beam of one event is a hook, and says which way it points.
 */
export interface Beam {
  events: readonly string[]
  beams: readonly Beam[]
  direction: 'left' | 'right' | undefined
}

/** MNX's plain dynamic marks, from softest to loudest. */
export type DynamicValue = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'n'

/** Which way a hairpin opens. */
export type WedgeType = 'increasing' | 'decreasing'

/**
 * A dynamic mark. An immediate one states a value and sits at a point; a
 * gradual one is a hairpin, which opens one way or the other and runs from
 * here to a point that may be several measures away.
 */
export interface Dynamic {
  position: Fraction
  value: DynamicValue | undefined
  /** Set on a hairpin, which is what makes it gradual rather than immediate. */
  wedge: WedgeType | undefined
  /**
   * Where a hairpin stops, as a measure's place in the score and a position
   * within it. Unset where the source never closed it.
   */
  end: { measure: number; position: Fraction } | undefined
  /** Which staff it belongs under, where the part has more than one. */
  staff: number | undefined
}

/**
 * A chord rolled rather than struck. MNX states it on the measure rather than
 * on the event, spanning the notes it runs between, because it is drawn as a
 * line beside them rather than as a mark on any one of them.
 */
export interface Arpeggio {
  position: Fraction
  /**
   * The ids of the notes it runs between. MNX names the first-played note
   * first, so a roll going downwards runs from the highest to the lowest.
   */
  span: { start: string; end: string }
  /** Which way it is rolled. MusicXML's default is upwards. */
  direction: 'up' | 'down'
  /** Whether an arrowhead is drawn, which is what a stated direction means. */
  arrow: boolean
  /** A bracket saying the notes are struck together, rather than a roll. */
  struck: boolean
}

/**
 * An octave shift: a stretch of music drawn an octave or more away from where
 * it sounds, to keep it off the ledger lines. Positive means the notes are
 * written lower than they sound, which is 8va.
 *
 * Both formats state the sounding pitch on the notes themselves, so this
 * changes nothing about them; it says only how they are drawn.
 */
export type OttavaAmount = 1 | 2 | 3 | -1 | -2 | -3

export interface Ottava {
  position: Fraction
  /** Where it stops, as a measure's place in the score and a point in it. */
  end: { measure: number; position: Fraction }
  value: OttavaAmount
  /** Which staff it applies to, where the part has more than one. */
  staff: number | undefined
}

export interface Measure {
  clefs: readonly Clef[]
  /** Stated over the measure rather than on the notes, as MNX has it. */
  beams: readonly Beam[]
  dynamics: readonly Dynamic[]
  arpeggios: readonly Arpeggio[]
  /** Filled in once the whole part is read, because a shift spans measures. */
  ottavas: Ottava[]
  sequences: readonly Sequence[]
}

export interface Part {
  id: string
  name: string | undefined
  /** How many staves the part is written on. One unless the source says. */
  staves: number
  measures: readonly Measure[]
}

export interface Key {
  fifths: number
}

/**
 * A time signature's lower number names a note value, so only a power of two
 * can appear there. Narrow on purpose: it makes validating it the reader's
 * job, and lets the writer emit it without a cast.
 */
export type TimeUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface TimeSignature {
  count: number
  unit: TimeUnit
  /**
   * The C or cut-C glyph the signature is drawn with, in place of its numbers.
   * Undefined where it is drawn as numbers.
   */
  display: 'common' | 'cut' | undefined
}

/**
 * Attributes that apply to a measure across every part. There is one of these
 * per measure in the score, whether or not it declares anything: this list is
 * the score's measure list, and each part's measures line up with it by
 * position.
 */
/** A tempo mark: this many of the given note value per minute. */
export interface Tempo {
  position: Fraction
  value: NoteValue
  bpm: number
}

/** The line closing a measure, as MNX names the result rather than the strokes. */
export type BarlineType =
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

/** A repeat sign closing a measure, and how many times the passage is played. */
export interface RepeatEnd {
  times: number | undefined
}

/**
 * A first or second time bracket. MusicXML marks where one starts and where it
 * stops; MNX states it on the measure where it starts, as how many measures it
 * covers.
 */
export interface Ending {
  /** Measures covered, counted inclusively, so one measure is a duration of 1. */
  duration: number
  /** The times it covers, as written over the bracket. */
  numbers: readonly number[]
  /** True where the bracket has no closing hook, as a final ending has none. */
  open: boolean
}

export interface GlobalMeasure {
  key: Key | undefined
  time: TimeSignature | undefined
  tempos: readonly Tempo[]
  /** Only when the score numbers the measure differently from its position. */
  number: number | undefined
  /** The line that closes the measure, where the source draws other than a plain one. */
  barline: BarlineType | undefined
  repeatStart: boolean
  repeatEnd: RepeatEnd | undefined
  ending: Ending | undefined
  /** A pause written over the barline rather than over a note. */
  fermata: Fermata | undefined
}

export interface Score {
  globalMeasures: readonly GlobalMeasure[]
  parts: readonly Part[]
}
