// The source-side readers behind the corpus checks. They read the XML
// independently of the converter, so their own readings need pinning where
// the format allows more than one shape for the same music.

import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import type { MNXDocument } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import {
  differingLyricLines,
  layoutLosses,
  pitchesOf,
  sourceMeasureLengths,
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

// A <backup> can reach further back than the measure has run. Nothing sounds
// before a measure starts, so a note written out there is written at the
// start, and a <forward> that brings the cursor back cancels the reach.
function backupMeasure(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${body}
    </measure>
  </part>
</score-partwise>
`
}

const QUARTER =
  '<note><pitch><step>C</step><octave>5</octave></pitch>' +
  '<duration>1</duration><voice>1</voice><type>quarter</type></note>'

test('a backup past the measure start that a forward cancels measures from the start', () => {
  const source = backupMeasure(
    '<backup><duration>4</duration></backup><forward><duration>4</duration></forward>' + QUARTER,
  )

  expect(sourceMeasureLengths(parseXmlRoot(source))).toEqual([[0.25]])

  const { mnx } = convertMusicXML(source)
  expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content).toHaveLength(1)
  expect(schemaErrors(mnx)).toEqual([])
})

test('a note written before the measure starts counts from the start', () => {
  // The second voice writes a whole note where the backup left the cursor a
  // whole note before the measure. Measured from where the source put the
  // cursor it would end a quarter in; measured from the start, where the
  // converter writes it, the measure sounds for a whole note.
  const source = backupMeasure(
    QUARTER +
      '<backup><duration>4</duration></backup>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch>' +
      '<duration>4</duration><voice>2</voice><type>whole</type></note>',
  )

  expect(sourceMeasureLengths(parseXmlRoot(source))).toEqual([[1]])

  // The second voice starts at the measure start, so it holds its note alone.
  const { mnx } = convertMusicXML(source)
  const sequences = mnx.parts[0]?.measures[0]?.sequences
  expect(sequences?.[1]?.content).toHaveLength(1)
  expect(schemaErrors(mnx)).toEqual([])
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

function sourceOf(body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="3">' +
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>1</duration><type>quarter</type>${body}</note>` +
    '</measure></part></score-partwise>'
  )
}

function withLyrics(body: string): XmlElement {
  return parseXmlRoot(sourceOf(body))
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

// A syllable that is nothing but whitespace draws nothing, so the reader
// states no verse for it. Compared as one, it would read as a line's second
// verse disagreeing with its first, and fault the converter for a loss the
// converter does not make: it converts the line once and says nothing.
test('a whitespace syllable beside a real one is not a disagreement', () => {
  const source = withLyrics(verse('La') + verse(' '))

  expect(differingLyricLines(source)).toEqual([])
  // The source states no <divisions>, which is its own report and not this
  // one's subject, so only what the lyrics cost is compared.
  const { warnings } = convertMusicXML(sourceOf(verse('La') + verse(' ')))
  expect(warnings.filter((warning) => warning.element !== 'divisions')).toEqual([])
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

// An empty <text> draws nothing, so the reader states no verse for it and
// the words of the lyric beside it are the line's. Counted as a verse, it
// would read as a disagreement and fault the converter for a loss it does
// not make.
test('an empty syllable beside a written one is not a loss', () => {
  const body = '<lyric number="1"><text></text></lyric>' + verse('word')

  expect(differingLyricLines(withLyrics(body))).toEqual([])
  const { mnx } = convertMusicXML(sourceOf(body))
  const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
  expect(event).toMatchObject({ lyrics: { lines: { 1: { text: 'word' } } } })
})

// A lyric with no <text> at all is a melisma marker rather than a verse, and
// the reader passes over it, so it states nothing to disagree with.
test('a lyric with no text at all states no verse to lose', () => {
  expect(
    differingLyricLines(withLyrics('<lyric number="1"><extend/></lyric>' + verse('word'))),
  ).toEqual([])
})
