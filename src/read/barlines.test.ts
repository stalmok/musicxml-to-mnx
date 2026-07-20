// The line at the edge of a measure, the repeat signs on it, and the bracket
// over a first or second time ending. MusicXML hangs all of these off one
// <barline> at the left or right edge of a measure; MNX states them on the
// score's measure, because a barline is the whole score's.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

function read(...bodies: string[]) {
  const warnings = new WarningCollector()
  const measures = bodies
    .map(
      (body, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
        `${body}</measure>`,
    )
    .join('')
  const score = readScore(
    parseXmlRoot(`<score-partwise><part id="P1">${measures}</part></score-partwise>`),
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
})

describe('repeat signs', () => {
  test('opens a repeat on the measure whose left edge carries one', () => {
    const { globals, warnings } = read(left('<repeat direction="forward"/>') + NOTE)

    expect(globals[0]?.repeatStart).toBe(true)
    expect(warnings).toEqual([])
  })

  test('closes one on the measure whose right edge carries one', () => {
    const { globals } = read(NOTE + right('<repeat direction="backward"/>'))

    expect(globals[0]?.repeatEnd).toEqual({ times: undefined })
  })

  test('keeps how many times the passage is played', () => {
    const { globals } = read(NOTE + right('<repeat direction="backward" times="4"/>'))

    expect(globals[0]?.repeatEnd?.times).toBe(4)
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

  // MusicXML writes the times as a comma-separated list.
  test('reads every time the bracket covers', () => {
    const { globals } = read(
      left('<ending number="1, 2, 4" type="start"/>') +
        NOTE +
        right('<ending number="1, 2, 4" type="stop"/>'),
    )

    expect(globals[0]?.ending?.numbers).toEqual([1, 2, 4])
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

  test('reports an ending that stops where none had started', () => {
    const { globals, warnings } = read(NOTE + right('<ending number="1" type="stop"/>'))

    expect(globals[0]?.ending).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
  })

  test('reports an ending that nothing ends', () => {
    const { warnings } = read(left('<ending number="1" type="start"/>') + NOTE)

    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
    expect(warnings[0]?.message).toContain('nothing ends it')
  })

  test('reports an ending that starts while one is already open', () => {
    const { globals, warnings } = read(
      left('<ending number="1" type="start"/>') + NOTE,
      left('<ending number="2" type="start"/>') + NOTE + right('<ending number="2" type="stop"/>'),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unclosed:ending'])
    // The second one still resolves; only the abandoned first is lost.
    expect(globals[1]?.ending?.numbers).toEqual([2])
  })

  test('reports a number that is not a list of numbers', () => {
    const { globals, warnings } = read(
      left('<ending number="first" type="start"/>') +
        NOTE +
        right('<ending number="first" type="stop"/>'),
    )

    expect(globals[0]?.ending?.numbers).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['ending'])
  })

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
describe('a fermata over the barline', () => {
  test('states it on the score’s measure', () => {
    const { globals, warnings } = read(NOTE + right('<fermata type="upright"/>'))

    expect(globals[0]?.fermata).toMatchObject({ pointing: 'up' })
    expect(warnings).toEqual([])
  })
})

// Everything below was found by a fresh-context review of the milestone.
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

  // A fermata at the opening edge is held over the barline closing the measure
  // before, and moving it there would be a guess about what the source meant.
  test('reports a fermata written at the start of a measure', () => {
    const { globals, warnings } = read(left('<fermata/>') + NOTE)

    expect(globals[0]?.fermata).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  // Both formats allow any whole number of repeats, so an odd count is worth
  // reporting rather than refusing a whole score over.
  test.each(['1', '0', 'lots'])(
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
