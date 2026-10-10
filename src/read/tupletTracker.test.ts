import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import { TupletTracker } from './tupletTracker.js'
import { fraction } from '../fraction.js'
import type { SequenceItem } from '../model/score.js'
import { parseXmlRoot } from '../xml/parse.js'

const EIGHTH = { base: 'eighth', dots: 0 } as const
const space = (num: number): SequenceItem => ({ kind: 'space', duration: fraction(num, 8) })

describe('removing the item written last', () => {
  test('removes it from inside the innermost open bracket', () => {
    const content: SequenceItem[] = []
    const tracker = new TupletTracker(content)
    const first = space(1)
    tracker.append(first)
    tracker.openTremolo(1, [], 1)
    const second = space(2)
    tracker.append(second)

    tracker.removeLast(second)

    expect(tracker.last()).toBeUndefined()
    expect(content).toEqual([first])
  })

  test('refuses an item written before the last one', () => {
    const tracker = new TupletTracker([])
    const first = space(1)
    tracker.append(first)
    tracker.append(space(2))

    expect(() => tracker.removeLast(first)).toThrow('not the last one written')
  })

  test('refuses where nothing is written', () => {
    expect(() => new TupletTracker([]).removeLast(space(1))).toThrow('not the last one written')
  })
})

test('a run the ratio alone opened and nothing went into is removed when it closes', () => {
  const content: SequenceItem[] = []
  const tracker = new TupletTracker(content)
  const before = space(1)
  tracker.append(before)
  tracker.openImplied(
    { value: EIGHTH, multiple: 3 },
    { value: EIGHTH, multiple: 2 },
    parseXmlRoot('<time-modification/>'),
    fraction(1, 8),
  )

  tracker.closeImplied(fraction(1, 8), new WarningCollector(), {}, [], 1)

  expect(content).toEqual([before])
})
