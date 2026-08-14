// A <part-group> in the part list draws a bracket or brace across the staves
// of its member parts. MNX states the same grouping as a layout: a
// system-layout whose content nests staff groups around staves, each staff
// naming the part it draws.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A renderer that honours a layout resolves part names from it, so a staff
  // that names none draws none. labelref points back at the part, which
  // keeps the name written once.
  test('labels a staff from the short name when the part draws no full name', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no label reference for a part that draws no name at all', () => {
    const { mnx } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('names the grand-staff group from the short name when no full name draws', () => {
    const pianoPart =
      '<part id="P1"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertMusicXML(
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
    expect(group.content[0]).toEqual(expect.objectContaining({ label: 'Pno.', symbol: 'brace' }))
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Only a score can name a layout, so a layout no score names is unreachable
  // and the brackets never draw. Written without one, the grouping converted
  // into a dead end with nothing to warn about.
  test('names the layout from a score, so a reader can reach it', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no score of its own where the source draws no groups', () => {
    const { mnx } = convertMusicXML(score('<score-part id="P1"/>', part('P1')))

    expect('scores' in mnx).toBe(false)
  })

  // One score carries everything this converter states on a rendering, so a
  // grouped source that also breaks its systems names the layout on the same
  // entry as the pages rather than writing a second one.
  test('names the layout on the score that already carries the pages', () => {
    const { mnx, warnings } = convertMusicXML(
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

  // A layout lists staves, not parts, and a multi-staff part is still one
  // instrument. MusicXML leaves the grand staff implicit; MNX states it, so
  // the part's staves arrive inside a braced group of their own.
  test('braces the staves of a two-staff part into a group of their own', () => {
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
      {
        type: 'group',
        symbol: 'brace',
        content: [
          { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
        ],
      },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The braced group stands in for the part, so it takes the part's name;
  // a group label is a plain string because MNX gives groups no labelref.
  test('names the grand-staff group after its part', () => {
    const pianoPart =
      '<part id="P2"><measure number="1">' +
      '<attributes><staves>2</staves></attributes>' +
      `${NOTE}</measure></part>`
    const { mnx, warnings } = convertMusicXML(
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
      label: 'Piano',
      content: [
        { type: 'staff', sources: [{ part: 'P2', staff: 1 }] },
        { type: 'staff', sources: [{ part: 'P2', staff: 2 }] },
      ],
    })
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
      expect.objectContaining({
        code: 'unresolved:part-id',
        element: 'score-part',
        context: expect.objectContaining({
          part: 'P2',
          line: expect.any(Number) as unknown,
        }) as unknown,
      }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A group around nothing draws nothing, so it is left out; here that
  // leaves no group at all, and with it goes the layout.
  test('writes no layout when every group ends up empty', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('drops a group emptied by pruning but keeps the rest of the layout', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('nests a group whose only member is another group', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A part the list never mentions cannot be grouped, so the layout omits
  // it; the id is still written, like every part's once a layout exists.
  test('gives an unlisted part an id even though the layout omits it', () => {
    const { mnx } = convertMusicXML(
      score(
        '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>',
        part('P1') + part('P2') + part('P3'),
      ),
    )

    expect(mnx.parts.map((p) => p.id)).toEqual(['P1', 'P2', 'P3'])
    const layout = JSON.stringify(mnx.layouts)
    expect(layout).not.toContain('P3')
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The gate on writing a layout is a surviving group, not the absence of
  // failures: a stop nothing opened is reported while the sound group stays.
  test('keeps the layout when one group survives an orphan stop', () => {
    const { mnx, warnings } = convertMusicXML(
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

  // The type attribute is what pairs the two edges, so an edge without one
  // is structurally broken input, refused rather than guessed at.
  test('refuses a part-group with no type', () => {
    const source = score('<part-group number="1"/><score-part id="P1"/>', part('P1'))

    expect(() => convertMusicXML(source)).toThrow(MusicXMLError)
    expect(() => convertMusicXML(source)).toThrow('missing a "type" attribute')
  })

  test('refuses a part-group whose type is neither start nor stop', () => {
    const source = score(
      '<part-group type="continue" number="1"/><score-part id="P1"/>',
      part('P1'),
    )

    expect(() => convertMusicXML(source)).toThrow(MusicXMLError)
    expect(() => convertMusicXML(source)).toThrow('"start" or "stop"')
  })

  // A value outside yes/no/Mensurstrich is invalid input, reported the same
  // way an unrecognized <bar-style> is.
  test('reports a group-barline value it does not recognize', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A value that is not a symbol MusicXML names is invalid input, not a
  // symbol MNX lacks, and the two read differently in the loss report.
  test('reports a group-symbol value it does not recognize as invalid, not as a format limit', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Two groups can cross: the first stops while the second is still open,
  // which MusicXML allows (the number attribute exists to tell overlapping
  // groups apart) but MNX's layout tree cannot hold. The crossed group runs
  // to the end of the part list instead, and the overlap is reported once,
  // as a format limit rather than a fault of the source.
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
        code: 'unrepresentable:part-group-overlap',
        message: expect.stringContaining('cross') as unknown,
        context: expect.objectContaining({ line: expect.any(Number) as unknown }),
      }),
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
