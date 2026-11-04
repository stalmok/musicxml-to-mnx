import type { Pitch, Step } from '../model/score.js'

// The steps of the scale in order from C, since staff height is counted
// diatonically, and where each sits in the octave in half steps.
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const satisfies readonly Step[]
const SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** A pitch's diatonic index: its octave times seven, plus the step's order. */
export function diatonicIndex(step: Step, octave: number): number {
  return octave * 7 + STEPS.indexOf(step)
}

/** A pitch's height in half steps above the C of octave 0. */
export function chromaticIndex(pitch: Pitch): number {
  return pitch.octave * 12 + SEMITONES[pitch.step] + pitch.alter
}

/**
 * The pitch `letters` steps higher on the staff and `halfSteps` higher in
 * sound. The letters settle the step, and the half steps its alteration, so
 * a C moved one letter and no half steps is a D double-flat.
 */
export function movedPitch(pitch: Pitch, letters: number, halfSteps: number): Pitch {
  const stepsFromC = diatonicIndex(pitch.step, pitch.octave) + letters
  /* v8 ignore next -- seven steps, and the remainder of seven is one of them. */
  const step = STEPS[((stepsFromC % 7) + 7) % 7] ?? 'C'
  const octave = Math.floor(stepsFromC / 7)
  return {
    step,
    octave,
    alter: chromaticIndex(pitch) + halfSteps - chromaticIndex({ step, octave, alter: 0 }),
  }
}
