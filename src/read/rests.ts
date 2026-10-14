// Whether a rest is its voice's rest through the measure, and placing it
// there, or dropping a rest written over it.
//
// MNX states a rest filling the measure on the sequence rather than as an
// event in it. MusicXML writes one as an ordinary <note>, sometimes marked
// measure="yes", sometimes only drawn to the length the time signature
// states, so which rests are the measure's is read here from what the note
// states and where it stands in its voice.

import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { NoteValue } from '../model/score.js'
import { writtenAt } from './collector.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, descendants, readWholeElement } from '../xml/tree.js'
import { describeLength, lengthOf, noteValueOf } from './duration.js'
import { readFermata, statesNoStem, writtenMarks } from './marks.js'
import type { NoteStatement, RestNote, VoicedNote } from './noteStatement.js'
import { readCountedRatio } from './noteTuplets.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import { stopsFirst } from './tiesAndSlurs.js'
import type { MeasureBuilder } from './voices.js'
import { measuredValue, reportDurationMismatch } from './writtenValues.js'
import type { NoteScale } from './writtenValues.js'

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
       * notes before it at the measure start also keep it an event, where a
       * note value can write it.
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

  const soundsFirst = builder.hasSoundedNothing(voice) && builder.atMeasureStart()
  const afterGraceNotes = soundsFirst && voice.holdsOnlyGraceNotes()

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
    soundsFirst
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

/**
 * A rest that fills the measure stands in no bracket. A start opens one, and
 * a rest inside a bracket stays an event, so the markers here are stops.
 */
export function reportMarkersOnMeasureRest(
  markers: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
): void {
  for (const marker of markers) {
    warnings.addWhole(
      'unsupported:element',
      'A <tuplet> on a rest that fills the measure closes no bracket, and is not converted.',
      context,
      marker,
    )
  }
}

/** Places a rest as its voice's rest through the measure. */
export function setMeasureRest(
  note: VoicedNote,
  fills: FillsMeasure,
  state: PartState,
  builder: MeasureBuilder,
  measureIndex: number,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const { element, eventNotations, voice, written, duration, staff, staffPosition } = note
  // A beam over a rest alone is not a beam, so a source stating one says
  // nothing this loses.
  element.skip('beam')
  if (!fills.canStayEvent) {
    const at = builder.position()
    reportCarriedByUnwritableRest(note, warnings, context, (type, slur) => {
      const number = attribute(slur, 'number') ?? '1'
      state.spanners.dropSlurEnd(
        type,
        number,
        voice.name,
        measureIndex,
        at,
        writtenAt(slur, context, warnings),
      )
    })
  }

  const { eventValue: restValue, unwritableLength: unwritableRest } = fills
  const place = warnings.reserve()

  // A rest no note value writes is written as a space beside grace notes, and
  // a hidden one then loses nothing drawn. So its hiding, like its length, is
  // reported only where it stays on the sequence. Where the rest cannot stay
  // an event, only its fermata is converted, so only a hidden block holding
  // one is drawn anyway.
  const hiddenDrawn = fills.canStayEvent ? undefined : 'fermata'
  if (restValue) note.reportHidden(hiddenDrawn)

  // Where the source states no <duration>, the rest lasts the measure. A bar
  // of silence is drawn as a whole rest in any meter, so the written value is
  // what it lasts only where no time signature says how long the measure is.
  const lasts = duration ?? measureLength(state) ?? (written && lengthOf(written))
  const fermata = readFermata(eventNotations, warnings, context)
  builder.setFullMeasure(
    voice,
    {
      visualDuration: written,
      fermata,
      // MNX's full-measure rest carries a staffPosition too, so a display
      // height on one is placed there rather than lost.
      staffPosition,
    },
    lasts,
    staff,
    // What grace notes beside the rest write it as. A marking, a stem, a
    // lyric or a slur would have kept it an event already.
    restValue &&
      (() => ({
        kind: 'event',
        id: state.ids.nextEvent(),
        staff: undefined,
        value: restValue,
        slurs: [],
        lyrics: new Map(),
        stemDirection: undefined,
        markings: {},
        fermata,
        body: { kind: 'rest', staffPosition },
      })),
    {
      // A tuplet or a tremolo open around the rest is refused, so nothing
      // scales its written value.
      event: () => {
        if (written && lasts) {
          const scale = { factor: fraction(1), by: undefined }
          reportDurationMismatch(element, written, lasts, scale, warnings, context, place)
        }
      },
      sequence: () => {
        if (!restValue) note.reportHidden(hiddenDrawn)
        // MNX's rest filling the measure states no length, so how long the
        // source drew this one is not carried. Only a rest that reached here
        // on its own length reports it: one marked as the measure's, or drawn
        // to what the time signature states, says nothing MNX's measure does
        // not. A space written for the rest beside grace notes states the
        // length.
        if (unwritableRest) {
          warnings.addAt(
            place,
            'unrepresentable:rest-length',
            `A rest lasting ${describeLength(unwritableRest)} is the whole of its voice in ` +
              (state.time === undefined
                ? 'a measure written with no time signature. '
                : 'this measure, and no note value can write that length. ') +
              'MNX states such a rest on the sequence, which carries no length, so the ' +
              'length is not converted.',
            context,
            fills.rest,
          )
        }
      },
      space: () => {
        // A hidden rest is time with nothing drawn in it, which is what a
        // space is, unless a fermata is drawn over it.
        if (note.hidden && !fermata) return
        warnings.addAt(
          place,
          'unrepresentable:grace-beside-rest',
          'A grace note stands beside a rest that fills the measure, and no note value ' +
            'can write that rest as an event. MNX states such a rest on a sequence that ' +
            'holds nothing, so the rest is converted as a space of its length. The rest ' +
            'is not drawn, nor a fermata or a position stated on it.',
          context,
          fills.rest,
        )
      },
    },
    path,
    element.line,
  )
}

/**
 * Reports what only an event holds on a rest no note value writes as one.
 * MNX states that rest on the sequence, or as a space beside grace notes,
 * and neither carries a stem, a mark, a slur end or a lyric.
 */
function reportCarriedByUnwritableRest(
  note: NoteStatement,
  warnings: WarningCollector,
  context: ReportContext,
  dropSlurEnd: (type: 'start' | 'stop', slur: XmlElement) => void,
): void {
  const marks = [...writtenMarks(note.eventNotations, warnings, context)].flatMap(
    ({ marking, found, block, notations }) => {
      block.read(found)
      // A mark MNX cannot state was reported as it was read.
      if (marking === undefined) return []
      return [[found, attribute(notations.element, 'print-object') !== 'no'] as const]
    },
  )
  reportCarriedByRest(note, marks, dropSlurEnd, (found) => {
    warnings.add(
      'unrepresentable:element',
      `A <${found.name}> on a rest that fills the measure is not converted. No note value ` +
        'writes the rest as an event, and neither the rest MNX states on the sequence nor a ' +
        'space written for it carries one.',
      context,
      found,
    )
  })
}

/**
 * Drops a rest written over its voice's rest through the measure. The rest
 * and each notation it carries are reported, and the cursor still moves past
 * where it stood.
 */
export function dropRedundantRest(
  note: VoicedNote,
  rest: XmlElement,
  state: PartState,
  builder: MeasureBuilder,
  measureIndex: number,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const { element, eventNotations, voice, duration, written } = note
  // The voice rests the measure, so no bracket is open around the rest, and a
  // ratio on it scales it alone. One counting no note value scales nothing.
  const ratio = element.child('time-modification')
  const rated = ratio && readCountedRatio(ratio, element, path)
  const scale: NoteScale = rated
    ? { factor: fraction(rated.outer.multiple, rated.inner.multiple), by: 'tuplet' }
    : { factor: fraction(1), by: undefined }
  if (written && duration) {
    reportDurationMismatch(element, written, duration, scale, warnings, context, warnings.reserve())
  }
  const lasts =
    duration ??
    multiplyFractions(
      lengthOf(written ?? measuredValue(element, duration, scale, state, path)),
      scale.factor,
    )

  warnings.add(
    'redundant:rest',
    'A rest is written over a rest that already fills the measure in the same voice. The ' +
      'measure rest is the one converted.',
    context,
    rest,
  )
  // A beam over a rest alone is not a beam, so a source stating one says
  // nothing this loses.
  element.skip('beam')
  const notations = eventNotations.map(({ found, block, notations }) => {
    block.read(found)
    return [found, attribute(notations.element, 'print-object') !== 'no'] as const
  })
  const at = builder.position()
  reportCarriedByRest(
    note,
    notations,
    (type, slur) => {
      const number = attribute(slur, 'number') ?? '1'
      state.spanners.dropSlurEnd(
        type,
        number,
        voice.name,
        measureIndex,
        at,
        writtenAt(slur, context, warnings),
      )
    },
    (found) => {
      warnings.add(
        'redundant:rest',
        `A <${found.name}> on a rest written over a rest that already fills the measure is ` +
          'not converted.',
        context,
        found,
      )
    },
  )
  builder.passOver(lasts)
}

/**
 * Reports, through `report`, what a rest carries and loses: the `notations`
 * given, its stem, its slur ends and its lyrics. Each comes with whether the
 * source draws it, and what the source does not draw loses nothing drawn, so
 * it is read and not reported.
 */
function reportCarriedByRest(
  { element, notations, hidden }: NoteStatement,
  carriedNotations: readonly (readonly [XmlElement, boolean])[],
  dropSlurEnd: (type: 'start' | 'stop', slur: XmlElement) => void,
  report: (found: XmlElement) => void,
): void {
  // A slur passing over the rest needs nothing of it. A slur end in a hidden
  // block still closes or opens its slur, so its loss reaches the other end.
  const slurEnds = notations.flatMap((block) =>
    children(block.element, 'slur').filter((slur) => {
      const type = attribute(slur, 'type')
      if (type !== 'start' && type !== 'stop') return false
      block.read(slur)
      return true
    }),
  )
  for (const slur of stopsFirst(slurEnds, (end) => end)) {
    dropSlurEnd(attribute(slur, 'type') === 'stop' ? 'stop' : 'start', slur)
  }
  // A note has at most one <stem>. A hidden rest draws none it states.
  const stem = element.child('stem')
  // Each element the rest carries, and whether the source draws it.
  const carried = new Map<XmlElement | undefined, boolean>([
    [stem, !hidden && stem !== undefined && !statesNoStem(stem)],
    ...carriedNotations,
    ...slurEnds.map((slur) => [slur, true] as const),
    ...element.children('lyric').map((lyric) => [lyric, true] as const),
  ])
  for (const found of descendants(element.element)) {
    const drawn = carried.get(found)
    if (drawn === undefined) continue
    // Reading it, or the one warning, accounts for the element whole.
    readWholeElement(found)
    if (drawn) report(found)
  }
}
