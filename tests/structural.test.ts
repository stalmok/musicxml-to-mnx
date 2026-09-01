// The source-side readers behind the corpus checks. They read the XML
// independently of the converter, so their own readings need pinning where
// the format allows more than one shape for the same music.

import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import type { MNXDocument } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import {
  differingLyricLines,
  layoutLosses,
  pitchesOf,
  sourcePitches,
} from './support/structural.js'

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
        barlineStyle: 'instrument',
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
        barlineStyle: 'instrument',
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

test('a braced group that leaves its barlines unstated does not count', () => {
  const document = layoutDocument(
    [
      {
        type: 'group',
        symbol: 'brace',
        content: [
          { type: 'staff', sources: [{ part: 'P1', staff: 1 }] },
          { type: 'staff', sources: [{ part: 'P1', staff: 2 }] },
        ],
      },
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

test('a document of single staves needs no layout', () => {
  expect(
    layoutLosses({ mnx: { version: 1 }, global: { measures: [] }, parts: [{ measures: [] }] }),
  ).toEqual([])
})

// A multi-staff part needs a layout to state its grand staff, so a document
// holding one and no layout has already lost the brace.
test('a multi-staff part with no layout at all is a loss', () => {
  expect(
    layoutLosses({
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [{ id: 'P1', staves: 2, measures: [] }],
    }),
  ).toEqual(['part P1: multi-staff with no layout'])
})

// A note carrying <lyric number="1"> twice states one line twice, and MNX
// states one lyric per line per event. The corpus check kept the last of the
// two, which agreed with the converter dropping the first, so a real loss
// would have passed. Comparing the texts is what makes the check say
// anything: two saying the same thing lose nothing, two differing lose one.
function verse(text: string, number = '1'): string {
  return `<lyric number="${number}"><text>${text}</text></lyric>`
}

function withLyrics(body: string): XmlElement {
  return parseXmlRoot(
    '<score-partwise><part id="P1"><measure number="3">' +
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>1</duration><type>quarter</type>${body}</note>` +
      '</measure></part></score-partwise>',
  )
}

test('two lyrics on one line saying different things is a loss', () => {
  expect(differingLyricLines(withLyrics(verse('FIRST') + verse('SECOND')))).toEqual([
    'part P1 measure 3 line 1: "FIRST/" against "SECOND/"',
  ])
})

test('two lyrics on one line saying the same thing lose nothing', () => {
  expect(differingLyricLines(withLyrics(verse('same') + verse('same')))).toEqual([])
})

test('two lyrics on different lines are two verses, not a loss', () => {
  expect(differingLyricLines(withLyrics(verse('one') + verse('two', '2')))).toEqual([])
})

// The syllabic says how the syllable joins its word, and MNX states one for
// the event, so two that agree on the words and not on the syllabic still
// lose one of the two. The reader reports that; the check has to see it.
test('two lyrics on one line differing only in the syllabic is a loss', () => {
  const syllable = (spelling: string) =>
    `<lyric number="1"><syllabic>${spelling}</syllabic><text>sing</text></lyric>`

  expect(differingLyricLines(withLyrics(syllable('begin') + syllable('end')))).toEqual([
    'part P1 measure 3 line 1: "sing/begin" against "sing/end"',
  ])
})

// A syllable standing on its own is written either way, and both say the
// same thing.
test('a syllabic of single and no syllabic at all say the same thing', () => {
  const single = '<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>'

  expect(differingLyricLines(withLyrics(single + verse('la')))).toEqual([])
})

// An empty <text> is a syllable that draws nothing, and the converter keeps
// the first of the two, so the words are gone if the empty one is first.
test('an empty syllable beside a written one is a loss', () => {
  expect(
    differingLyricLines(withLyrics('<lyric number="1"><text></text></lyric>' + verse('word'))),
  ).toEqual(['part P1 measure 3 line 1: "/" against "word/"'])
})

// A lyric with no <text> at all is a melisma marker rather than a verse, and
// the reader passes over it, so it states nothing to disagree with.
test('a lyric with no text at all states no verse to lose', () => {
  expect(
    differingLyricLines(withLyrics('<lyric number="1"><extend/></lyric>' + verse('word'))),
  ).toEqual([])
})
