// The line at the edge of a measure, the repeat signs on it, and the bracket
// over a first or second time ending. MusicXML hangs all of these off one
// <barline> at the left or right edge of a measure; MNX states them on the
// score's measure, because a barline is the whole score's.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

// Each measure is written on its own line, so a warning's line names the
// measure element it came from.
function read(...bodies: string[]) {
  const warnings = new WarningCollector()
  const measures = bodies
    .map(
      (body, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
        `${body}</measure>`,
    )
    .join('\n')
  const score = readValid(
    `<score-partwise><part id="P1">\n${measures}\n</part></score-partwise>`,
    warnings,
  )
  return { globals: score.globalMeasures, warnings: warnings.list() }
}

const right = (inner: string) => `<barline location="right">${inner}</barline>`
const left = (inner: string) => `<barline location="left">${inner}</barline>`

describe('the line closing a measure', () => {
  test.each([
    ['regular', 'regular'],
    ['dotted', 'dotted'],
    ['dashed', 'dashed'],
    ['heavy', 'heavy'],
    ['light-light', 'double'],
    ['light-heavy', 'final'],
    ['heavy-light', 'heavyLight'],
    ['heavy-heavy', 'heavyHeavy'],
    ['tick', 'tick'],
    ['short', 'short'],
    ['none', 'noBarline'],
  ])('reads "%s" as MNX names it', (written, expected) => {
    const { globals, warnings } = read(NOTE + right(`<bar-style>${written}</bar-style>`))

    expect(globals[0]?.barline).toBe(expected)
    expect(warnings).toEqual([])
  })

  test('reports a bar style MNX has no line for', () => {
    const { globals, warnings } = read(NOTE + right('<bar-style>wibble</bar-style>'))

    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['bar-style'])
  })

  // MNX states the line that closes a measure, so one drawn at the opening
  // edge has no home.
  test('reports a bar style drawn at the opening edge', () => {
    const { globals, warnings } = read(left('<bar-style>heavy</bar-style>') + NOTE)

    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  // MusicXML's default location is the right edge, which is the closing line.
  test('takes a barline that states no location as the closing one', () => {
    const { globals, warnings } = read(
      NOTE + '<barline><bar-style>light-heavy</bar-style></barline>',
    )

    expect(globals[0]?.barline).toBe('final')
    expect(warnings).toEqual([])
  })

  test('states none where the source draws a plain one', () => {
    const { globals } = read(NOTE)

    expect(globals[0]?.barline).toBeUndefined()
  })

  // MusicXML allows several <barline> elements per measure, one per edge. Two
  // at the closing edge stating different styles disagree about the one line
  // MNX can draw there.
  test('reports a second closing barline stating a different style', () => {
    const { globals, warnings } = read(
      NOTE + right('<bar-style>light-heavy</bar-style>') + right('<bar-style>regular</bar-style>'),
    )

    expect(globals[0]?.barline).toBe('final')
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:barline'])
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: expect.any(Number) })
  })

  test('says nothing where a second closing barline restates the same style', () => {
    const { globals, warnings } = read(
      NOTE +
        right('<bar-style>light-heavy</bar-style>') +
        right('<bar-style>light-heavy</bar-style>'),
    )

    expect(globals[0]?.barline).toBe('final')
    expect(warnings).toEqual([])
  })

  // A left and a right barline are the measure's two edges, not two claims
  // about one line.
  test('says nothing about a styled opening repeat beside a styled closing line', () => {
    const { globals, warnings } = read(
      left('<bar-style>heavy-light</bar-style><repeat direction="forward"/>') +
        NOTE +
        right('<bar-style>light-heavy</bar-style>'),
    )

    expect(globals[0]?.barline).toBe('final')
    expect(globals[0]?.repeatStart).toBe(true)
    expect(warnings).toEqual([])
  })
})

describe('repeat signs', () => {
  // A heavy-light at the opening edge is how a repeat start draws, and is
  // not restated. Any other style there has no home and is reported.
  test('reports an opening style a repeat start does not draw', () => {
    const { globals, warnings } = read(
      left('<bar-style>dotted</bar-style><repeat direction="forward"/>') + NOTE,
    )

    expect(globals[0]?.repeatStart).toBe(true)
    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  test('opens a repeat on the measure whose left edge carries one', () => {
    const { globals, warnings } = read(left('<repeat direction="forward"/>') + NOTE)

    expect(globals[0]?.repeatStart).toBe(true)
    expect(warnings).toEqual([])
  })

  test('closes one on the measure whose right edge carries one', () => {
    const { globals } = read(NOTE + right('<repeat direction="backward"/>'))

    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
  })

  test('opens no repeat on a measure carrying no barline at all', () => {
    const { globals } = read(NOTE)

    expect(globals[0]?.repeatStart).toBe(false)
  })

  test('opens no repeat on a measure closing one', () => {
    const { globals } = read(NOTE + right('<repeat direction="backward"/>'))

    expect(globals[0]?.repeatStart).toBe(false)
  })

  test('opens no repeat on a barline whose repeat direction is not one of the two', () => {
    const { globals, warnings } = read(left('<repeat direction="sideways"/>') + NOTE)

    expect(globals[0]?.repeatStart).toBe(false)
    expect(warnings.map((w) => w.element)).toEqual(['repeat'])
  })

  test('keeps how many times the passage is played', () => {
    const { globals } = read(NOTE + right('<repeat direction="backward" times="12"/>'))

    expect(globals[0]?.repeatEnd?.times).toBe(12)
  })

  // A standard backward repeat is written light-heavy plus the repeat. The
  // light-heavy is how the closing sign draws, and repeatEnd already draws
  // it. A consumer honouring both would draw the light-heavy twice.
  test('keeps only the repeat where light-heavy is how it draws', () => {
    const { globals, warnings } = read(
      NOTE + right('<bar-style>light-heavy</bar-style><repeat direction="backward"/>'),
    )

    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings).toEqual([])
  })

  // Any other style beside a closing repeat is the source's own statement,
  // not how the sign draws, and stays.
  test('keeps a style that is not how a closing repeat draws', () => {
    const { globals, warnings } = read(
      NOTE + right('<bar-style>heavy-heavy</bar-style><repeat direction="backward"/>'),
    )

    expect(globals[0]?.barline).toBe('heavyHeavy')
    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
    expect(warnings).toEqual([])
  })

  // MusicXML allows one <barline> per edge, but a source can still split
  // the style and the repeat across two elements at the closing edge. The
  // two say together what one element says alone, and read the same.
  test('keeps only the repeat when the style arrives in its own element', () => {
    const { globals, warnings } = read(
      NOTE + right('<bar-style>light-heavy</bar-style>') + right('<repeat direction="backward"/>'),
    )

    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('reports an opening-edge style and the backward repeat beside it', () => {
    const { globals, warnings } = read(
      left('<bar-style>light-heavy</bar-style><repeat direction="backward"/>') + NOTE,
    )

    expect(globals[0]?.barline).toBeUndefined()
    expect(globals[0]?.repeatEnd).toBeUndefined()
    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unsupported:element', 'repeat'],
      ['unrepresentable:barline', 'bar-style'],
    ])
  })

  // The sign sits on the barline the two measures share, so it belongs to
  // the neighbouring measure, not the one whose edge carries it.
  test('reports a backward repeat at the start of a measure', () => {
    const { globals, warnings } = read(
      NOTE,
      left('<repeat direction="backward" times="3"/>') + NOTE,
    )

    expect(globals.map((g) => g.repeatEnd)).toEqual([undefined, undefined])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported:element',
        element: 'repeat',
        message:
          'A backward repeat is written at the start of a measure. Moving it to the end ' +
          'of the measure before is not converted yet.',
        context: expect.objectContaining({ measure: 2 }),
      }),
    ])
  })

  test('reports a forward repeat at the end of a measure', () => {
    const { globals, warnings } = read(NOTE + right('<repeat direction="forward"/>'), NOTE)

    expect(globals.map((g) => g.repeatStart)).toEqual([false, false])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported:element',
        element: 'repeat',
        message:
          'A forward repeat is written at the end of a measure. Moving it to the start ' +
          'of the next is not converted yet.',
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  // MusicXML's default location is the right edge.
  test('reports a forward repeat on a barline that names no location', () => {
    const { globals, warnings } = read(NOTE + '<barline><repeat direction="forward"/></barline>')

    expect(globals[0]?.repeatStart).toBe(false)
    expect(warnings.map((w) => w.element)).toEqual(['repeat'])
  })

  test('reports a repeat in neither direction', () => {
    const { globals, warnings } = read(NOTE + right('<repeat/>'))

    expect(globals[0]?.repeatEnd).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['repeat'])
  })

  // A heavy-light at the opening edge is how a repeat start is drawn, and
  // repeatStart already says to draw one, so nothing is lost by it.
  test('says nothing about the bar style that draws a repeat start', () => {
    const { globals, warnings } = read(
      left('<bar-style>heavy-light</bar-style><repeat direction="forward"/>') + NOTE,
    )

    expect(globals[0]?.repeatStart).toBe(true)
    expect(warnings).toEqual([])
  })

  // The style is passed over only because the repeat start redraws it. With
  // no repeat beside it, a heavy-light at the opening edge has no home in MNX.
  test('reports a heavy-light opening edge with no repeat start beside it', () => {
    const { globals, warnings } = read(left('<bar-style>heavy-light</bar-style>') + NOTE)

    expect(globals[0]?.repeatStart).toBe(false)
    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })
})

describe('a mark on the opening edge of a measure', () => {
  // MNX states a fermata over the barline that closes a measure, so one
  // written at the opening edge would have to move to the measure before.
  test('reports a fermata written at the start of a measure', () => {
    const { globals, warnings } = read(
      NOTE,
      left('<fermata type="upright">normal</fermata>') + NOTE,
    )

    expect(globals[1]?.fermata).toBeUndefined()
    expect(warnings.map((one) => ({ code: one.code, element: one.element }))).toEqual([
      { code: 'unrepresentable:barline', element: 'fermata' },
    ])
    expect(warnings[0]?.message).toBe(
      'A fermata is written at the start of a measure, and MNX states one over the ' +
        'barline that closes a measure.',
    )
  })
})

describe('a repeat sign', () => {
  // MusicXML's repeat runs forward or backward.
  test('reports a repeat in a direction MusicXML does not define, and names it', () => {
    const { warnings } = read(NOTE + right('<repeat direction="sideways"/>'))

    expect(warnings.map((one) => [one.code, one.attribute, one.message])).toEqual([
      [
        'unresolved:attribute-value',
        'direction',
        'A <repeat> of direction "sideways" is not one MusicXML defines, and is not carried over.',
      ],
    ])
  })

  test('reports a repeat stating no direction', () => {
    const { warnings } = read(NOTE + right('<repeat/>'))

    expect(warnings.map((one) => [one.code, one.attribute, one.message])).toEqual([
      ['missing:attribute', undefined, 'A <repeat> states no direction, and is not carried over.'],
    ])
  })
})

describe('the text printed over an ending', () => {
  const ending = (numbers: string, text: string) =>
    read(
      left(`<ending number="${numbers}" type="start">${text}</ending>`) +
        NOTE +
        right(`<ending number="${numbers}" type="stop"/>`),
    )

  // MusicXML writes the text only where it differs from the numbers, but a
  // source often writes the numbers out anyway.
  test.each([
    ['1', ''],
    ['1', '  '],
    ['1', '1'],
    ['1', '1.'],
    ['1, 2', '1. 2.'],
    ['1, 2', '1.,2.'],
    ['1, 2', '1.2'],
    ['1, 2, 3', '1.2.3.'],
    ['1, 2, 3, 4', '1.-4.'],
    ['1, 2, 3', '1 – 3'],
    ['12', '12.'],
    ['10, 11, 12', '10.-12.'],
  ])('says nothing where %s is printed as "%s"', (numbers, text) => {
    const { globals, warnings } = ending(numbers, text)

    expect(globals[0]?.ending?.numbers).toEqual(numbers.split(',').map(Number))
    expect(warnings).toEqual([])
  })

  test.each([
    ['3', 'Pour finir'],
    ['1, 2', '1. and 2.'],
    ['1, 2', '[1. 2.]'],
    ['1', '1°'],
    ['1', '2.'],
    ['1', '1.-5.'],
    ['1, 2', '2. 1.'],
    ['1, 2', '1-'],
    ['1', '1-'],
    ['12', '1'],
    ['1, 2', '1.-2.-3.'],
    ['1', '.'],
    ['1', '1, 3-1'],
  ])('reports %s printed as "%s", and keeps the numbers', (numbers, text) => {
    const { globals, warnings } = ending(numbers, text)

    expect(globals[0]?.ending?.numbers).toEqual(numbers.split(',').map(Number))
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:ending-text',
        element: 'ending',
        message: `An ending is printed as "${text}", and MNX prints an ending's numbers only.`,
      }),
    ])
  })

  test('reports nothing more where the numbers are reported already', () => {
    const { warnings } = ending('0', '0')

    expect(warnings.map((w) => w.message)).toEqual([
      'An <ending> is numbered "0", which is not a list of times counted from 1.',
    ])
  })

  test('reports text where the ending states no number', () => {
    const { warnings } = read(
      left('<ending type="start">Pour finir</ending>') +
        NOTE +
        right('<ending number="1" type="stop"/>'),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:ending-text'])
  })

  test('reports text where the number is only spaces', () => {
    const { warnings } = ending(' ', 'Pour finir')

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:ending-text'])
  })

  test('does not count out a long range', () => {
    const { warnings } = ending('1', '1-999999999')

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:ending-text'])
  })
})

describe('first and second time endings', () => {
  test('states one on the measure it starts, as the measures it covers', () => {
    const { globals, warnings } = read(
      left('<ending number="1" type="start"/>') + NOTE,
      NOTE,
      NOTE + right('<ending number="1" type="stop"/>'),
    )

    expect(globals[0]?.ending).toEqual({ duration: 3, numbers: [1], open: false })
    expect(globals[2]?.ending).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('counts an ending that opens and closes in one measure as one measure', () => {
    const { globals } = read(
      left('<ending number="1" type="start"/>') + NOTE + right('<ending number="1" type="stop"/>'),
    )

    expect(globals[0]?.ending?.duration).toBe(1)
  })

  // The count is measured from the measure the bracket opened on, not from
  // the start of the score.
  test('counts an ending that opens and closes past the first measure', () => {
    const { globals } = read(
      NOTE,
      left('<ending number="1" type="start"/>') + NOTE + right('<ending number="1" type="stop"/>'),
    )

    expect(globals[1]?.ending?.duration).toBe(1)
  })

  // MusicXML writes the times as a comma-separated list.
  test('reads every time the bracket covers', () => {
    const { globals } = read(
      left('<ending number="1, 2, 12" type="start"/>') +
        NOTE +
        right('<ending number="1, 2, 12" type="stop"/>'),
    )

    expect(globals[0]?.ending?.numbers).toEqual([1, 2, 12])
  })

  // "discontinue" is how a final ending running to the end of the piece is
  // drawn: the bracket has no closing hook.
  test('marks a discontinued ending as open', () => {
    const { globals } = read(
      left('<ending number="2" type="start"/>') +
        NOTE +
        right('<ending number="2" type="discontinue"/>'),
    )

    expect(globals[0]?.ending?.open).toBe(true)
  })

  // A bracket is joined to its other end once the part is whole, so these
  // three are reported after the <ending> is read. Each names the measure the
  // loss is in and the line the bracket's edge was written on.
  test('reports an ending that stops where none had started', () => {
    const { globals, warnings } = read(NOTE + right('<ending number="1" type="stop"/>'))

    expect(globals[0]?.ending).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: 2 })
  })

  test('reports an ending that nothing ends', () => {
    const { warnings } = read(left('<ending number="1" type="start"/>') + NOTE)

    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
    expect(warnings[0]?.message).toContain('nothing ends it')
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: 2 })
  })

  test('reports an ending that starts while one is already open', () => {
    const { globals, warnings } = read(
      left('<ending number="1" type="start"/>') + NOTE,
      left('<ending number="2" type="start"/>') + NOTE + right('<ending number="2" type="stop"/>'),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
    // Named as the measure the abandoned bracket opened in, and the line it
    // was written on, not the ones of the bracket that displaced it: the
    // second measure is line 3.
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: 2 })
    // The second one still resolves; only the abandoned first is lost.
    expect(globals[1]?.ending?.numbers).toEqual([2])
  })

  // "first" fails the shape. "+1" and "1e2" are safe integers to Number()
  // that the regex refuses. Twenty digits cannot be read back exactly. Each
  // check rejects a case the others accept. Both formats count the times from
  // 1, so "0" states no time, and a list that holds "0" states none.
  // Every one but the twenty digits breaks MusicXML's pattern for an ending
  // number, which is the source's problem.
  test.each([
    ['first', 'unresolved:attribute-value'],
    ['+1', 'unresolved:attribute-value'],
    ['1e2', 'unresolved:attribute-value'],
    ['0', 'unresolved:attribute-value'],
    ['1, 2, 0', 'unresolved:attribute-value'],
    ['99999999999999999999', 'unsupported:element'],
  ])('reports a number of "%s" as %s', (numbers, code) => {
    const { globals, warnings } = read(
      left(`<ending number="${numbers}" type="start"/>`) +
        NOTE +
        right(`<ending number="${numbers}" type="stop"/>`),
    )

    expect(globals[0]?.ending?.numbers).toEqual([])
    expect(warnings.map((w) => [w.element, w.code])).toEqual([['ending', code]])
  })

  // MusicXML lets an ending state no number, and writes the stop with
  // an empty one.
  test('reads an ending that numbers no times', () => {
    const { globals, warnings } = read(
      left('<ending type="start"/>') + NOTE + right('<ending number="" type="stop"/>'),
    )

    expect(globals[0]?.ending).toEqual({ duration: 1, numbers: [], open: false })
    expect(warnings).toEqual([])
  })

  test('reports an ending stating no type at all', () => {
    const { warnings } = read(NOTE + right('<ending number="1"/>'))

    expect(warnings.map((w) => [w.element, w.code, w.message])).toEqual([
      ['ending', 'missing:attribute', 'An <ending> states no type, and is not carried over.'],
    ])
  })

  test('reports an ending of a type MusicXML does not define', () => {
    const { warnings } = read(NOTE + right('<ending number="1" type="wibble"/>'))

    expect(warnings.map((w) => [w.element, w.code, w.attribute])).toEqual([
      ['ending', 'unresolved:attribute-value', 'type'],
    ])
  })
})

// MusicXML lets the sign a D.S. jumps back to sit on the barline instead of
// between the notes as a direction. It is the same sign, so it goes on the
// score's measure the same way.
describe('a segno on the barline', () => {
  test('puts a segno on the opening barline at the start of the measure', () => {
    const { globals, warnings } = read(left('<segno/>') + NOTE)

    expect(globals[0]?.segno).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings).toEqual([])
  })

  test('puts a segno on the closing barline at the end of the measure', () => {
    const { globals, warnings } = read(NOTE + right('<segno/>'))

    expect(globals[0]?.segno).toEqual({ location: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  test('keeps the glyph and color the source draws it with', () => {
    const { globals, warnings } = read(
      left('<segno smufl="segnoSerpent1" color="#FF0000"/>') + NOTE,
    )

    expect(globals[0]?.segno).toEqual({
      location: { num: 0, den: 1 },
      glyph: 'segnoSerpent1',
      color: '#FF0000',
    })
    expect(warnings).toEqual([])
  })

  // The segno attribute on <barline> names the sign for playback, the same
  // way <sound segno> names one written as a direction. The name is never
  // written; it only matches a jump to the sign it returns to. Here it picks
  // the sign before the Fine, so the jump is a D.S. al Fine.
  test('names the sign from the segno attribute on the barline', () => {
    const { globals, warnings } = read(
      `<barline location="left" segno="verse"><segno/></barline>` + NOTE,
      NOTE + '<sound fine="yes"/>',
      `<barline location="left" segno="coda"><segno/></barline>` + NOTE,
      NOTE + '<sound dalsegno="verse"/>',
    )

    expect(globals[0]?.segno).toEqual({ location: { num: 0, den: 1 } })
    expect(globals[3]?.jump?.type).toBe('dsalfine')
    expect(warnings).toEqual([])
  })

  // A sign on the barline and one written as a direction at another point are
  // two claims about the one segno MNX states per measure.
  test('reports a second segno where a direction already drew one', () => {
    const { globals, warnings } = read(
      '<direction><direction-type><segno/></direction-type></direction>' +
        NOTE +
        '\n' +
        right('<segno/>'),
    )

    expect(globals[0]?.segno).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
    expect(warnings[0]?.context.line).toBe(3)
    expect(warnings[0]?.message).toContain('more than one segno')
  })

  test('writes a barline segno the spec schema accepts', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        `${left('<segno color="#FF0000"/>')}${NOTE}` +
        '</measure></part></score-partwise>',
    )

    expect(mnx.global.measures[0]?.segno).toEqual({
      location: { fraction: [0, 1] },
      color: '#FF0000',
    })
  })
})

describe('a fermata over the barline', () => {
  test('states it on the score’s measure', () => {
    const { globals, warnings } = read(NOTE + right('<fermata type="upright"/>'))

    expect(globals[0]?.fermata).toMatchObject({ pointing: 'up' })
    expect(warnings).toEqual([])
  })
})

describe('what a barline can say that MNX cannot', () => {
  // MusicXML allows a barline partway through a measure, which is neither the
  // line that opens one nor the line that closes it.
  test('reports a barline drawn partway through the measure, once', () => {
    const { globals, warnings } = read(
      NOTE + '<barline location="middle"><bar-style>light-light</bar-style></barline>' + NOTE,
    )

    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  test('reports a partway barline once, whatever it holds', () => {
    const { globals, warnings } = read(
      NOTE +
        '<barline location="middle"><bar-style>light-heavy</bar-style><segno/><fermata/>' +
        '<ending number="1" type="stop"/><repeat direction="backward"/></barline>' +
        NOTE,
    )

    expect(globals[0]).toMatchObject({ barline: undefined, segno: undefined, repeatEnd: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  test('reports a partway barline carrying a segno once, converting none of it', () => {
    const { globals, warnings } = read(
      NOTE + '<barline location="middle"><segno/></barline>' + NOTE,
    )

    expect(globals[0]?.segno).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  // A fermata at the opening edge is held over the barline that closes the
  // measure before. Moving it there would be a guess. The one warning covers
  // the whole mark, its facing included.
  test('reports a fermata written at the start of a measure', () => {
    const { globals, warnings } = read(left('<fermata type="upright"/>') + NOTE)

    expect(globals[0]?.fermata).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  // MusicXML counts repeats as a whole number from 0, and MNX from 2, so a
  // count of 0 or 1 is a limit of the format. A count that is not a whole
  // number is the source's problem. Twenty digits cannot be read back exactly,
  // which is this converter's gap. Each keeps the repeat.
  test.each([
    ['1', 'unrepresentable:repeat-times'],
    ['0', 'unrepresentable:repeat-times'],
    ['+1', 'unrepresentable:repeat-times'],
    ['lots', 'unresolved:attribute-value'],
    ['1e2', 'unresolved:attribute-value'],
    ['-3', 'unresolved:attribute-value'],
    ['99999999999999999999', 'unsupported:element'],
  ])('reports a repeat played "%s" times as %s, keeping the repeat', (times, code) => {
    const { globals, warnings } = read(
      NOTE + right(`<repeat direction="backward" times="${times}"/>`),
    )

    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
    expect(warnings.map((w) => [w.element, w.code])).toEqual([['repeat', code]])
  })

  test('says why a count of one is not carried over', () => {
    const { warnings } = read(NOTE + right('<repeat direction="backward" times="1"/>'))

    expect(warnings.map((w) => [w.attribute, w.message])).toEqual([
      [
        'times',
        'A <repeat> states a count of 1, and MNX plays a repeat at least 2 times, ' +
          'so the count is not carried over.',
      ],
    ])
  })

  test('reads a repeat played exactly as often as MNX allows', () => {
    const { globals, warnings } = read(NOTE + right('<repeat direction="backward" times="2"/>'))

    expect(globals[0]?.repeatEnd).toEqual({ times: 2 })
    expect(warnings).toEqual([])
  })

  // The count is an xs:nonNegativeInteger, which allows a leading plus sign.
  test('reads a repeat count written with a plus sign', () => {
    const { globals, warnings } = read(NOTE + right('<repeat direction="backward" times="+2"/>'))

    expect(globals[0]?.repeatEnd).toEqual({ times: 2 })
    expect(warnings).toEqual([])
  })
})

// MusicXML allows several <barline> elements in a measure. Two stating
// different marks of one kind disagree about the one mark MNX states there.
// Each second barline is written on a line of its own, so the warning's line
// names it.
describe('two barlines of one measure stating different marks', () => {
  test.each([
    [
      'repeat',
      'repeats',
      NOTE + right('<repeat direction="backward" times="2"/>'),
      right('<repeat direction="backward" times="3"/>'),
    ],
    [
      'fermata',
      'fermatas',
      NOTE + right('<fermata>normal</fermata>'),
      right('<fermata>angled</fermata>'),
    ],
    [
      'ending',
      'ending starts',
      left('<ending number="1" type="start"/>'),
      left('<ending number="2" type="start"/>') + NOTE + right('<ending number="1" type="stop"/>'),
    ],
    [
      'ending',
      'ending stops',
      left('<ending number="1" type="start"/>') + NOTE + right('<ending number="1" type="stop"/>'),
      right('<ending number="1" type="discontinue"/>'),
    ],
    // An ending start written on the closing barline is still the measure's
    // one ending start.
    [
      'ending',
      'ending starts',
      left('<ending number="1" type="start"/>') + NOTE,
      right('<ending number="2" type="start"/>'),
    ],
  ])('reports a second %s that states different %s', (element, kind, before, second) => {
    const { warnings } = read(`${before}\n${second}`)

    expect(warnings.filter((w) => w.code === 'inconsistent:barline')).toEqual([
      {
        code: 'inconsistent:barline',
        message:
          `Two barlines of this measure state different ${kind}. The first is the one ` +
          'converted.',
        element,
        attribute: undefined,
        context: { part: 'P1', measure: 1, line: 3 },
      },
    ])
  })

  test('keeps the first of each', () => {
    const { globals } = read(
      left('<ending number="1" type="start"/>') +
        left('<ending number="2" type="start"/>') +
        NOTE +
        right('<repeat direction="backward" times="2"/><fermata>normal</fermata>') +
        right('<ending number="1" type="stop"/>') +
        right('<ending number="1" type="discontinue"/>') +
        right('<repeat direction="backward" times="3"/><fermata>angled</fermata>'),
    )

    expect(globals[0]?.repeatEnd).toEqual({ times: 2 })
    expect(globals[0]?.fermata?.symbol).toBe('normal')
    expect(globals[0]?.ending).toMatchObject({ numbers: [1], open: false })
  })

  test('says nothing where a second barline restates the same marks', () => {
    const marks =
      '<ending number="1" type="stop"/><repeat direction="backward" times="2"/>' +
      '<fermata>normal</fermata>'
    const { warnings } = read(
      left('<ending number="1" type="start"/>') +
        left('<ending number="1" type="start"/>') +
        NOTE +
        right(marks) +
        right(marks),
    )

    expect(warnings).toEqual([])
  })
})
