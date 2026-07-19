import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

/** Wraps `body` in the smallest document that can carry it. */
function score(body: string): string {
  return `<score-partwise version="4.0">${body}</score-partwise>`
}

/** Wraps `body` in a one-part, one-measure document. */
function measure(body: string): string {
  return score(`<part id="P1"><measure number="1">${body}</measure></part>`)
}

const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readScore(parseXmlRoot(source), warnings)
  return { score: result, warnings: warnings.list() }
}

function readFailure(source: string): MusicXMLError {
  try {
    read(source)
  } catch (e) {
    if (e instanceof MusicXMLError) return e
    throw e
  }
  throw new Error('Expected the read to fail, but it succeeded.')
}

describe('the document element', () => {
  test('rejects timewise MusicXML, naming the conversion needed', () => {
    expect(readFailure('<score-timewise/>').message).toContain('Timewise MusicXML is not supported')
  })

  test('rejects a document that is not a score at all', () => {
    expect(readFailure('<html/>').message).toContain('found <html>')
  })
})

describe('parts', () => {
  test('takes each part name from the part list', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.name).toBe('Flute')
  })

  test('leaves the name unset when the part list does not give one', () => {
    const { score: result } = read(measure(NOTE))

    expect(result.parts[0]?.name).toBeUndefined()
  })

  test('ignores a part list entry with no id to attach a name to', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part><part-name>Nameless</part-name></score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.name).toBeUndefined()
  })

  test('ignores a part list entry that states no name', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"/></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.name).toBeUndefined()
  })

  // MusicXML requires the id, and it is what ties a part to its name and to
  // every warning reported against it.
  test('rejects a part with no id', () => {
    expect(
      readFailure(score('<part><measure><note><rest/><type>whole</type></note></measure></part>'))
        .message,
    ).toContain('missing a "id" attribute')
  })

  test('reports a part whose id the part list never introduces', () => {
    const { warnings } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>' +
          `<part id="P9"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual(['The part list has no entry for part P9.'])
  })
})

describe('measure attributes', () => {
  test('reads the key, time signature, and clef', () => {
    const { score: result } = read(
      measure(
        '<attributes>' +
          '<key><fifths>-3</fifths></key>' +
          '<time><beats>3</beats><beat-type>4</beat-type></time>' +
          '<clef><sign>F</sign><line>4</line></clef>' +
          '</attributes>' +
          NOTE,
      ),
    )

    expect(result.globalMeasures[0]).toEqual({ key: { fifths: -3 }, time: { count: 3, unit: 4 } })
    expect(result.parts[0]?.measures[0]?.clefs).toEqual([{ sign: 'F', staffPosition: 2 }])
  })

  test('reads a key change in a measure that restates no time signature', () => {
    const { score: result } = read(
      measure(`<attributes><key><fifths>4</fifths></key></attributes>${NOTE}`),
    )

    expect(result.globalMeasures[0]).toEqual({ key: { fifths: 4 }, time: undefined })
  })

  test('places a clef by its default line when none is written', () => {
    const { score: result } = read(measure('<attributes><clef><sign>G</sign></clef></attributes>'))

    expect(result.parts[0]?.measures[0]?.clefs).toEqual([{ sign: 'G', staffPosition: -2 }])
  })

  test('rejects a clef MNX has no sign for', () => {
    expect(
      readFailure(measure('<attributes><clef><sign>percussion</sign></clef></attributes>')).message,
    ).toContain('"percussion" clef cannot be represented')
  })

  test('reads every attributes block in a measure, not just the first', () => {
    const { score: result } = read(
      measure(
        '<attributes><clef><sign>G</sign></clef></attributes>' +
          `${NOTE}<attributes><clef><sign>F</sign></clef></attributes>${NOTE}`,
      ),
    )

    expect(result.parts[0]?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -2 },
      { sign: 'F', staffPosition: 2 },
    ])
  })

  test('rejects a beat unit that is not a power of two', () => {
    expect(
      readFailure(
        measure('<attributes><time><beats>4</beats><beat-type>5</beat-type></time></attributes>'),
      ).message,
    ).toContain('cannot be written as a note value')
  })

  test('rejects a time signature with no beats in it', () => {
    expect(
      readFailure(
        measure('<attributes><time><beats>0</beats><beat-type>4</beat-type></time></attributes>'),
      ).message,
    ).toContain('0 beats')
  })

  test('rejects a number that is not whole, naming the element', () => {
    expect(
      readFailure(measure('<attributes><key><fifths>two</fifths></key></attributes>')).message,
    ).toContain('<fifths> is not a whole number: "two"')
  })

  // Number() would read these as 16 and 1000. Quietly reinterpreting a
  // score's digits is exactly the guessing this converter refuses to do.
  test.each(['0x10', '1e3', '0b101', '0o17'])('rejects "%s" as a number', (written) => {
    expect(
      readFailure(measure(`<attributes><key><fifths>${written}</fifths></key></attributes>`))
        .message,
    ).toContain('is not a whole number')
  })

  test('rejects an octave outside the range MusicXML allows', () => {
    expect(
      readFailure(
        measure('<note><pitch><step>C</step><octave>99</octave></pitch><type>whole</type></note>'),
      ).message,
    ).toContain('octave')
  })

  test('rejects a clef on a line the staff does not have', () => {
    expect(
      readFailure(measure('<attributes><clef><sign>G</sign><line>９</line></clef></attributes>'))
        .message,
    ).toContain('is not a whole number')
  })

  test('rejects a key with no fifths', () => {
    expect(readFailure(measure('<attributes><key/></attributes>')).message).toContain(
      'missing a <fifths> child',
    )
  })
})

describe('notes', () => {
  test('reads a pitch, including its alteration', () => {
    const { score: result } = read(
      measure(
        '<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch>' +
          '<type>quarter</type></note>',
      ),
    )

    expect(result.parts[0]?.measures[0]?.sequences[0]?.events[0]?.notes[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
  })

  test('counts augmentation dots', () => {
    const { score: result } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>half</type><dot/><dot/></note>',
      ),
    )

    expect(result.parts[0]?.measures[0]?.sequences[0]?.events[0]?.value).toEqual({
      base: 'half',
      dots: 2,
    })
  })

  test('reads a rest as an event with no notes', () => {
    const { score: result } = read(measure('<note><rest/><type>whole</type></note>'))
    const event = result.parts[0]?.measures[0]?.sequences[0]?.events[0]

    expect(event?.isRest).toBe(true)
    expect(event?.notes).toEqual([])
  })

  test("spells MusicXML's long as MNX's longa", () => {
    const { score: result } = read(measure('<note><rest/><type>long</type></note>'))

    expect(result.parts[0]?.measures[0]?.sequences[0]?.events[0]?.value.base).toBe('longa')
  })

  test('refuses to guess a rhythm when the note has no type', () => {
    expect(
      readFailure(measure('<note><pitch><step>C</step><octave>4</octave></pitch></note>')).message,
    ).toContain('without a <type> is not supported yet')
  })

  test('rejects a note type it does not know', () => {
    expect(readFailure(measure('<note><rest/><type>triangle</type></note>')).message).toContain(
      'Unknown note type "triangle"',
    )
  })

  test('rejects a note that is both a rest and a pitch', () => {
    expect(
      readFailure(
        measure(
          '<note><rest/><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>',
        ),
      ).message,
    ).toContain('both a rest and a pitch')
  })

  test('rejects a note that is neither a rest nor a pitch', () => {
    expect(readFailure(measure('<note><type>whole</type></note>')).message).toContain(
      'neither <pitch> nor <rest>',
    )
  })

  test('rejects a pitch step that is not a note name', () => {
    expect(
      readFailure(
        measure('<note><pitch><step>H</step><octave>4</octave></pitch><type>whole</type></note>'),
      ).message,
    ).toContain('Unknown pitch step "H"')
  })

  test('locates a failure by part, measure, and line', () => {
    const failure = readFailure(
      '<score-partwise>\n<part id="P2">\n<measure number="7">\n<note><rest/></note>\n' +
        '</measure>\n</part>\n</score-partwise>',
    )

    expect(failure.path).toEqual(['score-partwise', 'part P2', 'measure 7'])
    expect(failure.line).toBe(4)
  })
})

describe('measure numbering', () => {
  test('reports a measure by the number the score gives it', () => {
    const failure = readFailure(
      score('<part id="P1"><measure number="12"><note><type>whole</type></note></measure></part>'),
    )

    expect(failure.path).toContain('measure 12')
  })

  test('falls back to position when the number is not a plain integer', () => {
    const failure = readFailure(
      score('<part id="P1"><measure number="3a"><note><type>whole</type></note></measure></part>'),
    )

    expect(failure.path).toContain('measure 1')
  })
})

describe('reporting what is not converted', () => {
  test('reports an unconverted element with its name, place, and line', () => {
    const { warnings } = read(
      '<score-partwise>\n<part id="P1">\n<measure number="1">\n<direction/>\n' +
        `${NOTE}\n</measure>\n</part>\n</score-partwise>`,
    )

    expect(warnings).toEqual([
      {
        code: 'unsupported:element',
        message: '<direction> is not converted yet.',
        context: { part: 'P1', measure: 1, line: 4 },
      },
    ])
  })

  test('reports unconverted document-level elements', () => {
    const { warnings } = read(
      score(`<identification/><part id="P1"><measure>${NOTE}</measure></part>`),
    )

    expect(warnings.map((w) => w.message)).toEqual(['<identification> is not converted yet.'])
  })

  test('reports unconverted attributes', () => {
    const { warnings } = read(measure(`<attributes><staves>2</staves></attributes>${NOTE}`))

    expect(warnings.map((w) => w.message)).toEqual(['<staves> is not converted yet.'])
  })

  test('reports unconverted parts of a note', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type>' +
          '<beam number="1">begin</beam><notations/></note>',
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      '<beam> is not converted yet.',
      '<notations> is not converted yet.',
    ])
  })

  test('says nothing when everything converted', () => {
    const { warnings } = read(measure(NOTE))

    expect(warnings).toEqual([])
  })
})

// In MNX, global.measures is the score's measure list: a part's measures line
// up with it by position. A score with more measures than global entries is
// structurally wrong, and the schema cannot catch it.
describe('the global measure list', () => {
  test('has one entry per measure, even where nothing is declared', () => {
    const { score: result } = read(
      score(
        '<part id="P1">' +
          '<measure number="1"><attributes>' +
          '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          `${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure>` +
          `<measure number="3">${NOTE}</measure>` +
          '</part>',
      ),
    )

    expect(result.globalMeasures).toHaveLength(3)
    expect(result.globalMeasures[0]?.time).toEqual({ count: 4, unit: 4 })
    expect(result.globalMeasures[2]).toEqual({ key: undefined, time: undefined, number: undefined })
  })

  test('is as long as the longest part', () => {
    const { score: result } = read(
      score(
        `<part id="P1"><measure number="1">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures).toHaveLength(2)
  })

  // A pickup is numbered 0, which shifts every later measure's number one
  // below its position, so all of them have to be carried, not just the
  // pickup itself.
  test('keeps measure numbers that do not match their positions', () => {
    const { score: result } = read(
      score(
        `<part id="P1"><measure number="0">${NOTE}</measure>` +
          `<measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures.map((m) => m.number)).toEqual([0, 1])
  })

  test('says nothing about numbering that already matches position', () => {
    const { score: result } = read(
      score(
        `<part id="P1"><measure number="1">${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures.map((m) => m.number)).toEqual([undefined, undefined])
  })

  test('reports a measure label it cannot represent as a number', () => {
    const { warnings } = read(score(`<part id="P1"><measure number="3a">${NOTE}</measure></part>`))

    expect(warnings.map((w) => w.message)).toEqual([
      'The measure label "3a" is not a number, and is not carried over.',
    ])
  })
})

describe('several parts', () => {
  test('takes each measure’s key and time from the first part that states them', () => {
    const { score: result } = read(
      score(
        '<part id="P1"><measure number="1">' +
          '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
          `${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
          `${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures).toEqual([{ key: undefined, time: { count: 6, unit: 8 } }])
    expect(result.parts).toHaveLength(2)
  })
})
