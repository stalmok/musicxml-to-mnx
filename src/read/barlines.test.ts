// The line at the edge of a measure, the repeat signs on it, and the bracket
// over a first or second time ending. MusicXML hangs all of these off one
// <barline> at the left or right edge of a measure; MNX states them on the
// score's measure, because a barline is the whole score's.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

// Each measure is written on its own line, so a warning naming a line names
// which measure's element it came from. Written as one line, every element in
// the document sat on line 1 and an assertion on the line said only that
// there was one.
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
  const score = readScore(
    parseXmlRoot(`<score-partwise><part id="P1">\n${measures}\n</part></score-partwise>`),
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
  // edge has nowhere to go.
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
  // not restated. Any other style there is the source's own statement, with
  // nowhere to go, and says so like any opening style.
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

  // Nothing said that a barline which is not a repeat start does not open
  // one, so the reader could have opened a repeat on every measure and the
  // suite would have stayed green. Each of the three ways of not opening one
  // is stated here.
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

  // A standard backward repeat is written light-heavy plus the repeat: the
  // light-heavy is how the closing sign draws, and repeatEnd already says
  // to draw it. Stating final too asserts a barline the source never
  // states, and a consumer honouring both draws the thin-thick twice.
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

  // A backward repeat at the opening edge is a statement the format allows
  // and the music cannot mean. The style there still has nowhere to go, and
  // still says so.
  test('still reports an opening-edge style beside a backward repeat', () => {
    const { globals, warnings } = read(
      left('<bar-style>light-heavy</bar-style><repeat direction="backward"/>') + NOTE,
    )

    expect(globals[0]?.barline).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
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
  // no repeat beside it, a heavy-light at the opening edge is the source's
  // own statement, with nowhere to go, and says so like any opening style.
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
  // MusicXML's repeat runs forward or backward. Anything else names no sign
  // this converter draws, and the report says which word was written.
  test('reports a repeat in a direction it does not know, and names it', () => {
    const { warnings } = read(NOTE + right('<repeat direction="sideways"/>'))

    expect(warnings.map((one) => one.message)).toEqual([
      'A <repeat> in direction "sideways" is not converted yet.',
    ])
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
  // three are reported long after the <ending> is gone. Each names the
  // measure the loss is in and the line the bracket's edge was written on,
  // which is the only thing that sends a reader to it. No vendored song
  // carries a broken bracket, so nothing else states it.
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

  // "first" fails the shape. "+1" and "1e2" are safe integers to Number() that
  // the regex refuses, and twenty digits is digits that cannot be read back
  // exactly, so each check rejects a case the others accept. Both formats
  // count the times from 1, so "0" states no time, and a list holding one
  // states none either.
  test.each(['first', '+1', '1e2', '99999999999999999999', '0', '1, 2, 0'])(
    'reports a number of "%s", which is not a list of times counted from 1',
    (numbers) => {
      const { globals, warnings } = read(
        left(`<ending number="${numbers}" type="start"/>`) +
          NOTE +
          right(`<ending number="${numbers}" type="stop"/>`),
      )

      expect(globals[0]?.ending?.numbers).toEqual([])
      expect(warnings.map((w) => w.element)).toEqual(['ending'])
    },
  )

  // MusicXML lets an ending state no number at all, and writes the stop with
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

    expect(warnings.map((w) => w.element)).toEqual(['ending'])
    expect(warnings[0]?.message).toContain('of type ""')
  })

  test('reports an ending of a type it does not know', () => {
    const { warnings } = read(NOTE + right('<ending number="1" type="wibble"/>'))

    expect(warnings.map((w) => w.element)).toEqual(['ending'])
  })
})

// MusicXML writes the same <fermata> over a note and over a barline, and MNX
// reads it the same way in both places.
// MusicXML also lets the sign a D.S. jumps back to sit on the barline itself
// rather than between the notes as a direction. It is the same sign, so it
// goes on the score's measure the same way.
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
      '<direction><direction-type><segno/></direction-type></direction>' + NOTE + right('<segno/>'),
    )

    expect(globals[0]?.segno).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
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

  // The one warning accounts for the whole partway barline, so a segno on it
  // is neither converted nor reported a second time.
  test('reports a partway barline carrying a segno once, converting none of it', () => {
    const { globals, warnings } = read(
      NOTE + '<barline location="middle"><segno/></barline>' + NOTE,
    )

    expect(globals[0]?.segno).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:barline'])
  })

  // A fermata at the opening edge is held over the barline closing the measure
  // before, and moving it there would be a guess about what the source meant.
  // The one warning accounts for the whole mark, the way it faces included.
  test('reports a fermata written at the start of a measure', () => {
    const { globals, warnings } = read(left('<fermata type="upright"/>') + NOTE)

    expect(globals[0]?.fermata).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  // Both formats allow any whole number of repeats, so an odd count is worth
  // reporting rather than refusing a whole score over.
  // "lots" fails both halves of the guard, which is why it said nothing about
  // either. "+2" and "1e2" are safe integers to Number() that the regex
  // refuses, and twenty digits is a string the regex accepts that cannot be
  // read back exactly, so each half now rejects a case the other accepts.
  test.each(['1', '0', 'lots', '+2', '1e2', '99999999999999999999'])(
    'reports a repeat played "%s" times, keeping the repeat',
    (times) => {
      const { globals, warnings } = read(
        NOTE + right(`<repeat direction="backward" times="${times}"/>`),
      )

      expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
      expect(warnings.map((w) => w.element)).toEqual(['repeat'])
    },
  )
})
