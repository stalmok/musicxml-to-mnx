// Reading numbers out of the document. Stricter than Number(), which reads
// "0x10" as 16 and "1e3" as 1000: reinterpreting a score's digits is the kind
// of guessing this converter exists to avoid.
//
// Each guard here is two tests wide. A rejection resting on a regex and a
// safe-integer check is stated once for a string only the regex rejects and
// once for a string only the safe-integer check rejects, and a range is
// stated at both of its edges and just outside each. Tested at one end only,
// the other end could move and nothing would notice.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readAttributeInRange, readInteger, readIntegerInRange } from './numbers.js'

const PATH = ['score-partwise', 'part']

function element(source: string) {
  return parseXmlRoot(source)
}

describe('a whole number written as an element', () => {
  test('reads a plain one', () => {
    expect(readInteger(element('<divisions>24</divisions>'), PATH)).toBe(24)
  })

  test('reads a signed one', () => {
    expect(readInteger(element('<offset>-4</offset>'), PATH)).toBe(-4)
  })

  // Number() reads these; the regex is what stops them being salvaged.
  test.each(['0x10', '1e3', '2.5', '', 'four'])('refuses "%s", which is not digits', (written) => {
    expect(() => readInteger(element(`<divisions>${written}</divisions>`), PATH)).toThrow(
      MusicXMLError,
    )
  })

  // Digits all the way, so the regex accepts it. Past 2^53 the value read
  // back is not the value written, which is the safe-integer check's own job.
  test('refuses digits too large to be read back exactly', () => {
    expect(() => readInteger(element('<divisions>99999999999999999999</divisions>'), PATH)).toThrow(
      '<divisions> is not a whole number: "99999999999999999999".',
    )
  })

  test('names the document path and the line it failed on', () => {
    expect(() => readInteger(element('<divisions>x</divisions>'), PATH)).toThrow(
      'score-partwise > part, line 1',
    )
  })
})

describe('a whole number that has to fall in a range', () => {
  const read = (written: string) =>
    readIntegerInRange(element(`<line>${written}</line>`), PATH, 1, 5)

  test.each([1, 3, 5])('accepts %i, inside the range', (value) => {
    expect(read(String(value))).toBe(value)
  })

  test('refuses one below the range', () => {
    expect(() => read('0')).toThrow('<line> is 0, outside the range 1 to 5.')
  })

  test('refuses one above the range', () => {
    expect(() => read('6')).toThrow('<line> is 6, outside the range 1 to 5.')
  })
})

describe('a whole number written as an attribute', () => {
  const read = (written: string) =>
    readAttributeInRange(element(`<clef number="${written}"/>`), 'number', PATH, 1, 4)

  test('states nothing where the attribute is absent', () => {
    expect(readAttributeInRange(element('<clef/>'), 'number', PATH, 1, 4)).toBeUndefined()
  })

  test.each([1, 2, 4])('accepts %i, inside the range', (value) => {
    expect(read(String(value))).toBe(value)
  })

  test('refuses one below the range', () => {
    expect(() => read('0')).toThrow('<clef> has a "number" of 0, outside the range 1 to 4.')
  })

  test('refuses one above the range', () => {
    expect(() => read('5')).toThrow('<clef> has a "number" of 5, outside the range 1 to 4.')
  })

  test('refuses a value that is not digits', () => {
    expect(() => read('0x2')).toThrow(
      '<clef> has a "number" of "0x2", which is not a whole number.',
    )
  })

  test('refuses digits too large to be read back exactly', () => {
    expect(() => read('99999999999999999999')).toThrow('which is not a whole number')
  })
})
