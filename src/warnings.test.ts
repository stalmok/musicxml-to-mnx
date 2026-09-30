import { describe, expect, test } from 'vitest'
import {
  categoryOf,
  isConverterGap,
  isFormatLimit,
  isSourceProblem,
  WARNING_CODES,
} from './warnings.js'

// A converter gap may close in a later release. A format limit will not.
describe('isFormatLimit', () => {
  test('is true for a loss MNX has nowhere to put', () => {
    expect(isFormatLimit('unrepresentable:element')).toBe(true)
    expect(isFormatLimit('unrepresentable:per-staff-key')).toBe(true)
  })

  test('is false for a gap in this converter', () => {
    expect(isFormatLimit('unsupported:element')).toBe(false)
  })

  test('is false for the source disagreeing with itself', () => {
    expect(isFormatLimit('unclosed:spanner')).toBe(false)
    expect(isFormatLimit('inconsistent:duration')).toBe(false)
  })
})

describe('isConverterGap', () => {
  test('is true for a gap this converter may later close', () => {
    expect(isConverterGap('unsupported:element')).toBe(true)
  })

  test('is false for a limit of MNX', () => {
    expect(isConverterGap('unrepresentable:element')).toBe(false)
  })

  test('is false for the source disagreeing with itself', () => {
    expect(isConverterGap('unclosed:spanner')).toBe(false)
    expect(isConverterGap('missing:divisions')).toBe(false)
  })
})

// The third kind has its own prefixes, so categoryOf does not compile if a new
// prefix belongs to none of the three.
describe('isSourceProblem', () => {
  test('is true for the source disagreeing with itself', () => {
    expect(isSourceProblem('inconsistent:duration')).toBe(true)
    expect(isSourceProblem('unclosed:spanner')).toBe(true)
    expect(isSourceProblem('missing:divisions')).toBe(true)
    expect(isSourceProblem('unresolved:part-id')).toBe(true)
    expect(isSourceProblem('redundant:rest')).toBe(true)
  })

  test('is false for a limit of MNX and for a gap in this converter', () => {
    expect(isSourceProblem('unrepresentable:element')).toBe(false)
    expect(isSourceProblem('unsupported:element')).toBe(false)
  })

  test('is false for a code whose prefix only starts with one of the five', () => {
    expect(isSourceProblem('unresolvedxx:whatever' as 'unresolved:part-id')).toBe(false)
  })
})

describe('categoryOf', () => {
  test('names the kind each prefix belongs to', () => {
    expect(categoryOf('unrepresentable:fermata')).toBe('format-limit')
    expect(categoryOf('unsupported:attribute')).toBe('converter-gap')
    expect(categoryOf('inconsistent:tempo')).toBe('source-problem')
  })
})

describe('WARNING_CODES', () => {
  test('lists each code once', () => {
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length)
    expect(WARNING_CODES).toContain('unsupported:element')
  })

  test('cannot be changed by a consumer', () => {
    expect(Object.isFrozen(WARNING_CODES)).toBe(true)
  })

  test('holds codes of all three kinds', () => {
    expect(new Set(WARNING_CODES.map(categoryOf))).toEqual(
      new Set(['format-limit', 'converter-gap', 'source-problem']),
    )
  })
})
