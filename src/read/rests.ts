// Whether a rest is its voice's rest through the measure, and in what form.
//
// MNX states a rest filling the measure on the sequence rather than as an
// event in it. MusicXML writes one as an ordinary <note>, sometimes marked
// measure="yes", sometimes only drawn to the length the time signature
// states, so which rests are the measure's is read here from what the note
// states and where it stands in its voice.

import { compareFractions, divideFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { NoteValue } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import { lengthOf, noteValueOf } from './duration.js'
import type { ElementReader } from './element.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import type { MeasureBuilder, VoiceLine } from './voices.js'

export interface RestNote {
  element: ElementReader
  notations: readonly ElementReader[]
  rest: XmlElement | undefined
  grace: XmlElement | undefined
  /** The value the note states in <type>, where it states one. */
  written: NoteValue | undefined
  duration: Fraction | undefined
  /** The line of its voice the note is written in. */
  voice: VoiceLine
}

/**
 * How a <note> stands against its voice's measure.
 *
 * - `ordinary`: it is not the measure's rest.
 * - `candidate`: it may be the measure's rest, and is held as an ordinary rest
 *   until the voice is whole. MeasureBuilder.finish settles it. It carries the
 *   written value and the length that disagree, for the reading where it
 *   stays an ordinary rest.
 * - `fills`: it is the measure's rest as it stands.
 */
export type RestReading =
  | { kind: 'ordinary' }
  | { kind: 'candidate'; written: NoteValue; duration: Fraction }
  | {
      kind: 'fills'
      /** The <rest> of the note. */
      rest: XmlElement
      /**
       * The value the rest is written as where it stays an event, and nothing
       * where no note value can write it: an irregular measure can rest for a
       * length no value states.
       */
      eventValue: NoteValue | undefined
      /**
       * Whether the rest can stay an event to keep what only an event holds:
       * a note value writes it, and the voice rests its measure no other way.
       * A second rest filling the measure is refused whatever it carries.
       */
      canStayEvent: boolean
      /**
       * Whether it carries something only an event holds, other than a
       * marking or a stem, which are read where the event is built. MNX's rest
       * on the sequence has no room for a lyric, and no id for a slur to start
       * or end on. The sequence stating it must hold nothing else, so grace
       * notes before it also keep it an event, where a note value can write it.
       */
      needsEvent: boolean
      /**
       * How long the rest lasts, where no note value can write that length and
       * that is what makes it the measure's rest.
       */
      unwritableLength: Fraction | undefined
    }

export type FillsMeasure = Extract<RestReading, { kind: 'fills' }>

/** Reads how a <note> stands against its voice's measure, as a rest. */
export function readRest(note: RestNote, state: PartState, builder: MeasureBuilder): RestReading {
  const { element, notations, rest, grace, written, duration, voice } = note

  const measure = measureLength(state)
  const lastsTheMeasure =
    duration !== undefined &&
    !state.divisionsAssumed &&
    measure !== undefined &&
    compareFractions(duration, measure) === 0

  // A rest marked as filling the measure has no length of its own: MNX states
  // it on the sequence, and the time signature sets the measure's length. Some
  // exporters leave measure="yes" off, so a rest with no written value lasting
  // the whole measure is read the same way. In an irregular measure that
  // length may have no note value.
  const drawnToTheMeasure =
    rest !== undefined &&
    written === undefined &&
    lastsTheMeasure &&
    // A rest reached after the voice has sounded fills what is left of the
    // measure. Exporters write one as a filler behind a note that overruns the
    // barline, and it is an ordinary rest.
    builder.opensMeasure(voice)

  // A grace note takes none of the measure's time, so a grace rest is never
  // the measure's rest. The mark is left unread and reported.
  const markedAsTheMeasure =
    rest !== undefined && grace === undefined && attribute(rest, 'measure') === 'yes'

  const opensMeasure = builder.canTakeMeasureRest(voice) && builder.atMeasureStart()
  const afterGraceNotes = opensMeasure && voice.holdsOnlyGraceNotes()

  // This rest has no written value and opens its voice. It is not marked as the
  // measure's rest, is not drawn to the time signature's length, and lasts a
  // time no note value can write. It is that voice's silence through the
  // measure, and MNX's rest on the sequence is the only place for it. Chant
  // editions written senza misura rest whole parts this way, and so do hidden
  // parts in early-music engravings: one bare rest per measure, in a bar longer
  // than the time signature says. A rest a note value can write stays that
  // event. The value tested is the one an open tuplet would draw the rest as,
  // as measuredValue does. Grace notes before it take none of the measure's
  // time, so the rest still opens the voice.
  const unwritableLength =
    !markedAsTheMeasure &&
    !drawnToTheMeasure &&
    rest !== undefined &&
    written === undefined &&
    duration !== undefined &&
    !state.divisionsAssumed &&
    noteValueOf(divideFractions(duration, voice.noteFactor())) === undefined &&
    opensMeasure
      ? duration
      : undefined

  // A slur only passing over the rest needs no target. The checks read the
  // element directly so that an unkept lyric or slur stays unread and
  // reported.
  const carriesLyric = element.element.children.some((c) => c.name === 'lyric')
  const carriesSlurEnd = notations.some((block) =>
    block.element.children.some(
      (c) =>
        c.name === 'slur' && (attribute(c, 'type') === 'start' || attribute(c, 'type') === 'stop'),
    ),
  )
  const eventValue =
    written ??
    (duration !== undefined && !state.divisionsAssumed ? noteValueOf(duration) : undefined)

  // A rest the source marks as the measure's is the measure's rest only where
  // it is the whole of its voice. Early-music editions bar their parts at
  // different lengths and pad a voice with a marked whole rest, before or
  // after its notes. Where the source states the rest's written value, the
  // rest can stand as an ordinary event, so the reading is settled once the
  // voice is whole. Without that value there is no event to fall back to, and
  // the mark is taken as written.
  const markedCandidate =
    markedAsTheMeasure &&
    written !== undefined &&
    duration !== undefined &&
    !carriesSlurEnd &&
    !builder.restsTheMeasure(voice)

  const fillsMeasure =
    rest !== undefined &&
    ((markedAsTheMeasure && !markedCandidate) ||
      drawnToTheMeasure ||
      unwritableLength !== undefined)

  // A bar of silence is drawn with a whole rest whatever the meter, so a rest
  // opening a voice can state a written value shorter than the measure it
  // fills. Where measure="yes" is left off, reading that value as the length
  // leaves the measure short. A rest lasting the whole measure can stand
  // beside other notes, so the reading is settled once the voice is whole.
  // Anything the rest carries that only an event can hold keeps it an event.
  const isCandidate =
    written !== undefined &&
    duration !== undefined &&
    (markedCandidate ||
      (rest !== undefined &&
        grace === undefined &&
        lastsTheMeasure &&
        compareFractions(lengthOf(written), duration) !== 0 &&
        // A slur is paired only once the part is whole, so whether one reaches
        // this rest can be read here and nowhere later. What the event carries
        // is checked where the reading is settled.
        !carriesSlurEnd &&
        // A rest written over a rest that already fills the measure is never
        // the measure's rest.
        !builder.restsTheMeasure(voice) &&
        // A rest the voice has already sounded past cannot be the measure's
        // rest. Ruling it out here, not when the measure is settled, keeps its
        // report where the rest stands.
        builder.opensMeasure(voice)))

  if (fillsMeasure) {
    return {
      kind: 'fills',
      rest,
      eventValue,
      canStayEvent: eventValue !== undefined && !builder.restsTheMeasure(voice),
      needsEvent: carriesLyric || carriesSlurEnd || afterGraceNotes,
      unwritableLength,
    }
  }
  return isCandidate ? { kind: 'candidate', written, duration } : { kind: 'ordinary' }
}
