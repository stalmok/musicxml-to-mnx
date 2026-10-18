// A transposing instrument reads at one pitch and sounds at another: a
// B-flat clarinet reading a C sounds a B-flat. MusicXML writes what the
// player reads and states the interval to the sounding pitch in <transpose>.
// MNX writes what the instrument sounds, and its part transposition states
// the interval the other way round, from the sounding pitch back to the
// written one. So both numbers are negated as <transpose> is read, and every
// pitch of such a part is carried to what it sounds.

import type {
  Event,
  Measure,
  Pitch,
  SequenceItem,
  Step,
  TranspositionInterval,
} from '../model/score.js'

/** The steps of the scale in order, and where each sits in the octave. */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const satisfies readonly Step[]
const SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * The pitch a written note sounds. The staff distance settles which letter
 * the sounding note takes, and the half steps settle its alteration, so a
 * written E-flat sounds a D-flat rather than the C-sharp beside it.
 */
export function soundingPitch(written: Pitch, transposition: TranspositionInterval): Pitch {
  const stepsFromC = written.octave * 7 + STEPS.indexOf(written.step) - transposition.staffDistance
  /* v8 ignore next -- seven steps, and the remainder of seven is one of them. */
  const step = STEPS[((stepsFromC % 7) + 7) % 7] ?? 'C'
  const octave = Math.floor(stepsFromC / 7)

  const semitonesFromC =
    written.octave * 12 + SEMITONES[written.step] + written.alter - transposition.halfSteps

  return { step, octave, alter: semitonesFromC - (octave * 12 + SEMITONES[step]) }
}

/**
 * The key the music sounds in, from the one the part is written in. An
 * interval of `d` staff steps and `c` half steps stands `7c - 12d` fifths
 * from where it starts, which is what a key signature counts: a B-flat
 * clarinet reads two sharps more than the music sounds.
 */
export function concertFifths(written: number, transposition: TranspositionInterval): number {
  return written + 12 * transposition.staffDistance - 7 * transposition.halfSteps
}

/**
 * The key a part writes for the key the music sounds in: the inverse of
 * `concertFifths`. A B-flat clarinet writes two sharps more than it sounds.
 * A part at concert pitch writes what it sounds.
 */
export function writtenFifths(
  concert: number,
  transposition: TranspositionInterval | undefined,
): number {
  if (!transposition) return concert
  return concert - 12 * transposition.staffDistance + 7 * transposition.halfSteps
}

/**
 * The same, for a part that flips its signature enharmonically past a point.
 * MNX states the point as a number of fifths: from there on twelve are taken
 * off, and a negative point adds twelve instead.
 */
export function writtenFifthsWithFlip(
  concert: number,
  transposition: TranspositionInterval | undefined,
  flipAt: number | undefined,
): number {
  const written = writtenFifths(concert, transposition)
  if (flipAt === undefined) return written
  if (flipAt >= 0) return written >= flipAt ? written - 12 : written
  return written <= flipAt ? written + 12 : written
}

/**
 * The point at which a part flips its key signature enharmonically, from the
 * keys the score sounds in and the keys the part states, measure by measure.
 *
 * A part avoids a signature of more than seven sharps or flats by writing the
 * enharmonic one: a concert key of five sharps is written for a B-flat
 * instrument as five flats rather than seven sharps. Read back, that flipped
 * signature gives a concert key twelve fifths from the one the rest of the
 * score is in, which is a different spelling of the same key, not a different
 * key.
 *
 * MNX states one point for the whole part, and its sign picks the direction,
 * so a part that flips both ways, or flips at one key change and not at a
 * further one, cannot be stated. Nothing is returned there, and nothing where
 * the part flips nowhere, which leaves the caller reporting whatever the
 * point does not account for.
 */
export function keyFifthsFlipAt(
  keys: readonly { score: number; part: number }[],
  transposition: TranspositionInterval | undefined,
): number | undefined {
  if (!transposition) return undefined

  // Each key is held as the fifths the part would write without a flip, which
  // is what the point is measured in.
  const kept: number[] = []
  const lowered: number[] = []
  const raised: number[] = []
  for (const key of keys) {
    const naive = writtenFifths(key.score, transposition)
    if (key.part === key.score) kept.push(naive)
    else if (key.part === key.score - 12) lowered.push(naive)
    else if (key.part === key.score + 12) raised.push(naive)
    else return undefined
  }
  if (lowered.length > 0 && raised.length > 0) return undefined

  if (lowered.length > 0) {
    const at = Math.min(...lowered)
    return at >= 0 && kept.every((naive) => naive < at) ? at : undefined
  }
  if (raised.length > 0) {
    const at = Math.max(...raised)
    return at < 0 && kept.every((naive) => naive > at) ? at : undefined
  }
  return undefined
}

/**
 * The same pitch spelled `letters` steps higher on the staff, as a C-sharp is
 * a D-flat one letter up.
 */
export function respelled(pitch: Pitch, letters: number): Pitch {
  const stepsFromC = pitch.octave * 7 + STEPS.indexOf(pitch.step) + letters
  /* v8 ignore next -- seven steps, and the remainder of seven is one of them. */
  const step = STEPS[((stepsFromC % 7) + 7) % 7] ?? 'C'
  const octave = Math.floor(stepsFromC / 7)
  const semitonesFromC = pitch.octave * 12 + SEMITONES[pitch.step] + pitch.alter
  return { step, octave, alter: semitonesFromC - (octave * 12 + SEMITONES[step]) }
}

/**
 * Re-spells a flipping part's notes in the key the score sounds in, given the
 * concert key in force at each measure.
 *
 * MNX moves every note of the part by a letter wherever the point flips its
 * signature: one up where twelve fifths are taken off, one down where they
 * are added. A note read from the flipped part is spelled the way the part
 * wrote it, so it is moved the other way here, and the flip brings it back.
 */
export function respellPastFlip(
  measures: readonly Measure[],
  transposition: TranspositionInterval,
  flipAt: number,
  concertKeys: readonly number[],
): Measure[] {
  return measures.map((measure, index) => {
    const concert = concertKeys[index] ?? 0
    const letters =
      (writtenFifthsWithFlip(concert, transposition, flipAt) -
        writtenFifths(concert, transposition)) /
      12
    if (letters === 0) return measure
    return {
      ...measure,
      sequences: measure.sequences.map((sequence) =>
        sequence.fullMeasure
          ? sequence
          : { ...sequence, content: respellItems(sequence.content, letters) },
      ),
    }
  })
}

function respellItems(items: readonly SequenceItem[], letters: number): SequenceItem[] {
  return items.map((item) => {
    switch (item.kind) {
      case 'event':
        return respellEvent(item, letters)
      case 'tuplet':
        return { ...item, content: respellItems(item.content, letters) }
      case 'grace':
      case 'multiNoteTremolo':
        return { ...item, content: item.content.map((event) => respellEvent(event, letters)) }
      case 'space':
        return item
    }
  })
}

function respellEvent(event: Event, letters: number): Event {
  if (event.body.kind === 'rest') return event
  const [first, ...rest] = event.body.notes.map((note) => ({
    ...note,
    pitch: respelled(note.pitch, letters),
  }))
  if (!first) return event
  return { ...event, body: { ...event.body, notes: [first, ...rest] } }
}
