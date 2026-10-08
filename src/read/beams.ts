// Turning MusicXML's per-note beam markings into MNX's tree of beams.
//
// MusicXML puts the beams on the notes. Each note says, for every beam level
// it carries, whether a beam begins, continues or ends there, where level 1
// is the eighth-note beam, level 2 the sixteenth, and so on. A note beamed to
// only one neighbour carries a hook instead, pointing forward or back.
//
// MNX states it as a tree over the measure: an outer beam listing the events
// it runs over, nested beams for the secondary levels, and a beam of one event
// with a direction for a hook.

import type { Beam, NoteValueBase } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import type { ReportContext, WarningCollector } from './collector.js'
import { entriesOf, recogniser } from './tables.js'

/** MusicXML's beam-value: what the beam at a level does at a note. */
export type BeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook'

export const isBeamValue = recogniser<BeamValue>({
  begin: true,
  continue: true,
  end: true,
  'forward hook': true,
  'backward hook': true,
})

/** What one <beam> says the beam at its level does at this event. */
export interface BeamMarker {
  /**
   * Nothing where the text is not one MusicXML defines. The beam at its level
   * then stops before the event, as at an event with no marker there.
   */
  kind: BeamValue | undefined
  element: XmlElement
}

/** What one event says about the beams it carries, by level. */
export interface BeamedEvent {
  id: string
  markers: ReadonlyMap<number, BeamMarker>
  /**
   * Whether the event opens the measure in a voice whose primary beam the
   * measure before left open. A beam continued or ended here carries on
   * that one. Never true for a grace note, whose beams stay in its group.
   */
  continuesFromBefore: boolean
  /**
   * How many beams the note's value calls for: an eighth one, a 16th two. An
   * inner beam that closes on this event alone is kept only up to this level.
   */
  beamCount: number
}

// How many beams each note value is drawn with. A Record, so a note value
// added to the model does not compile until it is added here.
const BEAM_COUNTS: Record<NoteValueBase, number> = {
  maxima: 0,
  longa: 0,
  breve: 0,
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
  '256th': 6,
  '512th': 7,
  '1024th': 8,
}

/** How many beams a note of this value carries. Zero for a quarter or longer. */
export function beamCountForValue(base: NoteValueBase): number {
  return BEAM_COUNTS[base]
}

// The table read the other way round, for a note whose beams are the only
// sign of its value. Only beamed values are in it, so each count names one
// value.
const VALUE_FOR_BEAMS = new Map<number, NoteValueBase>(
  entriesOf(BEAM_COUNTS)
    .filter(([, count]) => count > 0)
    .map(([base, count]) => [count, base]),
)

/** The value drawn with `count` beams: one beam is an eighth, two a 16th. */
export function valueForBeamCount(count: number): NoteValueBase | undefined {
  return VALUE_FOR_BEAMS.get(count)
}

const HOOK_DIRECTIONS = new Map<BeamValue, 'left' | 'right'>([
  ['forward hook', 'right'],
  ['backward hook', 'left'],
])

/**
 * The beams over one measure of one voice, outermost first.
 *
 * A run at a given level starts where a beam begins and closes where it ends.
 * A run the measure never closes is kept, since a source may leave the
 * barline to close it. A primary run over one event is dropped, because a
 * beam over a single note is a flag.
 *
 * A beam crossing the barline shows as a continue or end on the event that
 * opens the measure, in a voice whose beam the measure before left open.
 * MNX states such a beam on the measure it starts in, listing the events of
 * both. This converter does not join the two yet, so each side is beamed on
 * its own, and the crossing is reported.
 */
export function buildBeams(
  events: readonly BeamedEvent[],
  warnings: WarningCollector,
  context: ReportContext,
): Beam[] {
  return beamsAtLevel(events, 1, { warnings, context })
}

function beamsAtLevel(
  events: readonly BeamedEvent[],
  level: number,
  /** Where to report a primary beam crossing the barline. */
  report?: { warnings: WarningCollector; context: ReportContext },
  /**
   * Whether the run these events make up carries on a beam from the measure
   * before, so an inner beam can carry on with it.
   */
  carriesOn = true,
): Beam[] {
  const beams: Beam[] = []
  let run: BeamedEvent[] = []
  // Whether the run carries on a beam from the measure before.
  let fromBefore = false

  const close = (): void => {
    const [only] = run
    if (run.length > 1) {
      beams.push({
        events: run.map((event) => event.id),
        beams: beamsAtLevel(run, level + 1, undefined, fromBefore),
        direction: undefined,
      })
    } else if (only !== undefined && level > 1 && only.beamCount >= level) {
      // A single event left at an inner level came from a begin, or carries
      // on a beam from the measure before. Where the note's value needs this
      // beam, it is a partial beam pointing at the rest of it. A repeated
      // begin (two begins with no end between) leaves the first note in this
      // shape.
      beams.push({ events: [only.id], beams: [], direction: fromBefore ? 'left' : 'right' })
    }
    // A single event whose value does not need this beam is a stray marker.
    // It is dropped with no warning, because the note is drawn correctly
    // without it.
    run = []
    fromBefore = false
  }

  for (const event of events) {
    const found = event.markers.get(level)
    const marker = found?.kind

    const hook = marker === undefined ? undefined : HOOK_DIRECTIONS.get(marker)
    if (hook) {
      // A hook belongs to the level it is written at, beside the runs there.
      // A note may carry hooks at several levels, as a 32nd beside a
      // double-dotted eighth does, and the deeper ones nest inside this one.
      beams.push({
        events: [event.id],
        beams: beamsAtLevel([event], level + 1, undefined, false),
        direction: hook,
      })
      continue
    }

    if (marker === 'begin') {
      close()
      run = [event]
    } else if (found?.kind === 'continue' || found?.kind === 'end') {
      if (run.length > 0) {
        run.push(event)
      } else if (carriesOn && event.continuesFromBefore) {
        if (report) {
          report.warnings.add(
            'unsupported:element',
            'A beam crosses the barline into this measure, which is not converted yet. ' +
              'It is drawn as one beam each side of the barline, and a side holding one ' +
              'note is not beamed.',
            report.context,
            found.element,
          )
        }
        run = [event]
        fromBefore = true
      }
      // Anywhere else, an end or continue with no begin is not a beam, and
      // the notes are drawn correctly without it.
      if (marker === 'end') close()
    } else {
      close()
    }
  }
  close()

  return beams
}
