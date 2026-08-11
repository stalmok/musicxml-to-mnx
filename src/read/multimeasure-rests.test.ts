// A multi-measure rest: several measures of silence drawn as one bar with a
// count over it. MusicXML states it as a <measure-style><multiple-rest> in
// the <attributes> of the measure it starts at, counting that measure; MNX
// states it on a score rendering, pointing at the global measure it begins
// in. The measures it spans stay ordinary measures in both formats.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const REST = '<note><rest measure="yes"/><duration>4</duration></note>'
const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>whole</type></note>'

const style = (inner: string, extra = '') => `<measure-style${extra}>${inner}</measure-style>`
const multipleRest = (count: string, extra = '') =>
  style(`<multiple-rest${extra}>${count}</multiple-rest>`)

/** A part whose measures each carry a body, plus extra <attributes> content. */
function part(id: string, measures: readonly { attributes?: string; body: string }[]) {
  const written = measures
    .map((measure, index) => {
      const declared =
        (index === 0
          ? '<divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'
          : '') + (measure.attributes ?? '')
      return (
        `<measure number="${String(index + 1)}">` +
        (declared ? `<attributes>${declared}</attributes>` : '') +
        `${measure.body}</measure>`
      )
    })
    .join('')
  return `<part id="${id}">${written}</part>`
}

function convert(...parts: string[]) {
  const { mnx, warnings } = convertMusicXML(`<score-partwise>${parts.join('')}</score-partwise>`)
  return { mnx, warnings }
}

const RESTING = [
  { attributes: multipleRest('3'), body: REST },
  { body: REST },
  { body: REST },
  { body: NOTE },
]

describe('a multi-measure rest', () => {
  test('converts one over three measures, keeping every measure', () => {
    const { mnx, warnings } = convert(part('P1', RESTING), part('P2', RESTING))

    const start = mnx.global.measures[0]?.id
    expect(start).toBeDefined()
    expect(mnx.scores).toEqual([{ name: 'Score', multimeasureRests: [{ start, duration: 3 }] }])
    // The spanned measures still exist, in the score and in every part.
    expect(mnx.global.measures).toHaveLength(4)
    expect(mnx.parts[0]?.measures).toHaveLength(4)
    expect(mnx.parts[1]?.measures).toHaveLength(4)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no scores object when the source draws none', () => {
    const { mnx, warnings } = convert(part('P1', [{ body: NOTE }]))

    expect(mnx.scores).toBeUndefined()
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Legal MusicXML: a single measure drawn in the multi-measure rest style.
  test('converts one spanning a single measure', () => {
    const { mnx, warnings } = convert(
      part('P1', [{ attributes: multipleRest('1'), body: REST }, { body: NOTE }]),
    )

    expect(mnx.scores?.[0]?.multimeasureRests).toEqual([
      { start: mnx.global.measures[0]?.id, duration: 1 },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // MusicXML says a positive integer; anything else is a broken document,
  // refused the way every unreadable number is.
  test.each([['0'], ['-2'], ['three']])('refuses a count of "%s"', (count) => {
    expect(() =>
      convert(part('P1', [{ attributes: multipleRest(count), body: REST }, { body: NOTE }])),
    ).toThrow(MusicXMLError)
  })

  test('converts the first count where staves state different ones', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        {
          attributes: multipleRest('3', '') + multipleRest('2', ''),
          body: REST,
        },
        { body: REST },
        { body: REST },
        { body: NOTE },
      ]),
    )

    expect(mnx.scores?.[0]?.multimeasureRests?.[0]?.duration).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:multimeasure-rest'])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('does not report a count restated per staff', () => {
    const { warnings } = convert(
      part('P1', [
        {
          attributes:
            '<staves>2</staves>' +
            style('<multiple-rest>3</multiple-rest>', ' number="1"') +
            style('<multiple-rest>3</multiple-rest>', ' number="2"'),
          body: REST,
        },
        { body: REST },
        { body: REST },
        { body: NOTE },
      ]),
    )

    expect(warnings).toEqual([])
  })

  test('converts the first count where parts state different ones', () => {
    const { mnx, warnings } = convert(
      part('P1', RESTING),
      part('P2', [
        { attributes: multipleRest('2'), body: REST },
        { body: REST },
        { body: REST },
        { body: NOTE },
      ]),
    )

    expect(mnx.scores?.[0]?.multimeasureRests?.[0]?.duration).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-multimeasure-rest'])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The choice between the single thick bar and the stacked church-rest
  // symbols. MNX has no way to state it, so the rest is drawn the default way.
  test('reports a rest drawn with symbols, and converts it anyway', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { attributes: multipleRest('3', ' use-symbols="yes"'), body: REST },
        { body: REST },
        { body: REST },
        { body: NOTE },
      ]),
    )

    expect(mnx.scores?.[0]?.multimeasureRests?.[0]?.duration).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:multiple-rest-symbols'])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Saying use-symbols="no" asks for the default drawing, so nothing is lost.
  test('does not report use-symbols="no"', () => {
    const { warnings } = convert(
      part('P1', [
        { attributes: multipleRest('3', ' use-symbols="no"'), body: REST },
        { body: REST },
        { body: REST },
        { body: NOTE },
      ]),
    )

    expect(warnings).toEqual([])
  })

  test('keeps reporting the other measure-style children', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { attributes: style('<slash type="start" use-stems="no"/>'), body: NOTE },
        { attributes: style('<beat-repeat type="start"/>'), body: NOTE },
      ]),
    )

    expect(mnx.scores).toBeUndefined()
    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unsupported:element', 'slash'],
      ['unsupported:element', 'beat-repeat'],
    ])
  })
})
