import { describe, expect, test } from 'vitest'
import { isConverterGap, isFormatLimit, WarningCollector } from './warnings.js'

// The two prefixes are the report's whole point: a gap here may close in a
// later release, a limit of MNX will not, and a pipeline choosing what to
// reconvert has to be able to tell them apart.
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

// The mirror of isFormatLimit: a gap a later release may close, told apart
// from a limit of MNX no release will, and from the source's own problems.
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

describe('WarningCollector', () => {
  test('starts with nothing reported', () => {
    expect(new WarningCollector().list()).toEqual([])
  })

  test('records a warning with its code, message, and context', () => {
    const warnings = new WarningCollector()

    warnings.add(
      'unsupported:element',
      'The <pedal> element is not converted.',
      { part: 'P1', measure: 4, line: 88 },
      'pedal',
    )

    expect(warnings.list()).toEqual([
      {
        code: 'unsupported:element',
        message: 'The <pedal> element is not converted.',
        element: 'pedal',
        context: { part: 'P1', measure: 4, line: 88 },
      },
    ])
  })

  test('leaves the element unset where the loss is not about one', () => {
    const warnings = new WarningCollector()
    warnings.add('inconsistent:duration', 'a note disagrees with itself', {})

    expect(warnings.list()[0]?.element).toBeUndefined()
  })

  test('keeps warnings in the order they were reported', () => {
    const warnings = new WarningCollector()

    warnings.add('unsupported:element', 'first', {})
    warnings.add('unsupported:element', 'second', {})

    expect(warnings.list().map((w) => w.message)).toEqual(['first', 'second'])
  })

  test('hands out a copy, so a caller cannot corrupt the report', () => {
    const warnings = new WarningCollector()
    warnings.add('unsupported:element', 'reported', {})

    const list = warnings.list() as ReturnType<WarningCollector['list']>[number][]
    list.length = 0

    expect(warnings.list()).toHaveLength(1)
  })
})
