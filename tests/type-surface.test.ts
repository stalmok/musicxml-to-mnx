// Covers the parts of src/types/mnx.ts that the writer does not produce yet: a
// tie targetType other than crossVoice, a relative dynamic, the useBeams and
// useLyricExtenders support flags, the far ends of the note-value scale, a
// coda, the jumps other than dal segno and D.S. al Fine, a caesura over a
// barline, a slide into or out of a note, and a lyric extender line. Each fixture is typed as
// an MNXDocument, so TypeScript holds it to the declared shape, and
// schemaErrors holds that shape to the schema.

import { describe, expect, test } from 'vitest'
import { schemaErrors } from './support/schema.js'
import type {
  MNXDocument,
  MNXDynamic,
  MNXEvent,
  MNXGlobalMeasure,
  MNXJumpType,
  MNXLyricLine,
  MNXNoteMarkings,
  MNXNoteValueBase,
  MNXSequenceItem,
  MNXSupport,
  MNXTie,
  MNXTieTargetType,
} from '../src/index.js'

/** One part, one voice, one quarter note on middle C. */
function documentWith(parts: {
  support?: MNXSupport
  ties?: MNXTie[]
  dynamics?: MNXDynamic[]
  noteBase?: MNXNoteValueBase
  eventType?: MNXEvent['type']
  measure?: Omit<MNXGlobalMeasure, 'id'>
  markings?: MNXNoteMarkings
  lyric?: MNXLyricLine
}): MNXDocument {
  return {
    mnx: { version: 1, ...(parts.support ? { support: parts.support } : {}) },
    global: { measures: [{ id: 'm1', ...parts.measure }] },
    parts: [
      {
        measures: [
          {
            ...(parts.dynamics ? { dynamics: parts.dynamics } : {}),
            sequences: [
              {
                content: [
                  {
                    id: 'e1',
                    ...(parts.eventType ? { type: parts.eventType } : {}),
                    duration: { base: parts.noteBase ?? 'quarter' },
                    ...(parts.lyric ? { lyrics: { lines: { '1': parts.lyric } } } : {}),
                    notes: [
                      {
                        pitch: { step: 'C', octave: 4 },
                        ...(parts.ties ? { ties: parts.ties } : {}),
                        ...(parts.markings ? { markings: parts.markings } : {}),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

test('the base document the fixtures build on is itself legal MNX', () => {
  expect(schemaErrors(documentWith({}))).toEqual([])
})

describe('the type surface the writer does not yet emit is still legal MNX', () => {
  test.each<MNXTieTargetType>(['nextNote', 'crossVoice', 'arpeggio', 'crossJump'])(
    'a tie targetType of %s',
    (targetType) => {
      const tie: MNXTie = { target: 'x', targetType }
      expect(schemaErrors(documentWith({ ties: [tie] }))).toEqual([])
    },
  )

  const start = { fraction: [0, 1] as [number, number] }

  // Each with only the fields its type requires.
  test.each<MNXDynamic>([
    { position: start, type: 'immediate', value: 'f' },
    {
      position: start,
      type: 'gradual',
      wedgeType: 'increasing',
      end: { measure: 'm1', position: { fraction: [1, 4] } },
    },
    { position: start, type: 'relative', relativeValue: 'louder' },
    { position: start, type: 'accent', value: 'f' },
  ])('a dynamic of type $type', (dynamic) => {
    expect(schemaErrors(documentWith({ dynamics: [dynamic] }))).toEqual([])
  })

  test.each<MNXDynamic>([
    {
      position: start,
      type: 'gradual',
      value: 'p',
      glyphs: ['dynamicPiano'],
      wedgeType: 'increasing',
      end: { measure: 'm1', position: { fraction: [1, 4] } },
    },
    {
      position: start,
      type: 'relative',
      relativeValue: 'louder',
      value: 'f',
      glyphs: ['dynamicForte'],
    },
  ])('the glyphs of a dynamic of type $type', (dynamic) => {
    expect(schemaErrors(documentWith({ dynamics: [dynamic] }))).toEqual([])
  })

  test('a hairpin must state where it ends', () => {
    // @ts-expect-error MNX requires a gradual dynamic to state its end.
    const endless: MNXDynamic = { position: start, type: 'gradual', wedgeType: 'increasing' }
    expect(schemaErrors(documentWith({ dynamics: [endless] }))).not.toEqual([])
  })

  // Every other sequence item states its kind, and an event may. The writer
  // leaves it off, but the types must accept it.
  test('the event discriminant', () => {
    expect(schemaErrors(documentWith({ eventType: 'event' }))).toEqual([])
  })

  // This compiles only while every item states its kind and an event's kind
  // is its own value. An event's kind is optional, so the event is the
  // default case.
  test('a sequence item can be told apart by its kind', () => {
    const kindOf = (item: MNXSequenceItem): string => {
      switch (item.type) {
        case 'space':
          return `space of ${String(item.duration[0])}/${String(item.duration[1])}`
        case 'tuplet':
        case 'grace':
        case 'tremolo':
          return `${item.type} of ${String(item.content.length)}`
        default:
          return `event of ${item.duration.base}`
      }
    }

    const sequence = documentWith({}).parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map(kindOf)).toEqual(['event of quarter'])
    expect(kindOf({ type: 'space', duration: [1, 4] })).toBe('space of 1/4')
    expect(kindOf({ type: 'event', duration: { base: 'half' } })).toBe('event of half')
  })

  test.each(['useBeams', 'useLyricExtenders'] as const)('the %s support flag', (flag) => {
    expect(schemaErrors(documentWith({ support: { [flag]: true } }))).toEqual([])
  })

  test.each<MNXJumpType>(['dc', 'dcAlCoda', 'dcAlFine', 'dsAlCoda', 'dsAlFine', 'segno', 'toCoda'])(
    'a jump of type %s',
    (type) => {
      expect(schemaErrors(documentWith({ measure: { jump: { location: start, type } } }))).toEqual(
        [],
      )
    },
  )

  test('a coda sign', () => {
    const measure = { coda: { location: start, glyph: 'coda', color: '#ff0000' } }
    expect(schemaErrors(documentWith({ measure }))).toEqual([])
  })

  test('a caesura over the barline', () => {
    const measure = { caesura: { marks: 1, shape: 'curved' as const } }
    expect(schemaErrors(documentWith({ measure }))).toEqual([])
  })

  test('a slide into and out of a note', () => {
    const markings: MNXNoteMarkings = { slideIn: { type: 'scoop' }, slideOut: { type: 'doit' } }
    expect(schemaErrors(documentWith({ markings }))).toEqual([])
  })

  test.each<MNXLyricLine>([
    { text: 'la', extender: { target: 'e1' } },
    { text: 'la', extender: { show: false } },
  ])('a lyric extender line: $extender', (lyric) => {
    expect(schemaErrors(documentWith({ lyric }))).toEqual([])
  })

  test.each<MNXNoteValueBase>(['duplexMaxima', '2048th', '4096th'])(
    'a note value base of %s',
    (noteBase) => {
      expect(schemaErrors(documentWith({ noteBase }))).toEqual([])
    },
  )
})
