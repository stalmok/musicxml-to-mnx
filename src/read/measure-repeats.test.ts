// A measure repeat: a simile sign saying "repeat the previous measures".
// MusicXML states it as a <measure-style><measure-repeat> in the <attributes>
// of the first measure drawing the sign, running until a stop names the first
// measure that no longer draws it, or to the end of the part. MNX states it
// on the part's measure, and for a sign spanning several measures only the
// first of them carries it. MusicXML asks for the repeated music to be
// written out in each measure besides the sign, and MNX allows both, so the
// content converts as usual.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>whole</type></note>'

const style = (inner: string) => `<measure-style>${inner}</measure-style>`
const start = (measures = '', extra = '') =>
  style(`<measure-repeat type="start"${extra}>${measures}</measure-repeat>`)
const stop = () => style('<measure-repeat type="stop"/>')

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

function repeats(mnx: ReturnType<typeof convertMusicXML>['mnx'], partIndex = 0) {
  return mnx.parts[partIndex]?.measures.map((measure) => measure.measureRepeat)
}

describe('a measure repeat', () => {
  test('marks every measure under a one-measure sign', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start('1'), body: NOTE },
        { body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 1 }, { number: 1 }, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('marks only the first measure of each two-measure sign', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { body: NOTE },
        { attributes: start('2'), body: NOTE },
        { body: NOTE },
        { body: NOTE },
        { body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([
      undefined,
      undefined,
      { number: 2 },
      undefined,
      { number: 2 },
      undefined,
      undefined,
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // "Both the start and the stop ... should be specified unless the repeats
  // are displayed through the end of the part."
  test('runs to the end of the part without a stop', () => {
    const { mnx, warnings } = convert(
      part('P1', [{ body: NOTE }, { attributes: start('1'), body: NOTE }, { body: NOTE }]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 1 }, { number: 1 }])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The content is positive-integer-or-empty, and a sign saying nothing is
  // the everyday one-measure sign.
  test('reads an empty count as one measure', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start(), body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 1 }, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('keeps converting the notes written under the sign', () => {
    const { mnx } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start('1'), body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(mnx.parts[0]?.measures[1]?.sequences[0]?.content).toHaveLength(1)
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('ignores a stop with nothing started', () => {
    const { mnx, warnings } = convert(
      part('P1', [{ attributes: stop(), body: NOTE }, { body: NOTE }]),
    )

    expect(repeats(mnx)).toEqual([undefined, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The slash count changes the glyph, which MNX has no way to ask for.
  test('reports a slash count and converts the repeat', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start('1', ' slashes="2"'), body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 1 }, undefined])
    expect(warnings.map((warning) => warning.code)).toEqual([
      'unrepresentable:measure-repeat-slashes',
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('lets a measure stop one sign and start the next', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start('1'), body: NOTE },
        { attributes: stop() + start('2'), body: NOTE },
        { body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 1 }, { number: 2 }, undefined, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('starts a new sign over one still running', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { body: NOTE },
        { attributes: start('2'), body: NOTE },
        { body: NOTE },
        { attributes: start('1'), body: NOTE },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([undefined, { number: 2 }, undefined, { number: 1 }, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // One staff's sign ends while the other staff's runs on. MNX states one
  // sign for the part, so the continuing staff's remaining measures cannot
  // keep their marks; the loss is reported where the sign is cut.
  test('reports a stop ending one staff while the other continues', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        {
          attributes:
            '<staves>2</staves>' +
            '<measure-style number="1"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>' +
            '<measure-style number="2"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>',
          body: NOTE,
        },
        { body: NOTE },
        {
          attributes: '<measure-style number="1"><measure-repeat type="stop"/></measure-style>',
          body: NOTE,
        },
        { body: NOTE },
        {
          attributes: '<measure-style number="2"><measure-repeat type="stop"/></measure-style>',
          body: NOTE,
        },
      ]),
    )

    expect(repeats(mnx)).toEqual([{ number: 1 }, { number: 1 }, undefined, undefined, undefined])
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:measure-repeat'])
    expect(warnings[0]?.context).toMatchObject({ part: 'P1', measure: 3 })
    expect(schemaErrors(mnx)).toEqual([])
  })

  // One staff starts a sign while another staff's sign is mid-flight. The
  // walk restarts for the part, and the running sign's loss is reported.
  test('reports a staff starting a sign while another staff runs', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        {
          attributes:
            '<staves>2</staves>' +
            '<measure-style number="1"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>',
          body: NOTE,
        },
        { body: NOTE },
        {
          attributes:
            '<measure-style number="2"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>',
          body: NOTE,
        },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([{ number: 1 }, { number: 1 }, { number: 1 }, undefined])
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:measure-repeat'])
    expect(warnings[0]?.context).toMatchObject({ part: 'P1', measure: 3 })
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The type attribute is required: without it there is no saying whether
  // the sign starts or stops here, so the file is broken.
  test('refuses a measure-repeat with no type', () => {
    expect(() =>
      convert(
        part('P1', [{ attributes: style('<measure-repeat>1</measure-repeat>'), body: NOTE }]),
      ),
    ).toThrow(MusicXMLError)
  })

  test('refuses a measure-repeat with a type it does not know', () => {
    expect(() =>
      convert(
        part('P1', [
          {
            attributes: style('<measure-repeat type="continue">1</measure-repeat>'),
            body: NOTE,
          },
        ]),
      ),
    ).toThrow(MusicXMLError)
  })

  // A sign restated per staff with the same pattern loses nothing.
  test('reads agreeing per-staff signs as one', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        {
          attributes:
            '<staves>2</staves>' +
            '<measure-style number="1"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>' +
            '<measure-style number="2"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>',
          body: NOTE,
        },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)).toEqual([{ number: 1 }, undefined])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // MusicXML allows one <measure-style> per staff. MNX states the repeat for
  // the part's measure, so staves that disagree cannot both be carried.
  test('keeps the first of disagreeing per-staff counts', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        { attributes: '<staves>2</staves>', body: NOTE },
        { body: NOTE },
        { body: NOTE },
        {
          attributes:
            '<measure-style number="1"><measure-repeat type="start">1</measure-repeat>' +
            '</measure-style>' +
            '<measure-style number="2"><measure-repeat type="start">2</measure-repeat>' +
            '</measure-style>',
          body: NOTE,
        },
        { attributes: stop(), body: NOTE },
      ]),
    )

    expect(repeats(mnx)?.[3]).toEqual({ number: 1 })
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:measure-repeat'])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
