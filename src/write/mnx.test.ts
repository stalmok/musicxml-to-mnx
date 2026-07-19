// MNX distinguishes an absent key from a present one, so what the writer
// leaves out is as much a decision as what it puts in. These cover both sides
// of each of those choices.

import { describe, expect, test } from 'vitest'
import { schemaErrors } from '../../tests/support/schema.js'
import type { Event, Measure, Score } from '../model/score.js'
import { writeMnx } from './mnx.js'

const WHOLE_C: Event = {
  value: { base: 'whole', dots: 0 },
  notes: [{ pitch: { step: 'C', octave: 4, alter: 0 } }],
  isRest: false,
}

function scoreOf(
  measure: Measure,
  globals: Score['globalMeasures'] = [{ key: undefined, time: undefined, number: undefined }],
): Score {
  return {
    globalMeasures: globals,
    parts: [{ id: 'P1', name: undefined, measures: [measure] }],
  }
}

function measureOf(...events: Event[]): Measure {
  return { clefs: [], sequences: [{ events }] }
}

function firstEvent(score: Score) {
  return writeMnx(score).parts[0]?.measures[0]?.sequences[0]?.content[0]
}

// Asserting on shape alone would happily pass output no MNX reader accepts,
// so every score these tests build is also put to the spec schema.
test.each([
  ['a plain note', scoreOf(measureOf(WHOLE_C))],
  ['a rest', scoreOf(measureOf({ value: { base: 'half', dots: 0 }, notes: [], isRest: true }))],
  [
    'a dotted, altered note',
    scoreOf(
      measureOf({
        value: { base: 'quarter', dots: 2 },
        notes: [{ pitch: { step: 'B', octave: 3, alter: -1 } }],
        isRest: false,
      }),
    ),
  ],
  [
    'clefs and a key',
    scoreOf({ clefs: [{ sign: 'F', staffPosition: 2 }], sequences: [{ events: [WHOLE_C] }] }, [
      { key: { fifths: -3 }, time: { count: 6, unit: 8 }, number: 0 },
    ]),
  ],
])('writes MNX the spec schema accepts for %s', (_name, score) => {
  expect(schemaErrors(writeMnx(score))).toEqual([])
})

describe('the document', () => {
  test('declares the MNX version it emits', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).mnx).toEqual({ version: 1 })
  })
})

describe('global measures', () => {
  test('writes the key and time signature when the score states them', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      { key: { fifths: 2 }, time: { count: 3, unit: 8 }, number: undefined },
    ])

    expect(writeMnx(score).global.measures[0]).toEqual({
      key: { fifths: 2 },
      time: { count: 3, unit: 8 },
    })
  })

  test('leaves them out when the score states neither', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).global.measures[0]).toEqual({})
  })
})

describe('parts', () => {
  test('writes the part name when there is one', () => {
    const score = scoreOf(measureOf(WHOLE_C))
    const named: Score = {
      ...score,
      parts: [{ id: 'P1', name: 'Flute', measures: score.parts[0]?.measures ?? [] }],
    }

    expect(writeMnx(named).parts[0]?.name).toBe('Flute')
  })

  test('leaves the name out when the part is unnamed', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).parts[0]).not.toHaveProperty('name')
  })
})

describe('measures', () => {
  test('writes clefs when the measure has them', () => {
    const score = scoreOf({
      clefs: [{ sign: 'F', staffPosition: 2 }],
      sequences: [{ events: [WHOLE_C] }],
    })

    expect(writeMnx(score).parts[0]?.measures[0]?.clefs).toEqual([
      { clef: { sign: 'F', staffPosition: 2 } },
    ])
  })

  test('leaves clefs out when the measure has none', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).parts[0]?.measures[0]).not.toHaveProperty('clefs')
  })
})

describe('events', () => {
  test('writes a rest as an empty rest object with no notes', () => {
    const rest: Event = { value: { base: 'half', dots: 0 }, notes: [], isRest: true }

    expect(firstEvent(scoreOf(measureOf(rest)))).toEqual({
      duration: { base: 'half' },
      rest: {},
    })
  })

  test('writes augmentation dots when there are any', () => {
    const dotted: Event = { ...WHOLE_C, value: { base: 'quarter', dots: 1 } }

    expect(firstEvent(scoreOf(measureOf(dotted)))?.duration).toEqual({
      base: 'quarter',
      dots: 1,
    })
  })

  test('leaves dots out when the note has none', () => {
    expect(firstEvent(scoreOf(measureOf(WHOLE_C)))?.duration).not.toHaveProperty('dots')
  })

  test('writes an alteration when the pitch is altered', () => {
    const flat: Event = {
      ...WHOLE_C,
      notes: [{ pitch: { step: 'B', octave: 3, alter: -1 } }],
    }

    expect(firstEvent(scoreOf(measureOf(flat)))?.notes?.[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
  })

  test('leaves the alteration out when the pitch is unaltered', () => {
    expect(firstEvent(scoreOf(measureOf(WHOLE_C)))?.notes?.[0]?.pitch).not.toHaveProperty('alter')
  })
})
