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
  // MNX names the first-played note first, and MusicXML rolls from the lowest
  // note up unless it says otherwise.
  test('spans the notes it runs between, first-played first', () => {
    const { measure, warnings } = read(head(ROLL) + member('E', ROLL) + member('G', ROLL))

    expect(measure?.arpeggios).toEqual([
      {
        position: { num: 0, den: 1 },
        span: { start: 'note1', end: 'note3' },
        direction: 'up',
        arrow: false,
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

  // A roll going downwards is played highest first, and MNX names the
  // first-played note first, so the span runs the other way.
  test('runs the span the other way where the roll goes downwards', () => {
    const { measure } = read(
      head('<arpeggiate direction="down"/>') + member('E', '<arpeggiate direction="down"/>'),
    )

    expect(measure?.arpeggios[0]?.direction).toBe('down')
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note2', end: 'note1' })
  })

  // MusicXML states a direction only where an arrowhead is drawn.
  test('draws an arrowhead only where the source states a direction', () => {
    const { measure } = read(head(ROLL) + member('E', ROLL))
    const { measure: arrowed } = read(
      head('<arpeggiate direction="up"/>') + member('E', '<arpeggiate direction="up"/>'),
    )

    expect(measure?.arpeggios[0]?.arrow).toBe(false)
    expect(arrowed?.arpeggios[0]?.arrow).toBe(true)
  })

  // Two chords sounding together under one number are one roll across both,
  // which is how a pianist's two hands are rolled as one gesture.
  test('joins two chords that share a number into one roll', () => {
    const { measure, warnings } = read(
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>2</voice><notations><arpeggiate number="1"/></notations></note>` +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>1</voice><notations><arpeggiate number="1"/></notations></note>`,
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note1', end: 'note2' })
    expect(warnings).toEqual([])
  })

  test('keeps two chords under different numbers as two rolls', () => {
    const { measure } = read(
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>2</voice><notations><arpeggiate number="1"/></notations></note>` +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>1</voice><notations><arpeggiate number="2"/></notations></note>`,
    )

    expect(measure?.arpeggios).toHaveLength(2)
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
        direction: 'up',
        arrow: false,
        struck: true,
      },
    ])
    expect(warnings).toEqual([])
  })
})

// A rest cannot be rolled, and a mark on one spans nothing.
describe('a roll marked on something with no notes', () => {
  test('states nothing, and says so', () => {
    const { measure, warnings } = read(
      `<note><rest/><duration>4</duration><type>quarter</type><notations>${ROLL}</notations></note>`,
    )

    expect(measure?.arpeggios).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['arpeggiate'])
  })
})

// Rolled and struck together are opposite instructions, and MNX keeps them in
// separate lists, so a chord marked as both cannot be stated as both.
describe('a chord marked both ways at once', () => {
  test('keeps the first and says the other is lost', () => {
    const { measure, warnings } = read(head('<non-arpeggiate type="bottom"/>') + member('E', ROLL))

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:arpeggio'])
  })
})
