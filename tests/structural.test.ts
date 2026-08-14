// The source-side readers behind the corpus checks. They read the XML
// independently of the converter, so their own readings need pinning where
// the format allows more than one shape for the same music.

import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import type { MNXDocument } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import { layoutLosses, pitchesOf, sourcePitches } from './support/structural.js'

// Sibelius states no <voice> on chord members. The chord member belongs to
// the voice of the note it is chorded with, not to a voice of its own.
test('a chord member without a voice counts toward its base note voice', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
      <backup><duration>2</duration></backup>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration><voice>2</voice><type>quarter</type>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>1</duration><voice>2</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))
  expect(inSource).toEqual(['part 1 measure 1: C5 D5 | G4 B4 A4'])

  // The converter reads it the same way, which is what the corpus gate
  // compares.
  const { mnx } = convertMusicXML(source)
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// The layout checks. A layout can state less than the part list does and
// stay legal MNX: a staff with no label reference suppresses its part's
// name, and a multi-staff part left as bare sibling staves loses its grand
// staff. The schema cannot see either, so the corpus gate walks the layout.

function layoutDocument(
  content: NonNullable<MNXDocument['layouts']>[number]['content'],
  parts: MNXDocument['parts'],
): MNXDocument {
  return {
    mnx: { version: 1 },
    global: { measures: [] },
    layouts: [{ id: 'layout1', content }],
    parts,
  }
}

test('a layout that states every name and brace loses nothing', () => {
  const document = layoutDocument(
    [
      { type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] },
      {
        type: 'group',
        symbol: 'brace',
        label: 'Piano',
        content: [
          { type: 'staff', sources: [{ part: 'P2', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P2', staff: 2 }] },
        ],
      },
    ],
    [
      { id: 'P1', name: 'Voice', measures: [] },
      { id: 'P2', name: 'Piano', staves: 2, measures: [] },
    ],
  )

  expect(layoutLosses(document)).toEqual([])
})

test('a staff with no label reference loses its part name', () => {
  const document = layoutDocument(
    [{ type: 'staff', sources: [{ part: 'P1' }] }],
    [{ id: 'P1', name: 'Voice', measures: [] }],
  )

  expect(layoutLosses(document)).toEqual(['part P1: name unreachable from the layout'])
})

test('a label on an enclosing group keeps the part name reachable', () => {
  const document = layoutDocument(
    [
      {
        type: 'group',
        label: 'Choir',
        content: [{ type: 'staff', sources: [{ part: 'P1' }] }],
      },
    ],
    [{ id: 'P1', name: 'Soprano', measures: [] }],
  )

  expect(layoutLosses(document)).toEqual([])
})

test('a multi-staff part written as bare staves loses its grand staff', () => {
  const document = layoutDocument(
    [
      { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
      { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
    ],
    [{ id: 'P1', staves: 2, measures: [] }],
  )

  expect(layoutLosses(document)).toEqual([
    'part P1: 2 staves without one braced group of their own',
  ])
})

test('a braced group missing one of the staves does not count', () => {
  const document = layoutDocument(
    [
      {
        type: 'group',
        symbol: 'brace',
        content: [{ type: 'staff', sources: [{ part: 'P1', staff: 1 }] }],
      },
      { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
    ],
    [{ id: 'P1', staves: 2, measures: [] }],
  )

  expect(layoutLosses(document)).toEqual([
    'part P1: 2 staves without one braced group of their own',
  ])
})

test('a part left out of the layout is not the layout to state', () => {
  const document = layoutDocument(
    [{ type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] }],
    [
      { id: 'P1', name: 'Voice', measures: [] },
      { id: 'P2', name: 'Piano', staves: 2, measures: [] },
    ],
  )

  expect(layoutLosses(document)).toEqual([])
})

test('a document without layouts has nothing to check', () => {
  expect(
    layoutLosses({ mnx: { version: 1 }, global: { measures: [] }, parts: [{ measures: [] }] }),
  ).toEqual([])
})
