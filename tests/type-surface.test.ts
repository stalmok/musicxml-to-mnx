// The MNX types in src/types/mnx.ts are hand-written against the vendored
// schema, and the corpus validates everything the writer emits against it. What
// that does not reach is the surface the types declare but the writer does not
// yet produce: a tie targetType other than crossVoice, a relative dynamic, the
// useBeams support flag, the far ends of the note-value scale.
//
// These fixtures exercise that surface. Each is typed as an MNXDocument, so
// TypeScript holds it to the declared shape, and schemaErrors holds the
// declared shape to MNX. A type that names a value the schema forbids fails
// here, rather than waiting for the day a writer change starts emitting it.

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

/**
 * A minimal document the schema accepts, with hooks for the parts a fixture
 * varies. One part, one voice, one quarter note on middle C.
 */
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

  // Every other sequence item states its kind and an event may. The writer
  // leaves it off, so a document stating it is legal MNX the types have to
  // accept for a consumer to switch on the kind at all.
  test('the event discriminant', () => {
    expect(schemaErrors(documentWith({ eventType: 'event' }))).toEqual([])
  })

  // Walking a sequence is the first thing a consumer does with a document,
  // and telling the items apart means switching on the kind. This compiles
  // only while every item states one and an event's is its own value, so a
  // regression there fails the typecheck rather than waiting on a consumer.
  // An event's kind is optional, so the one it leaves off is the default arm
  // rather than a case of its own.
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
