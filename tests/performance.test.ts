// Conversion time must scale linearly with the size of the score.
//
// These are guards, not measurements: each one converts a generated score at
// two sizes along one axis and checks the time ratio stays far below what a
// quadratic algorithm would produce. The bounds are several times the
// observed linear ratio, so machine noise cannot trip them, while an
// accidental O(n²) pass over notes, measures, or parts still will. For
// numbers rather than pass/fail, run `pnpm bench`.

import { performance } from 'node:perf_hooks'
import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import { generateScore } from './support/generate.js'

/**
 * Times both conversions and returns the large-to-small ratio of their best
 * runs. The runs alternate between the two sources, so load from test files
 * running in other workers slows both sides rather than skewing the ratio.
 */
function timeRatio(small: string, large: string): number {
  convertMusicXML(small)
  convertMusicXML(large)
  let bestSmall = Infinity
  let bestLarge = Infinity
  for (let run = 0; run < 5; run++) {
    let start = performance.now()
    convertMusicXML(small)
    bestSmall = Math.min(bestSmall, performance.now() - start)
    start = performance.now()
    convertMusicXML(large)
    bestLarge = Math.min(bestLarge, performance.now() - start)
  }
  return bestLarge / bestSmall
}

test('time scales linearly with measure count', () => {
  const small = generateScore({ parts: 1, measures: 100, notesPerMeasure: 8 })
  const large = generateScore({ parts: 1, measures: 800, notesPerMeasure: 8 })

  // 8x the measures: linear is 8x (observed ~7x), quadratic ~64x.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with part count', () => {
  const small = generateScore({ parts: 1, measures: 100, notesPerMeasure: 8 })
  const large = generateScore({ parts: 8, measures: 100, notesPerMeasure: 8 })

  // 8x the parts: linear is 8x (observed ~6x), quadratic ~64x.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with notes per measure', () => {
  const sparse = generateScore({ parts: 1, measures: 100, notesPerMeasure: 4 })
  const dense = generateScore({ parts: 1, measures: 100, notesPerMeasure: 16 })

  // 4x the density: linear is 4x (observed ~3x), quadratic ~16x.
  expect(timeRatio(sparse, dense)).toBeLessThan(12)
}, 60_000)

test('a large score converts in bounded time', () => {
  // Four parts, a thousand measures, ~48,000 notes: an order of magnitude
  // past the longest corpus songs. Observed around 1.5s plain and 6.5s under
  // coverage instrumentation; the bound leaves room for a loaded machine but
  // not for a complexity regression, which would take minutes at this size.
  const source = generateScore({ parts: 4, measures: 1000, notesPerMeasure: 8 })

  const start = performance.now()
  const { warnings } = convertMusicXML(source)
  const elapsed = performance.now() - start

  expect(warnings).toEqual([])
  expect(elapsed).toBeLessThan(30_000)
}, 90_000)
