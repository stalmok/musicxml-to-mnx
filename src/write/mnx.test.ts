// MNX distinguishes an absent key from a present one, so what the writer
// leaves out is as much a decision as what it puts in. These cover both sides
// of each of those choices.

import { describe, expect, test } from 'vitest'
import { schemaErrors } from '../../tests/support/schema.js'
import type {
  Ending,
  Event,
  FullMeasureRest,
  Measure,
  Score,
  SequenceItem,
} from '../model/score.js'
import type { MNXEvent } from '../types/mnx.js'
import { writeMnx } from './mnx.js'

const WHOLE_C: Event = {
  kind: 'event',
  id: 'ev1',
  staff: undefined,
  value: { base: 'whole', dots: 0 },
  slurs: [],
  lyrics: [],
  stemDirection: undefined,
  markings: [],
  fermata: undefined,
  notes: [
    {
      id: 'note1',
      pitch: { step: 'C', octave: 4, alter: 0 },
      ties: [],
      accidentalDisplay: undefined,
    },
  ],
  isRest: false,
}

// Everything a global measure can state beyond a key, a time and a tempo.
// Spread into the literals below so that adding a field to the model does not
// mean editing every one of them.
const NO_BARLINE = {
  barline: undefined,
  repeatStart: false,
  repeatEnd: undefined,
  ending: undefined,
  fermata: undefined,
} as const

function scoreOf(
  measure: Measure,
  globals: Score['globalMeasures'] = [
    { key: undefined, time: undefined, tempos: [], number: undefined, ...NO_BARLINE },
  ],
): Score {
  return {
    globalMeasures: globals,
    parts: [{ id: 'P1', name: undefined, staves: 1, measures: [measure] }],
  }
}

function measureOf(...events: Event[]): Measure {
  return {
    clefs: [],
    beams: [],
    dynamics: [],
    sequences: [{ voice: undefined, staff: undefined, content: events, fullMeasure: undefined }],
  }
}

function firstEvent(score: Score) {
  const item = writeMnx(score).parts[0]?.measures[0]?.sequences[0]?.content[0]
  return item && 'duration' in item && !('type' in item) ? item : undefined
}

// Asserting on shape alone would happily pass output no MNX reader accepts,
// so every score these tests build is also put to the spec schema.
test.each([
  ['a plain note', scoreOf(measureOf(WHOLE_C))],
  [
    'a rest',
    scoreOf(
      measureOf({
        kind: 'event' as const,
        id: 'ev2',
        staff: undefined,
        value: { base: 'half', dots: 0 },
        slurs: [],
        lyrics: [],
        stemDirection: undefined,
        markings: [],
        fermata: undefined,
        notes: [],
        isRest: true,
      }),
    ),
  ],
  [
    'a dotted, altered note',
    scoreOf(
      measureOf({
        kind: 'event',
        id: 'ev3',
        staff: undefined,
        value: { base: 'quarter', dots: 2 },
        slurs: [],
        lyrics: [],
        stemDirection: undefined,
        markings: [],
        fermata: undefined,
        notes: [
          {
            id: 'note2',
            pitch: { step: 'B', octave: 3, alter: -1 },
            ties: [],
            accidentalDisplay: undefined,
          },
        ],
        isRest: false,
      }),
    ),
  ],
  [
    'clefs and a key',
    scoreOf(
      {
        clefs: [{ sign: 'F', staffPosition: 2, staff: undefined }],
        beams: [],
        dynamics: [],
        sequences: [
          { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
        ],
      },
      [{ key: { fifths: -3 }, time: { count: 6, unit: 8 }, tempos: [], number: 0, ...NO_BARLINE }],
    ),
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
      {
        key: { fifths: 2 },
        time: { count: 3, unit: 8 },
        tempos: [],
        number: undefined,
        ...NO_BARLINE,
      },
    ])

    expect(writeMnx(score).global.measures[0]).toEqual({
      key: { fifths: 2 },
      time: { count: 3, unit: 8 },
    })
  })

  test('leaves them out when the score states neither', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).global.measures[0]).toEqual({})
  })

  test('writes a tempo at the start of the measure without a location', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [{ position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 100 }],
        ...NO_BARLINE,
        number: undefined,
      },
    ])

    expect(writeMnx(score).global.measures[0]?.tempos).toEqual([
      { value: { base: 'quarter' }, bpm: 100 },
    ])
  })

  test('gives a tempo partway through the measure a location', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [{ position: { num: 1, den: 2 }, value: { base: 'half', dots: 0 }, bpm: 60 }],
        ...NO_BARLINE,
        number: undefined,
      },
    ])

    expect(writeMnx(score).global.measures[0]?.tempos?.[0]?.location).toEqual({ fraction: [1, 2] })
  })

  test('writes a dynamic that MNX schema accepts', () => {
    const measure = {
      ...measureOf(WHOLE_C),
      dynamics: [
        {
          position: { num: 0, den: 1 },
          value: 'f' as const,
          wedge: undefined,
          end: undefined,
          staff: undefined,
        },
      ],
    }

    expect(schemaErrors(writeMnx(scoreOf(measure)))).toEqual([])
  })
})

describe('parts', () => {
  test('writes the part name when there is one', () => {
    const score = scoreOf(measureOf(WHOLE_C))
    const named: Score = {
      ...score,
      parts: [{ id: 'P1', name: 'Flute', staves: 1, measures: score.parts[0]?.measures ?? [] }],
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
      clefs: [{ sign: 'F', staffPosition: 2, staff: undefined }],
      beams: [],
      dynamics: [],
      sequences: [
        { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
      ],
    })

    expect(writeMnx(score).parts[0]?.measures[0]?.clefs).toEqual([
      { clef: { sign: 'F', staffPosition: 2 } },
    ])
  })

  test('leaves clefs out when the measure has none', () => {
    expect(writeMnx(scoreOf(measureOf(WHOLE_C))).parts[0]?.measures[0]).not.toHaveProperty('clefs')
  })
})

describe('ties and slurs', () => {
  // An id exists so that a tie or slur can point at something. Anything
  // nothing points at should not be named.
  const target: Event = {
    kind: 'event',
    id: 'ev-target',
    staff: undefined,
    value: { base: 'whole', dots: 0 },
    slurs: [],
    lyrics: [],
    stemDirection: undefined,
    markings: [],
    fermata: undefined,
    notes: [
      {
        id: 'note-target',
        pitch: { step: 'G', octave: 4, alter: 0 },
        ties: [],
        accidentalDisplay: undefined,
      },
    ],
    isRest: false,
  }
  const start: Event = {
    kind: 'event',
    id: 'ev-start',
    staff: undefined,
    value: { base: 'whole', dots: 0 },
    slurs: [{ target: 'ev-target', side: 'up' }],
    lyrics: [],
    stemDirection: undefined,
    markings: [],
    fermata: undefined,
    notes: [
      {
        id: 'note-start',
        pitch: { step: 'G', octave: 4, alter: 0 },
        ties: [{ target: 'note-target' }],
        accidentalDisplay: undefined,
      },
    ],
    isRest: false,
  }

  function joined(): Score {
    return scoreOf({
      clefs: [],
      beams: [],
      dynamics: [],
      sequences: [
        { voice: undefined, staff: undefined, content: [start, target], fullMeasure: undefined },
      ],
    })
  }

  test('states the tie on the note it starts from', () => {
    const written = writeMnx(joined()).parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({ notes: [{ ties: [{ target: 'note-target' }] }] })
  })

  test('states the slur on the event it starts from, with its side', () => {
    const written = writeMnx(joined()).parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({ slurs: [{ target: 'ev-target', side: 'up' }] })
  })

  test('names only what something points at', () => {
    const content = writeMnx(joined()).parts[0]?.measures[0]?.sequences[0]?.content ?? []
    const from = content[0] as MNXEvent
    const to = content[1] as MNXEvent

    // Nothing refers to the starting event or note, so neither is named.
    expect(from).not.toHaveProperty('id')
    expect(from.notes?.[0]).not.toHaveProperty('id')
    expect(to.id).toBe('ev-target')
    expect(to.notes?.[0]?.id).toBe('note-target')
  })

  test('writes MNX the spec schema accepts', () => {
    expect(schemaErrors(writeMnx(joined()))).toEqual([])
  })
})

describe('beams', () => {
  const beamed = (): Score => {
    const first = { ...WHOLE_C, id: 'ev1' }
    const second = { ...WHOLE_C, id: 'ev2' }
    return scoreOf({
      clefs: [],
      beams: [{ events: ['ev1', 'ev2'], beams: [], direction: undefined }],
      dynamics: [],
      sequences: [
        { voice: undefined, staff: undefined, content: [first, second], fullMeasure: undefined },
      ],
    })
  }

  test('states the beam over the measure rather than on the notes', () => {
    expect(writeMnx(beamed()).parts[0]?.measures[0]?.beams).toEqual([{ events: ['ev1', 'ev2'] }])
  })

  // A beam names its events, so those events have to be named in turn.
  test('names the events a beam refers to', () => {
    const content = writeMnx(beamed()).parts[0]?.measures[0]?.sequences[0]?.content ?? []

    expect((content[0] as MNXEvent).id).toBe('ev1')
    expect((content[1] as MNXEvent).id).toBe('ev2')
  })

  test('nests secondary beams and marks a hook with its direction', () => {
    const score = scoreOf({
      clefs: [],
      beams: [
        {
          events: ['ev1', 'ev2'],
          beams: [{ events: ['ev1'], beams: [], direction: 'right' }],
          direction: undefined,
        },
      ],
      dynamics: [],
      sequences: [
        {
          voice: undefined,
          staff: undefined,
          content: [
            { ...WHOLE_C, id: 'ev1' },
            { ...WHOLE_C, id: 'ev2' },
          ],
          fullMeasure: undefined,
        },
      ],
    })

    expect(writeMnx(score).parts[0]?.measures[0]?.beams).toEqual([
      { events: ['ev1', 'ev2'], beams: [{ events: ['ev1'], direction: 'right' }] },
    ])
  })

  test('writes MNX the spec schema accepts', () => {
    expect(schemaErrors(writeMnx(beamed()))).toEqual([])
  })
})

describe('voices and spaces', () => {
  const gap = { kind: 'space', duration: { num: 1, den: 4 } } as const

  function voicedScore(voice: string | undefined, content: SequenceItem[]): Score {
    return scoreOf({
      clefs: [],
      beams: [],
      dynamics: [],
      sequences: [{ voice, staff: undefined, content, fullMeasure: undefined }],
    })
  }

  test('writes a space as a duration and a type, not as a note', () => {
    const written = writeMnx(voicedScore(undefined, [gap, WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toEqual({
      type: 'space',
      duration: [1, 4],
    })
  })

  test('names the voice when the source distinguished one', () => {
    const written = writeMnx(voicedScore('2', [WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.voice).toBe('2')
  })

  test('leaves the voice out when the source never named one', () => {
    const written = writeMnx(voicedScore(undefined, [WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]).not.toHaveProperty('voice')
  })

  test('writes MNX the spec schema accepts', () => {
    expect(schemaErrors(writeMnx(voicedScore('2', [gap, WHOLE_C])))).toEqual([])
  })
})

describe('tuplets and grace groups', () => {
  const eighths = (multiple: number) => ({ value: { base: 'eighth', dots: 0 } as const, multiple })

  const triplet = {
    kind: 'tuplet',
    inner: eighths(3),
    outer: eighths(2),
    content: [WHOLE_C, WHOLE_C, WHOLE_C],
  } as const

  function itemScore(item: SequenceItem): Score {
    return scoreOf({
      clefs: [],
      beams: [],
      dynamics: [],
      sequences: [{ voice: undefined, staff: undefined, content: [item], fullMeasure: undefined }],
    })
  }

  test('states what is played and the space it is played in', () => {
    const written = writeMnx(itemScore(triplet))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toMatchObject({
      type: 'tuplet',
      inner: { multiple: 3, duration: { base: 'eighth' } },
      outer: { multiple: 2, duration: { base: 'eighth' } },
    })
  })

  test('writes a grace group without a slash it does not have', () => {
    const group = { kind: 'grace', content: [WHOLE_C], slashed: false } as const

    expect(writeMnx(itemScore(group)).parts[0]?.measures[0]?.sequences[0]?.content[0]).toEqual({
      type: 'grace',
      content: [{ duration: { base: 'whole' }, notes: [{ pitch: { step: 'C', octave: 4 } }] }],
    })
  })

  test('writes the slash when the group is drawn with one', () => {
    const group = { kind: 'grace', content: [WHOLE_C], slashed: true } as const
    const written = writeMnx(itemScore(group))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toHaveProperty('slash', true)
  })

  test.each([
    ['a tuplet', triplet],
    ['a grace group', { kind: 'grace', content: [WHOLE_C], slashed: true } as const],
  ])('writes MNX the spec schema accepts for %s', (_name, item) => {
    expect(schemaErrors(writeMnx(itemScore(item)))).toEqual([])
  })
})

describe('full-measure rests', () => {
  function restingScore(fullMeasure: FullMeasureRest): Score {
    return scoreOf({
      clefs: [],
      beams: [],
      dynamics: [],
      sequences: [{ voice: undefined, staff: undefined, content: [], fullMeasure }],
    })
  }

  test('states the rest on the sequence, which then holds no events', () => {
    const written = writeMnx(restingScore({ visualDuration: undefined }))

    expect(written.parts[0]?.measures[0]?.sequences[0]).toEqual({ content: [], fullMeasure: {} })
  })

  test('carries the drawn value when the source gave one', () => {
    const written = writeMnx(restingScore({ visualDuration: { base: 'whole', dots: 0 } }))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({
      visualDuration: { base: 'whole' },
    })
  })

  test('writes MNX the spec schema accepts', () => {
    expect(schemaErrors(writeMnx(restingScore({ visualDuration: undefined })))).toEqual([])
  })
})

describe('events', () => {
  test('writes a rest as an empty rest object with no notes', () => {
    const rest: Event = {
      kind: 'event' as const,
      id: 'ev9',
      staff: undefined,
      value: { base: 'half', dots: 0 },
      slurs: [],
      lyrics: [],
      stemDirection: undefined,
      markings: [],
      fermata: undefined,
      notes: [],
      isRest: true,
    }

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
      notes: [
        {
          id: 'note9',
          pitch: { step: 'B', octave: 3, alter: -1 },
          ties: [],
          accidentalDisplay: undefined,
        },
      ],
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

// MNX states an ending on the measure where it starts, as how many measures
// it covers, and leaves out what the source did not say.
describe('endings', () => {
  function endingOf(ending: Ending) {
    const score = scoreOf(measureOf(), [
      {
        key: undefined,
        time: undefined,
        tempos: [],
        number: undefined,
        ...NO_BARLINE,
        ending,
      },
    ])
    expect(schemaErrors(writeMnx(score))).toEqual([])
    return writeMnx(score).global.measures[0]?.ending
  }

  test('writes the times where the bracket names any', () => {
    expect(endingOf({ duration: 2, numbers: [1, 2], open: false })).toEqual({
      duration: 2,
      numbers: [1, 2],
    })
  })

  test('leaves the times out where the bracket names none', () => {
    expect(endingOf({ duration: 1, numbers: [], open: false })).toEqual({ duration: 1 })
  })

  // A closed bracket is the ordinary one, so only an open one is stated.
  test('states only an open bracket as open', () => {
    expect(endingOf({ duration: 1, numbers: [], open: true })).toEqual({ duration: 1, open: true })
  })
})

// MusicXML says which way a fermata faces and what shape it is; MNX states
// both, and leaves out what the source does not say.
describe('fermatas', () => {
  function fermataOf(fermata: Event['fermata']) {
    const event: Event = {
      kind: 'event',
      id: 'ev1',
      staff: undefined,
      value: { base: 'quarter', dots: 0 },
      slurs: [],
      lyrics: [],
      stemDirection: undefined,
      markings: [],
      fermata,
      notes: [
        {
          id: 'note1',
          pitch: { step: 'C', octave: 4, alter: 0 },
          ties: [],
          accidentalDisplay: undefined,
        },
      ],
      isRest: false,
    }
    const score = scoreOf(measureOf(event))
    expect(schemaErrors(writeMnx(score))).toEqual([])
    return firstEvent(score)?.fermata
  }

  test('writes everything the source stated', () => {
    expect(fermataOf({ symbol: 'angled', pointing: 'down', orient: 'below' })).toEqual({
      symbol: 'angled',
      pointing: 'down',
      orient: 'below',
    })
  })

  // An empty object is how MNX states a fermata with nothing said about it.
  test('writes an empty object where the source said only that it is there', () => {
    expect(fermataOf({ symbol: undefined, pointing: undefined, orient: undefined })).toEqual({})
  })

  test('leaves the key out altogether where there is no fermata', () => {
    expect(fermataOf(undefined)).toBeUndefined()
  })
})

// MNX keys the marks on an event by name, and allows a mark no property
// beyond the ones it names for that mark, so the two that carry more than an
// orientation are written out rather than folded in with the rest.
describe('event markings', () => {
  function eventWith(markings: Event['markings']): Event {
    return {
      kind: 'event',
      id: 'ev1',
      staff: undefined,
      value: { base: 'quarter', dots: 0 },
      slurs: [],
      lyrics: [],
      stemDirection: undefined,
      markings,
      fermata: undefined,
      notes: [
        {
          id: 'note1',
          pitch: { step: 'C', octave: 4, alter: 0 },
          ties: [],
          accidentalDisplay: undefined,
        },
      ],
      isRest: false,
    }
  }

  function markingsOf(markings: Event['markings']) {
    const score = scoreOf(measureOf(eventWith(markings)))
    expect(schemaErrors(writeMnx(score))).toEqual([])
    return firstEvent(score)?.markings
  }

  test('writes a strong accent with both where it points and which side', () => {
    expect(
      markingsOf([{ kind: 'strongAccent', orient: 'above', pointing: 'up', symbol: undefined }]),
    ).toEqual({ strongAccent: { orient: 'above', pointing: 'up' } })
  })

  test('writes a breath mark with both its glyph and which side', () => {
    expect(
      markingsOf([{ kind: 'breath', orient: 'below', pointing: undefined, symbol: 'comma' }]),
    ).toEqual({ breath: { orient: 'below', symbol: 'comma' } })
  })

  test('leaves out a pointing a strong accent does not state', () => {
    expect(
      markingsOf([
        { kind: 'strongAccent', orient: undefined, pointing: undefined, symbol: undefined },
      ]),
    ).toEqual({ strongAccent: {} })
  })

  test('leaves out a glyph a breath mark does not name', () => {
    expect(
      markingsOf([{ kind: 'breath', orient: undefined, pointing: undefined, symbol: undefined }]),
    ).toEqual({ breath: {} })
  })

  test('writes a plain mark as an empty object, which is how MNX states it', () => {
    expect(
      markingsOf([{ kind: 'staccato', orient: undefined, pointing: undefined, symbol: undefined }]),
    ).toEqual({ staccato: {} })
  })

  // Two of the same kind cannot both be stated, because MNX keys them by name.
  test('keeps one of each kind', () => {
    expect(
      markingsOf([
        { kind: 'tenuto', orient: 'above', pointing: undefined, symbol: undefined },
        { kind: 'tenuto', orient: 'below', pointing: undefined, symbol: undefined },
      ]),
    ).toEqual({ tenuto: { orient: 'below' } })
  })
})
