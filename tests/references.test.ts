// The id reference check every conversion output in a test goes through. One
// document names each kind of reference; each case breaks one of them.

import { describe, expect, test } from 'vitest'
import type { MNXDocument } from '../src/index.js'
import { danglingReferences } from './support/references.js'

const at = { fraction: [0, 1] as [number, number] }
const quarter = { base: 'quarter' as const }

function document(): MNXDocument {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: 'm1' }, { id: 'm2' }],
      sounds: { drum: { name: 'Drum' } },
    },
    layouts: [
      {
        id: 'layout',
        content: [{ type: 'group', content: [{ type: 'staff', sources: [{ part: 'P1' }] }] }],
      },
    ],
    parts: [
      {
        id: 'P1',
        kit: { snare: { staffPosition: 0, sound: 'drum' } },
        measures: [
          {
            beams: [{ events: ['e1', 'e2'], beams: [{ events: ['e1'] }] }],
            arpeggios: [{ position: at, span: { start: 'n1', end: 'k1' } }],
            nonArpeggios: [{ position: at, span: { start: 'n1', end: 'n2' } }],
            dynamics: [
              {
                type: 'gradual',
                position: at,
                end: { measure: 'm2', position: at },
                wedgeType: 'increasing',
              },
            ],
            ottavas: [{ position: at, end: { measure: 'm2', position: at }, value: 1 }],
            sequences: [
              {
                content: [
                  {
                    id: 'e1',
                    duration: quarter,
                    slurs: [{ target: 'e3' }],
                    notes: [
                      { id: 'n1', pitch: { step: 'C', octave: 4 }, ties: [{ target: 'n3' }] },
                    ],
                  },
                  {
                    type: 'tuplet',
                    inner: { duration: quarter, multiple: 3 },
                    outer: { duration: quarter, multiple: 2 },
                    content: [
                      {
                        id: 'e2',
                        duration: quarter,
                        notes: [{ id: 'n2', pitch: { step: 'D', octave: 4 } }],
                        kitNotes: [{ id: 'k1', kitComponent: 'snare', ties: [{ target: 'k2' }] }],
                      },
                    ],
                  },
                  { type: 'space', duration: [1, 4] },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    id: 'e3',
                    duration: quarter,
                    notes: [{ id: 'n3', pitch: { step: 'C', octave: 4 } }],
                    kitNotes: [{ id: 'k2', kitComponent: 'snare' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    scores: [
      {
        name: 'Score',
        layout: 'layout',
        multimeasureRests: [{ start: 'm1', duration: 2 }],
        pages: [{ systems: [{ measure: 'm1' }] }],
      },
    ],
  }
}

/** The first measure of the one part, which holds most of the references. */
function first(mnx: MNXDocument): MNXDocument['parts'][number]['measures'][number] {
  const measure = mnx.parts[0]?.measures[0]
  if (measure === undefined) throw new Error('The document has no first measure.')
  return measure
}

test('a document whose every reference leads somewhere has none dangling', () => {
  expect(danglingReferences(document())).toEqual([])
})

describe('reports a reference that leads nowhere', () => {
  const cases: readonly [string, (mnx: MNXDocument) => void, string][] = [
    [
      'a beam naming an event of another measure',
      (mnx) => {
        first(mnx).beams = [{ events: ['e1', 'e3'] }]
      },
      'part 1 measure 1 beam names "e3"',
    ],
    [
      'a secondary beam',
      (mnx) => {
        first(mnx).beams = [{ events: ['e1', 'e2'], beams: [{ events: ['x'] }] }]
      },
      'part 1 measure 1 beam names "x"',
    ],
    [
      'an arpeggio naming a note of another measure',
      (mnx) => {
        first(mnx).arpeggios = [{ position: at, span: { start: 'n1', end: 'n3' } }]
      },
      'part 1 measure 1 arpeggio end names "n3"',
    ],
    [
      'the start of a chord struck together',
      (mnx) => {
        first(mnx).nonArpeggios = [{ position: at, span: { start: 'e1', end: 'n2' } }]
      },
      'part 1 measure 1 arpeggio start names "e1"',
    ],
    [
      'a hairpin end',
      (mnx) => {
        first(mnx).dynamics = [
          {
            type: 'gradual',
            position: at,
            end: { measure: 'm9', position: at },
            wedgeType: 'increasing',
          },
        ]
      },
      'part 1 measure 1 hairpin end names "m9"',
    ],
    [
      'an octave shift end',
      (mnx) => {
        first(mnx).ottavas = [{ position: at, end: { measure: 'm9', position: at }, value: 1 }]
      },
      'part 1 measure 1 octave shift end names "m9"',
    ],
    [
      'a slur naming a note rather than an event',
      (mnx) => {
        const event = first(mnx).sequences[0]?.content[0]
        if (event && !('content' in event) && event.type !== 'space')
          event.slurs = [{ target: 'n3' }]
      },
      'part 1 measure 1 slur names "n3"',
    ],
    [
      'a tie naming a kit note',
      (mnx) => {
        const event = first(mnx).sequences[0]?.content[0]
        const note = event && 'notes' in event ? event.notes?.[0] : undefined
        if (note) note.ties = [{ target: 'k2' }]
      },
      'part 1 measure 1 tie names "k2"',
    ],
    [
      'a kit note naming a component the kit lacks',
      (mnx) => {
        const second = mnx.parts[0]?.measures[1]?.sequences[0]?.content[0]
        if (second && 'kitNotes' in second) second.kitNotes = [{ id: 'k2', kitComponent: 'tom' }]
      },
      'part 1 measure 2 kit note names "tom"',
    ],
    [
      'a kit note tie naming a note',
      (mnx) => {
        const second = mnx.parts[0]?.measures[1]?.sequences[0]?.content[0]
        if (second && 'kitNotes' in second) {
          second.kitNotes = [{ id: 'k2', kitComponent: 'snare', ties: [{ target: 'n1' }] }]
        }
      },
      'part 1 measure 2 kit note tie names "n1"',
    ],
    [
      'a kit component naming a sound the score lacks',
      (mnx) => {
        mnx.global.sounds = {}
      },
      'part 1 kit component snare sound names "drum"',
    ],
    [
      'a staff naming a part, inside a group',
      (mnx) => {
        const part = mnx.parts[0]
        if (part) part.id = 'P2'
      },
      'layout layout staff names "P1"',
    ],
    [
      'a score naming a layout',
      (mnx) => {
        mnx.layouts = [{ content: [] }]
      },
      'score 1 layout names "layout"',
    ],
    [
      'a multi-measure rest start',
      (mnx) => {
        const score = mnx.scores?.[0]
        if (score) score.multimeasureRests = [{ start: 'm9', duration: 2 }]
      },
      'score 1 multi-measure rest names "m9"',
    ],
    [
      'a system start',
      (mnx) => {
        const score = mnx.scores?.[0]
        if (score) score.pages = [{ systems: [{ measure: 'm9' }] }]
      },
      'score 1 system names "m9"',
    ],
  ]

  test.each(cases)('%s', (_name, breaks, reported) => {
    const mnx = document()
    breaks(mnx)
    expect(danglingReferences(mnx)).toEqual([reported])
  })
})
