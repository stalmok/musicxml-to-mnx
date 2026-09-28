// Tests convert and write through these two functions, which check every
// output against the vendored schema. ESLint rejects a direct call to the
// converter or the writer outside this file, except where a test expects it to
// throw.

import { expect } from 'vitest'
import { convertMusicXML } from '../../src/index.js'
import type { ConversionOptions, ConversionResult, MNXDocument } from '../../src/index.js'
import type { Score } from '../../src/model/score.js'
import { writeMnx } from '../../src/write/mnx.js'
import type { WriterOptions } from '../../src/write/mnx.js'
import { schemaErrors } from './schema.js'

/** Converts the source and fails the test if the output breaks the schema. */
export function convertValid(
  source: string | Uint8Array,
  options?: ConversionOptions,
): ConversionResult {
  const result = convertMusicXML(source, options)
  expect(schemaErrors(result.mnx), 'the output breaks the MNX schema').toEqual([])
  return result
}

/** Writes the score and fails the test if the output breaks the schema. */
export function writeValid(score: Score, options?: WriterOptions): MNXDocument {
  const mnx = writeMnx(score, options)
  expect(schemaErrors(mnx), 'the output breaks the MNX schema').toEqual([])
  return mnx
}
