// What each reader passes over is reported, whichever path it took.
//
// The loss report used to work from a hand-kept list of the children each
// level handles, and the list drifted away from the code: it went on claiming
// a <lyric> was carried over long after the path that reads a chord member
// stopped reading one. These are the paths that drifted, plus the exceptions
// that are genuinely accounted for elsewhere and must stay quiet.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

function measure(body: string, attributes = '<divisions>4</divisions>'): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes>${attributes}</attributes>` +
    `${body}</measure></part></score-partwise>`
  )
}

function note(body: string, step = 'C'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`
  )
}

/** The elements reported as unconverted, in the order they were found. */
function lost(source: string): string[] {
  const warnings = new WarningCollector()
  readScore(parseXmlRoot(source), warnings)
  return warnings
    .list()
    .map((warning) => /<([a-z-]+)>/.exec(warning.message)?.[1])
    .filter((name): name is string => name !== undefined)
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  return { score, warnings: warnings.list() }
}

describe('a note that joins the chord before it', () => {
  const chord = (body: string) =>
    measure(
      note('') +
        `<note><chord/><pitch><step>E</step><octave>4</octave></pitch>` +
        `<duration>4</duration><type>quarter</type>${body}</note>`,
    )

  test('reports the words under it, which are not carried over', () => {
    expect(lost(chord('<lyric number="1"><text>lost</text></lyric>'))).toEqual(['lyric'])
  })

  test('reports a slur starting on it, which is not carried over', () => {
    expect(lost(chord('<notations><slur type="start" number="1"/></notations>'))).toContain('slur')
  })

  test('says nothing about its stem or beams, which are the chord it joins', () => {
    expect(lost(chord('<stem>up</stem><beam number="1">begin</beam>'))).toEqual([])
  })

  test('says nothing about the ratio it repeats, which is the chord it joins', () => {
    expect(
      lost(
        chord(
          '<time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification>',
        ),
      ),
    ).toEqual([])
  })
})

describe('a chord member naming a staff', () => {
  const twoStaves = '<divisions>4</divisions><staves>2</staves>'
  const chord = (headStaff: string, memberStaff: string) =>
    measure(
      note(`<staff>${headStaff}</staff>`) +
        '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><staff>${memberStaff}</staff></note>`,
      twoStaves,
    )

  // MNX states the staff on the event, so the chord's own staff carries it.
  test('says nothing when it is the staff the chord is already on', () => {
    expect(lost(chord('1', '1'))).toEqual([])
  })

  test('reports it when it reaches across to the other staff', () => {
    expect(lost(chord('1', '2'))).toEqual(['note'])
  })
})

describe('a grace note', () => {
  const grace = (body: string) =>
    measure(
      `<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>` +
        `${body}</note>` +
        note(''),
    )

  test('says nothing about its beams, which are carried over', () => {
    expect(lost(grace('<beam number="1">begin</beam>'))).toEqual([])
  })

  test('says nothing about the words under it, which are carried over', () => {
    expect(lost(grace('<lyric number="1"><text>kept</text></lyric>'))).toEqual([])
  })
})

describe('a direction', () => {
  const direction = (body: string) =>
    measure(
      note('') +
        `<direction><direction-type><dynamics><p/></dynamics></direction-type>${body}</direction>`,
    )

  test('says nothing about the offset that moves it, which is applied', () => {
    expect(lost(direction('<offset>2</offset>'))).toEqual([])
  })

  test('reports the playback it carries, which is not converted', () => {
    expect(lost(direction('<sound tempo="120"/>'))).toEqual(['sound'])
  })

  test('says nothing about the staff it belongs to, which is carried over', () => {
    expect(lost(direction('<staff>1</staff>'))).toEqual([])
  })

  test('says nothing when it carries only what is converted', () => {
    expect(lost(direction(''))).toEqual([])
  })
})

describe('a rest that fills the measure', () => {
  const rest = (body: string, attributes?: string) =>
    measure(`<note><rest measure="yes"/><duration>16</duration>${body}</note>`, attributes)

  test('puts its voice on the staff the rest names', () => {
    const { score, warnings } = read(
      rest('<staff>2</staff>', '<divisions>4</divisions><staves>2</staves>'),
    )

    expect(score.parts[0]?.measures[0]?.sequences[0]?.staff).toBe(2)
    expect(warnings).toEqual([])
  })

  test('says nothing about a stem or a beam, which a rest is not drawn with', () => {
    expect(lost(rest('<stem>up</stem><beam number="1">begin</beam>'))).toEqual([])
  })
})

describe('a note stating both kinds of tie', () => {
  // <tied> is the visual counterpart of <tie>, which is what the tie is read
  // from, so a document stating both loses nothing by <tied> going unread.
  test('says nothing about <tied>, which <tie> already carried', () => {
    const source = measure(
      note('<tie type="start"/><notations><tied type="start"/></notations>') +
        note('<tie type="stop"/><notations><tied type="stop"/></notations>', 'D'),
    )

    expect(lost(source)).toEqual([])
  })
})

describe('a cursor move', () => {
  test('reports the voice it names, which the model cannot yet express', () => {
    const source = measure(note('') + '<backup><duration>4</duration><voice>1</voice></backup>')

    expect(lost(source)).toEqual(['voice'])
  })
})
