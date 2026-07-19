import { describe, expect, test } from 'vitest'
import { WarningCollector } from './warnings.js'

describe('WarningCollector', () => {
  test('starts with nothing reported', () => {
    expect(new WarningCollector().list()).toEqual([])
  })

  test('records a warning with its code, message, and context', () => {
    const warnings = new WarningCollector()

    warnings.add('unsupported:element', 'The <pedal> element is not converted.', {
      part: 'P1',
      measure: 4,
      line: 88,
    })

    expect(warnings.list()).toEqual([
      {
        code: 'unsupported:element',
        message: 'The <pedal> element is not converted.',
        context: { part: 'P1', measure: 4, line: 88 },
      },
    ])
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
