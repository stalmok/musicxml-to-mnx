// Covers the parts of src/types/mnx.ts that the writer does not produce yet: a
// tie targetType other than crossVoice, a relative dynamic, the useBeams
// support flag, the far ends of the note-value scale. Each fixture is typed as
// an MNXDocument, so TypeScript holds it to the declared shape, and
// schemaErrors holds that shape to the schema.

import { describe, expect, test } from 'vitest'
import { schemaErrors } from './support/schema.js'
import type {
  MNXDocument,
  MNXDynamic,
  MNXEvent,
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
}): MNXDocument {
  return {
    mnx: { version: 1, ...(parts.support ? { support: parts.support } : {}) },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            ...(parts.dynamics ? { dynamics: parts.dynamics } : {}),
            sequences: [
              {
                content: [
                  {
                    ...(parts.eventType ? { type: parts.eventType } : {}),
                    duration: { base: parts.noteBase ?? 'quarter' },
                    notes: [
                      {
                        pitch: { step: 'C', octave: 4 },
                        ...(parts.ties ? { ties: parts.ties } : {}),
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

  test.each<MNXDynamic['type']>(['immediate', 'gradual', 'relative', 'accent'])(
    'a dynamic type of %s',
    (type) => {
      expect(
        schemaErrors(documentWith({ dynamics: [{ position: { fraction: [0, 1] }, type }] })),
      ).toEqual([])
    },
  )

  // Every other sequence item states its kind, and an event may. The writer
  // leaves it off, but the types must accept it.
  test('the event discriminant', () => {
    expect(schemaErrors(documentWith({ eventType: 'event' }))).toEqual([])
  })

  // This compiles only while every item states its kind and an event's kind
  // is its own value. An event's kind is optional, so the event is the
  // default arm.
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

  test('the useBeams support flag', () => {
    expect(schemaErrors(documentWith({ support: { useBeams: true } }))).toEqual([])
  })

  test.each<MNXNoteValueBase>(['duplexMaxima', '2048th', '4096th'])(
    'a note value base of %s',
    (noteBase) => {
      expect(schemaErrors(documentWith({ noteBase }))).toEqual([])
    },
  )
})
