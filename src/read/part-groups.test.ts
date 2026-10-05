// A <part-group> in the part list draws a bracket or brace across the staves
// of its member parts. MNX states the same grouping as a layout: a
// system-layout whose content nests staff groups around staves, each staff
// naming the part it draws.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import { convertMusicXML } from '../index.js'

const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>'

function part(id: string): string {
  return `<part id="${id}"><measure number="1">${NOTE}</measure></part>`
}

function score(partList: string, parts: string): string {
  return `<score-partwise version="4.0"><part-list>${partList}</part-list>${parts}</score-partwise>`
}

/** The error a structurally broken document is refused with. */
function failure(source: string): MusicXMLError {
  try {
    convertMusicXML(source)
  } catch (error) {
    if (error instanceof MusicXMLError) return error
    throw error
  }
  throw new Error('The document was expected to be refused.')
}

describe('part groups', () => {
  test('turns a bracket group over two parts into a layout staff group', () => {
    const { mnx, warnings } = convertValid(
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
        id: 'layout1',
        content: [
          {
            type: 'group',
            symbol: 'bracket',
            content: [
              { type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] },
              { type: 'staff', labelref: 'name', sources: [{ part: 'P2' }] },
            ],
          },
        ],
      },
    ])
    expect(mnx.parts.map((p) => p.id)).toEqual(['P1', 'P2'])
    expect(warnings).toEqual([])
  })

  // An edge that writes no number is number 1.
  test.each([
    ['<part-group type="start">', '<part-group type="stop" number="1"/>'],
    ['<part-group type="start" number="1">', '<part-group type="stop"/>'],
  ])('joins %s to %s', (start, stop) => {
    const { mnx, warnings } = convertValid(
      score(
        `${start}<group-symbol>bracket</group-symbol></part-group>` +
          '<score-part id="P1"/><score-part id="P2"/>' +
          stop +
          '<score-part id="P3"/>',
        part('P1') + part('P2') + part('P3'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    expect(group?.type === 'group' && group.content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A renderer that honours a layout resolves part names from it, so a staff
  // that names none draws none. labelref points back at the part, so the name
  // is written once.
  test('labels a staff from the short name when the part draws no full name', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name print-object="no">Voice</part-name>' +
          '<part-abbreviation>V.</part-abbreviation></score-part>' +
          '<score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content[0]).toEqual({
      type: 'staff',
      labelref: 'shortName',
      sources: [{ part: 'P1' }],
    })
    expect(warnings).toEqual([])
  })

  test('writes no label reference for a part that draws no name at all', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content[0]).toEqual({ type: 'staff', sources: [{ part: 'P1' }] })
    expect(warnings).toEqual([])
  })

  test('names the grand-staff group from the short name when no full name draws', () => {
    const pianoPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name print-object="no">Piano</part-name>' +
          '<part-abbreviation>Pno.</part-abbreviation></score-part>' +
          '<part-group type="stop" number="1"/>',
        pianoPart,
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content[0]).toEqual({
      type: 'group',
      symbol: 'brace',
      barlineStyle: 'instrument',
      label: 'Pno.',
      content: [
        { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
        { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
      ],
    })
    expect(warnings).toEqual([])
  })

  // A part that draws both of its names is labelled by the full one; the
  // short name stays on the part for a renderer that wants it later.
  test('prefers the full name over the short name on staff and group alike', () => {
    const pianoPart =
      '<part id="P2"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Voice</part-name>' +
          '<part-abbreviation>V.</part-abbreviation></score-part>' +
          '<part-group type="stop" number="1"/>' +
          '<score-part id="P2"><part-name>Piano</part-name>' +
          '<part-abbreviation>Pno.</part-abbreviation></score-part>',
        part('P1') + pianoPart,
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect(group.content[0]).toEqual({
      type: 'staff',
      labelref: 'name',
      sources: [{ part: 'P1' }],
    })
    expect(mnx.layouts?.[0]?.content[1]).toEqual({
      type: 'group',
      symbol: 'brace',
      barlineStyle: 'instrument',
      label: 'Piano',
      content: [
        { type: 'staff', sources: [{ part: 'P2', staff: 1 }] },
        { type: 'staff', sources: [{ part: 'P2', staff: 2 }] },
      ],
    })
    expect(warnings).toEqual([])
  })

  // The fold is for the grand staff a multi-staff part restates; a brace
  // group around a single-staff part states a grouping of its own and
  // stays a group around its one staff.
  test('keeps a brace group around one single-staff part as a group', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Voice</part-name></score-part>' +
          '<part-group type="stop" number="1"/>',
        part('P1'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        content: [{ type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] }],
      },
    ])
    expect(warnings).toEqual([])
  })

  // Where the group states no label of its own, the folded group keeps the
  // part's name, as the grand staff on its own would.
  test('names the folded group after its part when the group is nameless', () => {
    const pianoPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Piano</part-name></score-part>' +
          '<part-group type="stop" number="1"/>',
        pianoPart,
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        barlineStyle: 'instrument',
        label: 'Piano',
        content: [
          { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
  })

  // Only a score can name a layout. A layout no score names is unreachable,
  // and its brackets never draw.
  test('names the layout from a score, so a reader can reach it', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(mnx.scores).toEqual([{ name: 'Score', layout: 'layout1' }])
    expect(mnx.layouts?.[0]?.id).toBe('layout1')
    expect(warnings).toEqual([])
  })

  test('writes no score of its own where the source draws no groups', () => {
    const { mnx } = convertValid(score('<score-part id="P1"/>', part('P1')))

    expect('scores' in mnx).toBe(false)
  })

  // One score carries everything this converter states on a rendering, so a
  // grouped source that also breaks its systems names the layout on the same
  // entry as the pages.
  test('names the layout on the score that already carries the pages', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        `<part id="P1"><measure number="1">${NOTE}</measure>` +
          `<measure number="2"><print new-system="yes"/>${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.scores).toHaveLength(1)
    expect(mnx.scores?.[0]?.layout).toBe('layout1')
    expect(mnx.scores?.[0]?.pages).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  test('carries a brace group name and barline run onto the staff group', () => {
    const { mnx, warnings } = convertValid(
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
  })

  test('reports a group stop that nothing opened and keeps the rest', () => {
    const { mnx, warnings } = convertValid(
      score('<score-part id="P1"/><part-group type="stop" number="1"/>', part('P1')),
    )

    expect(mnx.layouts).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unclosed:part-group', element: 'part-group' }),
    ])
  })

  test('runs a group nothing stops to the end of the part list, and says so', () => {
    const { mnx, warnings } = convertValid(
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
  })

  test('nests a group inside another and leaves an ungrouped part outside both', () => {
    const { mnx, warnings } = convertValid(
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
  })

  // MNX's staff-symbol enum has no line or square, so the kind is reported
  // and the group is kept with no symbol.
  test('keeps a line-symbol group but reports the symbol it cannot spell', () => {
    const { mnx, warnings } = convertValid(
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
  })

  // The square is the other symbol MNX cannot spell.
  test('keeps a square-symbol group but reports the symbol it cannot spell', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>square</group-symbol></part-group>' +
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
  })

  // An empty <group-symbol> states no symbol, the same as "none".
  test.each(['none', ''])(
    'reads a group-symbol of "%s" as no symbol, saying nothing',
    (written) => {
      const { mnx, warnings } = convertValid(
        score(
          `<part-group type="start" number="1"><group-symbol>${written}</group-symbol></part-group>` +
            '<score-part id="P1"/><score-part id="P2"/>' +
            '<part-group type="stop" number="1"/>',
          part('P1') + part('P2'),
        ),
      )

      const group = mnx.layouts?.[0]?.content[0]
      if (group?.type !== 'group') throw new Error('expected a staff group')
      expect(group.symbol).toBe('noSymbol')
      expect(warnings).toEqual([])
    },
  )

  // A brace group holding exactly one multi-staff part restates the grand
  // staff the part gets on its own, and nested, a renderer draws two braces
  // side by side. The two statements fold into one group.
  test('folds a brace group around one multi-staff part into its grand staff', () => {
    const twoStaffPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"/>' +
          '<part-group type="stop" number="1"/>',
        twoStaffPart,
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        barlineStyle: 'instrument',
        content: [
          { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
  })

  // The fold is for a group holding that part alone. A second member makes
  // the group a grouping of its own, so it stays one and keeps both members.
  test('keeps a brace group holding a multi-staff part and another part', () => {
    const twoStaffPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        twoStaffPart + part('P2'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        content: [
          {
            type: 'group',
            symbol: 'brace',
            barlineStyle: 'instrument',
            content: [
              { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
              { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
            ],
          },
          { type: 'staff', sources: [{ part: 'P2' }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
  })

  // What the source's group states wins over what the part implies; the
  // part fills in only what the group leaves unsaid.
  test("keeps the folded group to the source's own label and barline run", () => {
    const twoStaffPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>brace</group-symbol>' +
          '<group-name>Duo</group-name><group-barline>no</group-barline></part-group>' +
          '<score-part id="P1"><part-name>Piano</part-name></score-part>' +
          '<part-group type="stop" number="1"/>',
        twoStaffPart,
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        barlineStyle: 'individual',
        label: 'Duo',
        content: [
          { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
  })

  // The braced group stands in for the part, so it takes the part's name;
  // a group label is a plain string because MNX gives groups no labelref.
  test('names the grand-staff group after its part', () => {
    const pianoPart =
      '<part id="P2"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Voice</part-name></score-part>' +
          '<part-group type="stop" number="1"/>' +
          '<score-part id="P2"><part-name>Piano</part-name></score-part>',
        part('P1') + pianoPart,
      ),
    )

    expect(mnx.layouts?.[0]?.content[1]).toEqual({
      type: 'group',
      symbol: 'brace',
      barlineStyle: 'instrument',
      label: 'Piano',
      content: [
        { type: 'staff', sources: [{ part: 'P2', staff: 1 }] },
        { type: 'staff', sources: [{ part: 'P2', staff: 2 }] },
      ],
    })
    expect(warnings).toEqual([])
  })

  // A braced grand staff is something the part list does not state:
  // parts[i].staves says two staves, and nothing says they are one braced
  // instrument with connected barlines. So a multi-staff part gets a layout
  // even where the source draws no groups.
  test('states the grand staff of a piano the source never groups', () => {
    const pianoPart =
      '<part id="P2"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertValid(
      score(
        '<score-part id="P1"><part-name>Voice</part-name></score-part>' +
          '<score-part id="P2"><part-name>Piano</part-name></score-part>',
        part('P1') + pianoPart,
      ),
    )

    expect(mnx.layouts).toEqual([
      {
        id: 'layout1',
        content: [
          { type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] },
          {
            type: 'group',
            symbol: 'brace',
            barlineStyle: 'instrument',
            label: 'Piano',
            content: [
              { type: 'staff', sources: [{ part: 'P2', staff: 1 }] },
              { type: 'staff', sources: [{ part: 'P2', staff: 2 }] },
            ],
          },
        ],
      },
    ])
    expect(mnx.scores?.[0]?.layout).toBe('layout1')
    expect(mnx.parts.map((p) => p.id)).toEqual(['P1', 'P2'])
    expect(warnings).toEqual([])
  })

  // A layout of bare staves states nothing the part list does not, so a
  // score without groups gets none, and its parts stay unnamed by id.
  test('writes no layout and no part ids when the source draws no groups', () => {
    const { mnx, warnings } = convertValid(
      score('<score-part id="P1"/><score-part id="P2"/>', part('P1') + part('P2')),
    )

    expect('layouts' in mnx).toBe(false)
    expect(mnx.parts.every((p) => !('id' in p))).toBe(true)
    expect(warnings).toEqual([])
  })

  // A staff pointing at a part the score does not hold would dangle, so the
  // listed-but-absent part is left out of the layout and reported.
  test('leaves a part the score never writes out of the layout', () => {
    const { mnx, warnings } = convertValid(
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
      expect.objectContaining({
        code: 'unresolved:part-id',
        element: 'score-part',
        context: expect.objectContaining({
          part: 'P2',
          line: expect.any(Number) as unknown,
        }) as unknown,
      }),
    ])
  })

  // A layout draws only the staves it names, so a part the list never
  // mentions is drawn after the listed ones, outside any group.
  test('draws a part the part list never mentions after the listed parts', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P3') + part('P1') + part('P4') + part('P2'),
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
      { type: 'staff', sources: [{ part: 'P3' }] },
      { type: 'staff', sources: [{ part: 'P4' }] },
    ])
    expect(warnings.map((w) => [w.code, w.context.part])).toEqual([
      ['unresolved:part-id', 'P3'],
      ['unresolved:part-id', 'P4'],
    ])
  })

  // A group around nothing draws nothing, so it is left out; here that
  // leaves no group, and with it goes the layout.
  test('writes no layout when every group ends up empty', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<part-group type="stop" number="1"/>' +
          '<score-part id="P1"/>',
        part('P1'),
      ),
    )

    expect('layouts' in mnx).toBe(false)
    expect(mnx.parts.every((p) => !('id' in p))).toBe(true)
    expect(warnings).toEqual([])
  })

  test('drops a group emptied by pruning but keeps the rest of the layout', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P9"/>' +
          '<part-group type="stop" number="1"/>' +
          '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'brace',
        content: [
          { type: 'staff', sources: [{ part: 'P1' }] },
          { type: 'staff', sources: [{ part: 'P2' }] },
        ],
      },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unresolved:part-id', element: 'score-part' }),
    ])
  })

  test('nests a group whose only member is another group', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<part-group type="start" number="2"><group-symbol>brace</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const outer = mnx.layouts?.[0]?.content[0]
    if (outer?.type !== 'group') throw new Error('expected a staff group')
    expect(outer.symbol).toBe('bracket')
    expect(outer.content).toHaveLength(1)
    expect(outer.content[0]?.type).toBe('group')
    expect(warnings).toEqual([])
  })

  // The gate on writing a layout is a surviving group, not the absence of
  // failures: a stop nothing opened is reported while the sound group stays.
  test('keeps the layout when one group survives an orphan stop', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="stop" number="7"/>' +
          '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(mnx.layouts?.[0]?.content).toHaveLength(1)
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unclosed:part-group', element: 'part-group' }),
    ])
  })

  // MusicXML's group-barline values in MNX's: "no" draws each staff its own
  // barline, "Mensurstrich" draws them between staves only.
  test.each([
    ['no', 'individual'],
    ['Mensurstrich', 'mensurstrich'],
  ])('carries a group-barline of %s as %s', (source, written) => {
    const { mnx, warnings } = convertValid(
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
  })

  // The type attribute pairs the two edges, so an edge without one is
  // structurally broken input.
  test('refuses a part-group with no type', () => {
    const source = score('<part-group number="1"/><score-part id="P1"/>', part('P1'))

    expect(() => convertMusicXML(source)).toThrow(MusicXMLError)
    expect(() => convertMusicXML(source)).toThrow('missing a "type" attribute')
    expect(failure(source).path).toEqual(['score-partwise', 'part-list', 'part-group'])
  })

  test('refuses a part-group whose type is neither start nor stop', () => {
    const source = score(
      '<part-group type="continue" number="1"/><score-part id="P1"/>',
      part('P1'),
    )

    expect(() => convertMusicXML(source)).toThrow(MusicXMLError)
    expect(() => convertMusicXML(source)).toThrow('"start" or "stop"')
    expect(failure(source).path).toEqual(['score-partwise', 'part-list', 'part-group'])
  })

  // The part list holds score parts and part groups. Anything else is not an
  // edge of a group: it is read by nothing and reported as a whole.
  test('reports a part-list child that is neither a score part nor a group', () => {
    const { warnings } = convertValid(score('<score-part id="P1"/><part-order/>', part('P1')))

    expect(warnings.map((one) => ({ code: one.code, element: one.element }))).toEqual([
      { code: 'unsupported:element', element: 'part-order' },
    ])
  })

  // Everything in a <part-group> that is not the symbol, the name or the
  // barline has no home in an MNX staff group, and the unread sweep reports
  // it. <group-time>, which draws one time signature across the group's
  // staves, is one of those.
  test('reports what a part group states beside its symbol, name and barline', () => {
    const { warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol>' +
          '<group-time/></part-group>' +
          '<score-part id="P1"><part-name>Soprano</part-name></score-part>' +
          '<score-part id="P2"><part-name>Alto</part-name></score-part>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    expect(warnings.map((w) => w.element)).toEqual(['group-time'])
  })

  // A value outside yes/no/Mensurstrich is invalid input, reported the same
  // way an unrecognized <bar-style> is.
  test('reports a group-barline value it does not recognize', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-barline>maybe</group-barline></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect('barlineStyle' in group).toBe(false)
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unsupported:element', element: 'group-barline' }),
    ])
  })

  test('reports a group-symbol value it does not recognize as invalid, not as a format limit', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-group type="start" number="1"><group-symbol>squiggle</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2'),
      ),
    )

    const group = mnx.layouts?.[0]?.content[0]
    if (group?.type !== 'group') throw new Error('expected a staff group')
    expect('symbol' in group).toBe(false)
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unsupported:element', element: 'group-symbol' }),
    ])
  })

  // Two groups can cross: the first stops while the second is still open.
  // MusicXML allows this (the number attribute tells overlapping groups
  // apart), but MNX's layout tree cannot hold it. The crossed group runs to
  // the end of the part list, and the overlap is reported once, as a format
  // limit.
  test('reports crossed group edges and runs the crossed group to the end', () => {
    const { mnx, warnings } = convertValid(
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
        code: 'unrepresentable:part-group-overlap',
        message: expect.stringContaining('cross') as unknown,
        context: expect.objectContaining({ line: expect.any(Number) as unknown }),
      }),
    ])
  })
})

// Two groups open under one number, which MusicXML does not resolve. A stop
// then names that number while a third group is still open inside both. The
// stop goes to the inner of the two, so that group crosses the third. The
// outer one stays open.
//
// The report shows which of the two is picked. A crossed group runs to the
// end of the part list and is not reported as unclosed. The group left over
// is. Each part-list entry is on its own line, so the reported line names the
// group.
describe('a stop naming a number two open groups carry', () => {
  const CROSSED = [
    '<score-partwise version="4.0"><part-list>',
    '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>',
    '<score-part id="P1"/>',
    '<part-group type="start" number="1"><group-symbol>brace</group-symbol></part-group>',
    '<score-part id="P2"/>',
    '<part-group type="start" number="2"/>',
    '<score-part id="P3"/>',
    '<part-group type="stop" number="1"/>',
    '<part-group type="stop" number="2"/>',
    `</part-list>${part('P1')}${part('P2')}${part('P3')}</score-partwise>`,
  ].join('\n')

  test('crosses the innermost of the two, leaving the outer one unclosed', () => {
    const { warnings } = convertValid(CROSSED)

    expect(warnings.map((warning) => [warning.code, warning.context.line])).toEqual([
      ['unrepresentable:part-group-overlap', 8],
      // The bracket on line 2, not the brace on line 4: the brace is the one
      // the stop crossed, and a crossed group is not reported as unclosed.
      ['unclosed:part-group', 2],
    ])
  })
})
