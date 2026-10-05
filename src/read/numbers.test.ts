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
import { fraction } from '../fraction.js'
import {
  parseDecimal,
  parseExactDecimal,
  readAttributeInRange,
  readDecimalInRange,
  readInteger,
  readIntegerInRange,
} from './numbers.js'

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

describe('an exact decimal number', () => {
  test.each([
    ['12', fraction(12)],
    ['+3', fraction(3)],
    ['-4', fraction(-4)],
    ['4.0', fraction(4)],
    ['1.25', fraction(5, 4)],
    ['.75', fraction(3, 4)],
    ['3.', fraction(3)],
    ['-.5', fraction(-1, 2)],
    ['0.00', fraction(0)],
    ['-.0', fraction(0)],
    ['007.50', fraction(15, 2)],
    ['2.0000000000000000000', fraction(2)],
  ])('reads "%s"', (written, value) => {
    expect(parseExactDecimal(written)).toEqual(value)
  })

  test.each(['0x10', '1e3', '', '.', '-', '1.2.3', ' 12', '4,0'])(
    'reads nothing from "%s"',
    (written) => {
      expect(parseExactDecimal(written)).toBeUndefined()
    },
  )

  // Past 2^53 a part read back is not the part written.
  test('reads nothing from digits too many to hold exactly', () => {
    expect(parseExactDecimal('99999999999999999999')).toBeUndefined()
    expect(parseExactDecimal('0.1234567890123456')).toBeUndefined()
  })

  test('reads fifteen places, the most a power of ten below 2^53 holds', () => {
    expect(parseExactDecimal('0.000000000000001')).toEqual(fraction(1, 10 ** 15))
  })
})

describe('a decimal number that has to fall in a range', () => {
  const read = (written: string, range: Parameters<typeof readDecimalInRange>[2]) =>
    readDecimalInRange(element(`<duration>${written}</duration>`), PATH, range)

  test.each(['0', '2.5', '5.0'])(
    'accepts %s, inside a range that includes its bounds',
    (written) => {
      expect(read(written, { min: 0, max: 5 })).toEqual(parseExactDecimal(written))
    },
  )

  test('refuses one below a range that includes its bounds', () => {
    expect(() => read('-0.5', { min: 0, max: 5 })).toThrow(
      '<duration> is -0.5, outside the range 0 to 5.',
    )
  })

  test('refuses one above the range', () => {
    expect(() => read('5.01', { min: 0, max: 5 })).toThrow(
      '<duration> is 5.01, outside the range 0 to 5.',
    )
  })

  test('accepts one just above a bound the range leaves out', () => {
    expect(read('0.01', { above: 0, max: 5 })).toEqual(fraction(1, 100))
  })

  test('refuses the bound a range leaves out', () => {
    expect(() => read('0.0', { above: 0, max: 5 })).toThrow(
      '<duration> is 0.0, outside the range above 0 to 5.',
    )
  })

  test('refuses text that is not a number, naming the line', () => {
    expect(() => read('1e3', { min: 0, max: 5 })).toThrow(
      '<duration> is not a number: "1e3". (at score-partwise > part, line 1)',
    )
  })
})
