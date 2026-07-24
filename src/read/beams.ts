// Turning MusicXML's per-note beam markings into MNX's tree of beams.
//
// MusicXML puts the beams on the notes. Each note says, for every beam level
// it carries, whether a beam begins, continues or ends there, where level 1
// is the eighth-note beam, level 2 the sixteenth, and so on. A note beamed to
// only one neighbour carries a hook instead, pointing forward or back.
//
// MNX states the same thing the other way round, as a tree over the measure:
// an outer beam listing the events it runs over, nested beams for the
// secondary levels, and a beam of one event with a direction for a hook.

import type { Beam } from '../model/score.js'

/** What one event says about the beams it carries, by level. */
export interface BeamedEvent {
  id: string
  markers: ReadonlyMap<number, string>
}

const HOOK_DIRECTIONS = new Map<string, 'left' | 'right'>([
  // A forward hook points ahead, to the right of its note.
  ['forward hook', 'right'],
  ['backward hook', 'left'],
])

/**
 * The beams over one measure of one voice, outermost first.
 *
 * A run at a given level starts where a beam begins and closes where it ends.
 * A run the measure never closes is kept anyway, so the notes under it are
 * not lost; a beam left with one event under it is dropped, because a beam
 * over a single note is a flag rather than a beam.
 */
export function buildBeams(events: readonly BeamedEvent[]): Beam[] {
  return beamsAtLevel(events, 1)
}

function beamsAtLevel(events: readonly BeamedEvent[], level: number): Beam[] {
  const beams: Beam[] = []
  let run: BeamedEvent[] = []

  const close = (): void => {
    if (run.length > 1) {
      beams.push({
        events: run.map((event) => event.id),
        beams: beamsAtLevel(run, level + 1),
        direction: undefined,
      })
    }
    run = []
  }

  for (const event of events) {
    const marker = event.markers.get(level)

    const hook = marker === undefined ? undefined : HOOK_DIRECTIONS.get(marker)
    if (hook) {
      // A hook belongs to the level it is written at, beside whatever runs
      // there rather than inside them. A note may carry hooks at several
      // levels at once, as a 32nd beside a double-dotted eighth does, and
      // the deeper ones nest inside this one.
      beams.push({ events: [event.id], beams: beamsAtLevel([event], level + 1), direction: hook })
      continue
    }

    if (marker === 'begin') {
      close()
      run = [event]
    } else if (marker === 'continue' || marker === 'end') {
      // An end with no beginning is not a beam, and nothing is invented for it.
      if (run.length > 0) run.push(event)
      if (marker === 'end') close()
    } else {
      close()
    }
  }
  close()

  return beams
}
