// Reading numbers out of the document. Stricter than Number(), which reads
// "0x10" as 16 and "1e3" as 1000.
//
// Each guard has two tests. A rejection that rests on a regex and a
// safe-integer check has one string only the regex rejects and one only the
// safe-integer check rejects. A range is tested at both edges and just
// outside each.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from '../xml/parse.js'
import { parseDecimal, readAttributeInRange, readInteger, readIntegerInRange } from './numbers.js'

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

  // Number() reads these. The regex rejects them.
  test.each(['0x10', '1e3', '2.5', '', 'four'])('refuses "%s", which is not digits', (written) => {
    expect(() => readInteger(element(`<divisions>${written}</divisions>`), PATH)).toThrow(
      MusicXMLError,
    )
  })

  // The regex accepts these digits. Past 2^53 the value read back is not the
  // value written, so the safe-integer check rejects it.
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

describe('a decimal number', () => {
  test.each([
    ['120', 120],
    ['-4', -4],
    ['1.25', 1.25],
    ['.25', 0.25],
    ['3.', 3],
  ])('reads "%s"', (written, value) => {
    expect(parseDecimal(written)).toBe(value)
  })

  test.each(['0x10', '1e3', '', '.', '1.2.3', ' 12'])('reads nothing from "%s"', (written) => {
    expect(parseDecimal(written)).toBeUndefined()
  })
})
