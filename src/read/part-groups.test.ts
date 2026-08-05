// A <part-group> in the part list draws a bracket or brace across the staves
// of its member parts. MNX states the same grouping as a layout: a
// system-layout whose content nests staff groups around staves, each staff
// naming the part it draws.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>'

function part(id: string): string {
  return `<part id="${id}"><measure number="1">${NOTE}</measure></part>`
}

function score(partList: string, parts: string): string {
  return `<score-partwise version="4.0"><part-list>${partList}</part-list>${parts}</score-partwise>`
}

describe('part groups', () => {
  test('turns a bracket group over two parts into a layout staff group', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Soprano</part-name></score-part>' +
          '<score-part id="P2"><part-name>Alto</part-name></score-part>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(mnx.layouts).toEqual([
      {
        content: [
          {
            type: 'group',
            symbol: 'bracket',
            content: [
              { type: 'staff', sources: [{ part: 'P1' }] },
              { type: 'staff', sources: [{ part: 'P2' }] },
            ],
          },
        ],
      },
    ])
    expect(mnx.parts.map((p) => p.id)).toEqual(['P1', 'P2'])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('carries a brace group name and barline run onto the staff group', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol>' +
          '<group-name>Piano</group-name><group-barline>yes</group-barline></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.symbol).toBe('brace')
    expect(group.label).toBe('Piano')
    expect(group.barlineStyle).toBe('unified')
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('reports a group stop that nothing opened and keeps the rest', () => {
    const { mnx, warnings } = convertMusicXML(
      score('<score-part id="P1"/><part-group type="stop" number="1"/>', part('P1')),
    )

    expect(mnx.layouts).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unclosed:part-group', element: 'part-group' }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('runs a group nothing stops to the end of the part list, and says so', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'bracket',
        content: [
          { type: 'staff', sources: [{ part: 'P1' }] },
          { type: 'staff', sources: [{ part: 'P2' }] },
        ],
      },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unclosed:part-group', element: 'part-group' }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('nests a group inside another and leaves an ungrouped part outside both', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/>' +
          '<part-group type="start" number="2"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P2"/><score-part id="P3"/>' +
          '<part-group type="stop" number="2"/>' +
          '<part-group type="stop" number="1"/>' +
          '<score-part id="P4"/>',
        part('P1') + part('P2') + part('P3') + part('P4'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'bracket',
        content: [
          { type: 'staff', sources: [{ part: 'P1' }] },
          {
            type: 'group',
            symbol: 'brace',
            content: [
              { type: 'staff', sources: [{ part: 'P2' }] },
              { type: 'staff', sources: [{ part: 'P3' }] },
            ],
          },
        ],
      },
      { type: 'staff', sources: [{ part: 'P4' }] },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // MNX's staff-symbol enum has no line or square, so the kind is reported
  // and the group is kept with no symbol, which leaves the drawing open
  // rather than claiming the source asked for none.
  test('keeps a line-symbol group but reports the symbol it cannot spell', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>line</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect('symbol' in group).toBe(false)
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:group-symbol', element: 'group-symbol' }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A layout lists staves, not parts, so a part written on two staves takes
  // two of them, each naming which staff of the part it draws.
  test('gives each staff of a two-staff part its own staff in the layout', () => {
    const twoStaffPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"/>' +
          '<part-group type="stop" number="1"/>',
        twoStaffPart,
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content).toEqual([
      { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
      { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A layout of bare staves states nothing the part list does not, so a
  // score without groups gets none, and its parts stay unnamed by id.
  test('writes no layout and no part ids when the source draws no groups', () => {
    const { mnx, warnings } = convertMusicXML(
      score('<score-part id="P1"/><score-part id="P2"/>', part('P1') + part('P2')),
    )

    expect('layouts' in mnx).toBe(false)
    expect(mnx.parts.every((p) => !('id' in p))).toBe(true)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A staff pointing at a part the score does not hold would dangle, so the
  // listed-but-absent part is left out of the layout and reported.
  test('leaves a part the score never writes out of the layout', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content).toEqual([{ type: 'staff', sources: [{ part: 'P1' }] }])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unresolved:part-id', element: 'score-part' }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // MusicXML's group-barline values in MNX's: "no" draws each staff its own
  // barline, "Mensurstrich" draws them between staves only.
  test.each([
    ['no', 'individual'],
    ['Mensurstrich', 'mensurstrich'],
  ])('carries a group-barline of %s as %s', (source, written) => {
    const { mnx, warnings } = convertMusicXML(
      score(
        `<part-group type="start" number="1"><group-barline>${source}</group-barline></part-group>` +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.barlineStyle).toBe(written)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Two groups can cross: the first stops while the second is still open,
  // which no tree can hold. The crossed group runs to the end of the part
  // list instead, and the crossing is reported once.
  test('reports crossed group edges and runs the crossed group to the end', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/>' +
          '<part-group type="start" number="2"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>' +
          '<score-part id="P3"/>' +
          '<part-group type="stop" number="2"/>',
        part('P1') + part('P2') + part('P3'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'bracket',
        content: [
          { type: 'staff', sources: [{ part: 'P1' }] },
          {
            type: 'group',
            symbol: 'brace',
            content: [
              { type: 'staff', sources: [{ part: 'P2' }] },
              { type: 'staff', sources: [{ part: 'P3' }] },
            ],
          },
        ],
      },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unclosed:part-group',
        message: expect.stringContaining('cross') as unknown,
      }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
