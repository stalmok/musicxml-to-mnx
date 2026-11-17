import { expect, test, vi } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from './parse.js'

// An error from the engine, not the parser, has no line. Node cannot be made to
// throw one here, so the mocked parser throws it.
vi.mock('@rgrove/parse-xml', async (original) => ({
  ...(await original<typeof import('@rgrove/parse-xml')>()),
  parseXml: () => {
    throw new RangeError('Invalid string length')
  },
}))

test('keeps the message of an engine error, with no line', () => {
  expect(() => parseXmlRoot('<a/>')).toThrow(MusicXMLError)
  expect(() => parseXmlRoot('<a/>')).toThrow(
    expect.objectContaining({ message: 'Invalid string length', line: undefined }),
  )
})
