// The score model: what the reader understood, in the shape the
// writer needs. That shape follows MNX's structure. MusicXML's encoding stops
// at the reader, and the MNX types start at the writer.
//
// Internal: not exported from the package, and scoped to conversion. It is not
// a general notation model.
//
// Two axes say what is still open, and each is read on its own.
//
// A `readonly` property is one nothing assigns after the object is made; a
// mutable one is something a later pass replaces. A `readonly T[]` is a list
// nothing adds to; a plain `T[]` is one something still pushes into. So
// `readonly ties: readonly Tie[]` is settled, `ties: readonly Tie[]` is
// replaced whole, and `readonly dynamics: Dynamic[]` is added to in place.
//
// Every field that is open either way says in its comment what fills it. Most
// are the passes that run once a whole part is read, because what they
// resolve is written between the notes and the document's order is not the
// music's.

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

/** The clef signs that place a pitch on a line. */
export type PitchedClefSign = 'C' | 'F' | 'G'

/** P is the percussion clef, which places no pitch. */
export type ClefSign = PitchedClefSign | 'P'

export interface Pitch {
  readonly step: Step
  readonly octave: number
  /** Semitone alteration; 0 for an unaltered pitch. */
  readonly alter: number
}

export interface NoteValue {
  readonly base: NoteValueBase
  readonly dots: number
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
  readonly target?: string
  /** True where the tie ends in a different voice from the one it starts in. */
  readonly crossVoice: boolean
  /** True for a let-ring (l.v.) tie, which has no ending note. */
  readonly lv?: boolean
  /** Which side the tie is drawn on, where the source states it. */
  readonly side?: CurveSide
}

/**
 * A syllable of a lyric under an event. The type says how the syllable joins
 * the word, and is left off where it stands alone. The verse line is the map
 * key, not a field: MNX keys an event's lyrics by line, so an event holds at
 * most one syllable per line.
 */
export interface Lyric {
  readonly text: string
  readonly type: 'start' | 'middle' | 'end' | undefined
}

/** A slur joining this event to a later one. */
export interface Slur {
  readonly target: string
  readonly side: CurveSide | undefined
  /** The side at the end, where the source states one differing from side. */
  readonly sideEnd?: CurveSide
  /** The line it is drawn with, where the source states one other than solid. */
  readonly lineType?: LineType
}

/**
 * Whether a note's accidental is drawn, and how it is enclosed. Set only on
 * the notes whose accidental the source draws.
 */
export interface AccidentalDisplay {
  readonly show: boolean
  readonly enclosure: 'parentheses' | 'brackets' | undefined
  /** True where the accidental is forced, as a cautionary or editorial one is. */
  readonly force?: boolean
}

/**
 * What a tie is written on. A pitched note and a note struck on a percussion
 * kit both carry ties, and the resolver that pairs the two ends works on
 * either; what a tie pairs by differs, so the reader states that separately.
 */
export interface TieTarget {
  /** Unique in the document. Written out only where something refers to it. */
  readonly id: string
  /**
   * Added to as the note is read, and again by the spanner resolver, which
   * is where the two ends of a tie across measures meet.
   */
  ties: readonly Tie[]
}

export interface Note extends TieTarget {
  readonly pitch: Pitch
  readonly accidentalDisplay: AccidentalDisplay | undefined
  /**
   * Set only where this note sits on a staff other than the event's, which is
   * a chord straddling the two hands of a piano part.
   */
  readonly staff: number | undefined
}

/**
 * One instrument of a percussion kit: what it is called, where its notes are
 * written on the staff, and what plays it.
 *
 * MusicXML states the staff height on every unpitched note and MNX states it
 * once on the component, so the reader gathers the components a part strikes
 * as it reads its notes.
 */
export interface KitComponent {
  readonly name: string | undefined
  /** Staff steps from the middle line; negative is below it. */
  readonly staffPosition: number
  /**
   * The instrument setup that plays it, as the key it is held under in the
   * score's sounds. Undefined where the part list states no instrument.
   */
  readonly sound: string | undefined
}

/** A note struck on one component of a percussion kit. */
export interface KitNote extends TieTarget {
  /** The component struck, as the key it is held under in the part's kit. */
  readonly component: string
  /**
   * Set only where this note sits on a staff other than the event's, which is
   * a chord straddling two staves of one part.
   */
  readonly staff: number | undefined
}

/** A mark that states nothing beyond which side of the notes it is drawn on. */
export interface Marking {
  /** Which side of the notes it is drawn on, where the source says. */
  readonly placement: 'above' | 'below' | undefined
}

/** A strong accent, which states which way its wedge points. */
export interface StrongAccentMarking extends Marking {
  readonly pointing: 'up' | 'down' | undefined
}

/** An up-bow or down-bow, which names the way the bow travels. */
export interface BowDirectionMarking extends Marking {
  readonly direction: 'up' | 'down'
}

/** A breath mark, which names the glyph it is drawn with. */
export interface BreathMarking extends Marking {
  readonly symbol: string | undefined
}

/** A tremolo on one note, drawn as beams across its stem. */
export interface TremoloMarking extends Marking {
  /** How many beams it is drawn with. MNX states no tremolo without one. */
  readonly marks: number
}

export type CaesuraShape = 'normal' | 'thick' | 'short' | 'curved'

/** A caesura. MNX states no side for it, so it is not a Marking. */
export interface CaesuraMarking {
  /** How many strokes it is drawn with, where the source says one. */
  readonly marks: 1 | undefined
  readonly shape: CaesuraShape | undefined
}

/**
 * The marks written on an event: how it is attacked, and how long it is held.
 * Keyed by kind, as MNX keys them, so an event carries at most one of each.
 * The reader resolves a source that writes two of one kind, where it still has
 * the measure to report against. The kinds use the MNX spelling, so the writer
 * needs no second table.
 */
export interface Markings {
  readonly accent?: Marking
  readonly staccato?: Marking
  readonly staccatissimo?: Marking
  readonly tenuto?: Marking
  readonly spiccato?: Marking
  readonly stress?: Marking
  readonly unstress?: Marking
  readonly softAccent?: Marking
  readonly strongAccent?: StrongAccentMarking
  readonly bowDirection?: BowDirectionMarking
  readonly breath?: BreathMarking
  readonly tremolo?: TremoloMarking
  readonly caesura?: CaesuraMarking
}

export type MarkingKind = keyof Markings

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
  readonly symbol: FermataSymbol | undefined
  /** Which way it faces, where the source says. */
  readonly pointing: 'up' | 'down' | undefined
  /** Which side of the notes it is drawn on, where the source says. */
  readonly placement: 'above' | 'below' | undefined
}

export interface Event {
  readonly kind: 'event'
  /** Unique in the document. Written out only where something refers to it. */
  readonly id: string
  /**
   * Set only where this event sits on a staff other than its voice's, which
   * is settled once the measure is whole and the voice's own staff is known.
   */
  staff: number | undefined
  readonly value: NoteValue
  /** Filled in by the spanner resolver, because a slur pairs across measures. */
  slurs: readonly Slur[]
  /** What the event sings, by the verse line the source numbers it. */
  readonly lyrics: ReadonlyMap<string, Lyric>
  readonly stemDirection: 'up' | 'down' | undefined
  readonly markings: Markings
  readonly fermata: Fermata | undefined
  /**
   * Empty for a rest. More than one note makes it a chord, and each of those
   * joins as the measure walk reaches it.
   */
  notes: readonly Note[]
  /**
   * Empty unless the event is struck on a percussion kit. More than one makes
   * it a chord, as a hi-hat struck with a snare is.
   */
  kitNotes: readonly KitNote[]
  readonly isRest: boolean
  /**
   * A rest's height on the staff, in steps from the middle line, where the
   * source fixed it with <display-step>/<display-octave>. Undefined for a note
   * and for a rest drawn at its default height.
   */
  readonly staffPosition: number | undefined
}

/**
 * Time a voice passes over without sounding. MusicXML leaves such a gap
 * implicit, by moving its cursor; MNX has to state it, because a sequence
 * runs without interruption from wherever it starts.
 */
export interface Space {
  readonly kind: 'space'
  readonly duration: Fraction
}

/** A count of note values, as in "three eighths". */
export interface NoteValueQuantity {
  readonly value: NoteValue
  readonly multiple: number
}

/** Whether a tuplet's number or note value is drawn, and in what form. */
export type TupletDisplay = 'noNumber' | 'inner' | 'both'

/**
 * Notes played in the time of a different number of them. The events inside
 * keep the values they are written with; the ratio says how much time they
 * occupy.
 */
export interface Tuplet {
  readonly kind: 'tuplet'
  /**
   * What is played, for example three eighths. A bracket that states no ratio
   * of its own opens with the one its first note implies, and states what it
   * turned out to hold when it closes, so both counts are restated there.
   */
  inner: NoteValueQuantity
  /** The space they are played in, for example two eighths. */
  outer: NoteValueQuantity
  /** Added to as the bracket's notes are read, until it closes. */
  readonly content: SequenceItem[]
  /** Whether the bracket is drawn. Absent lets the renderer decide. */
  readonly bracket?: 'yes' | 'no'
  /** Whether the tuplet number is drawn. Absent lets the renderer decide. */
  readonly showNumber?: TupletDisplay
  /** Whether the tuplet note value is drawn. Absent lets the renderer decide. */
  readonly showValue?: TupletDisplay
  /** Which side of the notes it is drawn on. Absent lets the renderer decide. */
  readonly placement?: 'above' | 'below'
}

/**
 * Where a grace group takes its time from. MusicXML states an amount on each
 * grace note; MNX states a kind on the group, so which attribute the source
 * wrote is what carries over and how much it takes does not.
 */
export type GraceType = 'makeTime' | 'stealFollowing' | 'stealPrevious'

/**
 * Notes drawn small beside the note they ornament, taking none of the
 * measure's time. Most lead into the note that follows; one taking its time
 * from the note before is drawn after that note instead.
 */
export interface GraceGroup {
  readonly kind: 'grace'
  /** Grace notes join the group as the measure walk reaches them. */
  content: readonly Event[]
  /** True when the group is drawn with a slash through it, which the last
   * note to join can be the one to say. */
  slashed: boolean
  /** Where its time comes from, where the source says. */
  graceType: GraceType | undefined
}

/**
 * A tremolo written across two notes, played as a rapid alternation. Each
 * note is drawn with the value of the whole tremolo, and together they
 * occupy that value once.
 */
export interface MultiNoteTremolo {
  readonly kind: 'multiNoteTremolo'
  /** How many beams join the pair. */
  readonly marks: number
  /**
   * The time the tremolo occupies: one unit per event, so a pair of written
   * halves occupies two quarters.
   */
  readonly outer: NoteValueQuantity
  readonly content: readonly Event[]
}

export type SequenceItem = Event | Space | Tuplet | GraceGroup | MultiNoteTremolo

/**
 * A rest that fills its measure, whatever the time signature says that is.
 * It is a property of the sequence rather than an event in it, because that
 * is how MNX states it: the sequence holds no events.
 */
export interface FullMeasureRest {
  /** The value drawn, when the source says which one. */
  readonly visualDuration: NoteValue | undefined
  /** A pause held over the rest, which is where most fermatas are written. */
  readonly fermata: Fermata | undefined
  /** Its height on the staff, in steps from the middle line, where fixed. */
  readonly staffPosition: number | undefined
}

export interface Sequence {
  /** The voice as the source named it, when a measure holds more than one. */
  readonly voice: string | undefined
  /** The staff this voice sits on, where the part has more than one. */
  readonly staff: number | undefined
  readonly content: readonly SequenceItem[]
  readonly fullMeasure: FullMeasureRest | undefined
}

export interface Clef {
  readonly sign: ClefSign
  /** Staff steps from the middle line; negative is below it. */
  readonly staffPosition: number
  /** Which staff of the part, where it has more than one. */
  readonly staff: number | undefined
  /** Where in the measure it is drawn: zero unless the clef changes partway. */
  readonly position: Fraction
  /**
   * Octaves the clef is transposed for drawing, as a treble-8 clef sits an
   * octave below a plain treble. Undefined where the clef is untransposed.
   */
  readonly octave: number | undefined
  /** True where the clef is not drawn, and takes no space. */
  readonly hide: boolean
}

/**
 * How a staff is drawn from a point in a measure on. MNX holds a config in
 * force until a later measure states another for the same staff, so one is
 * carried only where the count changes.
 */
export interface StaffConfig {
  /** How many lines the staff is drawn with. Five is what MNX draws anyway. */
  readonly lines: number
  /** Which staff of the part, where it has more than one. */
  readonly staff: number | undefined
  /** Where in the measure it takes effect: zero unless it changes partway. */
  readonly position: Fraction
}

/**
 * A beam over several events, with the secondary beams nested inside it. A
 * beam of one event is a hook, and says which way it points.
 */
export interface Beam {
  readonly events: readonly string[]
  readonly beams: readonly Beam[]
  readonly direction: 'left' | 'right' | undefined
}

// The letters an accent dynamic wraps around its value: the s of sfz or the
// r of rfz before it, the z after it, or explicitly none, which is not the
// same as unstated.
export type AccentPrefix = 's' | 'r' | ''
export type AccentSuffix = 'z' | ''

/** MNX's plain dynamic marks, from softest to loudest. */
export type DynamicValue =
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

/** Which way a hairpin opens. */
export type WedgeType = 'increasing' | 'decreasing'

/**
 * Where a span stops, which is what a hairpin's or an octave shift's end
 * states: a measure's place in the score and a point in it. Grace notes take
 * none of the measure's time, so a point they sit at needs a grace index to
 * say which of them the span ends on: the note they ornament is 0 and the
 * rightmost grace note is 1. Unset where the point has no grace notes, which
 * reads as before all of them.
 */
export interface SpanStop {
  readonly measure: number
  readonly position: Fraction
  readonly graceIndex?: number
}

/**
 * A dynamic mark. An immediate one states a value and sits at a point; a
 * gradual one is a hairpin, which opens one way or the other and runs from
 * here to a point that may be several measures away; an accent one, such as a
 * sforzando, is drawn as a single combined glyph.
 */
export interface Dynamic {
  readonly position: Fraction
  readonly value: DynamicValue | undefined
  /** Set on a hairpin, which is what makes it gradual rather than immediate. */
  readonly wedge: WedgeType | undefined
  /**
   * Set on an accent, such as a sforzando. The mark's spelling is the plain
   * `value` for the attack level with the accent's letters around it as the
   * prefix and suffix, and a two-stage accent like fp adds the level it
   * settles to as the residual. Its glyphs draw the combined mark.
   */
  readonly accent?: {
    readonly residualValue: DynamicValue | undefined
    readonly prefix: AccentPrefix
    readonly suffix: AccentSuffix
    readonly glyphs: readonly string[]
  }
  /** The wording drawn before the mark, as in the "più" of "più f", which is
   * read before the mark it belongs to. */
  prefix?: string
  /**
   * The wording drawn after the mark, as in the "sub." of "p sub.", which the
   * direction reader adds once it reaches the words. Wording written at a
   * hairpin's closing edge is added by the spanner resolver instead, which is
   * where the two ends meet.
   */
  suffix?: string
  /**
   * Where the hairpin stops. Filled in by the spanner resolver, which removes
   * a hairpin the source never closed.
   */
  end: SpanStop | undefined
  /** Which staff it belongs under, where the part has more than one. */
  readonly staff: number | undefined
  /** Which side of the staff it is drawn on, where the source states it. */
  readonly placement?: 'above' | 'below'
}

/**
 * A chord rolled rather than struck. MNX states it on the measure rather than
 * on the event, spanning the notes it runs between, because it is drawn as a
 * line beside them rather than as a mark on any one of them.
 */
export interface Arpeggio {
  readonly position: Fraction
  /**
   * The ids of the notes it runs between. MNX names the first-played note
   * first, so a roll going downwards runs from the highest to the lowest.
   */
  readonly span: { readonly start: string; readonly end: string }
  /** Which way it is rolled. MusicXML's default is upwards. */
  readonly direction: 'up' | 'down'
  /** Whether an arrowhead is drawn, which is what a stated direction means. */
  readonly arrow: boolean
  /** A bracket saying the notes are struck together, rather than a roll. */
  readonly struck: boolean
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
  readonly position: Fraction
  /** Where the shift stops. */
  readonly end: SpanStop
  readonly value: OttavaAmount
  /** Which staff it applies to, where the part has more than one. */
  readonly staff: number | undefined
  /** Which side of the staff it is drawn on, where the source states it. */
  readonly placement?: 'above' | 'below'
}

export interface Measure {
  readonly clefs: readonly Clef[]
  /** The staves this measure starts drawing with a line count of their own. */
  readonly staffConfigs: readonly StaffConfig[]
  /** Stated over the measure rather than on the notes, as MNX has it. */
  readonly beams: readonly Beam[]
  /**
   * Taken from once the whole part is read: a hairpin the source never
   * closes is removed.
   */
  readonly dynamics: Dynamic[]
  readonly arpeggios: readonly Arpeggio[]
  /** Filled in once the whole part is read, because a shift spans measures. */
  readonly ottavas: Ottava[]
  /**
   * A simile sign starting here: repeat the previous this-many measures.
   * A sign spanning several measures sits only on the first of them. Filled
   * in once the whole part is read, because the sign runs measure to measure.
   */
  measureRepeat: number | undefined
  readonly sequences: readonly Sequence[]
}

/**
 * A part's instrument transposition, as MNX states it: the interval that
 * turns a sounding pitch into the written one. A B-flat clarinet, written a
 * major second above what it sounds, is `{ staffDistance: 1, halfSteps: 2 }`.
 * MusicXML's <transpose> states the same interval the other way round.
 */
export interface TranspositionInterval {
  /** Staff steps from the sounding pitch to the written one. */
  readonly staffDistance: number
  /** Half steps from the sounding pitch to the written one. */
  readonly halfSteps: number
}

export interface Transposition extends TranspositionInterval {
  /**
   * The number of fifths at which the part writes the enharmonic signature
   * rather than the one its transposition asks for, to avoid more than seven
   * sharps or flats. Undefined for a part that flips nowhere, which is what
   * an absent point means in MNX.
   */
  readonly keyFifthsFlipAt: number | undefined
}

export interface Part {
  readonly id: string
  readonly name: string | undefined
  /** The abbreviated name drawn on systems after the first. Undefined where
   * the source gives none, gives an empty one, or hides it. */
  readonly shortName: string | undefined
  /** How many staves the part is written on. One unless the source says. */
  readonly staves: number
  /**
   * The percussion instruments the part is struck on, keyed by what its kit
   * notes name. Empty for a part that strikes none.
   */
  readonly kit: ReadonlyMap<string, KitComponent>
  /**
   * The instrument's transposition, where the part is written for one that
   * reads at a pitch other than it sounds. Undefined for a part at concert
   * pitch, which is what an absent <transpose> means.
   */
  readonly transposition: Transposition | undefined
  readonly measures: readonly Measure[]
}

/**
 * One item of the score's instrument grouping: a group drawn with a bracket
 * or brace around its members, or a part standing on its own. The grouping is
 * a tree, in score order.
 */
export type GroupingItem =
  ({ readonly kind: 'group' } & PartGroup) | { readonly kind: 'part'; readonly part: string }

export interface PartGroup {
  /** Undefined where the source's symbol kind has no MNX spelling. */
  readonly symbol: 'bracket' | 'brace' | 'noSymbol' | undefined
  /** The name drawn beside the group, where the source gives one. */
  readonly label: string | undefined
  /** How barlines run through the group, where the source says. */
  readonly barlineStyle: 'unified' | 'individual' | 'mensurstrich' | undefined
  readonly content: readonly GroupingItem[]
}

export interface Key {
  readonly fifths: number
}

/**
 * A time signature's lower number names a note value, so only a power of two
 * can appear there. Narrow, so the reader validates it and the writer emits it
 * without a cast.
 */
export type TimeUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface TimeSignature {
  readonly count: number
  readonly unit: TimeUnit
  /**
   * The C or cut-C glyph the signature is drawn with, in place of its numbers.
   * Undefined where it is drawn as numbers.
   */
  readonly display: 'common' | 'cut' | undefined
}

/** A tempo mark: this many of the given note value per minute. */
export interface Tempo {
  readonly position: Fraction
  readonly value: NoteValue
  readonly bpm: number
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
  readonly times: number | undefined
}

/**
 * A first or second time bracket. MusicXML marks where one starts and where it
 * stops; MNX states it on the measure where it starts, as how many measures it
 * covers.
 */
export interface Ending {
  /** Measures covered, counted inclusively, so one measure is a duration of 1. */
  readonly duration: number
  /** The times it covers, as written over the bracket. */
  readonly numbers: readonly number[]
  /** True where the bracket has no closing hook, as a final ending has none. */
  readonly open: boolean
}

/**
 * Attributes that apply to a measure across every part. There is one of these
 * per measure in the score, whether or not it declares anything: this list is
 * the score's measure list, and each part's measures line up with it by
 * position.
 */
export interface GlobalMeasure {
  readonly key: Key | undefined
  readonly time: TimeSignature | undefined
  readonly tempos: readonly Tempo[]
  /** Only when the score numbers the measure differently from its position. */
  readonly number: number | undefined
  /** The line that closes the measure, where the source draws other than a plain one. */
  readonly barline: BarlineType | undefined
  readonly repeatStart: boolean
  readonly repeatEnd: RepeatEnd | undefined
  /**
   * Filled in once the whole part is read, because the bracket is written as
   * a start in one measure and a stop in another.
   */
  readonly ending: Ending | undefined
  /** A pause written over the barline rather than over a note. */
  readonly fermata: Fermata | undefined
  /** The segno sign, where the measure carries one. MNX draws one per measure. */
  readonly segno: Segno | undefined
  /** A Fine, where a D.S. or D.C. repeat stops. One per measure. */
  readonly fine: Fine | undefined
  /** A jump such as D.S., taken once the measure is played. One per measure. */
  readonly jump: Jump | undefined
  /**
   * A multi-measure rest starting at this measure, as how many measures it
   * spans, counting this one. The spanned measures stay ordinary measures.
   */
  readonly multimeasureRest: number | undefined
  /** A new system starts at this measure. */
  readonly systemBreak: boolean
  /** A new page starts at this measure, and a new system with it. */
  readonly pageBreak: boolean
}

/** A segno sign, the point a D.S. jumps back to. */
export interface Segno {
  /** Where in the measure it is drawn, counting from the start. */
  readonly location: Fraction
  /** A specific SMuFL glyph, where the source names one. */
  readonly glyph: string | undefined
  /** The color it is drawn in, in MNX's "#RRGGBB" form, where the source states one. */
  readonly color: string | undefined
}

/** A Fine, where a D.S. or D.C. repeat stops. */
export interface Fine {
  /** Where in the measure it is taken, counting from the start. */
  readonly location: Fraction
}

/** The kinds of jump MNX states: a dal-segno jump, or a D.S. al Fine. */
export type JumpType = 'dsalfine' | 'segno'

/** A jump such as D.S., taken once the measure is played. */
export interface Jump {
  /** Where in the measure it is taken, counting from the start. */
  readonly location: Fraction
  readonly type: JumpType
}

/** An instrument the part list sets up, as its drawn name and what sounds it. */
export interface InstrumentSound {
  readonly name: string | undefined
  /**
   * The MIDI pitch that sounds it, where the part list states one. MNX's
   * sound states a midiNumber, which its docs define as the pitch backing a
   * percussion kit, so this is MusicXML's <midi-unpitched> and nothing else.
   */
  readonly midiNumber: number | undefined
}

export interface Score {
  readonly globalMeasures: readonly GlobalMeasure[]
  readonly parts: readonly Part[]
  /**
   * The instrument grouping the part list draws, empty where it draws none.
   * Ungrouped parts appear as bare items, so a non-empty grouping holds, in
   * order, every listed part the score writes; a part the list never
   * mentions stands outside it.
   */
  readonly grouping: readonly GroupingItem[]
  /**
   * The instrument setup the part list states, keyed by the source's
   * instrument id, empty where it states none.
   */
  readonly sounds: ReadonlyMap<string, InstrumentSound>
  /** The SMuFL font the score is engraved in, where the source names one. */
  readonly musicFont?: string
  /**
   * True where the source declared that the beams it writes are the whole of
   * them, which holds even where it writes none: a score can beam nothing on
   * purpose. Absent where the source declared nothing.
   */
  readonly declaresBeams?: boolean
  /**
   * True where the source declared that the accidentals it draws are the
   * whole of them, on the same terms as the beams.
   */
  readonly declaresAccidentals?: boolean
}
