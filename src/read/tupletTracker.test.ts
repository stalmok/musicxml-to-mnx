import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import { TupletTracker } from './tupletTracker.js'
import { fraction } from '../fraction.js'
import type { SequenceItem } from '../model/score.js'
import { parseXmlRoot } from '../xml/parse.js'

const EIGHTH = { base: 'eighth', dots: 0 } as const
const space = (num: number): SequenceItem => ({ kind: 'space', duration: fraction(num, 8) })

const openImplied = (tracker: TupletTracker) => {
  tracker.openImplied(
    { value: EIGHTH, multiple: 3 },
    { value: EIGHTH, multiple: 2 },
    parseXmlRoot('<time-modification/>'),
    fraction(0),
  )
}

describe('moving the item written last to another sequence', () => {
  test('moves it to the end of the other sequence', () => {
    const tracker = new TupletTracker()
    const first = space(1)
    const second = space(2)
    tracker.append(first)
    tracker.append(second)
    const other = new TupletTracker()
    other.append(space(3))

    tracker.moveLastTo(second, other, fraction(3, 8), [], 1)

    expect(tracker.content()).toEqual([first])
    expect(other.content()).toEqual([space(3), second])
  })

  test('moves a tremolo that holds nothing else with it', () => {
    const tracker = new TupletTracker()
    const first = space(1)
    tracker.append(first)
    tracker.openTremolo(1, parseXmlRoot('<tremolo/>'))
    const second = space(2)
    tracker.append(second)
    const other = new TupletTracker()

    expect(tracker.bracketOpensOnLast()).toBe(false)
    tracker.moveLastTo(second, other, fraction(0), [], 1)

    expect(tracker.insideTremolo()).toBe(false)
    expect(tracker.last()).toBe(first)
    expect(other.insideTremolo()).toBe(true)
    expect(other.last()).toBe(second)
  })

  test('moves the tuplets that hold nothing else with it, nested as they were', () => {
    const tracker = new TupletTracker()
    openImplied(tracker)
    const tremolo = parseXmlRoot('<tremolo/>')
    tracker.openTremolo(1, tremolo)
    const item = space(1)
    tracker.append(item)
    const other = new TupletTracker()

    tracker.moveLastTo(item, other, fraction(0), [], 1)

    expect(tracker.insideBracket()).toBe(false)
    expect(other.insideImplied()).toBe(false)
    expect(other.tremoloOpenedBy(tremolo)).toBe(true)
    expect(other.closeTremolo().list).toEqual([item])
    expect(other.insideImplied()).toBe(true)
    expect(other.content().map((moved) => moved.kind)).toEqual(['tuplet'])
  })

  test('moves a tuplet that holds nothing else with it, which a bracket opened there', () => {
    const tracker = new TupletTracker()
    openImplied(tracker)
    const item = space(1)
    tracker.append(item)
    const other = new TupletTracker()

    expect(tracker.bracketOpensOnLast()).toBe(true)
    tracker.moveLastTo(item, other, fraction(0), [], 1)

    expect(tracker.insideBracket()).toBe(false)
    expect(other.content().map((moved) => moved.kind)).toEqual(['tuplet'])
  })

  test('leaves a tuplet that holds something else where it is', () => {
    const tracker = new TupletTracker()
    openImplied(tracker)
    const first = space(1)
    const second = space(2)
    tracker.append(first)
    tracker.append(second)
    const other = new TupletTracker()

    expect(tracker.bracketOpensOnLast()).toBe(false)
    tracker.moveLastTo(second, other, fraction(0), [], 1)

    expect(tracker.insideImplied()).toBe(true)
    expect(tracker.last()).toBe(first)
    expect(other.insideBracket()).toBe(false)
    expect(other.content()).toEqual([second])
  })

  test('refuses to move brackets that would nest more than 256 deep', () => {
    const one = { value: EIGHTH, multiple: 1 }
    const opens = (tracker: TupletTracker, count: number) => {
      const starts = Array.from({ length: count }, (_, index) => ({
        display: {},
        stated: { inner: one, outer: one },
        number: String(index + 1),
        element: parseXmlRoot('<tuplet/>'),
      }))
      tracker.openTuplets(one, one, starts, false, fraction(0), new WarningCollector(), [], 1)
    }
    const fits = new TupletTracker()
    opens(fits, 1)
    const fitting = space(1)
    fits.append(fitting)
    const full = new TupletTracker()
    opens(full, 255)

    fits.moveLastTo(fitting, full, fraction(0), [], 1)

    const tracker = new TupletTracker()
    opens(tracker, 1)
    const item = space(1)
    tracker.append(item)

    expect(() => tracker.moveLastTo(item, full, fraction(0), ['part'], 7)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Tuplets nest more than 256 deep'),
        line: 7,
      }),
    )
  })

  test('refuses an item written before the last one', () => {
    const tracker = new TupletTracker()
    const first = space(1)
    tracker.append(first)
    tracker.append(space(2))

    expect(() => tracker.moveLastTo(first, new TupletTracker(), fraction(0), [], 1)).toThrow(
      'not the last one written',
    )
  })

  test('refuses where nothing is written', () => {
    expect(() =>
      new TupletTracker().moveLastTo(space(1), new TupletTracker(), fraction(0), [], 1),
    ).toThrow('not the last one written')
  })
})

test('a run the ratio alone opened and nothing went into is removed when it closes', () => {
  const tracker = new TupletTracker()
  const before = space(1)
  tracker.append(before)
  tracker.openImplied(
    { value: EIGHTH, multiple: 3 },
    { value: EIGHTH, multiple: 2 },
    parseXmlRoot('<time-modification/>'),
    fraction(1, 8),
  )

  const warnings = new WarningCollector()
  tracker.closeImplied(fraction(1, 8), warnings, {}, [], 1)

  expect(tracker.content()).toEqual([before])
  expect(warnings.list()).toEqual([])
})
