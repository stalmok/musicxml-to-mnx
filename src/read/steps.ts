import type { Step } from '../model/score.js'

// The diatonic order of a step within its octave, counting from C, since staff
// height is counted diatonically.
const STEP_ORDER: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

/** A pitch's diatonic index: its octave times seven, plus the step's order. */
export function diatonicIndex(step: Step, octave: number): number {
  return octave * 7 + STEP_ORDER[step]
}
