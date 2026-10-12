// Settling how a voice's measure rest is written once the measure is whole: on
// the sequence, as an event, or as a space.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import type { Fraction } from '../fraction.js'
import type { Event, EventRest, FullMeasureRest, SequenceItem, Space } from '../model/score.js'
import type { BeamedEvent } from './beams.js'

/**
 * How a voice's measure rest is written, settled once the measure is whole:
 * on the sequence, which then holds nothing else, as an event, or as a space
 * where no note value writes the rest.
 */
export type MeasureRestForm = 'sequence' | 'event' | 'space'

/** What a measure rest loses in each form it can take. */
export type MeasureRestReports<Form extends MeasureRestForm = MeasureRestForm> = Partial<
  Record<Form, () => void>
>

/**
 * A rest that fills its voice's measure, or may, until MeasureBuilder.finish
 * settles how it is written.
 *
 * - `candidate`: an ordinary rest that is the measure's rest only where it
 *   turns out to be the whole of its voice. It stays the event it was read
 *   as, or the sequence states it.
 * - `fills`: the rest fills the measure as read, and the voice holds nothing
 *   beside it but grace notes and silence. It stands in the content as a space of its
 *   length, where one is known, and takes any form.
 * - `fills-as-event`: the rest fills the measure as read and carries what
 *   only an event holds, so it stays the event it was read as.
 */
export type MeasureRest =
  | { readonly origin: 'fills-as-event' }
  | {
      readonly origin: 'candidate'
      readonly event: Event
      readonly body: EventRest
      readonly reports: MeasureRestReports<'sequence' | 'event'>
    }
  | {
      readonly origin: 'fills'
      readonly onSequence: FullMeasureRest
      readonly space: Space | undefined
      /** The event a note value writes the rest as, where one does. */
      readonly asEvent: (() => Event) | undefined
      readonly at: Fraction
      /** The rest's entry in `placed`, which names its staff. */
      readonly placed: { event: Event | undefined; staff: number | undefined }
      readonly reports: MeasureRestReports
      readonly path: DocumentPath
      readonly line: number
    }

/** What a voice's sequence holds that its measure rest is settled against. */
export interface RestingVoice {
  content: SequenceItem[]
  /** What each event said about its beams. */
  readonly beamed: readonly BeamedEvent[]
  measureRest: MeasureRest | undefined
  fullMeasure: FullMeasureRest | undefined
  readonly spent: Map<SequenceItem, Fraction>
}

/** States the rest on the sequence, which then holds nothing else. */
function stateOnSequence(voice: RestingVoice, rest: FullMeasureRest): void {
  voice.content.length = 0
  voice.fullMeasure = rest
}

/**
 * Settles how a rest filling the measure as read is written, and hands back
 * the form it takes.
 *
 * MNX states a measure rest on a sequence that holds nothing else. Grace
 * notes beside the rest have nowhere to stand there, so the rest is written
 * as the event a note value writes it as, or as a space of its length where
 * none can. Which side of the rest the grace notes are written on says
 * nothing about the music, so both orders are written alike.
 */
export function settleFillingRest(
  voice: RestingVoice,
  rest: Extract<MeasureRest, { origin: 'fills' }>,
): MeasureRestForm {
  // Anything in the content but a space is a grace note.
  if (voice.content.every((item) => item.kind === 'space')) {
    stateOnSequence(voice, rest.onSequence)
    return 'sequence'
  }
  const { space, asEvent } = rest
  if (!space) {
    throw new MusicXMLError(
      'A grace note stands beside a rest that fills the measure, and neither a note ' +
        'value nor a length says how long that rest lasts.',
      { path: rest.path, line: rest.line },
    )
  }
  if (!asEvent) return 'space'

  const event = asEvent()
  voice.content[voice.content.indexOf(space)] = event
  voice.spent.set(event, space.duration)
  rest.placed.event = event
  return 'event'
}

/**
 * Reads a rest that is the whole of its voice as that voice's measure rest,
 * the brackets being written, and reports what the form it takes loses.
 *
 * A bar of silence is drawn with a whole rest whatever the meter says, so a
 * 3/2 measure rests with a whole rest lasting a dotted whole. Where the
 * exporter leaves measure="yes" off, taking the written value as the rest's
 * length leaves the measure short. MNX has the full-measure rest's
 * visualDuration for this: the rest lasts the measure, and the value drawn
 * is stated beside it. Such a rest is not the measure's rest wherever it
 * stands: sources write one beside other notes, and the voice has to be
 * whole before the two can be told apart.
 *
 * The sequence carries no marking, no stem, no beam and no roll, and has
 * no id for a slur or a lyric to reach, so anything reaching the rest keeps
 * it an event.
 */
export function settleCandidateRest(
  voice: RestingVoice,
  rest: Extract<MeasureRest, { origin: 'candidate' }>,
  /** Whether a roll or a bracket marks the rest. */
  marked: boolean,
): void {
  const { event } = rest
  const reached =
    voice.beamed.length > 0 ||
    event.stemDirection !== undefined ||
    event.lyrics.size > 0 ||
    Object.keys(event.markings).length > 0 ||
    marked
  if (reached || voice.content.length !== 1 || voice.content[0] !== event) {
    rest.reports.event?.()
    return
  }
  // The rest is the whole of the voice, so the staff it named stays as
  // the sequence's own. Its entry keeps naming the event it came from,
  // which nothing writes once the content is empty.
  const { value, fermata } = event
  stateOnSequence(voice, {
    visualDuration: value,
    fermata,
    staffPosition: rest.body.staffPosition,
  })
  rest.reports.sequence?.()
}
