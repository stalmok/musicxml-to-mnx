// Reader tests read through this function, which holds every warning to the
// source. ESLint rejects a direct call to readScore in a test, except where
// the test expects it to throw.

import { expect } from 'vitest'
import type { Score } from '../../src/model/score.js'
import { readScore } from '../../src/read/score.js'
import { WarningCollector } from '../../src/read/collector.js'
import { parseXmlRoot } from '../../src/xml/parse.js'
import { unsourcedLosses } from './structural.js'

/** Reads the source and fails the test if a warning names what it does not hold. */
export function readValid(source: string, warnings = new WarningCollector()): Score {
  const score = readScore(parseXmlRoot(source), warnings)
  expect(
    unsourcedLosses(parseXmlRoot(source), warnings.list()),
    'a warning names what the source does not hold',
  ).toEqual([])
  return score
}
