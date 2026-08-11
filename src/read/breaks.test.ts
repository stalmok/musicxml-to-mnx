// A <print> at the top of a measure says how the score is laid out from
// there: new-system="yes" starts a new system, new-page="yes" a new page.
// MNX states the layout as the score rendering's pages, each holding the
// systems it draws, and each system naming the measure it starts at. The
// first system of the score is implicit in MusicXML and stated in MNX, so
// writing any break writes the whole structure.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>whole</type></note>'

/** A part whose measures each open with the given content before one note. */
function part(id: string, measures: readonly string[]) {
  const written = measures
    .map(
      (opening, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>1</divisions></attributes>' : '') +
        `${opening}${NOTE}</measure>`,
    )
    .join('')
  return `<part id="${id}">${written}</part>`
}

function convert(...parts: string[]) {
  return convertMusicXML(`<score-partwise>${parts.join('')}</score-partwise>`)
}

describe('system and page breaks', () => {
  test('writes no pages where the source states no break', () => {
    const { mnx, warnings } = convert(part('P1', ['', '']))

    expect(mnx.scores).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('starts a new system where the source breaks one', () => {
    const { mnx, warnings } = convert(part('P1', ['', '<print new-system="yes"/>', '']))

    expect(mnx.scores).toEqual([
      {
        name: 'Score',
        pages: [{ systems: [{ measure: 'm1' }, { measure: 'm2' }] }],
      },
    ])
    expect(mnx.global.measures[0]?.id).toBe('m1')
    expect(mnx.global.measures[1]?.id).toBe('m2')
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('starts a new page where the source turns one', () => {
    const { mnx, warnings } = convert(
      part('P1', ['', '<print new-system="yes"/>', '<print new-page="yes"/>', '']),
    )

    expect(mnx.scores).toEqual([
      {
        name: 'Score',
        pages: [
          { systems: [{ measure: 'm1' }, { measure: 'm2' }] },
          { systems: [{ measure: 'm3' }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // new-system="no" states the absence of a break, which is the default.
  test('reads a break written as no as no break', () => {
    const { mnx, warnings } = convert(part('P1', ['', '<print new-system="no"/>']))

    expect(mnx.scores).toBeUndefined()
    expect(warnings).toEqual([])
  })

  // Breaks are usually written into one part only, and they belong to the
  // whole score: a break any part states is the score's.
  test('takes the break from whichever part states it', () => {
    const { mnx, warnings } = convert(
      part('P1', ['', '']),
      part('P2', ['', '<print new-system="yes"/>']),
    )

    expect(mnx.scores?.[0]?.pages).toEqual([{ systems: [{ measure: 'm1' }, { measure: 'm2' }] }])
    expect(warnings).toEqual([])
  })

  // The rest of what a <print> states, page numbering and spacing, has no
  // home in MNX's pages and systems.
  test('reports the print details it cannot carry', () => {
    const { mnx, warnings } = convert(
      part('P1', ['<print page-number="3" blank-page="1" staff-spacing="80"/>', '']),
    )

    expect(mnx.scores).toBeUndefined()
    expect(warnings.map((warning) => warning.code)).toEqual([
      'unrepresentable:print-detail',
      'unrepresentable:print-detail',
      'unrepresentable:print-detail',
    ])
  })

  test('reports the layout details inside a print and keeps the break', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        '',
        '<print new-system="yes"><system-layout><system-distance>100</system-distance>' +
          '</system-layout></print>',
      ]),
    )

    expect(mnx.scores?.[0]?.pages?.[0]?.systems).toHaveLength(2)
    expect(warnings.map((warning) => warning.element)).toEqual(['system-layout'])
  })

  test('writes the pages beside a multi-measure rest', () => {
    const { mnx, warnings } = convert(
      part('P1', [
        '<attributes><measure-style><multiple-rest>2</multiple-rest></measure-style></attributes>',
        '',
        '<print new-page="yes"/>',
      ]),
    )

    expect(mnx.scores?.[0]?.multimeasureRests).toEqual([{ start: 'm1', duration: 2 }])
    expect(mnx.scores?.[0]?.pages).toEqual([
      { systems: [{ measure: 'm1' }] },
      { systems: [{ measure: 'm3' }] },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
