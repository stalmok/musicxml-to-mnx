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

  // A marker stating no number says nothing about another voice's chord.
  // Reading two of them as one roll ran a single gesture across both hands of
  // a grand staff, which neither voice asked for.
  test('keeps two chords in different voices apart where neither states a number', () => {
    const { measure, warnings } = read(
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>2</voice><notations>${ROLL}</notations></note>` +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><voice>1</voice><notations>${ROLL}</notations></note>`,
    )

    expect(measure?.arpeggios).toHaveLength(2)
    expect(measure?.arpeggios.map((a) => a.span)).toEqual([
      { start: 'note1', end: 'note1' },
      { start: 'note2', end: 'note2' },
    ])
    expect(warnings).toEqual([])
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

// The bracket runs between its bottom and top ends, each written on its own
// note. A lone marker with one note under it is half a bracket: written out,
// it would span the note to itself.
describe('a struck bracket with only one note under it', () => {
  test('is dropped, and says so', () => {
    const { measure, warnings } = read(head('<non-arpeggiate type="top"/>') + head('', 'D'))

    expect(measure?.arpeggios).toEqual([])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unclosed:spanner', element: 'non-arpeggiate' }),
    ])
  })

  // A chord's two ends arrive on one event, so a single chord under both
  // markers is a whole bracket, not half of one.
  test('keeps the bracket both of whose ends sit on one chord', () => {
    const { measure, warnings } = read(
      head('<non-arpeggiate type="bottom"/>') + member('E', '<non-arpeggiate type="top"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings).toEqual([])
  })
})

// A roll differs from the bracket: its squiggle is drawn beside whatever
// carries it, one notehead included, so a lone rolled note keeps its mark.
describe('a roll marked on a single note', () => {
  test('is kept, spanning the note itself', () => {
    const { measure, warnings } = read(head(ROLL))

    expect(measure?.arpeggios).toEqual([
      {
        position: { num: 0, den: 1 },
        span: { start: 'note1', end: 'note1' },
        direction: 'up',
        arrow: false,
        struck: false,
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

  // Sources number one note of a chord and leave the next bare. Both marks
  // are still the one roll drawn beside that chord, so they are read as one:
  // taken apart, they drew the same roll twice and the contradiction between
  // them went unreported.
  test('keeps the first where one mark is numbered and the other is bare', () => {
    const { measure, warnings } = read(
      head('<non-arpeggiate number="1" type="bottom"/>') + member('E', ROLL),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:arpeggio'])
  })
})

// Numbering the two marks differently used to put them in separate groups,
// where neither could see the other: the output carried a roll and a bracket
// over the same notes, contradicting each other with nothing said.
describe('a chord marked both ways under different numbers', () => {
  test('keeps the first and says the other is lost', () => {
    const { measure, warnings } = read(
      head('<arpeggiate number="1"/>') +
        member('E', '<non-arpeggiate number="2" type="bottom"/>') +
        member('G', '<non-arpeggiate number="2" type="top"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]?.struck).toBe(false)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:arpeggio'])
  })
})

// One roll cannot go both ways. The mark that loses used to be dropped with
// nothing said, once the two were read as one roll.
describe('a chord rolled both ways at once', () => {
  test('keeps the first direction and reports the other', () => {
    const { measure, warnings } = read(
      head('<arpeggiate direction="up"/>') +
        member('E', '<arpeggiate number="1" direction="down"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]?.direction).toBe('up')
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })
})

// A number joins a mark to another chord's; two marks on one chord are that
// chord's own roll however the source numbers them.
describe('one chord marked twice', () => {
  test('states one roll where one mark is numbered and the other is bare', () => {
    const { measure, warnings } = read(head('<arpeggiate number="1"/>') + member('E', ROLL))

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note1', end: 'note2' })
    expect(warnings).toEqual([])
  })

  // A grace chord takes no time, so it begins where the chord it decorates
  // does. They are still two chords, and each is rolled on its own.
  test('keeps a grace chord and the chord it decorates apart', () => {
    const grace =
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch>' +
      `<type>eighth</type><notations>${ROLL}</notations></note>`
    const { measure, warnings } = read(grace + head(ROLL) + member('E', ROLL))

    expect(measure?.arpeggios).toHaveLength(2)
    expect(measure?.arpeggios.map((a) => a.span)).toEqual([
      { start: 'note1', end: 'note1' },
      { start: 'note2', end: 'note3' },
    ])
    expect(warnings).toEqual([])
  })
})
