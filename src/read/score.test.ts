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

/**
 * The first item of a measure's first sequence, when that item is an event.
 * A sequence can also hold a space, so reaching for a note value needs to say
 * which it expects.
 */
function firstEvent(result: ReturnType<typeof read>['score'], measure = 0) {
  const item = result.parts[0]?.measures[measure]?.sequences[0]?.content[0]
  return item?.kind === 'event' ? item : undefined
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

// Everything a global measure can state beyond a key, a time and a tempo.
// Spread into the expectations below so that adding a field to the model does
// not mean editing every one of them.
const NO_BARLINE = {
  barline: undefined,
  repeatStart: false,
  repeatEnd: undefined,
  ending: undefined,
  fermata: undefined,
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

    expect(result.globalMeasures[0]).toEqual({
      key: { fifths: -3 },
      time: { count: 3, unit: 4 },
      tempos: [],
      number: undefined,
      ...NO_BARLINE,
    })
    expect(result.parts[0]?.measures[0]?.clefs).toEqual([
      { sign: 'F', staffPosition: 2, staff: undefined, position: { num: 0, den: 1 } },
    ])
  })

  test('reads a key change in a measure that restates no time signature', () => {
    const { score: result } = read(
      measure(`<attributes><key><fifths>4</fifths></key></attributes>${NOTE}`),
    )

    expect(result.globalMeasures[0]).toEqual({
      key: { fifths: 4 },
      time: undefined,
      tempos: [],
      number: undefined,
      ...NO_BARLINE,
    })
  })

  test('places a clef by its default line when none is written', () => {
    const { score: result } = read(measure('<attributes><clef><sign>G</sign></clef></attributes>'))

    expect(result.parts[0]?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 } },
    ])
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
      { sign: 'G', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 } },
      { sign: 'F', staffPosition: 2, staff: undefined, position: { num: 1, den: 1 } },
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

    expect(firstEvent(result)?.notes[0]?.pitch).toEqual({
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

    expect(firstEvent(result)?.value).toEqual({
      base: 'half',
      dots: 2,
    })
  })

  test('reads a rest as an event with no notes', () => {
    const { score: result } = read(measure('<note><rest/><type>whole</type></note>'))
    const event = firstEvent(result)

    expect(event?.isRest).toBe(true)
    expect(event?.notes).toEqual([])
  })

  test("spells MusicXML's long as MNX's longa", () => {
    const { score: result } = read(measure('<note><rest/><type>long</type></note>'))

    expect(firstEvent(result)?.value.base).toBe('longa')
  })

  test('refuses to guess a rhythm when the note states no length at all', () => {
    expect(
      readFailure(measure('<note><pitch><step>C</step><octave>4</octave></pitch></note>')).message,
    ).toContain('states neither a <type> nor a <duration>')
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

describe('durations', () => {
  test('recovers a note value from the duration when nothing is written', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration></note>',
      ),
    )

    expect(firstEvent(result)?.value).toEqual({
      base: 'quarter',
      dots: 1,
    })
  })

  test('carries divisions forward into later measures', () => {
    const { score: result } = read(
      score(
        '<part id="P1">' +
          '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
          `${NOTE}</measure>` +
          '<measure number="2"><note><rest/><duration>8</duration></note></measure>' +
          '</part>',
      ),
    )

    expect(firstEvent(result, 1)?.value).toEqual({
      base: 'half',
      dots: 0,
    })
  })

  test('rejects a duration when the score never said what a division is', () => {
    expect(readFailure(measure('<note><rest/><duration>4</duration></note>')).message).toContain(
      '<divisions>',
    )
  })

  test('rejects a duration that no note value can write', () => {
    expect(
      readFailure(
        measure(
          '<attributes><divisions>3</divisions></attributes>' +
            '<note><rest/><duration>1</duration></note>',
        ),
      ).message,
    ).toContain('no note value')
  })

  test('reports a duration that disagrees with the written note value', () => {
    const { warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest/><type>half</type><duration>4</duration></note>',
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
    expect(warnings[0]?.message).toContain('lasts a quarter')
  })

  test('says nothing when the duration matches the written note value', () => {
    const { warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest/><type>half</type><duration>8</duration></note>',
      ),
    )

    expect(warnings).toEqual([])
  })

  // A tuplet's written value is deliberately longer than it sounds, so
  // converting it as an ordinary note would emit a measure that does not add
  // up. Better to say so than to hand back the wrong rhythm.
  test('rejects a note inside a tuplet', () => {
    expect(
      readFailure(
        measure(
          '<attributes><divisions>3</divisions></attributes>' +
            '<note><rest/><type>eighth</type><duration>1</duration>' +
            '<time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification></note>',
        ),
      ).message,
    ).toContain('tuplet')
  })
})

describe('whole-measure rests', () => {
  test('marks the sequence rather than inventing a note value for it', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>12</duration></note>',
      ),
    )
    const sequence = result.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toEqual({ visualDuration: undefined })
    expect(sequence?.content).toEqual([])
  })

  test('keeps the drawn value when the rest says which one it is', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>12</duration><type>whole</type></note>',
      ),
    )

    expect(result.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({
      visualDuration: { base: 'whole', dots: 0 },
    })
  })

  // Rare, but a measure rest need not state how long it lasts, because the
  // time signature already says. Nothing then moves the cursor.
  test('does not need a duration to be understood', () => {
    const { score: result } = read(measure('<note><rest measure="yes"/></note>'))

    expect(result.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({
      visualDuration: undefined,
    })
  })

  test('is not confused with an ordinary rest', () => {
    const { score: result } = read(measure('<note><rest/><type>whole</type></note>'))

    expect(result.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toBeUndefined()
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
      '<score-partwise>\n<part id="P1">\n<measure number="1">\n<print/>\n' +
        `${NOTE}\n</measure>\n</part>\n</score-partwise>`,
    )

    expect(warnings).toEqual([
      {
        code: 'unsupported:element',
        message: '<print> is not converted yet.',
        // Named as a field, so a report can be grouped by what was lost
        // without parsing the sentence written for a person to read.
        element: 'print',
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
    const { warnings } = read(
      measure(`<attributes><instruments>2</instruments></attributes>${NOTE}`),
    )

    expect(warnings.map((w) => w.message)).toEqual(['<instruments> is not converted yet.'])
  })

  test('reports unconverted parts of a note', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type>' +
          '<notehead>diamond</notehead></note>',
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual(['<notehead> is not converted yet.'])
  })

  // <notations> holds a mixture, and some of it is converted now. Reporting
  // the block wholesale would claim a slur was dropped when it was carried
  // over, so what is inside it is reported instead.
  test('reports what a notations block holds, not the block itself', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type>' +
          '<notations><tied type="start"/><technical/><ornaments/></notations></note>',
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      '<technical> is not converted yet.',
      '<ornaments> is not converted yet.',
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
    expect(result.globalMeasures[2]).toEqual({
      key: undefined,
      time: undefined,
      tempos: [],
      number: undefined,
      ...NO_BARLINE,
    })
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

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:measure-label'])
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

    expect(result.globalMeasures).toEqual([
      { key: undefined, time: { count: 6, unit: 8 }, tempos: [], number: undefined, ...NO_BARLINE },
    ])
    expect(result.parts).toHaveLength(2)
  })
})

// A tempo belongs to the score, but MusicXML has to write it inside a part,
// and exporters routinely write the same mark into every one of them.
describe('a tempo stated by more than one part', () => {
  const metronome =
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
    '<per-minute>96</per-minute></metronome></direction-type></direction>'

  test('states it once, however many parts wrote it', () => {
    const { score: result } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${metronome}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 96 },
    ])
  })

  test('keeps both where the parts state different tempos', () => {
    const slower = metronome.replace('96', '60')
    const { score: result } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${slower}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96, 60])
  })
})

// The global list is the score's measure list and every part lines up with it
// by position, so a part of a different length falls silent partway through
// or runs past the end. MNX gives a part a plain list of measures, so nothing
// downstream can tell.
describe('parts of different lengths', () => {
  test('reports a part that stops before the score does', () => {
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:measure-count'])
    expect(warnings[0]?.message).toContain('P2 has 1 measures where the score has 2')
    expect(warnings[0]?.context.part).toBe('P2')
  })

  test('says nothing where every part runs the whole score', () => {
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings).toEqual([])
  })
})
