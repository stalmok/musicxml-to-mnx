// The source-side readers behind the corpus checks. They read the XML
// independently of the converter, so their own readings need pinning where
// the format allows more than one shape for the same music.

import { expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import type { MNXDocument, MNXSequenceItem } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import {
  collectStarts,
  crowdedMeasureRests,
  lyricPlaces,
  differingLyricLines,
  layoutLosses,
  measuresWarned,
  pitchesOf,
  sounding,
  sourceLyricPlaces,
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

// A transposing part is written at the pitch its player reads. MNX states the
// pitch the instrument sounds, so the source-side reader applies the source's
// own <transpose> before comparing.
test('a transposing part is compared at the pitch it sounds', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>2</fifths></key>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
      <note>
        <pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))

  // A written C sounds a B-flat, and a written E-flat a D-flat.
  expect(inSource).toEqual(['part 1 measure 1: B4(-1) D5(-1)'])

  const { mnx } = convertMusicXML(source)
  expect(pitchesOf(mnx)).toEqual(inSource)
  expect(schemaErrors(mnx)).toEqual([])
})

// A part changes instrument partway through a measure, which real scores
// write as "muta in A" or "To Piccolo". Both sides read the notes before the
// change at the instrument that was playing them.
test('a transposition stated partway through a measure applies from there', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
      <attributes>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))

  // The first note is still at concert pitch; the second sounds a B-flat.
  expect(inSource).toEqual(['part 1 measure 1: C5 B4(-1)'])

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

// The rule MNX states in prose and the schema does not carry: a sequence that
// states a rest filling its measure holds nothing else. The check reads a
// document built by hand, because the converter refuses every source that
// would produce one.
test('a sequence resting its measure and holding content is named', () => {
  const document = {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                voice: '1',
                content: [{ duration: { base: 'eighth' }, rest: {} }],
                fullMeasure: {},
              },
              { voice: '2', content: [], fullMeasure: {} },
            ],
          },
        ],
      },
    ],
  } as unknown as MNXDocument

  expect(crowdedMeasureRests(document)).toEqual(['part 1 measure 1 voice 1'])
})

test('a sequence resting its measure and holding nothing is not named', () => {
  const { mnx } = convertMusicXML(
    '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
      '</time></attributes>' +
      '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
      '</measure></part></score-partwise>',
  )

  expect(crowdedMeasureRests(mnx)).toEqual([])
})

// Closed-score hymnals write two lines in one <voice>, laid over each other
// with <backup>. The converter states each as its own sequence, so the
// source-side reading has to group them the same way: grouping strictly by
// <voice> would read one line where the music has two.
test('a voice sounding two notes at once counts as two lines', () => {
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
        <duration>2</duration><voice>1</voice><type>half</type>
      </note>
      <backup><duration>1</duration></backup>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))
  expect(inSource).toEqual(['part 1 measure 1: C5 | E4'])

  const { mnx } = convertMusicXML(source)
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A run written as one run stays in one line, so the reading follows the
// line the voice last sounded in wherever it has room rather than returning
// to the first the moment that one is free.
test('a laid-over line keeps the notes written after it', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>2</duration><voice>1</voice><type>half</type>
      </note>
      <backup><duration>1</duration></backup>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))
  expect(inSource).toEqual(['part 1 measure 1: C5 | E4 G4'])

  const { mnx } = convertMusicXML(source)
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A grace note takes none of the measure's time, so it overlaps nothing and
// opens no line of its own. It belongs to the note it leads into, which a
// <forward> can put in a different line from the one it was written after.
test('a grace note follows the note it leads into, not where it was written', () => {
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
        <duration>2</duration><voice>1</voice><type>half</type>
      </note>
      <backup><duration>2</duration></backup>
      <note>
        <grace/><pitch><step>B</step><octave>4</octave></pitch>
        <voice>1</voice><type>eighth</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`
  const inSource = sourcePitches(parseXmlRoot(source))
  expect(inSource).toEqual(['part 1 measure 1: B4 E4 | C5'])

  const { mnx } = convertMusicXML(source)
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// Lyrics are compared by the note each syllable is sung on, because a voice
// that sounds two lines at once is one <voice> in the source and two
// sequences in MNX, so the two sides have no grouping in common.
test('a syllable on each of a voice two lines is read on the note that sings it', () => {
  const sung = (step: string, duration: number, type: string, text: string): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><voice>1</voice><type>${type}</type>` +
    `<lyric number="1"><syllabic>single</syllabic><text>${text}</text></lyric></note>`
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
      ${sung('C', 2, 'half', 'Glo')}
      <backup><duration>1</duration></backup>
      ${sung('E', 1, 'quarter', 'ri')}
    </measure>
  </part>
</score-partwise>
`
  const { mnx } = convertMusicXML(source)

  expect(lyricPlaces(mnx).sort()).toEqual([
    'part 1 measure 1 at 0.000000000 line 1: Glo',
    'part 1 measure 1 at 0.250000000 line 1: ri',
  ])
  expect(lyricPlaces(mnx).sort()).toEqual(sourceLyricPlaces(parseXmlRoot(source)).sort())
})

// MNX advances the sequence cursor by a tuplet's outer and requires its
// content to fill inner. A tuplet holding less than its ratio counts still
// occupies its whole outer, so the check has to measure it that way: scaling
// the content by the ratio instead reproduces the converter's own arithmetic,
// and the two agree with each other whatever the source said.
const quarter = { base: 'quarter' as const, dots: 0 }
const eighth = { base: 'eighth' as const, dots: 0 }
const note = (duration: { base: 'quarter' | 'eighth'; dots: number }): MNXSequenceItem => ({
  type: 'event',
  duration,
  notes: [{ pitch: { step: 'C', octave: 4, alter: 0 } }],
})
const underfilled: MNXSequenceItem = {
  type: 'tuplet',
  inner: { duration: eighth, multiple: 3 },
  outer: { duration: eighth, multiple: 2 },
  content: [note(eighth)],
}

test('a tuplet holding less than its ratio counts still occupies its outer', () => {
  expect(sounding(underfilled)).toBe(1 / 4)
})

test('what follows an underfilled tuplet begins after its whole outer', () => {
  const starts = new Set<string>()
  collectStarts([underfilled, note(quarter)], 0, 1, starts)

  expect([...starts]).toEqual([(0).toFixed(9), (0.25).toFixed(9)])
})

test('a warning names the measure it was reported against', () => {
  const root = parseXmlRoot(
    '<score-partwise><part id="P2"><measure number="1"/><measure number="2"/></part>' +
      '<part id="P1"><measure number="1"/></part></score-partwise>',
  )
  const at = (part: string, measure: number) => ({
    code: 'inconsistent:tuplet' as const,
    context: { part, measure },
  })

  expect(measuresWarned(root, [at('P2', 2), at('P1', 1)], 'inconsistent:tuplet')).toEqual(
    new Set(['0:1', '1:0']),
  )
})

test('a warning of another code, or naming no measure, names nothing', () => {
  const root = parseXmlRoot(
    '<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>',
  )
  const warnings = [
    { code: 'inconsistent:tuplet' as const, context: { part: 'P1' } },
    { code: 'inconsistent:tuplet' as const, context: { measure: 1 } },
    { code: 'inconsistent:duration' as const, context: { part: 'P1', measure: 1 } },
  ]

  expect(measuresWarned(root, warnings, 'inconsistent:tuplet')).toEqual(new Set())
})
