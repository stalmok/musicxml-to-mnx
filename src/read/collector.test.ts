import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readAttributeNames } from '../xml/tree.js'

describe('WarningCollector', () => {
  test('starts with nothing reported', () => {
    expect(new WarningCollector().list()).toEqual([])
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

// A warning the reader can only decide after every part is read goes in the
// report at the place of its element, so the report stays in document order.
describe('a place kept for a decision made later', () => {
  test('reports through a place where it was taken, not where it was added', () => {
    const warnings = new WarningCollector()

    warnings.add('unsupported:element', 'first', {})
    const place = warnings.reserve()
    warnings.add('unsupported:element', 'third', {})
    warnings.addAt(place, 'unsupported:element', 'second', {})

    expect(warnings.list().map((w) => w.message)).toEqual(['first', 'second', 'third'])
  })

  test('keeps two reported through one place in the order they were added', () => {
    const warnings = new WarningCollector()

    const place = warnings.reserve()
    warnings.add('unsupported:element', 'last', {})
    warnings.addAt(place, 'unsupported:element', 'first', {})
    warnings.addAt(place, 'unsupported:element', 'second', {})

    expect(warnings.list().map((w) => w.message)).toEqual(['first', 'second', 'last'])
  })

  test('leaves a place nothing was reported through out of the report', () => {
    const warnings = new WarningCollector()

    warnings.reserve()
    warnings.add('unsupported:element', 'only', {})

    expect(warnings.list().map((w) => w.message)).toEqual(['only'])
  })

  test('records the same fields a warning reported in place carries', () => {
    const warnings = new WarningCollector()

    const sound = parseXmlRoot('<sound tempo="60"/>')

    const place = warnings.reserve()
    warnings.addAt(
      place,
      'unsupported:attribute',
      'The "tempo" of a <sound> is not converted yet.',
      { part: 'P1', measure: 2 },
      sound,
      'tempo',
    )

    expect(warnings.list()).toEqual([
      {
        code: 'unsupported:attribute',
        message: 'The "tempo" of a <sound> is not converted yet.',
        element: 'sound',
        attribute: 'tempo',
        context: { part: 'P1', measure: 2, line: 1 },
      },
    ])
  })
})

describe('a warning about an element', () => {
  test('takes its element and its line from the element', () => {
    const warnings = new WarningCollector()
    const pedal = parseXmlRoot('<direction>\n  <pedal/>\n</direction>').children[0]!

    warnings.add('unsupported:element', 'not converted', { part: 'P1', measure: 4 }, pedal)

    expect(warnings.list()).toEqual([
      {
        code: 'unsupported:element',
        message: 'not converted',
        element: 'pedal',
        context: { part: 'P1', measure: 4, line: 2 },
      },
    ])
  })

  test('counts the attribute it names as read, and no other', () => {
    const warnings = new WarningCollector()
    const sound = parseXmlRoot('<sound tempo="60" dynamics="80"/>')

    warnings.add('unsupported:attribute', 'not converted', {}, sound, 'tempo')

    expect(warnings.list()[0]?.attribute).toBe('tempo')
    expect([...(readAttributeNames(sound) ?? [])]).toEqual(['tempo'])
  })

  test('counts every attribute as read where the element is not converted at all', () => {
    const warnings = new WarningCollector()
    const fermata = parseXmlRoot('<fermata type="inverted" placement="below"/>')

    warnings.addWhole('unrepresentable:fermata', 'not converted', {}, fermata)

    expect(warnings.list()[0]?.element).toBe('fermata')
    expect([...(readAttributeNames(fermata) ?? [])]).toEqual(['type', 'placement'])
  })

  test('reports through a place taken earlier', () => {
    const warnings = new WarningCollector()
    const tuplet = parseXmlRoot('<tuplet/>')

    const place = warnings.reserve()
    warnings.add('unsupported:element', 'second', {}, tuplet)
    warnings.addAt(place, 'unsupported:element', 'first', {}, tuplet)

    expect(warnings.list().map((w) => w.message)).toEqual(['first', 'second'])
  })
})

describe('a warning about an element the source leaves out', () => {
  test('names the element left out, at the line where it is needed', () => {
    const warnings = new WarningCollector()
    const note = parseXmlRoot('<measure>\n  <note/>\n</measure>').children[0]!

    warnings.addMissing('missing:divisions', 'assumed', { measure: 1 }, note, 'divisions')

    expect(warnings.list()).toEqual([
      {
        code: 'missing:divisions',
        message: 'assumed',
        element: 'divisions',
        context: { measure: 1, line: 2 },
      },
    ])
  })
})

describe('a warning about what a measure states as a whole', () => {
  test('names the kind of element and gives no line', () => {
    const warnings = new WarningCollector()

    warnings.addForMeasure(
      'unrepresentable:cross-part-barline',
      'differ',
      { measure: 3 },
      'barline',
    )

    expect(warnings.list()).toEqual([
      {
        code: 'unrepresentable:cross-part-barline',
        message: 'differ',
        element: 'barline',
        context: { measure: 3 },
      },
    ])
  })
})
