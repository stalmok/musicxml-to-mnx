// Tests convert and write through these two functions, which check every
// output against the vendored schema and its id references, and hold every
// warning to the source.
// ESLint rejects a direct call to the converter or the writer outside this
// file, except where a test expects it to throw.

import { expect } from 'vitest'
import { readMusicXML } from '../../src/container.js'
import { convertMusicXML } from '../../src/index.js'
import type { ConversionOptions, ConversionResult, MNXDocument } from '../../src/index.js'
import type { Score } from '../../src/model/score.js'
import { writeMnx } from '../../src/write/mnx.js'
import type { WriterOptions } from '../../src/write/mnx.js'
import { parseXmlRoot } from '../../src/xml/parse.js'
import {
  duplicateIds,
  misplacedEndings,
  misplacedMultimeasureRests,
  sequencesPastTime,
} from './extents.js'
import {
  danglingReferences,
  jumpsWithoutOneDestination,
  staffNumbersPastParts,
  unorderedLyricLines,
} from './references.js'
import { schemaErrors } from './schema.js'
import { unsourcedLosses } from './structural.js'

/**
 * Converts the source and fails the test if the output breaks the schema, if
 * a reference in it leads nowhere, if a staff number in it is past its part,
 * if its verse lines and their order part ways, if a jump goes to an object
 * it holds none or several of, if two objects hold one id, if an ending or a
 * multi-measure rest runs past the score or into another, if a sequence runs
 * past its time signature, or if a warning names an element or attribute the
 * source does not hold.
 */
export function convertValid(
  source: string | Uint8Array,
  options?: ConversionOptions,
): ConversionResult {
  const result = convertMusicXML(source, options)
  expect(schemaErrors(result.mnx), 'the output breaks the MNX schema').toEqual([])
  expect(danglingReferences(result.mnx), 'a reference in the output leads nowhere').toEqual([])
  expect(staffNumbersPastParts(result.mnx), 'a staff number is past its part').toEqual([])
  expect(unorderedLyricLines(result.mnx), 'the verse lines and their order part ways').toEqual([])
  expect(
    jumpsWithoutOneDestination(result.mnx),
    'a jump goes to an object the output holds none or several of',
  ).toEqual([])
  expect(duplicateIds(result.mnx), 'two objects in the output hold one id').toEqual([])
  expect(misplacedEndings(result.mnx), 'an ending runs past the score or into another').toEqual([])
  expect(
    misplacedMultimeasureRests(result.mnx),
    'a multi-measure rest runs past the score or into another',
  ).toEqual([])
  expect(sequencesPastTime(result.mnx), 'a sequence runs past its time signature').toEqual([])
  const text = typeof source === 'string' ? source : readMusicXML(source)
  expect(
    unsourcedLosses(parseXmlRoot(text), result.warnings),
    'a warning names what the source does not hold',
  ).toEqual([])
  return result
}

/**
 * Writes the score and fails the test if the output breaks the schema, if a
 * reference in it leads nowhere, if a staff number in it is past its part, if
 * its verse lines and their order part ways, if a jump goes to an object it
 * holds none or several of, if two objects hold one id, if an ending or a
 * multi-measure rest runs past the score or into another, or if a sequence
 * runs past its time signature.
 */
export function writeValid(score: Score, options?: WriterOptions): MNXDocument {
  const mnx = writeMnx(score, options)
  expect(schemaErrors(mnx), 'the output breaks the MNX schema').toEqual([])
  expect(danglingReferences(mnx), 'a reference in the output leads nowhere').toEqual([])
  expect(staffNumbersPastParts(mnx), 'a staff number is past its part').toEqual([])
  expect(unorderedLyricLines(mnx), 'the verse lines and their order part ways').toEqual([])
  expect(
    jumpsWithoutOneDestination(mnx),
    'a jump goes to an object the output holds none or several of',
  ).toEqual([])
  expect(duplicateIds(mnx), 'two objects in the output hold one id').toEqual([])
  expect(misplacedEndings(mnx), 'an ending runs past the score or into another').toEqual([])
  expect(
    misplacedMultimeasureRests(mnx),
    'a multi-measure rest runs past the score or into another',
  ).toEqual([])
  expect(sequencesPastTime(mnx), 'a sequence runs past its time signature').toEqual([])
  return mnx
}
