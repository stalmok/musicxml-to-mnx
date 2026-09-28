// Conversion time must scale linearly with the size of the score.
//
// Each test converts a generated score at two sizes along one axis and
// bounds the time ratio. Each bound is a few times above the observed linear
// ratio and below the quadratic one. For numbers, run `pnpm bench`.

/* eslint-disable no-restricted-syntax -- the schema check would be timed with the conversion; tests/generate.test.ts checks the generated output */

import { performance } from 'node:perf_hooks'
import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import { generateScore } from './support/generate.js'

/**
 * Returns the large-to-small ratio of the best runs. The runs alternate
 * between the two sources, so load from other workers slows both sides.
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

  // 8x the measures: observed 8x to 10x. A quadratic pass multiplies that
  // by 8.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with part count', () => {
  const small = generateScore({ parts: 1, measures: 100, notesPerMeasure: 8 })
  const large = generateScore({ parts: 8, measures: 100, notesPerMeasure: 8 })

  // 8x the parts: observed 6x to 10x. Time per part is flat from 2 parts to
  // 16. A quadratic pass multiplies the ratio by 8.
  expect(timeRatio(small, large)).toBeLessThan(24)
}, 60_000)

test('time scales linearly with notes per measure', () => {
  const sparse = generateScore({ parts: 1, measures: 100, notesPerMeasure: 4 })
  const dense = generateScore({ parts: 1, measures: 100, notesPerMeasure: 16 })

  // 4x the density: observed 3.5x to 4.2x. A quadratic pass multiplies that
  // by 4, to about 14x.
  expect(timeRatio(sparse, dense)).toBeLessThan(10)
}, 60_000)

test('a large score converts in bounded time', () => {
  // Four parts, a thousand measures, 40,000 notes: about ten times the longest
  // corpus songs. Observed about 2s plain and 6.5s under coverage on a dev
  // machine. CI runners are slower and run other test files in parallel. A
  // complexity regression would take minutes at this size.
  const source = generateScore({ parts: 4, measures: 1000, notesPerMeasure: 8 })

  const start = performance.now()
  const { warnings } = convertMusicXML(source)
  const elapsed = performance.now() - start

  expect(warnings).toEqual([])
  expect(elapsed).toBeLessThan(60_000)
}, 120_000)
