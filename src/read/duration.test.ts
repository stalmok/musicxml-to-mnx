import { describe, expect, test } from 'vitest'
import { fraction } from '../fraction.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'

describe('lengthOf', () => {
  test('measures an undotted value', () => {
    expect(lengthOf({ base: 'quarter', dots: 0 })).toEqual(fraction(1, 4))
  })

  test('adds half again for a dot', () => {
    expect(lengthOf({ base: 'half', dots: 1 })).toEqual(fraction(3, 4))
  })

  test('round-trips every value it can name', () => {
    for (const dots of [0, 1, 2, 3]) {
      const value = { base: '16th', dots } as const
      expect(noteValueOf(lengthOf(value))).toEqual(value)
    }
  })
})

describe('describing a length in words', () => {
  test('names a plain value', () => {
    expect(describeValue({ base: 'quarter', dots: 0 })).toBe('a quarter')
  })

  test('counts the dots', () => {
    expect(describeValue({ base: 'half', dots: 1 })).toBe('a dotted half')
    expect(describeValue({ base: 'half', dots: 2 })).toBe('a double-dotted half')
    expect(describeValue({ base: 'half', dots: 3 })).toBe('a triple-dotted half')
  })

  test('says "an" before a value that needs it', () => {
    expect(describeValue({ base: 'eighth', dots: 0 })).toBe('an eighth')
  })

  test('counts dots past the point where they have a name', () => {
    expect(describeValue({ base: 'quarter', dots: 4 })).toBe('a quarter with 4 dots')
  })

  test('names a duration by the note value that fits it', () => {
    expect(describeLength(fraction(3, 8))).toBe('a dotted quarter')
  })

  test('falls back to the bare fraction when no value fits', () => {
    expect(describeLength(fraction(1, 12))).toBe('1/12 of a whole note')
  })
})

describe('noteValueOf', () => {
  test.each([
    [fraction(1), 'whole'],
    [fraction(1, 2), 'half'],
    [fraction(1, 4), 'quarter'],
    [fraction(1, 8), 'eighth'],
    [fraction(1, 16), '16th'],
    [fraction(1, 1024), '1024th'],
    [fraction(2), 'breve'],
    [fraction(4), 'longa'],
    [fraction(8), 'maxima'],
  ])('reads %o as an undotted %s', (value, base) => {
    expect(noteValueOf(value)).toEqual({ base, dots: 0 })
  })

  test('reads three quarters as a dotted half', () => {
    expect(noteValueOf(fraction(3, 4))).toEqual({ base: 'half', dots: 1 })
  })

  test('reads seven eighths as a double-dotted half', () => {
    expect(noteValueOf(fraction(7, 8))).toEqual({ base: 'half', dots: 2 })
  })

  test('reads fifteen sixteenths as a triple-dotted half', () => {
    expect(noteValueOf(fraction(15, 16))).toEqual({ base: 'half', dots: 3 })
  })

  test('reads three eighths as a dotted quarter', () => {
    expect(noteValueOf(fraction(3, 8))).toEqual({ base: 'quarter', dots: 1 })
  })

  // A triplet eighth is 1/12 of a whole note, which no combination of a note
  // value and dots can write. It needs a tuplet, so it is not this function's
  // to guess at.
  test('does not invent a value for a duration no note value can write', () => {
    expect(noteValueOf(fraction(1, 12))).toBeUndefined()
  })

  test('does not invent a value for a duration of zero', () => {
    expect(noteValueOf(fraction(0))).toBeUndefined()
  })

  test('does not invent a value for a negative duration', () => {
    expect(noteValueOf(fraction(-1, 4))).toBeUndefined()
  })
})
