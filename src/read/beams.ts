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
import { entriesOf } from './tables.js'

/** What one event says about the beams it carries, by level. */
export interface BeamedEvent {
  id: string
  markers: ReadonlyMap<number, string>
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

const HOOK_DIRECTIONS = new Map<string, 'left' | 'right'>([
  ['forward hook', 'right'],
  ['backward hook', 'left'],
])

/**
 * The beams over one measure of one voice, outermost first.
 *
 * A run at a given level starts where a beam begins and closes where it ends.
 * A run the measure never closes is kept. A primary run over one event is
 * dropped, because a beam over a single note is a flag.
 */
export function buildBeams(events: readonly BeamedEvent[]): Beam[] {
  return beamsAtLevel(events, 1)
}

function beamsAtLevel(events: readonly BeamedEvent[], level: number): Beam[] {
  const beams: Beam[] = []
  let run: BeamedEvent[] = []

  const close = (): void => {
    const [only] = run
    if (run.length > 1) {
      beams.push({
        events: run.map((event) => event.id),
        beams: beamsAtLevel(run, level + 1),
        direction: undefined,
      })
    } else if (only !== undefined && level > 1 && only.beamCount >= level) {
      // A single event left at an inner level always came from a begin, since
      // a continue or end only extends an open run. Where the note's value
      // needs this beam, it is a partial beam pointing forward: a one-event
      // beam drawn to the right. A repeated begin (two begins with no end
      // between) leaves the first note in this shape.
      beams.push({ events: [only.id], beams: [], direction: 'right' })
    }
    // A single event whose value does not need this beam is a stray marker.
    // It is dropped with no warning, because the note is drawn correctly
    // without it.
    run = []
  }

  for (const event of events) {
    const marker = event.markers.get(level)

    const hook = marker === undefined ? undefined : HOOK_DIRECTIONS.get(marker)
    if (hook) {
      // A hook belongs to the level it is written at, beside the runs there.
      // A note may carry hooks at several levels, as a 32nd beside a
      // double-dotted eighth does, and the deeper ones nest inside this one.
      beams.push({ events: [event.id], beams: beamsAtLevel([event], level + 1), direction: hook })
      continue
    }

    if (marker === 'begin') {
      close()
      run = [event]
    } else if (marker === 'continue' || marker === 'end') {
      // An end with no begin is not a beam.
      if (run.length > 0) run.push(event)
      if (marker === 'end') close()
    } else {
      close()
    }
  }
  close()

  return beams
}
