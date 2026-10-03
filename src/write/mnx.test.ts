// MNX distinguishes an absent key from a present one, so these tests cover
// what the writer leaves out as well as what it writes.

import { describe, expect, test } from 'vitest'
import { writeValid } from '../../tests/support/convert.js'
import { writeMnx } from './mnx.js'
import { fraction } from '../fraction.js'
import type {
  Ending,
  Event,
  GraceGroup,
  Markings,
  FullMeasureRest,
  Measure,
  Score,
  SequenceItem,
  Tuplet,
} from '../model/score.js'
import type { MNXEvent } from '../types/mnx.js'

const WHOLE_C: Event = {
  kind: 'event',
  id: 'ev1',
  staff: undefined,
  value: { base: 'whole', dots: 0 },
  slurs: [],
  lyrics: new Map(),
  stemDirection: undefined,
  markings: {},
  fermata: undefined,
  notes: [
    {
      id: 'note1',
      pitch: { step: 'C', octave: 4, alter: 0 },
      ties: [],
      accidentalDisplay: undefined,
      staff: undefined,
    },
  ],
  kitNotes: [],
  isRest: false,
  staffPosition: undefined,
}

// Everything a global measure can state beyond a key, a time and a tempo.
// Spread into the literals below, so a new model field does not mean editing
// each one.
const NO_BARLINE = {
  barline: undefined,
  repeatStart: false,
  repeatEnd: undefined,
  ending: undefined,
  fermata: undefined,
  segno: undefined,
  fine: undefined,
  jump: undefined,
  multimeasureRest: undefined,
  systemBreak: false,
  pageBreak: false,
} as const

function scoreOf(
  measure: Measure,
  globals: Score['globalMeasures'] = [
    { key: undefined, time: undefined, tempos: [], number: undefined, ...NO_BARLINE },
  ],
): Score {
  return {
    globalMeasures: globals,
    parts: [
      {
        id: 'P1',
        name: undefined,
        shortName: undefined,
        staves: 1,
        kit: new Map(),
        transposition: undefined,
        measures: [measure],
      },
    ],
    grouping: [],
    sounds: new Map(),
  }
}

function measureOf(...events: Event[]): Measure {
  return {
    clefs: [],
    staffConfigs: [],
    beams: [],
    dynamics: [],
    arpeggios: [],
    ottavas: [],
    measureRepeat: undefined,
    sequences: [{ voice: undefined, staff: undefined, content: events, fullMeasure: undefined }],
  }
}

function firstEvent(score: Score) {
  const item = writeValid(score).parts[0]?.measures[0]?.sequences[0]?.content[0]
  return item && 'duration' in item && !('type' in item) ? item : undefined
}

// Every score these tests build is also checked against the schema.
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
        lyrics: new Map(),
        stemDirection: undefined,
        markings: {},
        fermata: undefined,
        notes: [],
        kitNotes: [],
        isRest: true,
        staffPosition: undefined,
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
        lyrics: new Map(),
        stemDirection: undefined,
        markings: {},
        fermata: undefined,
        notes: [
          {
            id: 'note2',
            pitch: { step: 'B', octave: 3, alter: -1 },
            ties: [],
            accidentalDisplay: undefined,
            staff: undefined,
          },
        ],
        kitNotes: [],
        isRest: false,
        staffPosition: undefined,
      }),
    ),
  ],
  [
    'clefs and a key',
    scoreOf(
      {
        clefs: [
          {
            sign: 'F',
            staffPosition: 2,
            staff: undefined,
            position: fraction(0, 1),
            octave: undefined,
            hide: false,
          },
        ],
        staffConfigs: [],
        beams: [],
        dynamics: [],
        arpeggios: [],
        ottavas: [],
        measureRepeat: undefined,
        sequences: [
          { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
        ],
      },
      [
        {
          key: { fifths: -3 },
          time: { count: 6, unit: 8, display: undefined },
          tempos: [],
          number: 0,
          ...NO_BARLINE,
        },
      ],
    ),
  ],
])('writes MNX the spec schema accepts for %s', (_name, score) => {
  writeValid(score)
})

describe('the document', () => {
  test('declares the MNX version it emits', () => {
    expect(writeValid(scoreOf(measureOf(WHOLE_C))).mnx).toEqual({ version: 1 })
  })
})

describe('global measures', () => {
  test('writes the key and time signature when the score states them', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: { fifths: 2 },
        time: { count: 3, unit: 8, display: undefined },
        tempos: [],
        number: undefined,
        ...NO_BARLINE,
      },
    ])

    expect(writeValid(score).global.measures[0]).toEqual({
      key: { fifths: 2 },
      time: { count: 3, unit: 8 },
    })
  })

  test('writes the number, barline, repeats, fermata and segno the measure states', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [],
        ...NO_BARLINE,
        number: 5,
        barline: 'dashed',
        repeatStart: true,
        repeatEnd: { times: 3 },
        fermata: { symbol: undefined, pointing: undefined, placement: 'above' },
        segno: { location: fraction(0, 1), glyph: 'segnoSerpent1', color: undefined },
      },
    ])

    expect(writeValid(score).global.measures[0]).toEqual({
      number: 5,
      barline: { type: 'dashed' },
      repeatStart: {},
      repeatEnd: { times: 3 },
      fermata: { placement: 'above' },
      segno: { location: { fraction: [0, 1] }, glyph: 'segnoSerpent1' },
    })
  })

  test('writes a repeat end that states no count of times as an empty object', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [],
        number: undefined,
        ...NO_BARLINE,
        repeatEnd: { times: undefined },
      },
    ])

    expect(writeValid(score).global.measures[0]).toEqual({ repeatEnd: {} })
  })

  test('leaves them out when the score states neither', () => {
    expect(writeValid(scoreOf(measureOf(WHOLE_C))).global.measures[0]).toEqual({})
  })

  // Common time keeps its count and unit and adds the glyph to draw in their
  // place, so a reader can show the C and still know the meter.
  test('writes the common-time display alongside the count and unit', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: { count: 4, unit: 4, display: 'common' },
        tempos: [],
        number: undefined,
        ...NO_BARLINE,
      },
    ])
    const written = writeValid(score)

    expect(written.global.measures[0]?.time).toEqual({ count: 4, unit: 4, display: 'common' })
  })

  test('writes a tempo at the start of the measure without a location', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [{ position: fraction(0, 1), value: { base: 'quarter', dots: 0 }, bpm: 100 }],
        ...NO_BARLINE,
        number: undefined,
      },
    ])

    expect(writeValid(score).global.measures[0]?.tempos).toEqual([
      { value: { base: 'quarter' }, bpm: 100 },
    ])
  })

  test('gives a tempo partway through the measure a location', () => {
    const score = scoreOf(measureOf(WHOLE_C), [
      {
        key: undefined,
        time: undefined,
        tempos: [{ position: fraction(1, 2), value: { base: 'half', dots: 0 }, bpm: 60 }],
        ...NO_BARLINE,
        number: undefined,
      },
    ])

    expect(writeValid(score).global.measures[0]?.tempos?.[0]?.location).toEqual({
      fraction: [1, 2],
    })
  })

  test('writes a dynamic that MNX schema accepts', () => {
    const measure = {
      ...measureOf(WHOLE_C),
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      dynamics: [
        {
          kind: 'immediate' as const,
          position: fraction(0, 1),
          value: 'f' as const,
          staff: undefined,
        },
      ],
    }

    writeValid(scoreOf(measure))
  })
})

describe('parts', () => {
  test('writes the part name when there is one', () => {
    const score = scoreOf(measureOf(WHOLE_C))
    const named: Score = {
      ...score,
      parts: [
        {
          id: 'P1',
          name: 'Flute',
          shortName: undefined,
          staves: 1,
          kit: new Map(),
          transposition: undefined,
          measures: score.parts[0]?.measures ?? [],
        },
      ],
    }

    expect(writeValid(named).parts[0]?.name).toBe('Flute')
  })

  test('leaves the name out when the part is unnamed', () => {
    expect(writeValid(scoreOf(measureOf(WHOLE_C))).parts[0]).not.toHaveProperty('name')
  })

  test('writes the short name when there is one', () => {
    const score = scoreOf(measureOf(WHOLE_C))
    const abbreviated: Score = {
      ...score,
      parts: [
        {
          id: 'P1',
          name: 'Flute',
          shortName: 'Fl.',
          staves: 1,
          kit: new Map(),
          transposition: undefined,
          measures: score.parts[0]?.measures ?? [],
        },
      ],
    }

    expect(writeValid(abbreviated).parts[0]?.shortName).toBe('Fl.')
    writeValid(abbreviated)
  })

  test('leaves the short name out when the part has none', () => {
    expect(writeValid(scoreOf(measureOf(WHOLE_C))).parts[0]).not.toHaveProperty('shortName')
  })

  test('writes the staff count and key flip point of a two-staff transposing part', () => {
    const score = scoreOf(measureOf(WHOLE_C))
    const part = score.parts[0]
    if (!part) throw new Error('expected a part')
    const written = writeValid({
      ...score,
      parts: [
        {
          ...part,
          staves: 2,
          transposition: { staffDistance: -1, halfSteps: -2, keyFifthsFlipAt: 6 },
        },
      ],
    })

    expect(written.parts[0]?.staves).toBe(2)
    expect(written.parts[0]?.transposition).toEqual({
      interval: { halfSteps: -2, staffDistance: -1 },
      keyFifthsFlipAt: 6,
    })
  })
})

describe('octave shifts and hairpins', () => {
  test('writes each with the staff it belongs under, and nothing it does not state', () => {
    const end = { measure: 0, position: fraction(1, 2) }
    const measure: Measure = {
      ...measureOf(WHOLE_C),
      ottavas: [{ position: fraction(0, 1), end, value: -1, staff: 2 }],
      dynamics: [{ kind: 'gradual', position: fraction(0, 1), wedge: 'increasing', end, staff: 2 }],
    }
    const score = scoreOf(measure)
    const part = score.parts[0]
    if (!part) throw new Error('expected a part')
    const written = writeValid({ ...score, parts: [{ ...part, staves: 2 }] }).parts[0]?.measures[0]
    const stop = { measure: 'm1', position: { fraction: [1, 2] } }

    expect(written?.ottavas).toStrictEqual([
      { position: { fraction: [0, 1] }, end: stop, value: -1, staff: 2 },
    ])
    expect(written?.dynamics).toStrictEqual([
      {
        position: { fraction: [0, 1] },
        type: 'gradual',
        wedgeType: 'increasing',
        end: stop,
        staff: 2,
      },
    ])
  })
})

describe('a hairpin with no end', () => {
  test('is refused, because MNX requires a gradual dynamic to state its end', () => {
    const measure: Measure = {
      ...measureOf(WHOLE_C),
      dynamics: [
        {
          kind: 'gradual',
          position: fraction(0, 1),
          wedge: 'increasing',
          end: undefined,
          staff: undefined,
        },
      ],
    }

    expect(() => writeMnx(scoreOf(measure))).toThrow('A hairpin with no end reached the writer.')
  })
})

describe('measures', () => {
  test('writes clefs when the measure has them', () => {
    const score = scoreOf({
      clefs: [
        {
          sign: 'F',
          staffPosition: 2,
          staff: undefined,
          position: fraction(0, 1),
          octave: undefined,
          hide: false,
        },
      ],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
      ],
    })

    expect(writeValid(score).parts[0]?.measures[0]?.clefs).toEqual([
      { clef: { sign: 'F', staffPosition: 2 } },
    ])
  })

  // A clef at the start of the measure needs no position. A clef partway
  // through states where it falls.
  test('gives a mid-measure clef change its position', () => {
    const score = scoreOf({
      clefs: [
        {
          sign: 'G',
          staffPosition: -2,
          staff: undefined,
          position: fraction(0, 1),
          octave: undefined,
          hide: false,
        },
        {
          sign: 'F',
          staffPosition: 2,
          staff: undefined,
          position: fraction(1, 2),
          octave: undefined,
          hide: false,
        },
      ],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
      ],
    })
    const written = writeValid(score)

    expect(written.parts[0]?.measures[0]?.clefs).toEqual([
      { clef: { sign: 'G', staffPosition: -2 } },
      { clef: { sign: 'F', staffPosition: 2 }, position: { fraction: [1, 2] } },
    ])
  })

  // A transposed clef states its octave and asks for the 8 to be drawn.
  test('writes a clef octave change and shows it', () => {
    const score = scoreOf({
      clefs: [
        {
          sign: 'G',
          staffPosition: -2,
          staff: undefined,
          position: fraction(0, 1),
          octave: -1,
          hide: false,
        },
      ],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [WHOLE_C], fullMeasure: undefined },
      ],
    })
    const written = writeValid(score)

    expect(written.parts[0]?.measures[0]?.clefs).toEqual([
      { clef: { sign: 'G', staffPosition: -2, octave: -1, showOctave: true } },
    ])
  })

  test('leaves clefs out when the measure has none', () => {
    expect(writeValid(scoreOf(measureOf(WHOLE_C))).parts[0]?.measures[0]).not.toHaveProperty(
      'clefs',
    )
  })
})

describe('ties and slurs', () => {
  // An id exists so that a tie or slur can point at something. What nothing
  // points at gets no id.
  const target: Event = {
    kind: 'event',
    id: 'ev-target',
    staff: undefined,
    value: { base: 'whole', dots: 0 },
    slurs: [],
    lyrics: new Map(),
    stemDirection: undefined,
    markings: {},
    fermata: undefined,
    notes: [
      {
        id: 'note-target',
        pitch: { step: 'G', octave: 4, alter: 0 },
        ties: [],
        accidentalDisplay: undefined,
        staff: undefined,
      },
    ],
    kitNotes: [],
    isRest: false,
    staffPosition: undefined,
  }
  const start: Event = {
    kind: 'event',
    id: 'ev-start',
    staff: undefined,
    value: { base: 'whole', dots: 0 },
    slurs: [{ target: 'ev-target', side: 'up' }],
    lyrics: new Map(),
    stemDirection: undefined,
    markings: {},
    fermata: undefined,
    notes: [
      {
        id: 'note-start',
        pitch: { step: 'G', octave: 4, alter: 0 },
        ties: [{ target: 'note-target', crossVoice: false }],
        accidentalDisplay: undefined,
        staff: undefined,
      },
    ],
    kitNotes: [],
    isRest: false,
    staffPosition: undefined,
  }

  function joined(): Score {
    return scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [start, target], fullMeasure: undefined },
      ],
    })
  }

  test('states the tie on the note it starts from', () => {
    const written = writeValid(joined()).parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({ notes: [{ ties: [{ target: 'note-target' }] }] })
  })

  test('writes a let-ring tie with no target', () => {
    const ringing: Event = {
      ...WHOLE_C,
      notes: WHOLE_C.notes.map((note) => ({ ...note, ties: [{ crossVoice: false, lv: true }] })),
    }
    const score = scoreOf(measureOf(ringing))

    expect(firstEvent(score)?.notes?.[0]?.ties).toStrictEqual([{ lv: true }])
  })

  // A tie to the same voice's next note is the ordinary one and states no
  // target type.
  test('says nothing about the target type of a tie within one voice', () => {
    const note = writeValid(joined()).parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(JSON.stringify(note)).not.toContain('targetType')
  })

  test('declares the target type of a tie that crosses voices', () => {
    const crossing = structuredClone(start)
    crossing.notes = [
      { ...crossing.notes[0]!, ties: [{ target: 'note-target', crossVoice: true }] },
    ]
    const score = scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [crossing, target], fullMeasure: undefined },
      ],
    })
    const document = writeValid(score)
    const written = document.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({
      notes: [{ ties: [{ target: 'note-target', targetType: 'crossVoice' }] }],
    })
  })

  test('states the slur on the event it starts from, with its side', () => {
    const written = writeValid(joined()).parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({ slurs: [{ target: 'ev-target', side: 'up' }] })
  })

  // An S-shaped slur ends bending the other way, which the model carries as
  // sideEnd.
  test('writes the side a slur ends on where it differs from its side', () => {
    const bending = structuredClone(start)
    bending.slurs = [{ target: 'ev-target', side: 'up', sideEnd: 'down' }]
    const score = scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [bending, target], fullMeasure: undefined },
      ],
    })
    const document = writeValid(score)
    const written = document.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(written).toMatchObject({
      slurs: [{ target: 'ev-target', side: 'up', sideEnd: 'down' }],
    })
  })

  test('names only what something points at', () => {
    const content = writeValid(joined()).parts[0]?.measures[0]?.sequences[0]?.content ?? []
    const from = content[0] as MNXEvent
    const to = content[1] as MNXEvent

    // Nothing refers to the starting event or note, so neither is named.
    expect(from).not.toHaveProperty('id')
    expect(from.notes?.[0]).not.toHaveProperty('id')
    expect(to.id).toBe('ev-target')
    expect(to.notes?.[0]?.id).toBe('note-target')
  })

  test('writes MNX the spec schema accepts', () => {
    writeValid(joined())
  })
})

describe('beams', () => {
  const beamed = (): Score => {
    const first = { ...WHOLE_C, id: 'ev1' }
    const second = { ...WHOLE_C, id: 'ev2' }
    return scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [{ events: ['ev1', 'ev2'], beams: [], direction: undefined }],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [
        { voice: undefined, staff: undefined, content: [first, second], fullMeasure: undefined },
      ],
    })
  }

  test('states the beam over the measure rather than on the notes', () => {
    expect(writeValid(beamed()).parts[0]?.measures[0]?.beams).toEqual([{ events: ['ev1', 'ev2'] }])
  })

  test('names the events a beam refers to', () => {
    const content = writeValid(beamed()).parts[0]?.measures[0]?.sequences[0]?.content ?? []

    expect((content[0] as MNXEvent).id).toBe('ev1')
    expect((content[1] as MNXEvent).id).toBe('ev2')
  })

  test('nests secondary beams and marks a hook with its direction', () => {
    const score = scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [
        {
          events: ['ev1', 'ev2'],
          beams: [{ events: ['ev1'], beams: [], direction: 'right' }],
          direction: undefined,
        },
      ],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
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

    expect(writeValid(score).parts[0]?.measures[0]?.beams).toEqual([
      { events: ['ev1', 'ev2'], beams: [{ events: ['ev1'], direction: 'right' }] },
    ])
  })

  test('writes MNX the spec schema accepts', () => {
    writeValid(beamed())
  })
})

describe('voices and spaces', () => {
  const gap = { kind: 'space', duration: fraction(1, 4) } as const

  function voicedScore(voice: string | undefined, content: SequenceItem[]): Score {
    return scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [{ voice, staff: undefined, content, fullMeasure: undefined }],
    })
  }

  test('writes a space as a duration and a type, not as a note', () => {
    const written = writeValid(voicedScore(undefined, [gap, WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toEqual({
      type: 'space',
      duration: [1, 4],
    })
  })

  test('names the voice when the source distinguished one', () => {
    const written = writeValid(voicedScore('2', [WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.voice).toBe('2')
  })

  test('leaves the voice out when the source never named one', () => {
    const written = writeValid(voicedScore(undefined, [WHOLE_C]))

    expect(written.parts[0]?.measures[0]?.sequences[0]).not.toHaveProperty('voice')
  })

  test('writes MNX the spec schema accepts', () => {
    writeValid(voicedScore('2', [gap, WHOLE_C]))
  })
})

describe('tuplets and grace groups', () => {
  const eighths = (multiple: number) => ({ value: { base: 'eighth', dots: 0 } as const, multiple })

  const triplet: Tuplet = {
    kind: 'tuplet',
    inner: eighths(3),
    outer: eighths(2),
    content: [WHOLE_C, WHOLE_C, WHOLE_C],
  }

  // A triplet 16th group nested inside the triplet, each level stated as its
  // own ratio.
  const nestedTuplet: Tuplet = {
    kind: 'tuplet',
    inner: eighths(3),
    outer: eighths(2),
    content: [
      WHOLE_C,
      {
        kind: 'tuplet',
        inner: { value: { base: '16th', dots: 0 } as const, multiple: 3 },
        outer: { value: { base: '16th', dots: 0 } as const, multiple: 2 },
        content: [WHOLE_C, WHOLE_C, WHOLE_C],
      },
      WHOLE_C,
    ],
  }

  // A tremolo across two notes: each note has its full value, and the pair
  // takes the time of one of them.
  const tremolo = {
    kind: 'multiNoteTremolo',
    marks: 3,
    outer: eighths(2),
    content: [WHOLE_C, WHOLE_C],
  } as const

  function itemScore(item: SequenceItem): Score {
    return scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [{ voice: undefined, staff: undefined, content: [item], fullMeasure: undefined }],
    })
  }

  test('states what is played and the space it is played in', () => {
    const written = writeValid(itemScore(triplet))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toMatchObject({
      type: 'tuplet',
      inner: { multiple: 3, duration: { base: 'eighth' } },
      outer: { multiple: 2, duration: { base: 'eighth' } },
    })
  })

  // The schema states no default for slash, so an absent one is unspecified
  // rather than false. Both values are stated.
  test('states the absence of a slash', () => {
    const group: GraceGroup = {
      kind: 'grace',
      content: [WHOLE_C],
      slashed: false,
      graceType: undefined,
    }

    expect(writeValid(itemScore(group)).parts[0]?.measures[0]?.sequences[0]?.content[0]).toEqual({
      type: 'grace',
      slash: false,
      content: [{ duration: { base: 'whole' }, notes: [{ pitch: { step: 'C', octave: 4 } }] }],
    })
  })

  test('writes the slash when the group is drawn with one', () => {
    const group: GraceGroup = {
      kind: 'grace',
      content: [WHOLE_C],
      slashed: true,
      graceType: undefined,
    }
    const written = writeValid(itemScore(group))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toHaveProperty('slash', true)
  })

  test('writes where the group takes its time from, where the source says', () => {
    const group: GraceGroup = {
      kind: 'grace',
      content: [WHOLE_C],
      slashed: false,
      graceType: 'stealPrevious',
    }
    const written = writeValid(itemScore(group))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toHaveProperty(
      'graceType',
      'stealPrevious',
    )
  })

  test('writes a two-note tremolo as the pair and the space it fills', () => {
    const written = writeValid(itemScore(tremolo))

    expect(written.parts[0]?.measures[0]?.sequences[0]?.content[0]).toMatchObject({
      type: 'tremolo',
      marks: 3,
      outer: { multiple: 2, duration: { base: 'eighth' } },
    })
  })

  test.each([
    ['a tuplet', triplet],
    ['a nested tuplet', nestedTuplet],
    [
      'a grace group',
      {
        kind: 'grace',
        content: [WHOLE_C],
        slashed: true,
        graceType: 'makeTime',
      } satisfies GraceGroup,
    ],
    ['a two-note tremolo', tremolo],
  ])('writes MNX the spec schema accepts for %s', (_name, item) => {
    writeValid(itemScore(item))
  })
})

describe('full-measure rests', () => {
  function restingScore(fullMeasure: FullMeasureRest): Score {
    return scoreOf({
      clefs: [],
      staffConfigs: [],
      beams: [],
      dynamics: [],
      arpeggios: [],
      ottavas: [],
      measureRepeat: undefined,
      sequences: [{ voice: undefined, staff: undefined, content: [], fullMeasure }],
    })
  }

  test('states the rest on the sequence, which then holds no events', () => {
    const written = writeValid(
      restingScore({ visualDuration: undefined, fermata: undefined, staffPosition: undefined }),
    )

    expect(written.parts[0]?.measures[0]?.sequences[0]).toEqual({ content: [], fullMeasure: {} })
  })

  test('carries the drawn value when the source gave one', () => {
    const written = writeValid(
      restingScore({
        visualDuration: { base: 'whole', dots: 0 },
        fermata: undefined,
        staffPosition: undefined,
      }),
    )

    expect(written.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({
      visualDuration: { base: 'whole' },
    })
  })

  test('writes MNX the spec schema accepts', () => {
    writeValid(
      restingScore({ visualDuration: undefined, fermata: undefined, staffPosition: undefined }),
    )
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
      lyrics: new Map(),
      stemDirection: undefined,
      markings: {},
      fermata: undefined,
      notes: [],
      kitNotes: [],
      isRest: true,
      staffPosition: undefined,
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
          staff: undefined,
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

  test('writes an accidental drawn in parentheses', () => {
    const cautionary: Event = {
      ...WHOLE_C,
      notes: WHOLE_C.notes.map((note) => ({
        ...note,
        accidentalDisplay: { show: true, enclosure: 'parentheses' },
      })),
    }

    expect(firstEvent(scoreOf(measureOf(cautionary)))?.notes?.[0]?.accidentalDisplay).toEqual({
      show: true,
      enclosure: { symbol: 'parentheses' },
    })
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
    writeValid(score)
    return writeValid(score).global.measures[0]?.ending
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
      lyrics: new Map(),
      stemDirection: undefined,
      markings: {},
      fermata,
      notes: [
        {
          id: 'note1',
          pitch: { step: 'C', octave: 4, alter: 0 },
          ties: [],
          accidentalDisplay: undefined,
          staff: undefined,
        },
      ],
      kitNotes: [],
      isRest: false,
      staffPosition: undefined,
    }
    const score = scoreOf(measureOf(event))
    writeValid(score)
    return firstEvent(score)?.fermata
  }

  test('writes everything the source stated', () => {
    expect(fermataOf({ symbol: 'angled', pointing: 'down', placement: 'below' })).toEqual({
      symbol: 'angled',
      pointing: 'down',
      placement: 'below',
    })
  })

  // An empty object is how MNX states a fermata with nothing said about it.
  test('writes an empty object where the source said only that it is there', () => {
    expect(fermataOf({ symbol: undefined, pointing: undefined, placement: undefined })).toEqual({})
  })

  test('leaves the key out altogether where there is no fermata', () => {
    expect(fermataOf(undefined)).toBeUndefined()
  })
})

// MNX keys the marks on an event by name and allows each mark only its own
// properties, so the two marks with more than a placement are written apart.
describe('event markings', () => {
  function eventWith(markings: Event['markings']): Event {
    return {
      kind: 'event',
      id: 'ev1',
      staff: undefined,
      value: { base: 'quarter', dots: 0 },
      slurs: [],
      lyrics: new Map(),
      stemDirection: undefined,
      markings,
      fermata: undefined,
      notes: [
        {
          id: 'note1',
          pitch: { step: 'C', octave: 4, alter: 0 },
          ties: [],
          accidentalDisplay: undefined,
          staff: undefined,
        },
      ],
      kitNotes: [],
      isRest: false,
      staffPosition: undefined,
    }
  }

  function markingsOf(markings: Event['markings']) {
    const score = scoreOf(measureOf(eventWith(markings)))
    writeValid(score)
    return firstEvent(score)?.markings
  }

  test('writes a strong accent with both where it points and which side', () => {
    expect(markingsOf({ strongAccent: { placement: 'above', pointing: 'up' } })).toEqual({
      strongAccent: { placement: 'above', pointing: 'up' },
    })
  })

  test('writes a breath mark with both its glyph and which side', () => {
    expect(markingsOf({ breath: { placement: 'below', symbol: 'comma' } })).toEqual({
      breath: { placement: 'below', symbol: 'comma' },
    })
  })

  test('leaves out a pointing a strong accent does not state', () => {
    expect(markingsOf({ strongAccent: { placement: undefined, pointing: undefined } })).toEqual({
      strongAccent: {},
    })
  })

  test('leaves out a glyph a breath mark does not name', () => {
    expect(markingsOf({ breath: { placement: undefined, symbol: undefined } })).toEqual({
      breath: {},
    })
  })

  test('writes a plain mark as an empty object, which is how MNX states it', () => {
    expect(markingsOf({ staccato: { placement: undefined } })).toEqual({ staccato: {} })
  })

  test('writes every plain mark under the name MNX gives it', () => {
    const side = { placement: 'above' } as const
    expect(
      markingsOf({
        accent: side,
        staccato: side,
        staccatissimo: side,
        tenuto: side,
        spiccato: side,
        stress: side,
        unstress: side,
        softAccent: side,
      }),
    ).toEqual({
      accent: side,
      staccato: side,
      staccatissimo: side,
      tenuto: side,
      spiccato: side,
      stress: side,
      unstress: side,
      softAccent: side,
    })
  })

  test('writes a bow mark with the way the bow travels', () => {
    expect(markingsOf({ bowDirection: { placement: 'above', direction: 'down' } })).toEqual({
      bowDirection: { placement: 'above', direction: 'down' },
    })
  })

  test('writes a tremolo with how many beams it is drawn with', () => {
    expect(markingsOf({ tremolo: { placement: 'above', marks: 2 } })).toEqual({
      tremolo: { placement: 'above', marks: 2 },
    })
  })

  test('writes no markings at all for an event carrying none', () => {
    const score = scoreOf(measureOf(eventWith({})))
    writeValid(score)
    expect(firstEvent(score)).not.toHaveProperty('markings')
  })

  test('writes a caesura with only what the source states', () => {
    expect(markingsOf({ caesura: { marks: 1, shape: undefined } })).toEqual({
      caesura: { marks: 1 },
    })
    expect(markingsOf({ caesura: { marks: undefined, shape: 'thick' } })).toEqual({
      caesura: { shape: 'thick' },
    })
    expect(markingsOf({ caesura: { marks: undefined, shape: undefined } })).toEqual({
      caesura: {},
    })
  })

  // The writer names each mark in its own line. markings holds only optional
  // properties, so the schema cannot catch a dropped kind. Required<Markings>
  // makes the compiler refuse this object until it holds every kind.
  test('writes every kind the model can hold', () => {
    const everyKind = {
      accent: { placement: undefined },
      staccato: { placement: undefined },
      staccatissimo: { placement: undefined },
      tenuto: { placement: undefined },
      spiccato: { placement: undefined },
      stress: { placement: undefined },
      unstress: { placement: undefined },
      softAccent: { placement: undefined },
      strongAccent: { placement: undefined, pointing: undefined },
      bowDirection: { placement: undefined, direction: 'up' as const },
      breath: { placement: undefined, symbol: undefined },
      tremolo: { placement: undefined, marks: 3 },
      caesura: { marks: undefined, shape: undefined },
    } satisfies Required<Markings>

    expect(Object.keys(markingsOf(everyKind) ?? {}).sort()).toEqual(Object.keys(everyKind).sort())
  })
})

// MNX and the model both key an event's lyrics by verse line.
describe('event lyrics', () => {
  function singing(lyrics: Event['lyrics']): Event {
    return { ...WHOLE_C, id: 'ev1', lyrics }
  }

  test('writes each verse line under the number the source gave it', () => {
    const score = scoreOf(
      measureOf(
        singing(
          new Map([
            ['1', { text: 'Are', type: undefined }],
            ['2', { text: 'Am', type: 'start' as const }],
          ]),
        ),
      ),
    )

    writeValid(score)
    expect(firstEvent(score)?.lyrics).toEqual({
      lines: { '1': { text: 'Are' }, '2': { text: 'Am', type: 'start' } },
    })
  })

  test('leaves the key out altogether for an event that sings nothing', () => {
    const score = scoreOf(measureOf(singing(new Map())))

    writeValid(score)
    expect(firstEvent(score)).not.toHaveProperty('lyrics')
  })
})
