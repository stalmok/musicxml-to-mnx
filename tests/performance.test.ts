// Conversion time must scale linearly with the size of the score.
//
// Each test converts a generated score at two sizes along one axis and
// bounds the time ratio. Each bound sits a few times above the observed
// linear ratio and below the quadratic one, so machine noise cannot trip
// it, while a pass over the axis that goes quadratic and comes to dominate
// the runtime will. For numbers rather than pass/fail, run `pnpm bench`.

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

  // 8x the measures: observed ~8x; a quadratic pass multiplies that by 8.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with part count', () => {
  const small = generateScore({ parts: 1, measures: 100, notesPerMeasure: 8 })
  const large = generateScore({ parts: 8, measures: 100, notesPerMeasure: 8 })

  // 8x the parts: observed ~9x, since the work per part is what grows and
  // the one-part score carries the fixed cost of the score around it. Time
  // per part is flat from 2 parts to 16. A quadratic pass multiplies it by 8.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with notes per measure', () => {
  const sparse = generateScore({ parts: 1, measures: 100, notesPerMeasure: 4 })
  const dense = generateScore({ parts: 1, measures: 100, notesPerMeasure: 16 })

  // 4x the density: observed ~4.2x; a quadratic pass multiplies that by 4,
  // to ~14x, so this bound must stay under it.
  expect(timeRatio(sparse, dense)).toBeLessThan(10)
}, 60_000)

test('a large score converts in bounded time', () => {
  // Four parts, a thousand measures, 40,000 notes: an order of magnitude
  // past the longest corpus songs. Observed around 1.9s plain and 6.5s under
  // coverage instrumentation on a dev machine; CI runners are slower and run
  // the other test files in parallel. The bound leaves room for all of that
  // but not for a complexity regression, which would take minutes at this
  // size.
  const source = generateScore({ parts: 4, measures: 1000, notesPerMeasure: 8 })

  const start = performance.now()
  const { warnings } = convertMusicXML(source)
  const elapsed = performance.now() - start

  expect(warnings).toEqual([])
  expect(elapsed).toBeLessThan(60_000)
}, 120_000)
