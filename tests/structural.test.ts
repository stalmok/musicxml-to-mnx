// The source-side readers behind the corpus checks. They read the XML
// independently of the converter. These tests pin their readings where the
// format allows more than one shape for the same music.

import { describe, expect, test } from 'vitest'
import { convertValid } from './support/convert.js'
import type { ConversionWarning, MNXDocument, MNXEvent, MNXSequenceItem } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import {
  collectStarts,
  crowdedMeasureRests,
  lyricPlaces,
  differingLyricLines,
  drawnKeyDisagreements,
  layoutLosses,
  measureLengthDisagreements,
  holdsUnderfilledTuplet,
  flipLetters,
  pitchesOf,
  sounding,
  sourceLyricPlaces,
  sourceMeasureLengths,
  sourceMicrotones,
  sourcePitches,
  unsourcedLosses,
} from './support/structural.js'

// Sibelius states no <voice> on chord members. A chord member belongs to the
// voice of its base note.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))
  expect(inSource).toEqual(['part 1 measure 1: C5 D5 | G4 B4 A4'])

  // The converter reads it the same way.
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// MNX states a whole number of semitones, so a microtone converts to the
// nearest whole alteration, a half-way one to the smaller, and is reported.
test('a microtone is read as the whole alteration MNX states, and counted', () => {
  const note = (step: string, alter: string) =>
    `<note><pitch><step>${step}</step><alter>${alter}</alter><octave>4</octave></pitch>` +
    '<duration>1</duration><voice>1</voice><type>quarter</type></note>'
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>5</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      ${note('C', '-1.5')}${note('D', '-0.5')}${note('E', '0.5')}${note('F', '1.75')}${note('G', '1')}
    </measure>
  </part>
</score-partwise>
`
  const root = parseXmlRoot(source)
  const { mnx, warnings } = convertValid(source)
  const inSource = sourcePitches(root, flipLetters(mnx))
  expect(inSource).toEqual(['part 1 measure 1: C4(-1) D4 E4 F4(2) G4(1)'])
  expect(sourceMicrotones(root)).toBe(4)

  expect(pitchesOf(mnx)).toEqual(inSource)
  expect(warnings.filter((w) => w.code === 'unrepresentable:microtone')).toHaveLength(4)
})

// A <backup> can go back past the start of the measure. A note written there
// is written at the start, and a <forward> that brings the cursor back
// cancels the overshoot.
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

  const { mnx } = convertValid(source)
  expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content).toHaveLength(1)
})

test('a note written before the measure starts counts from the start', () => {
  // The backup leaves the cursor a whole note before the measure, and the
  // second voice writes a whole note there. Measured from the source's cursor,
  // it ends a quarter in. Measured from the start, where the converter writes
  // it, the measure sounds for a whole note.
  const source = backupMeasure(
    QUARTER +
      '<backup><duration>4</duration></backup>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch>' +
      '<duration>4</duration><voice>2</voice><type>whole</type></note>',
  )

  expect(sourceMeasureLengths(parseXmlRoot(source))).toEqual([[1]])

  // The second voice starts at the measure start, so it holds its note alone.
  const { mnx } = convertValid(source)
  const sequences = mnx.parts[0]?.measures[0]?.sequences
  expect(sequences?.[1]?.content).toHaveLength(1)
})

// Some exporters write the first measure of a multi-measure rest twice over:
// rests lasting the measure, then one rest with no <type> lasting as long
// again.
describe('a rest repeating the rests before it', () => {
  const multiRest =
    '<attributes><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<measure-style><multiple-rest>3</multiple-rest></measure-style></attributes>'
  const rest = (duration: number, type?: string, voice = '1') =>
    `<note><rest/><duration>${String(duration)}</duration><voice>${voice}</voice>` +
    (type === undefined ? '' : `<type>${type}</type>`) +
    '</note>'
  const lengths = (body: string) => sourceMeasureLengths(parseXmlRoot(backupMeasure(body)))

  test('adds no time in the first measure of a multi-measure rest', () => {
    expect(lengths(multiRest + rest(4, 'whole') + rest(1, 'quarter') + rest(5))).toEqual([[1.25]])
  })

  test('adds its time in a measure that opens no multi-measure rest', () => {
    expect(lengths(rest(4, 'whole') + rest(4))).toEqual([[2]])
  })

  test('adds its time where it states a <type>', () => {
    expect(lengths(multiRest + rest(4, 'whole') + rest(4, 'whole'))).toEqual([[2]])
  })

  test('adds its time after a note', () => {
    expect(lengths(multiRest + QUARTER + rest(1))).toEqual([[0.5]])
  })

  test('adds its time after rests in another voice', () => {
    expect(lengths(multiRest + rest(4, 'whole', '2') + rest(4))).toEqual([[2]])
  })

  test('adds no time after a <backup> and <forward> back to where the rests end', () => {
    expect(
      lengths(
        multiRest +
          rest(4, 'whole') +
          '<backup><duration>2</duration></backup><forward><duration>2</duration></forward>' +
          rest(4),
      ),
    ).toEqual([[1]])
  })

  test('adds its time where it starts elsewhere than where the rests end', () => {
    expect(
      lengths(multiRest + rest(4, 'whole') + '<backup><duration>4</duration></backup>' + rest(4)),
    ).toEqual([[1]])
    expect(
      lengths(multiRest + rest(4, 'whole') + '<forward><duration>4</duration></forward>' + rest(4)),
    ).toEqual([[3]])
  })

  test('adds its time after a rest with no <type>', () => {
    expect(lengths(multiRest + rest(1) + rest(1) + rest(2))).toEqual([[1]])
  })

  test('adds no time in each voice that repeats its rests', () => {
    expect(
      lengths(
        multiRest +
          rest(4, 'whole') +
          rest(4) +
          '<backup><duration>8</duration></backup>' +
          rest(4, 'whole', '2') +
          rest(4, undefined, '2'),
      ),
    ).toEqual([[1]])
  })

  test('adds its time in a voice that sounds a note later in the measure', () => {
    const note =
      '<note><pitch><step>C</step><octave>5</octave></pitch>' +
      '<duration>1</duration><voice>1</voice><type>quarter</type></note>'
    expect(lengths(multiRest + rest(4, 'whole') + rest(4) + note)).toEqual([[2.25]])
  })

  test('adds its time where it lasts other than the rests before it', () => {
    expect(lengths(multiRest + rest(4, 'whole') + rest(2))).toEqual([[1.5]])
  })
})

// A transposing part is written at the pitch its player reads. MNX states the
// pitch the instrument sounds, so the source-side reader applies <transpose>
// before it compares.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))

  // A written C sounds a B-flat, and a written E-flat a D-flat.
  expect(inSource).toEqual(['part 1 measure 1: B4(-1) D5(-1)'])

  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A B-flat clarinet in a score of five sharps writes five flats rather than
// seven sharps. MNX draws the part by moving each note a letter up from its
// sounding pitch, so the pitch it must state is the one spelled in the score's
// key: a written D-flat is stated as B, not C-flat.
test('a part that flips its key signature is compared in the score’s key', () => {
  const part = (id: string, attributes: string, step: string, alter: number) =>
    `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions>${attributes}` +
    `</attributes><note><pitch><step>${step}</step>` +
    (alter !== 0 ? `<alter>${String(alter)}</alter>` : '') +
    '<octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
    '</note></measure></part>'
  const source =
    '<score-partwise version="3.0"><part-list>' +
    '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
    '<score-part id="P2"><part-name>Clarinet</part-name></score-part></part-list>' +
    part('P1', '<key><fifths>5</fifths></key>', 'B', 0) +
    part(
      'P2',
      '<key><fifths>-5</fifths></key>' +
        '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
      'D',
      -1,
    ) +
    '</score-partwise>'

  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))

  expect(inSource).toEqual(['part 1 measure 1: B5', 'part 2 measure 1: B4'])
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A written E natural in that part would be a concert C double-sharp moved
// by the flip, so it keeps D and states one letter down as its own. The check
// reads it at the spelling the flip alone would move.
test('a note stating its own letter move is compared where the flip moves it from', () => {
  const part = (id: string, attributes: string, step: string) =>
    `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions>${attributes}` +
    `</attributes><note><pitch><step>${step}</step><octave>5</octave></pitch>` +
    '<duration>1</duration><voice>1</voice><type>quarter</type></note></measure></part>'
  const source =
    '<score-partwise version="3.0"><part-list>' +
    '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
    '<score-part id="P2"><part-name>Clarinet</part-name></score-part></part-list>' +
    part('P1', '<key><fifths>5</fifths></key>', 'B') +
    part(
      'P2',
      '<key><fifths>-5</fifths></key>' +
        '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
      'E',
    ) +
    '</score-partwise>'

  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))

  expect(inSource).toEqual(['part 1 measure 1: B5', 'part 2 measure 1: C5(2)'])
  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A part changes instrument partway through a measure ("muta in A", "To
// Piccolo"). Both sides read the notes before the change at the instrument
// that played them.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))

  // The first note is still at concert pitch; the second sounds a B-flat.
  expect(inSource).toEqual(['part 1 measure 1: C5 B4(-1)'])

  expect(pitchesOf(mnx)).toEqual(inSource)
})

// The layout checks. A layout can state less than the part list and stay
// legal MNX: a staff with no label reference hides its part's name, and a
// multi-staff part left as bare sibling staves loses its grand staff. The
// schema cannot see either.

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

test('a part the layout never names is not drawn', () => {
  const document = layoutDocument(
    [{ type: 'staff', sources: [{ part: 'P1' }] }],
    [{ id: 'P1', measures: [] }, { id: 'P2', measures: [] }, { measures: [] }],
  )

  expect(layoutLosses(document)).toEqual([
    'part P2: not in the layout',
    'part 3: not in the layout',
  ])
})

// A staff names its part by id, so it reaches only the first part holding it.
test('a second part sharing an id is not drawn', () => {
  const document = layoutDocument(
    [{ type: 'staff', sources: [{ part: 'P1' }] }],
    [
      { id: 'P1', measures: [] },
      { id: 'P1', measures: [] },
    ],
  )

  expect(layoutLosses(document)).toEqual(['part 2: not in the layout'])
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

test('a part left out of the layout loses only its place in it', () => {
  const document = layoutDocument(
    [{ type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] }],
    [
      { id: 'P1', name: 'Voice', measures: [] },
      { id: 'P2', name: 'Piano', staves: 2, measures: [] },
    ],
  )

  expect(layoutLosses(document)).toEqual(['part P2: not in the layout'])
})

test('a document of single staves needs no layout', () => {
  expect(
    layoutLosses({ mnx: { version: 1 }, global: { measures: [] }, parts: [{ measures: [] }] }),
  ).toEqual([])
})

// A multi-staff part needs a layout to state its grand staff.
test('a multi-staff part with no layout at all is a loss', () => {
  expect(
    layoutLosses({
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [{ id: 'P1', staves: 2, measures: [] }],
    }),
  ).toEqual(['part P1: multi-staff with no layout'])
})

// A note with <lyric number="1"> twice states one line twice, and MNX states
// one lyric per line per event. The check compares the texts: two that are
// the same lose nothing, two that differ lose one.
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

// A syllable of only whitespace draws nothing, so the reader states no verse
// for it and it cannot disagree with the line's other verse.
test('a whitespace syllable beside a real one is not a disagreement', () => {
  const source = withLyrics(verse('La') + verse(' '))

  expect(differingLyricLines(source)).toEqual([])
  // The source states no <divisions>, which has its own warning, so only the
  // lyric warnings are compared.
  const { warnings } = convertValid(sourceOf(verse('La') + verse(' ')))
  expect(warnings.filter((warning) => warning.element !== 'divisions')).toEqual([])
})

// The syllabic says how the syllable joins its word, and MNX states one per
// event. Two lyrics with the same words and a different syllabic lose one.
test('two lyrics on one line differing only in the syllabic is a loss', () => {
  const syllable = (spelling: string) =>
    `<lyric number="1"><syllabic>${spelling}</syllabic><text>sing</text></lyric>`

  expect(differingLyricLines(withLyrics(syllable('begin') + syllable('end')))).toEqual([
    'part P1 measure 3 line 1: "sing/begin" against "sing/end"',
  ])
})

test('a syllabic of single and no syllabic at all say the same thing', () => {
  const single = '<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>'

  expect(differingLyricLines(withLyrics(single + verse('la')))).toEqual([])
})

// An empty <text> draws nothing, so the reader states no verse for it and
// the words of the lyric beside it are the line's.
test('an empty syllable beside a written one is not a loss', () => {
  const body = '<lyric number="1"><text></text></lyric>' + verse('word')

  expect(differingLyricLines(withLyrics(body))).toEqual([])
  const { mnx } = convertValid(sourceOf(body))
  const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
  expect(event).toMatchObject({ lyrics: { lines: { 1: { text: 'word' } } } })
})

// A chord is one event, so its notes sing one lyric per line between them.
test('two notes of a chord singing one line differently is a loss', () => {
  const member =
    '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
    `<duration>1</duration><type>quarter</type>${verse('tu')}</note>`
  const source = parseXmlRoot(sourceOf(verse('is')).replace('</measure>', `${member}</measure>`))

  expect(differingLyricLines(source)).toEqual(['part P1 measure 3 line 1: "is/" against "tu/"'])
})

// A lyric with no <text> is a melisma marker, not a verse, and the reader
// skips it.
test('a lyric with no text at all states no verse to lose', () => {
  expect(
    differingLyricLines(withLyrics('<lyric number="1"><extend/></lyric>' + verse('word'))),
  ).toEqual([])
})

// MNX states in prose, not in the schema, that a sequence with a rest filling
// its measure holds nothing else. The document is built by hand, because the
// converter refuses every source that would produce one.
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
  const { mnx } = convertValid(
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
// source-side reading groups them the same way.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))
  expect(inSource).toEqual(['part 1 measure 1: C5 | E4'])

  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A run written as one run stays in one line. The reading follows the line
// the voice last sounded in while that line has room, and does not go back to
// the first line when it is free.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))
  expect(inSource).toEqual(['part 1 measure 1: C5 | E4 G4'])

  expect(pitchesOf(mnx)).toEqual(inSource)
})

// A grace note takes none of the measure's time, so it opens no line of its
// own. It belongs to the note it leads into, which a <forward> can put in a
// different line from the one it was written after.
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
  const { mnx } = convertValid(source)
  const inSource = sourcePitches(parseXmlRoot(source), flipLetters(mnx))
  expect(inSource).toEqual(['part 1 measure 1: B4 E4 | C5'])

  expect(pitchesOf(mnx)).toEqual(inSource)
})

// Lyrics are compared by the note each syllable is sung on. A voice that
// sounds two lines at once is one <voice> in the source and two sequences in
// MNX.
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
  const { mnx } = convertValid(source)

  expect(lyricPlaces(mnx).sort()).toEqual([
    'part 1 measure 1 at 0.000000000 line 1: Glo',
    'part 1 measure 1 at 0.250000000 line 1: ri',
  ])
  expect(lyricPlaces(mnx).sort()).toEqual(sourceLyricPlaces(parseXmlRoot(source)).sort())
})

// The cursor moves by each <duration>, and a voice places its next note after
// the written value of the one before.
describe('a syllable after a note whose duration differs from its written value', () => {
  const note = (step: string, voice: number, duration: number, text?: string): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><voice>${String(voice)}</voice><type>quarter</type>` +
    (text === undefined
      ? ''
      : `<lyric number="1"><syllabic>single</syllabic><text>${text}</text></lyric>`) +
    '</note>'
  const backup = (duration: number) => `<backup><duration>${String(duration)}</duration></backup>`
  const source = (notes: string) => `<?xml version="1.0" encoding="UTF-8"?>
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
      ${notes}
    </measure>
  </part>
</score-partwise>
`

  test.each([
    ['in the same voice', note('C', 1, 2, 'la') + note('D', 1, 1, 'lo')],
    [
      'in a voice after a <backup> past another voice',
      note('C', 1, 1, 'la') + backup(1) + note('A', 2, 2) + backup(1) + note('D', 1, 1, 'lo'),
    ],
  ])('is read where the converter sings it, %s', (_, notes) => {
    const xml = source(notes)
    const { mnx } = convertValid(xml)

    expect(lyricPlaces(mnx).sort()).toEqual([
      'part 1 measure 1 at 0.000000000 line 1: la',
      'part 1 measure 1 at 0.250000000 line 1: lo',
    ])
    expect(sourceLyricPlaces(parseXmlRoot(xml)).sort()).toEqual(lyricPlaces(mnx).sort())
  })
})

// MNX advances the sequence cursor by a tuplet's outer and requires its
// content to fill inner. A tuplet that holds less than its ratio counts still
// takes its whole outer, so the check measures it that way. Scaling the
// content by the ratio would repeat the converter's own arithmetic, so a
// tuplet whose content disagrees with its ratio would never show.
const quarter = { base: 'quarter' as const, dots: 0 }
const eighth = { base: 'eighth' as const, dots: 0 }
const note = (duration: { base: 'quarter' | 'eighth'; dots: number }): MNXEvent => ({
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

test('a tuplet holding less than its ratio counts is named', () => {
  expect(holdsUnderfilledTuplet([underfilled])).toBe(true)
})

test('a tuplet holding what its ratio counts is not', () => {
  const filled: MNXSequenceItem = {
    type: 'tuplet',
    inner: { duration: eighth, multiple: 3 },
    outer: { duration: eighth, multiple: 2 },
    content: [note(eighth), note(eighth), note(eighth)],
  }

  expect(holdsUnderfilledTuplet([filled, note(quarter)])).toBe(false)
})

// A nested tuplet or a tremolo counts in its parent for the time it takes,
// and the check also walks into it.
test('a tuplet is measured by its outer where it stands inside another', () => {
  const nested: MNXSequenceItem = {
    type: 'tuplet',
    inner: { duration: eighth, multiple: 2 },
    outer: { duration: eighth, multiple: 2 },
    content: [note(eighth), underfilled],
  }

  expect(holdsUnderfilledTuplet([nested])).toBe(true)
})

test('a grace group takes none of the time its tuplet counts', () => {
  const withGrace: MNXSequenceItem = {
    type: 'tuplet',
    inner: { duration: eighth, multiple: 2 },
    outer: { duration: eighth, multiple: 3 },
    content: [{ type: 'grace', content: [note(eighth)] }, note(eighth), note(eighth)],
  }

  expect(holdsUnderfilledTuplet([withGrace])).toBe(false)
})

test('a space counts toward what a tuplet holds', () => {
  const withSpace: MNXSequenceItem = {
    type: 'tuplet',
    inner: { duration: eighth, multiple: 3 },
    outer: { duration: eighth, multiple: 2 },
    content: [note(eighth), note(eighth), { type: 'space', duration: [1, 8] }],
  }

  expect(holdsUnderfilledTuplet([withSpace])).toBe(false)
})

describe('the measure length check', () => {
  /** A quarter taking two of the three eighth slots of its own 3:2 bracket. */
  const shortQuarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  const quarter = (step: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>12</duration><type>quarter</type></note>'

  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  function score(...parts: string[]): string {
    const list = parts
      .map((_, index) => `<score-part id="P${String(index + 1)}"><part-name/></score-part>`)
      .join('')
    const written = parts
      .map(
        (body, index) =>
          `<part id="P${String(index + 1)}"><measure number="1">${TIMED}${body}</measure></part>`,
      )
      .join('')
    return `<score-partwise><part-list>${list}</part-list>${written}</score-partwise>`
  }

  function disagreements(source: string, edit?: (mnx: MNXDocument) => void): string[] {
    const { mnx, warnings } = convertValid(source)
    edit?.(mnx)
    return measureLengthDisagreements(mnx, parseXmlRoot(source), warnings)
  }

  test('holds a measure the converter writes as the source does', () => {
    expect(disagreements(score(quarter('C') + quarter('D')))).toEqual([])
  })

  test('reports a note that sounds longer than the source gives it', () => {
    const lengthened = (mnx: MNXDocument) => {
      const first = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0] as MNXEvent
      first.duration = { base: 'half' }
    }
    expect(disagreements(score(quarter('C') + quarter('D')), lengthened)).toEqual([
      'part 1 measure 1: 0.75 against 0.5 in the source',
    ])
  })

  // The other part fills the measure, so the part written short is silent to
  // the barline. The bracket takes in that silence to keep its ratio.
  test('lets a part written short run on in silence to the barline', () => {
    const source = score(quarter('C') + quarter('D'), shortQuarter)
    const { mnx } = convertValid(source)
    const bracket = mnx.parts[1]?.measures[0]?.sequences[0]?.content[0]

    expect(bracket && 'type' in bracket && bracket.type).toBe('tuplet')
    expect(disagreements(source)).toEqual([])
  })

  test('reports a note that sounds past where a part written short runs', () => {
    const lengthened = (mnx: MNXDocument) => {
      const only = mnx.parts[1]?.measures[0]?.sequences[0]?.content[0] as MNXEvent
      only.duration = { base: 'half' }
    }
    expect(disagreements(score(quarter('C') + quarter('D'), quarter('E')), lengthened)).toEqual([
      'part 2 measure 1: 0.5 against 0.25 in the source',
    ])
  })

  /** Wraps the last event of the first sequence in a bracket that ends on a quarter of silence. */
  const closedOnSilence = (partIndex: number) => (mnx: MNXDocument) => {
    const sequence = mnx.parts[partIndex]?.measures[0]?.sequences[0]
    const last = sequence?.content.pop() as MNXEvent
    sequence?.content.push({
      type: 'tuplet',
      inner: { duration: { base: 'quarter' }, multiple: 2 },
      outer: { duration: { base: 'quarter' }, multiple: 2 },
      content: [last, { type: 'space', duration: [1, 4] }],
    })
  }

  test('reports silence in a bracket that runs past the barline', () => {
    expect(disagreements(score(quarter('C') + quarter('D')), closedOnSilence(0))).toEqual([
      'part 1 measure 1: 0.75 against 0.5 in the source',
    ])
  })

  test('reports silence written outside a bracket past where the part runs', () => {
    const padded = (mnx: MNXDocument) => {
      mnx.parts[1]?.measures[0]?.sequences[0]?.content.push({ type: 'space', duration: [1, 4] })
    }
    expect(disagreements(score(quarter('C') + quarter('D'), quarter('E')), padded)).toEqual([
      'part 2 measure 1: 0.5 against 0.25 in the source',
    ])
  })

  test('reports silence past a part that states no time signature', () => {
    const untimed = score(quarter('C')).replace(/<time>.*?<\/time>/, '')
    expect(disagreements(untimed, closedOnSilence(0))).toEqual([
      'part 1 measure 1: 0.5 against 0.25 in the source',
    ])
  })

  // A pickup ends where its music does: the time signature counts from the
  // barline after it, so no silence runs on to it.
  test('reports silence in a bracket that runs past the end of a pickup', () => {
    const pickup = score(quarter('C')).replace(
      '<measure number="1">',
      '<measure number="0" implicit="yes">',
    )
    const inBar = score(quarter('C'))

    expect(disagreements(inBar, closedOnSilence(0))).toEqual([])
    expect(disagreements(pickup, closedOnSilence(0))).toEqual([
      'part 1 measure 1: 0.5 against 0.25 in the source',
    ])
  })

  // No pair of note values states a quarter sounding a sixth of a whole note,
  // so the bracket takes the time its stated ratio gives it, with a warning.
  test('passes over the measure a tuplet ratio report names', () => {
    const source = score(shortQuarter + quarter('D'))
    const { mnx, warnings } = convertValid(source)

    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tuplet-ratio')
    expect(measureLengthDisagreements(mnx, parseXmlRoot(source), warnings)).toEqual([])
    expect(measureLengthDisagreements(mnx, parseXmlRoot(source), [])).toHaveLength(1)
  })

  // A bracket that no pair of note values counts is dropped, and its notes
  // take their written time, so the voice the warning names may hold no
  // tuplet.
  test('passes over the voice a tuplet ratio report names, whatever it holds', () => {
    const lines = [
      TIMED,
      quarter('C').replace('</duration>', '</duration><voice>1</voice>'),
      quarter('D').replace('</duration>', '</duration><voice>1</voice>'),
      '<backup><duration>24</duration></backup>',
      quarter('E').replace('</duration>', '</duration><voice>2</voice>'),
      quarter('F').replace('</duration>', '</duration><voice>2</voice>'),
    ]
    const source =
      '<score-partwise><part-list><score-part id="P1"><part-name/></score-part></part-list>\n' +
      `<part id="P1"><measure number="1">\n${lines.join('\n')}\n</measure></part></score-partwise>`
    const { mnx } = convertValid(source)
    const lengthen = (voice: number) => {
      const last = mnx.parts[0]?.measures[0]?.sequences[voice]?.content[1] as MNXEvent
      last.duration = { base: 'half' }
    }
    const report = (line: number): ConversionWarning => ({
      code: 'unrepresentable:tuplet-ratio',
      message: '',
      element: undefined,
      attribute: undefined,
      context: { part: 'P1', measure: 1, line },
    })
    const root = parseXmlRoot(source)

    lengthen(1)
    expect(measureLengthDisagreements(mnx, root, [report(8)])).toEqual([])
    lengthen(0)
    expect(measureLengthDisagreements(mnx, root, [report(8)])).toEqual([
      'part 1 measure 1: voice 1 runs 0.75 against 0.5 in the source',
    ])
  })

  // The source may name a voice as the converter names a laid-over line.
  test('holds a source voice named with a dot apart from the voice before the dot', () => {
    const lines = [
      TIMED,
      quarter('C').replace('</duration>', '</duration><voice>1</voice>'),
      quarter('D').replace('</duration>', '</duration><voice>1</voice>'),
      '<backup><duration>24</duration></backup>',
      quarter('E').replace('</duration>', '</duration><voice>1.2</voice>'),
      quarter('F').replace('</duration>', '</duration><voice>1.2</voice>'),
    ]
    const source =
      '<score-partwise><part-list><score-part id="P1"><part-name/></score-part></part-list>\n' +
      `<part id="P1"><measure number="1">\n${lines.join('\n')}\n</measure></part></score-partwise>`
    const { mnx } = convertValid(source)
    const sequences = mnx.parts[0]?.measures[0]?.sequences ?? []
    const last = sequences[1]?.content[1] as MNXEvent
    last.duration = { base: 'half' }
    const report: ConversionWarning = {
      code: 'unrepresentable:tuplet-ratio',
      message: '',
      element: undefined,
      attribute: undefined,
      context: { part: 'P1', measure: 1, line: 4 },
    }

    expect(sequences.map((sequence) => sequence.voice)).toEqual(['1', '1.2'])
    expect(measureLengthDisagreements(mnx, parseXmlRoot(source), [report])).toEqual([
      'part 1 measure 1: voice 2 runs 0.75 against 0.5 in the source',
    ])
  })

  test('maps a laid-over line to the voice it is laid over', () => {
    const lines = [
      TIMED,
      quarter('C').replace('</duration>', '</duration><voice>1.2</voice>'),
      quarter('D').replace('</duration>', '</duration><voice>1.2</voice>'),
      '<backup><duration>24</duration></backup>',
      quarter('E').replace('</duration>', '</duration><voice>1.2</voice>'),
      quarter('F').replace('</duration>', '</duration><voice>1.2</voice>'),
    ]
    const source =
      '<score-partwise><part-list><score-part id="P1"><part-name/></score-part></part-list>\n' +
      `<part id="P1"><measure number="1">\n${lines.join('\n')}\n</measure></part></score-partwise>`
    const { mnx } = convertValid(source)
    const sequences = mnx.parts[0]?.measures[0]?.sequences ?? []
    const laidOver = sequences.find((sequence) => sequence.voice === '1.2.2')
    const last = laidOver?.content[1] as MNXEvent
    last.duration = { base: 'half' }
    const report: ConversionWarning = {
      code: 'unrepresentable:tuplet-ratio',
      message: '',
      element: undefined,
      attribute: undefined,
      context: { part: 'P1', measure: 1, line: 4 },
    }

    expect(sequences.map((sequence) => sequence.voice).sort()).toEqual(['1.2', '1.2.2'])
    expect(measureLengthDisagreements(mnx, parseXmlRoot(source), [report])).toEqual([])
  })

  test('holds the other voices of a measure a tuplet ratio report names', () => {
    // One note to a line, since the report names the note by its line.
    const source = score(
      [
        shortQuarter,
        quarter('D'),
        '<backup><duration>20</duration></backup>',
        quarter('E').replace('</duration>', '</duration><voice>2</voice>'),
        quarter('F').replace('</duration>', '</duration><voice>2</voice>'),
      ].join('\n'),
    )
    const lengthened = (mnx: MNXDocument) => {
      const second = mnx.parts[0]?.measures[0]?.sequences[1]?.content[1] as MNXEvent
      second.duration = { base: 'half' }
    }
    expect(disagreements(source, lengthened)).toEqual([
      'part 1 measure 1: voice 2 runs 0.75 against 0.5 in the source',
    ])
  })
})

describe('the elements and attributes a warning names', () => {
  const source = [
    '<score-partwise>',
    '<part id="P1"><measure number="1">',
    '<note>',
    '<pitch><step>C</step><octave>4</octave></pitch>',
    '<tie type="start"/>',
    '</note>',
    '<note print-object="no"><rest/></note>',
    '</measure></part>',
    '</score-partwise>',
  ].join('\n')
  const lost = (element: string | undefined, line: number | undefined, attribute?: string) =>
    unsourcedLosses(parseXmlRoot(source), [
      {
        code: 'unsupported:element',
        message: '',
        element,
        attribute,
        context: line === undefined ? {} : { line },
      },
    ])

  test('accepts the element on the line, one it holds, and one holding it', () => {
    expect(lost('note', 3)).toEqual([])
    expect(lost('tie', 3)).toEqual([])
    expect(lost('note', 5)).toEqual([])
  })

  test('names an element the source does not hold', () => {
    expect(lost('tied', undefined)).toEqual(['unsupported:element tied@'])
  })

  test('names an element the source holds only elsewhere', () => {
    expect(lost('tie', 7)).toEqual(['unsupported:element tie@'])
  })

  test('names an attribute no element of that name carries', () => {
    expect(lost('note', 7, 'print-object')).toEqual([])
    expect(lost('rest', 7, 'print-object')).toEqual(['unsupported:element rest@print-object'])
  })

  test('names an attribute given with no element', () => {
    expect(lost(undefined, undefined, 'id')).toEqual(['unsupported:element @id'])
  })

  test('holds every missing loss but the missing divisions to the source', () => {
    const named = (code: ConversionWarning['code']) =>
      unsourcedLosses(parseXmlRoot(source), [
        { code, message: '', element: 'divisions', attribute: undefined, context: {} },
      ])

    expect(named('missing:divisions')).toEqual([])
    expect(named('missing:voice')).toEqual(['missing:voice divisions@'])
  })
})

describe('the key each part draws, against its source', () => {
  const NOTE =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'
  /** Written a major second above what it sounds. */
  const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
  const part = (id: string, ...keys: (string | undefined)[]) =>
    `<part id="${id}">` +
    keys
      .map(
        (key, index) =>
          `<measure number="${String(index + 1)}">` +
          (index === 0 ? '<attributes><divisions>4</divisions>' : '<attributes>') +
          `${key ?? ''}</attributes>${NOTE}</measure>`,
      )
      .join('') +
    '</part>'
  const key = (fifths: number, extra = '') =>
    `<key><fifths>${String(fifths)}</fifths></key>${extra}`
  const check = (parts: string, change?: (mnx: MNXDocument) => void) => {
    const source = `<score-partwise>${parts}</score-partwise>`
    const { mnx, warnings } = convertValid(source)
    change?.(mnx)
    return drawnKeyDisagreements(mnx, parseXmlRoot(source), warnings)
  }

  test('finds nothing where a flipping part is drawn in the key it writes', () => {
    expect(check(part('P1', key(5)) + part('P2', key(-5, B_FLAT)))).toEqual([])
  })

  test('finds a flipping part drawn without its flip point', () => {
    const lost = check(part('P1', key(5)) + part('P2', key(-5, B_FLAT)), (mnx) => {
      const transposition = mnx.parts[1]?.transposition
      if (transposition) delete transposition.keyFifthsFlipAt
    })

    expect(lost).toEqual(['P2 measure 1: draws 7 fifths, the source -5'])
  })

  // P2 changes key a measure before P1, and the score takes P2's key.
  test('passes over every part from a reported disagreement until the score states a key', () => {
    expect(
      check(part('P1', key(0), undefined, key(2)) + part('P2', key(0), key(2), undefined)),
    ).toEqual([])
  })

  // P2 and P3 change key a measure apart, and P1 stays in its own.
  test('passes over a part drawn in another key until it is drawn in its own', () => {
    expect(
      check(
        part('P1', key(0), undefined, undefined) +
          part('P2', key(0), key(2), undefined) +
          part('P3', key(0), undefined, key(2)),
      ),
    ).toEqual([])
  })

  test('finds a part drawn in another key once it agreed again', () => {
    const lost = check(
      part('P1', key(0), undefined, key(2), undefined) +
        part('P2', key(0), key(2), undefined, undefined),
      (mnx) => {
        const last = mnx.global.measures[3]
        if (last) last.key = { fifths: 4 }
      },
    )

    expect(lost).toEqual([
      'P1 measure 4: draws 4 fifths, the source 2',
      'P2 measure 4: draws 4 fifths, the source 2',
    ])
  })

  test('takes a key written after the notes of a measure from the next', () => {
    const late =
      '<part id="P1"><measure number="1"><attributes><divisions>4</divisions>' +
      `<key><fifths>0</fifths></key></attributes>${NOTE}` +
      `<attributes><key><fifths>3</fifths></key></attributes></measure>` +
      `<measure number="2">${NOTE}</measure></part>`

    expect(check(late)).toEqual([])
  })

  test('starts where the source first states a key', () => {
    expect(check(part('P1', undefined, key(2)))).toEqual([])
  })
})

// A melisma line runs from the syllable that starts it to the last later note
// whose lyric holds only an <extend>, and the check reads it from the source
// as the converter does.
describe('a melisma line in the source', () => {
  const note = (step: string, lyrics: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
    `<voice>1</voice><type>quarter</type>${lyrics}</note>`
  const sung = (text: string, extend = '') =>
    `<lyric number="1"><text>${text}</text>${extend}</lyric>`
  const held = (type: string) => `<lyric number="1"><extend type="${type}"/></lyric>`
  const chord = (step: string, lyrics: string) =>
    `<note><chord/><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
    `<voice>1</voice><type>quarter</type>${lyrics}</note>`
  const source = (notes: string) =>
    '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
    `</attributes>${notes}</measure></part></score-partwise>`

  test.each([
    [
      'a line to the note that stops it',
      note('C', sung('la', '<extend/>')) + note('D', held('stop')),
    ],
    ['a line with no end', note('C', sung('la', '<extend/>')) + note('D', sung('lo'))],
    [
      'a line from a second copy of the verse',
      note('C', sung('la') + sung('la', '<extend/>')) + note('D', held('stop')),
    ],
    [
      'a line stopped on its own note',
      note('C', sung('la', '<extend type="start"/>') + held('stop')) + note('D', ''),
    ],
    [
      'a line from a note of a chord',
      note('C', '') + chord('E', sung('la', '<extend/>')) + note('D', held('stop')),
    ],
    [
      'a syllable two notes of a chord sing',
      note('C', sung('la', '<extend/>')) + chord('E', sung('la')) + note('D', held('stop')),
    ],
    [
      'an <extend> restating the line its own chord starts',
      note('C', sung('la', '<extend/>')) + chord('E', held('continue')) + note('D', ''),
    ],
    [
      'a stop restated by a note of the chord',
      note('C', sung('la', '<extend/>')) + note('D', held('stop')) + chord('F', held('stop')),
    ],
  ])('agrees with the converter on %s', (_, notes) => {
    const xml = source(notes)
    const { mnx } = convertValid(xml)

    expect(sourceLyricPlaces(parseXmlRoot(xml)).sort()).toEqual(lyricPlaces(mnx).sort())
    expect(sourceLyricPlaces(parseXmlRoot(xml)).join()).toContain('with a line')
  })
})
