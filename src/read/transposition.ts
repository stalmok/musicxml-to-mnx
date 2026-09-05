// A transposing instrument reads at one pitch and sounds at another: a
// B-flat clarinet reading a C sounds a B-flat. MusicXML writes what the
// player reads and states the interval to the sounding pitch in <transpose>.
// MNX writes what the instrument sounds, and its part transposition states
// the interval the other way round, from the sounding pitch back to the
// written one. So both numbers are negated as <transpose> is read, and every
// pitch of such a part is carried to what it sounds.

import type { Pitch, Step, Transposition } from '../model/score.js'

/** The steps of the scale in order, and where each sits in the octave. */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const satisfies readonly Step[]
const SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * The pitch a written note sounds. The staff distance settles which letter
 * the sounding note takes, and the half steps settle its alteration, so a
 * written E-flat sounds a D-flat rather than the C-sharp beside it.
 */
export function soundingPitch(written: Pitch, transposition: Transposition): Pitch {
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
export function concertFifths(written: number, transposition: Transposition): number {
  return written + 12 * transposition.staffDistance - 7 * transposition.halfSteps
}
