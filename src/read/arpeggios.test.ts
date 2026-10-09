// A chord rolled rather than struck. MusicXML marks every note of the chord;
// MNX states it once on the measure, spanning the notes it runs between,
// because it is drawn as a line beside the chord rather than as a mark on any
// one note.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

function read(body: string) {
  const warnings = new WarningCollector()
  const score = readValid(
    '<score-partwise><part id="P1"><measure number="1">' +
      `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
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
        kind: 'rolled',
        span: { start: 'note1', end: 'note3' },
        direction: 'up',
        arrow: false,
      },
    ])
    expect(warnings).toEqual([])
  })

  // Sources mark every note of the chord.
  test('states one roll however many notes carry the mark', () => {
    const { measure } = read(head(ROLL) + member('E', ROLL) + member('G', ROLL))

    expect(measure?.arpeggios).toHaveLength(1)
  })

  test('reads one marked on only some of the chord', () => {
    const { measure } = read(head() + member('E', ROLL) + member('G'))

    expect(measure?.arpeggios).toHaveLength(1)
    // The span still covers the chord.
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note1', end: 'note3' })
  })

  // The span runs between the lowest note and the highest, not between the
  // first note written and the last. Sources write a chord's notes bottom up,
  // so only a chord written top down shows the difference.
  test('spans the lowest note to the highest, whatever order they are written', () => {
    const descending = (step: string, octave: number, chord: boolean) =>
      `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>` +
      `<octave>${String(octave)}</octave></pitch><duration>4</duration><type>quarter</type>` +
      `<notations>${ROLL}</notations></note>`
    const { measure } = read(
      descending('G', 4, false) + descending('E', 4, true) + descending('C', 4, true),
    )

    // note1 is G, note3 is C: the span runs from the lowest up.
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note3', end: 'note1' })
  })

  // Which note is higher depends on where it sits on the staff, so an octave
  // counts seven steps. A chord across the octave boundary tests this.
  test('orders a chord that crosses the octave boundary', () => {
    const at = (step: string, octave: number, chord: boolean) =>
      `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>` +
      `<octave>${String(octave)}</octave></pitch><duration>4</duration><type>quarter</type>` +
      `<notations>${ROLL}</notations></note>`
    const { measure } = read(at('B', 4, false) + at('C', 5, true))

    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note1', end: 'note2' })
  })

  // A roll going downwards is played highest first, and MNX names the
  // first-played note first, so the span runs the other way.
  test('runs the span the other way where the roll goes downwards', () => {
    const { measure } = read(
      head('<arpeggiate direction="down"/>') + member('E', '<arpeggiate direction="down"/>'),
    )

    expect(measure?.arpeggios[0]).toMatchObject({ kind: 'rolled', direction: 'down' })
    expect(measure?.arpeggios[0]?.span).toEqual({ start: 'note2', end: 'note1' })
  })

  // MusicXML states a direction only where an arrowhead is drawn.
  test('draws an arrowhead only where the source states a direction', () => {
    const { measure } = read(head(ROLL) + member('E', ROLL))
    const { measure: arrowed } = read(
      head('<arpeggiate direction="up"/>') + member('E', '<arpeggiate direction="up"/>'),
    )

    expect(measure?.arpeggios[0]).toMatchObject({ kind: 'rolled', arrow: false })
    expect(arrowed?.arpeggios[0]).toMatchObject({ kind: 'rolled', arrow: true })
  })

  // In MNX the key's presence draws an arrowhead, and its absence is the
  // ordinary drawing.
  test('writes the arrowhead only where the source states a direction', () => {
    const convert = (body: string) =>
      convertValid(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part>` +
          '</score-partwise>',
      )
    const plain = convert(head(ROLL) + member('E', ROLL))
    const arrowed = convert(
      head('<arpeggiate direction="up"/>') + member('E', '<arpeggiate direction="up"/>'),
    )

    expect(plain.mnx.parts[0]?.measures[0]?.arpeggios?.[0]?.arrow).toBeUndefined()
    expect(arrowed.mnx.parts[0]?.measures[0]?.arpeggios?.[0]?.arrow).toBe(true)
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

  // A marker with no number does not join a chord in another voice.
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
        kind: 'struck',
        span: { start: 'note1', end: 'note2' },
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
        kind: 'rolled',
        span: { start: 'note1', end: 'note1' },
        direction: 'up',
        arrow: false,
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

  // The marks on one rest are still that rest's one roll, so the loss is
  // stated once and there is no note to gather under it.
  test('says it once however many marks the rest carries', () => {
    const { measure, warnings } = read(
      '<note><rest/><duration>4</duration><type>quarter</type>' +
        `<notations>${ROLL}${ROLL}</notations></note>`,
    )

    expect(measure?.arpeggios).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['arpeggiate'])
  })
})

// Rolled and struck together are opposite instructions, so a chord marked as
// both is the source disagreeing with itself.
describe('a chord marked both ways at once', () => {
  test('keeps the first and says the other is lost', () => {
    const { measure, warnings } = read(head('<non-arpeggiate type="bottom"/>') + member('E', ROLL))

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })

  // Sources number one note of a chord and leave the next bare. Both marks
  // are the one roll drawn beside that chord, so they are read as one.
  test('keeps the first where one mark is numbered and the other is bare', () => {
    const { measure, warnings } = read(
      head('<non-arpeggiate number="1" type="bottom"/>') + member('E', ROLL),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })
})

describe('a rest carrying a mark that runs between notes', () => {
  test.each([
    ['rolled', '<arpeggiate/>', 'arpeggiate', 'A rest is marked as rolled'],
    ['struck together', '<non-arpeggiate type="bottom"/>', 'non-arpeggiate', 'A rest is bracketed'],
  ])('names the mark on a rest %s', (_what, mark, element, wording) => {
    const { warnings } = read(
      `<note><rest/><duration>4</duration><type>quarter</type><notations>${mark}</notations></note>`,
    )

    expect(warnings.map((w) => w.element)).toEqual([element])
    expect(warnings[0]?.message).toContain(wording)
  })
})

// The warning names the mark that is not converted.
describe('the mark a chord marked both ways reports', () => {
  test.each([
    ['a bracket after a roll', ROLL, '<non-arpeggiate type="bottom"/>', 'non-arpeggiate'],
    ['a roll after a bracket', '<non-arpeggiate type="bottom"/>', ROLL, 'arpeggiate'],
    [
      'a bracket numbered apart from the roll',
      '<arpeggiate number="1"/>',
      '<non-arpeggiate number="2" type="bottom"/>',
      'non-arpeggiate',
    ],
  ])('names %s', (_what, first, second, lost) => {
    const { warnings } = read(head(first) + member('E', second))

    expect(warnings.map((w) => [w.code, w.element])).toEqual([['inconsistent:arpeggio', lost]])
  })
})

// Marks on one chord are compared together whatever their numbers, so a roll
// and a bracket are not both written over the same notes.
describe('a chord marked both ways under different numbers', () => {
  test('keeps the first and says the other is lost', () => {
    const { measure, warnings } = read(
      head('<arpeggiate number="1"/>') +
        member('E', '<non-arpeggiate number="2" type="bottom"/>') +
        member('G', '<non-arpeggiate number="2" type="top"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]?.kind).toBe('rolled')
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })
})

// A pianist rolls the lower half of a chord and the upper half separately,
// and the source numbers the two halves differently. Each roll spans the
// notes that carry its own mark.
describe('a chord divided into two numbered rolls', () => {
  test('spans each roll over the notes that carried its mark', () => {
    const { measure, warnings } = read(
      head('<arpeggiate number="1"/>') +
        member('E', '<arpeggiate number="1"/>') +
        member('G', '<arpeggiate number="2"/>') +
        member('B', '<arpeggiate number="2"/>'),
    )

    expect(measure?.arpeggios.map((a) => a.span)).toEqual([
      { start: 'note1', end: 'note2' },
      { start: 'note3', end: 'note4' },
    ])
    expect(warnings).toEqual([])
  })

  test('writes both halves onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        head('<arpeggiate number="1"/>') +
        member('E', '<arpeggiate number="1"/>') +
        member('G', '<arpeggiate number="2"/>') +
        member('B', '<arpeggiate number="2"/>') +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.arpeggios).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A roll names the two notes it runs between, so those notes carry an id.
  // Ids are written only where something points at one. The schema cannot
  // tell a name that reaches a note from one that reaches nothing.
  test('names the notes each roll runs between', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        head('<arpeggiate number="1"/>') +
        member('E', '<arpeggiate number="1"/>') +
        member('G', '<arpeggiate number="2"/>') +
        member('B', '<arpeggiate number="2"/>') +
        '</measure></part></score-partwise>',
    )
    const measure = mnx.parts[0]?.measures[0]
    const event = measure?.sequences[0]?.content[0]
    const ids = event && 'notes' in event ? (event.notes ?? []).map((one) => one.id) : []

    expect(ids).toEqual(['note1', 'note2', 'note3', 'note4'])
    expect(measure?.arpeggios?.flatMap((one) => [one.span.start, one.span.end])).toEqual(ids)
  })

  // Where one half holds a single note, the roll spans that note to itself.
  // The source numbered one note of the chord and left its neighbour bare,
  // and the bare mark joins the first roll it can. This is a guess, not the
  // only reading.
  test('spans a half of one note to itself', () => {
    const { measure } = read(
      head('<arpeggiate number="1"/>') +
        member('E', ROLL) +
        member('G', '<arpeggiate number="2"/>') +
        member('B', ROLL),
    )

    expect(measure?.arpeggios.map((a) => a.span)).toEqual([
      { start: 'note1', end: 'note4' },
      { start: 'note3', end: 'note3' },
    ])
  })

  // The halves keep their own directions, since they are two rolls.
  test('keeps the direction each half states', () => {
    const { measure } = read(
      head('<arpeggiate number="1" direction="up"/>') +
        member('E', '<arpeggiate number="1" direction="up"/>') +
        member('G', '<arpeggiate number="2" direction="down"/>') +
        member('B', '<arpeggiate number="2" direction="down"/>'),
    )

    expect(measure?.arpeggios).toMatchObject([
      { kind: 'rolled', direction: 'up' },
      { kind: 'rolled', direction: 'down' },
    ])
    expect(measure?.arpeggios[1]?.span).toEqual({ start: 'note4', end: 'note3' })
  })
})

// A chord's marks are compared with each other, and only two directions
// that disagree are a roll going both ways. Any other pairing is one roll,
// drawn the one way, with the arrowhead either mark asks for.
describe('a chord whose marks agree', () => {
  test.each([
    ['one states the direction and the other states none', 'direction="up"', ''],
    ['the first states none and the second states it', '', 'direction="up"'],
    ['both state the same direction', 'direction="up"', 'direction="up"'],
  ])('states one roll where %s', (_what, first, second) => {
    const { measure, warnings } = read(
      head(`<arpeggiate ${first}/>`) + member('E', `<arpeggiate ${second}/>`),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    // MusicXML states a direction only where an arrowhead is drawn, so a mark
    // stating one draws the head however the mark beside it is written.
    expect(measure?.arpeggios[0]).toMatchObject({ kind: 'rolled', direction: 'up', arrow: true })
    expect(warnings).toEqual([])
  })
})

// Two chords sounding together under one number are one roll across both. A
// contradiction on one chord is a contradiction in the roll, and the other
// chord does not cancel it.
describe('a roll across two chords where one of them disagrees with itself', () => {
  const inVoice = (voice: string, step: string, octave: number, marks: string) =>
    `<note><pitch><step>${step}</step><octave>${String(octave)}</octave></pitch>` +
    `<duration>4</duration><type>quarter</type><voice>${voice}</voice>` +
    `<notations>${marks}</notations></note>`

  test('reports a chord rolled both ways beside one that is not', () => {
    const { measure, warnings } = read(
      inVoice('2', 'C', 3, '<arpeggiate number="1" direction="up"/>') +
        inVoice('2', 'E', 3, '<arpeggiate number="1" direction="down"/>').replace(
          '<note>',
          '<note><chord/>',
        ) +
        '<backup><duration>4</duration></backup>' +
        inVoice('1', 'G', 5, '<arpeggiate number="1"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })

  test('reports a chord struck together joined to one that is rolled', () => {
    const { measure, warnings } = read(
      inVoice('2', 'C', 3, '<non-arpeggiate number="1" type="bottom"/>') +
        inVoice('2', 'E', 3, '<non-arpeggiate number="1" type="top"/>').replace(
          '<note>',
          '<note><chord/>',
        ) +
        '<backup><duration>4</duration></backup>' +
        inVoice('1', 'G', 5, '<arpeggiate number="1"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:arpeggio'])
  })
})

// Marks are compared with the marks of their own chord. Compared with
// the first chord in the measure, a rolled chord and a struck one side by
// side would each read as the other's contradiction.
describe('two chords marked in opposite ways', () => {
  test('keeps a rolled chord and a struck one in one measure', () => {
    const { measure, warnings } = read(
      head(ROLL) +
        member('E', ROLL) +
        head('<non-arpeggiate type="bottom"/>', 'D') +
        member('F', '<non-arpeggiate type="top"/>'),
    )

    expect(measure?.arpeggios.map((a) => a.kind)).toEqual(['rolled', 'struck'])
    expect(warnings).toEqual([])
  })

  // MNX keeps the two apart: a rolled chord under arpeggios, a chord bracketed
  // as struck together under nonArpeggios.
  test('writes each under its own key', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        head(ROLL) +
        member('E', ROLL) +
        head('<non-arpeggiate type="bottom"/>', 'D') +
        member('F', '<non-arpeggiate type="top"/>') +
        '</measure></part></score-partwise>',
    )
    const measure = mnx.parts[0]?.measures[0]

    expect(measure?.arpeggios?.map((a) => a.span)).toEqual([{ start: 'note1', end: 'note2' }])
    expect(measure?.nonArpeggios?.map((a) => a.span)).toEqual([{ start: 'note3', end: 'note4' }])
  })
})

// One roll cannot go both ways.
describe('a chord rolled both ways at once', () => {
  test('keeps the first direction and reports the other', () => {
    const { measure, warnings } = read(
      head('<arpeggiate direction="up"/>') +
        member('E', '<arpeggiate number="1" direction="down"/>'),
    )

    expect(measure?.arpeggios).toHaveLength(1)
    expect(measure?.arpeggios[0]).toMatchObject({ kind: 'rolled', direction: 'up' })
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
