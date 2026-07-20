// A chord rolled rather than struck. MusicXML marks every note of the chord;
// MNX states it once on the measure, spanning the notes it runs between,
// because it is drawn as a line beside the chord rather than as a mark on any
// one note.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

function read(body: string) {
  const warnings = new WarningCollector()
  const score = readScore(
    parseXmlRoot(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
    ),
    warnings,
  )
  return { measure: score.parts[0]?.measures[0], warnings: warnings.list() }
}

const head = (notations = '', step = 'C') =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
  `<type>quarter</type>${notations ? `<notations>${notations}</notations>` : ''}</note>`

const member = (step: string, notations = '') =>
  `<note><chord/><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
  `<type>quarter</type>${notations ? `<notations>${notations}</notations>` : ''}</note>`

const ROLL = '<arpeggiate/>'

describe('a rolled chord', () => {
  test('spans the notes it runs between, lowest to highest', () => {
    const { measure, warnings } = read(head(ROLL) + member('E', ROLL) + member('G', ROLL))

    expect(measure?.arpeggios).toEqual([
      {
        position: { num: 0, den: 1 },
        span: { start: 'note1', end: 'note3' },
        direction: undefined,
        struck: false,
      },
    ])
    expect(warnings).toEqual([])
  })

  // Every note of the chord carries the mark, and the corpus writes it that
  // way throughout. One arpeggio comes out of them, not one per note.
  test('states one roll however many notes carry the mark', () => {
    const { measure } = read(head(ROLL) + member('E', ROLL) + member('G', ROLL))

    expect(measure?.arpeggios).toHaveLength(1)
  })

  test('reads one marked on only some of the chord', () => {
    const { measure } = read(head() + member('E', ROLL) + member('G'))

    expect(measure?.arpeggios).toHaveLength(1)
    // The span still covers the chord, because that is what is drawn.
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note1', end: 'note3' })
  })

  test('keeps which way it is rolled', () => {
    const { measure } = read(
      head('<arpeggiate direction="down"/>') + member('E', '<arpeggiate direction="down"/>'),
    )

    expect(measure?.arpeggios[0]?.direction).toBe('down')
  })

  test('sits at the place in the measure the chord does', () => {
    const { measure } = read(head() + head(ROLL) + member('E', ROLL))

    expect(measure?.arpeggios[0]?.position).toEqual({ num: 1, den: 4 })
  })

  test('states one per chord where a measure holds several', () => {
    const { measure } = read(head(ROLL) + member('E', ROLL) + head(ROLL, 'D') + member('F', ROLL))

    expect(measure?.arpeggios.map((a) => a.position)).toEqual([
      { num: 0, den: 1 },
      { num: 1, den: 4 },
    ])
  })

  test('states none where no note is marked', () => {
    const { measure } = read(head() + member('E'))

    expect(measure?.arpeggios).toEqual([])
  })
})

// <non-arpeggiate> is the opposite instruction: a bracket saying the notes
// are struck together. MNX keeps the two in separate lists.
describe('a chord bracketed as struck together', () => {
  test('is kept apart from the rolled ones', () => {
    const { measure, warnings } = read(
      head('<non-arpeggiate type="bottom"/>') + member('E', '<non-arpeggiate type="top"/>'),
    )

    expect(measure?.arpeggios).toEqual([
      {
        position: { num: 0, den: 1 },
        span: { start: 'note1', end: 'note2' },
        direction: undefined,
        struck: true,
      },
    ])
    expect(warnings).toEqual([])
  })
})

// A rest cannot be rolled, and a mark on one spans nothing.
describe('a roll marked on something with no notes', () => {
  test('states nothing', () => {
    const { measure } = read(`<note><rest/><duration>4</duration><type>quarter</type>
      <notations>${ROLL}</notations></note>`)

    expect(measure?.arpeggios).toEqual([])
  })
})
