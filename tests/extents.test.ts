// The checks on ids, measure-spanning objects and sequence lengths that every
// conversion output in a test goes through.

import { describe, expect, test } from 'vitest'
import type { MNXDocument, MNXGlobalMeasure, MNXSequenceItem } from '../src/index.js'
import {
  duplicateIds,
  misplacedEndings,
  misplacedMultimeasureRests,
  sequencesPastTime,
} from './support/extents.js'

const quarter = { duration: { base: 'quarter' as const } }

function document(measures: MNXGlobalMeasure[], ...contents: MNXSequenceItem[][]): MNXDocument {
  return {
    mnx: { version: 1 },
    global: { measures },
    parts: [{ measures: contents.map((content) => ({ sequences: [{ content }] })) }],
  }
}

describe('the ids a document holds', () => {
  test('says nothing where each id is held once', () => {
    const mnx = document(
      [{ id: 'm1' }],
      [{ id: 'e1', ...quarter, notes: [{ id: 'n1', pitch: { step: 'C', octave: 4 } }] }],
    )
    expect(duplicateIds(mnx)).toEqual([])
  })

  // MNX holds an id unique within the whole document, whatever object holds it.
  test('reports an id that objects of different kinds hold', () => {
    const mnx = document(
      [{ id: 'x' }],
      [
        { id: 'x', ...quarter },
        { id: 'e2', ...quarter, notes: [{ id: 'x', pitch: { step: 'C', octave: 4 } }] },
      ],
    )
    expect(duplicateIds(mnx)).toEqual(['3 objects hold id "x"'])
  })
})

describe('the endings of a document', () => {
  const ending = (duration: number): MNXGlobalMeasure => ({ ending: { duration } })

  test('says nothing of endings that close inside the score, one after another', () => {
    expect(misplacedEndings(document([ending(1), ending(2), {}]))).toEqual([])
  })

  test('reports an ending that runs past the last measure', () => {
    expect(misplacedEndings(document([{}, ending(2)]))).toEqual([
      'the ending in measure 2 runs to measure 3 of 2',
    ])
  })

  test('reports an ending that starts inside the one before it', () => {
    expect(misplacedEndings(document([ending(2), ending(1), {}]))).toEqual([
      'the ending in measure 2 starts inside the ending in measure 1',
    ])
  })
})

describe('the multi-measure rests of a document', () => {
  const withRests = (count: number, ...rests: [string, number][]): MNXDocument => ({
    ...document(Array.from({ length: count }, (_, index) => ({ id: `m${String(index + 1)}` }))),
    scores: [
      { name: 'Score', multimeasureRests: rests.map(([start, duration]) => ({ start, duration })) },
    ],
  })

  test('says nothing of rests that close inside the score, one after another', () => {
    expect(misplacedMultimeasureRests(withRests(4, ['m3', 2], ['m1', 2]))).toEqual([])
  })

  test('reports a rest that runs past the last measure', () => {
    expect(misplacedMultimeasureRests(withRests(2, ['m2', 2]))).toEqual([
      'score 1 rest in measure 2 runs to measure 3 of 2',
    ])
  })

  test('reports a rest that starts inside the one before it', () => {
    expect(misplacedMultimeasureRests(withRests(4, ['m1', 3], ['m2', 1]))).toEqual([
      'score 1 rest in measure 2 starts inside score 1 rest in measure 1',
    ])
  })

  test('holds the rests of each score apart from those of another', () => {
    const mnx = withRests(4, ['m1', 3])
    const second = { name: 'Part', multimeasureRests: [{ start: 'm2', duration: 1 }] }
    expect(misplacedMultimeasureRests({ ...mnx, scores: [...(mnx.scores ?? []), second] })).toEqual(
      [],
    )
  })

  // danglingReferences reports a start that leads nowhere.
  test('passes over a rest whose start names no measure', () => {
    expect(misplacedMultimeasureRests(withRests(1, ['m9', 5]))).toEqual([])
  })
})

describe('the length of each sequence against the time signature in force', () => {
  const threeFour: MNXGlobalMeasure = { time: { count: 3, unit: 4 } }
  const notes = (count: number): MNXSequenceItem[] => Array.from({ length: count }, () => quarter)

  test('says nothing of a sequence that fills or falls short of its measure', () => {
    expect(sequencesPastTime(document([threeFour, {}], notes(3), notes(2)))).toEqual([])
  })

  test('holds a measure to the time signature stated before it', () => {
    expect(sequencesPastTime(document([threeFour, {}], notes(3), notes(4)))).toEqual([
      'part 1 measure 2 sequence 1 lasts 1 of 0.75',
    ])
  })

  test('holds a measure to a time signature that replaces the one before it', () => {
    const twoFour: MNXGlobalMeasure = { time: { count: 2, unit: 4 } }
    expect(sequencesPastTime(document([threeFour, twoFour], notes(3), notes(3)))).toEqual([
      'part 1 measure 2 sequence 1 lasts 0.75 of 0.5',
    ])
  })

  test('counts a space by its fraction and a tremolo by the time it takes', () => {
    const tremolo: MNXSequenceItem = {
      type: 'tremolo',
      marks: 3,
      outer: { duration: { base: 'quarter' }, multiple: 2 },
      content: [{ duration: { base: 'half' } }, { duration: { base: 'half' } }],
    }
    const space: MNXSequenceItem = { type: 'space', duration: [3, 8] }
    expect(sequencesPastTime(document([threeFour], [space, tremolo]))).toEqual([
      'part 1 measure 1 sequence 1 lasts 0.875 of 0.75',
    ])
  })

  test('counts a tuplet by the time it takes and a grace note as taking none', () => {
    const triplet: MNXSequenceItem = {
      type: 'tuplet',
      inner: { duration: { base: 'eighth' }, multiple: 3 },
      outer: { duration: { base: 'eighth' }, multiple: 2 },
      content: notes(3).map(() => ({ duration: { base: 'eighth' } })),
    }
    const grace: MNXSequenceItem = { type: 'grace', content: [{ duration: { base: 'eighth' } }] }
    expect(sequencesPastTime(document([threeFour], [grace, triplet, quarter, quarter]))).toEqual([])
  })

  test('holds no sequence to a length where no time signature is in force', () => {
    expect(sequencesPastTime(document([{}], notes(9)))).toEqual([])
  })
})
