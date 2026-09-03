import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { convertMusicXML } from '../index.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { GENERATED_ID_PATTERN, readScore } from './score.js'
import { schemaErrors } from '../../tests/support/schema.js'

/** Wraps `body` in the smallest document that can carry it. */
function score(body: string): string {
  return `<score-partwise version="4.0">${body}</score-partwise>`
}

/** Wraps `body` in a one-part, one-measure document. */
function measure(body: string): string {
  return score(`<part id="P1"><measure number="1">${body}</measure></part>`)
}

const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>'

/** A note that takes time, for a mark whose point in the measure is the subject. */
const QUARTER =
  '<note><pitch><step>C</step><octave>4</octave></pitch>' +
  '<duration>4</duration><type>quarter</type></note>'

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
  systemBreak: false,
  pageBreak: false,
}

describe('the document element', () => {
  test('rejects timewise MusicXML, naming the conversion needed', () => {
    expect(readFailure('<score-timewise/>').message).toContain('Timewise MusicXML is not supported')
  })

  test('rejects a document that is not a score at all', () => {
    expect(readFailure('<html/>').message).toContain('found <html>')
  })

  // The parser does not resolve namespaces, so a prefix stays on the name and
  // the plain "found <mx:score-partwise>" message is a puzzle. Name the cause.
  test('rejects a namespace-prefixed document, explaining the prefix', () => {
    const message = readFailure('<mx:score-partwise version="4.0"/>').message

    expect(message).toContain('namespace')
    expect(message).toContain('mx:score-partwise')
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

  // A part name hidden with print-object="no" is one the source chose not to
  // draw. MNX's part.name is optional, so it is omitted rather than drawn.
  test('leaves the name unset when the part list hides it', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"><part-name print-object="no">Flute</part-name>' +
          '</score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.name).toBeUndefined()
  })

  // A hidden name drops out of the names map, but the part is still listed, so
  // it must not be reported as missing its list entry beside a named part.
  test('does not fault a hidden name in a list beside a drawn one', () => {
    const { score: result, warnings } = read(
      score(
        '<part-list>' +
          '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
          '<score-part id="P2"><part-name print-object="no">Piano</part-name></score-part>' +
          '</part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.name).toBe('Flute')
    expect(result.parts[1]?.name).toBeUndefined()
    expect(warnings.map((warning) => warning.code)).not.toContain('unresolved:part-id')
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

  test('takes the abbreviated name from the part list', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name>' +
          '<part-abbreviation>Fl.</part-abbreviation></score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.shortName).toBe('Fl.')
  })

  test('leaves the short name unset when the part list gives none', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.shortName).toBeUndefined()
  })

  // A hidden abbreviation is one the source chose not to draw, so like a hidden
  // name it is omitted rather than drawn.
  test('leaves the short name unset when the part list hides it', () => {
    const { score: result } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name>' +
          '<part-abbreviation print-object="no">Fl.</part-abbreviation>' +
          '</score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.parts[0]?.shortName).toBeUndefined()
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

  test('rejects a clef that states no sign', () => {
    expect(
      readFailure(measure('<attributes><clef><line>2</line></clef></attributes>')).message,
    ).toContain('missing a <sign>')
  })

  test('rejects a time signature that states no beats', () => {
    expect(
      readFailure(measure('<attributes><time><beat-type>4</beat-type></time></attributes>'))
        .message,
    ).toContain('missing a <beats>')
  })

  test('rejects a time signature that states no beat-type', () => {
    expect(
      readFailure(measure('<attributes><time><beats>4</beats></time></attributes>')).message,
    ).toContain('missing a <beat-type>')
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

  // A composite meter such as 3+2/8 is written as several beats-and-beat-type
  // pairs. MNX states one count and unit; keeping the first pair would say the
  // measure is shorter than it sounds, so the file is refused rather than
  // converted to a meter it does not have.
  test('refuses a composite time signature written as several pairs', () => {
    expect(
      readFailure(
        measure(
          '<attributes><time><beats>3</beats><beat-type>8</beat-type>' +
            '<beats>2</beats><beat-type>8</beat-type></time></attributes>',
        ),
      ).message,
    ).toContain('composite time signature')
  })

  // An interchangeable meter offers a second reading of the same measures. The
  // primary meter is a plain time signature MNX states; the alternative has no
  // home, so it is reported and the primary is converted.
  test('reports an interchangeable time signature and keeps the primary meter', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><time><beats>6</beats><beat-type>8</beat-type>' +
          '<interchangeable><time-relation>equals</time-relation>' +
          '<beats>3</beats><beat-type>4</beat-type></interchangeable></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 6, unit: 8, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:interchangeable-time'])
  })

  // Common time is 4/4 drawn with a C, cut time 2/2 drawn with a slashed C.
  // MNX carries the glyph as a display of the count and unit it still states.
  test('carries the common-time symbol', () => {
    const { score: result } = read(
      measure(
        '<attributes><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 4, unit: 4, display: 'common' })
  })

  test('carries the cut-time symbol', () => {
    const { score: result } = read(
      measure(
        '<attributes><time symbol="cut"><beats>2</beats><beat-type>2</beat-type></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 2, display: 'cut' })
  })

  // "normal" is the default: the numbers, which MNX draws anyway. It states no
  // glyph and is not a loss.
  test('takes a normal time symbol as no glyph and no loss', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><time symbol="normal"><beats>4</beats><beat-type>4</beat-type></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 4, unit: 4, display: undefined })
    expect(warnings).toEqual([])
  })

  // MNX draws a time signature as a C, a cut C, or its numbers. A single-number
  // or note-glyph symbol has no home there, so it is reported and the numbers
  // are drawn.
  test('reports a time symbol MNX cannot draw and keeps the numbers', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><time symbol="single-number"><beats>4</beats><beat-type>4</beat-type></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 4, unit: 4, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:time-symbol'])
  })

  // A file may state durations without ever saying how many divisions make a
  // quarter note. The spec names no default; one per quarter is the customary
  // reading, so it is assumed and reported once per part.
  test('assumes one division per quarter when none was ever stated', () => {
    const { score: result, warnings } = read(
      measure(
        '<note><rest/><duration>4</duration><type>whole</type></note>' +
          '<note><rest/><duration>2</duration><type>half</type></note>',
      ),
    )

    expect(result.parts[0]?.measures[0]?.sequences[0]?.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['missing:divisions'])
  })

  // The assumption is checkable only against a written value: a wrong guess
  // shows as an inconsistent:duration warning. A note with no <type> offers
  // nothing to check, and a wrong guess would be a silently wrong length.
  test('refuses an untyped duration under an assumed divisions', () => {
    expect(readFailure(measure('<note><rest/><duration>2</duration></note>')).message).toContain(
      'no <divisions> ever said',
    )
  })

  // A key stated without <fifths> is non-traditional, spelled as individual
  // altered steps. MNX states a key as a count of fifths, so the signature is
  // dropped and reported. The notes still sound right: each carries its own
  // <alter>.
  test('drops a key with no fifths, reporting the loss', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><key><key-step>B</key-step><key-alter>-1</key-alter></key></attributes>' +
          NOTE,
      ),
    )

    expect(result.globalMeasures[0]?.key).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:non-traditional-key', element: 'key' }),
    ])
  })

  // MNX states a key as a count of fifths and nothing else. A mode, the
  // courtesy naturals of a cancelled key, and a per-accidental octave all have
  // no home there, so each is reported rather than dropped without a word.
  test('reports a key mode, which MNX cannot state', () => {
    const { warnings } = read(
      measure('<attributes><key><fifths>2</fifths><mode>minor</mode></key></attributes>'),
    )

    expect(warnings.map((w) => `${w.code}/${w.element ?? ''}`)).toEqual([
      'unrepresentable:element/mode',
    ])
  })

  test('reports a cancelled key signature, which MNX cannot state', () => {
    const { warnings } = read(
      measure('<attributes><key><cancel>-3</cancel><fifths>2</fifths></key></attributes>'),
    )

    expect(warnings.map((w) => `${w.code}/${w.element ?? ''}`)).toEqual([
      'unrepresentable:element/cancel',
    ])
  })

  test('reports a key-octave, which MNX cannot state', () => {
    const { warnings } = read(
      measure(
        '<attributes><key><fifths>2</fifths>' +
          '<key-octave number="1">4</key-octave></key></attributes>',
      ),
    )

    expect(warnings.map((w) => `${w.code}/${w.element ?? ''}`)).toEqual([
      'unrepresentable:element/key-octave',
    ])
  })

  // A plain key states only its fifths, all of which MNX carries, so it is
  // converted with nothing reported.
  test('reports nothing for a plain key signature', () => {
    const { score: result, warnings } = read(
      measure('<attributes><key><fifths>-3</fifths></key></attributes>'),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: -3 })
    expect(warnings).toEqual([])
  })

  // The first statement in a measure is the one it shows, and a statement
  // MNX cannot carry is still a statement: a later block in the same measure
  // may not fill in what an earlier one deliberately left empty.
  test('does not let a later time signature overwrite senza misura', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>1</divisions><time><senza-misura/></time></attributes>' +
          NOTE +
          '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.time).toBeUndefined()
  })

  test('does not let a later key overwrite a dropped non-traditional one', () => {
    const { score: result } = read(
      measure(
        '<attributes><key><key-step>B</key-step><key-alter>-1</key-alter></key></attributes>' +
          NOTE +
          '<attributes><key><fifths>2</fifths></key></attributes>',
      ),
    )

    expect(result.globalMeasures[0]?.key).toBeUndefined()
  })

  // <senza-misura> writes unmetered music, which MNX has no way to state.
  test('converts senza misura as a measure with no time signature', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>1</divisions><time><senza-misura/></time></attributes>' + NOTE,
      ),
    )

    expect(result.globalMeasures[0]?.time).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:senza-misura', element: 'senza-misura' }),
    ])
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

  // Some exporters leave measure="yes" off: a rest with no written value
  // lasting exactly the measure is the same statement. In 5/16 that length
  // has no note value at all, so reading it as an ordinary rest would fail.
  test('treats an untyped rest lasting the whole measure as one', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions>' +
          '<time><beats>5</beats><beat-type>16</beat-type></time></attributes>' +
          '<note><rest/><duration>5</duration></note>',
      ),
    )
    const sequence = result.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toEqual({ visualDuration: undefined })
    expect(sequence?.content).toEqual([])
  })

  // Real scores write an occasional extra rest over the measure rest in the
  // same voice. Both are silence, so the measure rest stands and the extra
  // is reported.
  test('drops an extra rest written over a measure rest, reporting it', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          '<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>',
      ),
    )
    const sequence = result.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toEqual({ visualDuration: undefined })
    expect(sequence?.content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest'])
  })

  // Without a duration nothing moves the cursor, and the drop is the same.
  test('drops an extra rest that states no duration', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
          '<note><rest/><voice>1</voice><type>quarter</type></note>',
      ),
    )

    expect(result.parts[0]?.measures[0]?.sequences[0]?.content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest'])
  })

  // A pitched note over a measure rest is a real contradiction, not a
  // redundancy.
  test('still rejects a note written over a measure rest', () => {
    expect(
      readFailure(
        measure(
          '<attributes><divisions>4</divisions></attributes>' +
            '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
            '<backup><duration>4</duration></backup>' +
            '<note><pitch><step>C</step><octave>4</octave></pitch>' +
            '<duration>4</duration><voice>1</voice><type>quarter</type></note>',
        ),
      ).message,
    ).toContain('rest that fills the measure and notes')
  })

  // A shorter untyped rest is a fragment of the measure, not the whole of it.
  test('leaves an untyped rest shorter than the measure an ordinary rest', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions>' +
          '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          '<note><rest/><duration>8</duration></note>' +
          '<note><rest/><duration>8</duration></note>',
      ),
    )
    const sequence = result.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
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
      '<score-partwise>\n<part id="P1">\n<measure number="1">\n<harmony/>\n' +
        `${NOTE}\n</measure>\n</part>\n</score-partwise>`,
    )

    expect(warnings).toEqual([
      {
        code: 'unsupported:element',
        message: '<harmony> is not converted yet.',
        // Named as a field, so a report can be grouped by what was lost
        // without parsing the sentence written for a person to read.
        element: 'harmony',
        context: { part: 'P1', measure: 1, line: 4 },
      },
    ])
  })

  // The concrete attribute case that motivated the sweep: a pickup measure's
  // implicit="yes" says the measure is unnumbered. MNX's measure number is a
  // plain integer override, with no way to state a measure unnumbered.
  test('reports a measure attribute nothing reads', () => {
    const { warnings } = read(
      score(
        '<part id="P1"><measure number="0" implicit="yes">' +
          `<attributes><divisions>1</divisions></attributes>${NOTE}</measure></part>`,
      ),
    )

    expect(warnings).toMatchObject([
      {
        code: 'unrepresentable:attribute',
        message: 'The "implicit" attribute of a <measure> cannot be expressed in MNX.',
        element: 'measure',
        context: { part: 'P1', measure: 1 },
      },
    ])
  })

  test('reports unconverted document-level elements', () => {
    const { warnings } = read(
      score(
        `<work><work-title>Helen</work-title></work>` +
          `<part id="P1"><measure>${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual(['<work> cannot be expressed in MNX.'])
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

    // A notehead shape has no home in MNX, so the loss is the format's.
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
    expect(warnings.map((w) => w.message)).toEqual(['<notehead> cannot be expressed in MNX.'])
  })

  // <notations> holds a mixture, and some of it is converted now. Reporting
  // the block wholesale would claim a slur was dropped when it was carried
  // over, so what is inside it is reported instead. The same holds one level
  // down: an <ornaments> whose tremolo is converted reports only what is
  // actually passed over.
  test('reports what a notations block holds, not the block itself', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type>' +
          '<notations><tied type="start"/><technical/>' +
          '<ornaments><trill-mark/></ornaments></notations></note>',
      ),
    )

    // The <tied> start is a tie the measure never ends, reported as such
    // rather than as an unread block.
    expect(warnings.map((w) => w.message)).toEqual([
      '<technical> is not converted yet.',
      '<trill-mark> cannot be expressed in MNX.',
      'A tie starts on a note that nothing ties to, and is not carried over.',
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

  // MNX numbers a measure with a whole number of zero or more, so a negative
  // label has nowhere to go, like a lettered one.
  test('reports a negative measure label rather than writing it', () => {
    const { score: result, warnings } = read(
      score(`<part id="P1"><measure number="-1">${NOTE}</measure></part>`),
    )

    expect(result.globalMeasures[0]?.number).toBeUndefined()
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

  // Transposing instruments write different key signatures per part, and MNX
  // states one key and one time signature for the whole score, so parts that
  // disagree cannot both be carried.
  test('reports parts stating different keys in the same measure', () => {
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `<attributes><key><fifths>0</fifths></key></attributes>${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><key><fifths>2</fifths></key></attributes>${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 0 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
  })

  test('reports parts stating different time signatures in the same measure', () => {
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
          `${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          `${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 6, unit: 8, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-time'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
  })

  // A time signature stays in force until the next one, so a part that says
  // nothing in the measure where another part changes meter is disagreeing
  // just as much as one that states its own.
  test('reports a part staying in its meter while another changes', () => {
    const time = (count: string, unit: string) =>
      `<attributes><time><beats>${count}</beats><beat-type>${unit}</beat-type></time></attributes>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${time('3', '4')}${NOTE}</measure>` +
          `<measure number="2">${time('6', '8')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${time('3', '4')}${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[1]?.time).toEqual({ count: 6, unit: 8, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-time'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 2 })
  })

  test('reports a part staying in its key while another changes', () => {
    const key = (fifths: string) => `<attributes><key><fifths>${fifths}</fifths></key></attributes>`
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${key('0')}${NOTE}</measure>` +
          `<measure number="2">${key('2')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${key('0')}${NOTE}</measure>` +
          `<measure number="2">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 2 })
  })

  // The C glyph and the numbers write the same meter, so they are not a
  // disagreement.
  test('says nothing where the parts differ only in how the meter is drawn', () => {
    const { warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          '<attributes><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>' +
          `</attributes>${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          `${NOTE}</measure></part>`,
      ),
    )

    expect(warnings).toEqual([])
  })

  test('says nothing where the parts restate the same key', () => {
    const { warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `<attributes><key><fifths>2</fifths></key></attributes>${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><key><fifths>2</fifths></key></attributes>${NOTE}</measure></part>`,
      ),
    )

    expect(warnings).toEqual([])
  })

  test('says nothing where only a later part states the key', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><key><fifths>2</fifths></key></attributes>${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 2 })
    expect(warnings).toEqual([])
  })

  // A barline is the whole score's, so parts closing the same measure with
  // different lines disagree about the one MNX can state.
  test('reports parts closing the same measure with different barlines', () => {
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `${NOTE}<barline location="right"><bar-style>light-heavy</bar-style></barline>` +
          '</measure></part>' +
          '<part id="P2"><measure number="1">' +
          `${NOTE}<barline location="right"><bar-style>light-light</bar-style></barline>` +
          '</measure></part>',
      ),
    )

    expect(result.globalMeasures[0]?.barline).toBe('final')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-barline'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
  })

  test('says nothing where the parts restate the same barline', () => {
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `${NOTE}<barline location="right"><bar-style>light-heavy</bar-style></barline>` +
          '</measure></part>' +
          '<part id="P2"><measure number="1">' +
          `${NOTE}<barline location="right"><bar-style>light-heavy</bar-style></barline>` +
          '</measure></part>',
      ),
    )

    expect(result.globalMeasures[0]?.barline).toBe('final')
    expect(warnings).toEqual([])
  })

  // A segno is the score's navigation mark, restated in each part the same
  // way, so parts stating different signs disagree about the one MNX states.
  test('reports parts stating different segnos on the same measure', () => {
    const segno = (attrs: string) =>
      `<direction><direction-type><segno${attrs}/></direction-type></direction>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${segno(' color="#FF0000"')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${segno('')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.segno?.color).toBe('#FF0000')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-segno'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
  })

  test('says nothing where the parts restate the same segno', () => {
    const segno = '<direction><direction-type><segno/></direction-type></direction>'
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${segno}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${segno}${NOTE}</measure></part>`,
      ),
    )

    expect(warnings).toEqual([])
  })

  // The number is the label the score writes over the measure, so parts
  // giving the same measure different labels is the source disagreeing with
  // itself, not a limit of MNX.
  test('reports parts numbering the same measure differently', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="0">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="5">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.number).toBe(0)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:measure-number'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 5 })
  })

  test('says nothing where the parts restate the same measure number', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="0">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="0">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.number).toBe(0)
    expect(warnings).toEqual([])
  })

  test('reports parts stating different repeat counts for the same measure', () => {
    const repeated = (times: string) =>
      `${NOTE}<barline location="right"><repeat direction="backward" times="${times}"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${repeated('2')}</measure></part>` +
          `<part id="P2"><measure number="1">${repeated('3')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.repeatEnd).toEqual({ times: 2 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-mark'])
    expect(warnings[0]?.element).toBe('repeat')
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
  })

  test('reports parts drawing different endings over the same measure', () => {
    const bracketed = (numbers: string) =>
      `<barline location="left"><ending number="${numbers}" type="start"/></barline>${NOTE}` +
      `<barline location="right"><ending number="${numbers}" type="stop"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${bracketed('1')}</measure></part>` +
          `<part id="P2"><measure number="1">${bracketed('2')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending).toEqual({ duration: 1, numbers: [1], open: false })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-mark'])
    expect(warnings[0]?.element).toBe('ending')
  })

  test('reports parts holding different fermatas over the same barline', () => {
    const held = (shape: string) =>
      `${NOTE}<barline location="right"><fermata>${shape}</fermata></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${held('angled')}</measure></part>` +
          `<part id="P2"><measure number="1">${held('square')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.fermata?.symbol).toBe('angled')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-mark'])
    expect(warnings[0]?.element).toBe('fermata')
  })

  // The name tells one sign from another when a jump is matched to the one it
  // returns to, so parts naming it differently disagree about the sign
  // itself. The <sound segno> attribute is itself reported as not converted,
  // once per part, before the disagreement is.
  test('reports parts naming the segno differently', () => {
    const sign = (name: string) =>
      `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>` +
      NOTE
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${sign('A')}</measure></part>` +
          `<part id="P2"><measure number="1">${sign('B')}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:attribute',
      'unrepresentable:cross-part-segno',
    ])
    expect(warnings[2]?.element).toBe('segno')
  })

  test('says nothing where the parts restate the same named segno', () => {
    const sign =
      '<direction><direction-type><segno/></direction-type><sound segno="A"/></direction>' + NOTE
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${sign}</measure></part>` +
          `<part id="P2"><measure number="1">${sign}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:attribute',
    ])
  })

  test('reports parts placing the fine at different points in the measure', () => {
    const divisions = '<attributes><divisions>1</divisions></attributes>'
    const quarter =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>1</duration><type>quarter</type></note>'
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${divisions}<sound fine="yes"/>${quarter}` +
          '</measure></part>' +
          `<part id="P2"><measure number="1">${divisions}${quarter}<sound fine="yes"/>` +
          '</measure></part>',
      ),
    )

    expect(result.globalMeasures[0]?.fine).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-mark'])
    expect(warnings[0]?.element).toBe('fine')
  })

  test('reports parts jumping back to differently named segnos', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1"><sound dalsegno="A"/>${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1"><sound dalsegno="B"/>${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.jump).toEqual({
      location: { num: 0, den: 1 },
      type: 'segno',
      target: 'A',
    })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-mark'])
    expect(warnings[0]?.element).toBe('jump')
  })

  test('says nothing where the parts restate the same marks', () => {
    const marked =
      '<barline location="left"><ending number="1" type="start"/></barline>' +
      `<sound dalsegno="A"/>${NOTE}<sound fine="yes"/>` +
      '<barline location="right"><ending number="1" type="stop"/>' +
      '<repeat direction="backward" times="2"/><fermata>angled</fermata></barline>'
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${marked}</measure></part>` +
          `<part id="P2"><measure number="1">${marked}</measure></part>`,
      ),
    )

    expect(warnings).toEqual([])
  })
})

// Each predicate that decides whether two parts state the same mark compares
// several fields at once. The tests above differ in one field each, which
// leaves the rest saying nothing: two parts disagreeing on an ending's hook
// or a jump's kind would fold into one and nobody would hear about it. Each
// test here differs in exactly one field the tests above leave alone.
describe('two parts disagreeing on one field of a mark', () => {
  // A segno's position in the measure, not the sign itself.
  test('reports a segno drawn at different points in the measure', () => {
    const segno = '<direction><direction-type><segno/></direction-type></direction>'
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${segno}${QUARTER}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${QUARTER}${segno}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.segno?.location).toEqual({ num: 0, den: 1 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-segno'])
  })

  test('reports a segno drawn as different glyphs', () => {
    const segno = (glyph: string) =>
      `<direction><direction-type><segno${glyph}/></direction-type></direction>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${segno(' smufl="segnoSerpent1"')}${NOTE}` +
          '</measure></part>' +
          `<part id="P2"><measure number="1">${segno('')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.segno?.glyph).toBe('segnoSerpent1')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-segno'])
  })

  // A bracket that closes with a hook and one that runs on are two different
  // endings, whatever numbers they carry.
  test('reports an ending closed in one part and left open in the other', () => {
    const bracketed = (close: string) =>
      '<barline location="left"><ending number="1" type="start"/></barline>' +
      `${NOTE}<barline location="right"><ending number="1" type="${close}"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${bracketed('stop')}</measure></part>` +
          `<part id="P2"><measure number="1">${bracketed('discontinue')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending?.open).toBe(false)
    expect(warnings.map((w) => w.element)).toEqual(['ending'])
  })

  test('reports an ending covering different numbers of times', () => {
    const bracketed = (numbers: string) =>
      `<barline location="left"><ending number="${numbers}" type="start"/></barline>` +
      `${NOTE}<barline location="right"><ending number="${numbers}" type="stop"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${bracketed('1')}</measure></part>` +
          `<part id="P2"><measure number="1">${bracketed('1,2')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending?.numbers).toEqual([1])
    expect(warnings.map((w) => w.element)).toEqual(['ending'])
  })

  // One part brackets a single measure and the other brackets two, so the
  // same numbers cover a different stretch of music.
  test('reports an ending spanning different numbers of measures', () => {
    const start = '<barline location="left"><ending number="1" type="start"/></barline>'
    const stop = '<barline location="right"><ending number="1" type="stop"/></barline>'
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${start}${NOTE}${stop}</measure>` +
          `<measure number="2">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${start}${NOTE}</measure>` +
          `<measure number="2">${NOTE}${stop}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending?.duration).toBe(1)
    expect(warnings.map((w) => w.element)).toEqual(['ending'])
  })

  test('reports a fermata facing different ways', () => {
    const held = (facing: string) =>
      `${NOTE}<barline location="right"><fermata type="${facing}">normal</fermata></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${held('upright')}</measure></part>` +
          `<part id="P2"><measure number="1">${held('inverted')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.fermata?.pointing).toBe('up')
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  test('reports a fermata drawn on different sides of the notes', () => {
    const held = (side: string) =>
      `${NOTE}<barline location="right"><fermata placement="${side}">normal</fermata></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${held('above')}</measure></part>` +
          `<part id="P2"><measure number="1">${held('below')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.fermata?.orient).toBe('above')
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  // A jump's kind is not compared here, and cannot be: <sound dalsegno> is
  // the only jump the reader takes from a source, so every jump is a plain
  // segno at this point. The dal-segno-al-Fine kind is settled in a later
  // pass, once the whole score is known, which is after the parts are merged.
  test('reports a jump taken at different points in the measure', () => {
    const divisions = '<attributes><divisions>1</divisions></attributes>'
    const quarter =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>1</duration><type>quarter</type></note>'
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${divisions}<sound dalsegno="A"/>${quarter}` +
          '</measure></part>' +
          `<part id="P2"><measure number="1">${divisions}${quarter}<sound dalsegno="A"/>` +
          '</measure></part>',
      ),
    )

    expect(warnings.map((w) => w.element)).toEqual(['jump'])
  })

  // The meter itself: 3/4 against 4/4 differs in the count, 4/4 against 4/2
  // in the unit. Only both together say the same meter.
  test('reports parts stating time signatures with the same unit and different counts', () => {
    const timed = (count: string) =>
      `<attributes><time><beats>${count}</beats><beat-type>4</beat-type></time></attributes>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${timed('3')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${timed('4')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.time).toMatchObject({ count: 3, unit: 4 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-time'])
  })

  test('reports parts stating time signatures with the same count and different units', () => {
    const timed = (unit: string) =>
      `<attributes><time><beats>4</beats><beat-type>${unit}</beat-type></time></attributes>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${timed('4')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${timed('2')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.time).toMatchObject({ count: 4, unit: 4 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-time'])
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

  // Two tempos at one point contradict each other: a renderer would draw both
  // over the same beat, and a player would have to pick one. The parts
  // disagree about what the score does, so the first is kept and the
  // disagreement is reported, as it is for every other mark they share.
  test('reports parts stating different tempos at the same point', () => {
    const slower = metronome.replace('96', '60')
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${slower}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
    expect(warnings[0]?.element).toBe('metronome')
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1 })
    // Named as a disagreement between parts, not within one: a report that
    // sends a reader looking for a second part that is not there is no use.
    expect(warnings[0]?.message).toBe(
      'The parts of this score state different tempos at the same point in this measure. ' +
        'The first stated is the one converted.',
    )
  })

  // One part writing two marks at one point is the same disagreement with
  // nobody else involved, so the report says so rather than naming parts.
  test('reports one part stating two different tempos at the same point', () => {
    const slower = metronome.replace('96', '60')
    const { score: result, warnings } = read(
      score(`<part id="P1"><measure number="1">${metronome}${slower}${NOTE}</measure></part>`),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
    expect(warnings[0]?.message).toBe(
      'This part states two different tempos at the same point in this measure. ' +
        'The first is the one converted.',
    )
  })

  // Each mark dropped is a loss of its own, so each is reported, the way a
  // third part disagreeing about any other mark is.
  test('reports every part that disagrees, not just the first', () => {
    const slower = metronome.replace('96', '60')
    const slowest = metronome.replace('96', '40')
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${slower}${NOTE}</measure></part>` +
          `<part id="P3"><measure number="1">${slowest}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96])
    expect(warnings.map((w) => w.context.part)).toEqual(['P2', 'P3'])
  })

  // The same number of beats per minute counted in a different beat is a
  // different speed: quarter = 96 is twice half = 96.
  test('reports parts counting the same rate in different beats', () => {
    const inHalves = metronome.replace('quarter', 'half')
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${inHalves}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.value.base)).toEqual(['quarter'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
  })

  // A dotted beat is half as long again, so the same rate over one is a
  // different speed too.
  test('reports parts counting the same rate over a dotted and a plain beat', () => {
    const dotted = metronome.replace(
      '<beat-unit>quarter</beat-unit>',
      '<beat-unit>quarter</beat-unit><beat-unit-dot/>',
    )
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${dotted}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.value.dots)).toEqual([0])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
  })

  // Different points in the measure is a tempo change, not a disagreement, so
  // both are kept and nothing is reported.
  test('keeps tempos the parts state at different points in the measure', () => {
    const slower = metronome.replace('96', '60')
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}${slower}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96, 60])
    expect(warnings).toEqual([])
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

// A part carrying every kind of id the converter generates: two staves for a
// layout, a slur for event ids, a tie for note ids, and a system break for
// measure ids.
const GENERATED_IDS_MEASURES =
  '<measure number="1">' +
  '<attributes><divisions>4</divisions><staves>2</staves></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type><voice>1</voice><staff>1</staff><tie type="start"/>' +
  '<notations><tied type="start"/><slur type="start" number="1"/></notations></note>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type><voice>1</voice><staff>1</staff><tie type="stop"/>' +
  '<notations><tied type="stop"/><slur type="stop" number="1"/></notations></note>' +
  '<note><rest/><duration>8</duration><type>half</type><voice>1</voice>' +
  '<staff>1</staff></note>' +
  '<backup><duration>16</duration></backup>' +
  '<note><rest/><duration>16</duration><type>whole</type><voice>2</voice>' +
  '<staff>2</staff></note>' +
  '</measure>' +
  '<measure number="2"><print new-system="yes"/>' +
  '<note><rest/><duration>16</duration><type>whole</type><voice>1</voice>' +
  '<staff>1</staff></note>' +
  '<backup><duration>16</duration></backup>' +
  '<note><rest/><duration>16</duration><type>whole</type><voice>2</voice>' +
  '<staff>2</staff></note>' +
  '</measure>'

// MusicXML's part id is an xs:ID, which allows characters MNX's id pattern
// (printable ASCII, 1 to 256 characters) does not. An id shaped like one the
// converter generates cannot be carried either: MNX states every id the same
// way, so the part and the event would be one id. Either is renamed to a
// generated id everywhere the score refers to it, and reported.
describe('a part id the output cannot carry as it stands', () => {
  test('renames a non-ASCII part id in the parts and the layout alike', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-list>' +
          '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="Süß"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>' +
          '</part-list>' +
          `<part id="Süß"><measure number="1">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.parts.map((p) => p.id)).toEqual(['p1', 'P2'])
    expect(mnx.layouts).toEqual([
      {
        id: 'layout1',
        content: [
          {
            type: 'group',
            symbol: 'bracket',
            content: [
              { type: 'staff', sources: [{ part: 'p1' }] },
              { type: 'staff', sources: [{ part: 'P2' }] },
            ],
          },
        ],
      },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:part-id'])
    expect(warnings[0]?.message).toContain('Süß')
    expect(warnings[0]?.message).toContain('p1')
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('leaves printable ASCII part ids alone', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-list>' +
          '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"/><score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>' +
          '</part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.parts.map((p) => p.id)).toEqual(['P1', 'P2'])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A part id that reads like an id the converter generates names two things
  // at once: MNX states every id the same way, so nothing in the document
  // tells the part from the event, and a consumer resolving a slur target by
  // id can reach the part instead.
  test.each(['ev2', 'note1', 'm1', 'layout1'])(
    'renames the part id "%s", which the converter gives something else',
    (id) => {
      const { mnx, warnings } = convertMusicXML(
        score(
          `<part-list><score-part id="${id}"/></part-list>` +
            `<part id="${id}">${GENERATED_IDS_MEASURES}</part>`,
        ),
      )

      expect(mnx.parts.map((part) => part.id)).toEqual(['p1'])
      expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:part-id'])
      expect(warnings[0]?.message).toContain(id)
      // The two reasons a part is renamed read differently, so the report
      // says which one this is.
      expect(warnings[0]?.message).toContain('the converter gives')
      expect(schemaErrors(mnx)).toEqual([])
    },
  )

  // The other half of the same rule: an ordinary source id is left alone, so
  // the shapes the converter reserves stay the only ones renamed.
  test.each(['x1', 'P1', 'measure1', 'event2'])('leaves the part id "%s" alone', (id) => {
    const { mnx, warnings } = convertMusicXML(
      score(
        `<part-list><score-part id="${id}"/></part-list>` +
          `<part id="${id}">${GENERATED_IDS_MEASURES}</part>`,
      ),
    )

    expect(mnx.parts.map((part) => part.id)).toEqual([id])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The reader states the shape of the generated ids to keep a part id off
  // them, and two of the four are generated in the writer, which the reader
  // may not import. This holds the reader's copy to what a conversion really
  // writes.
  test('states the shape of every id the converter generates', () => {
    const { mnx } = convertMusicXML(
      score(
        '<part-list><score-part id="P1"/></part-list>' +
          `<part id="P1">${GENERATED_IDS_MEASURES}</part>`,
      ),
    )

    const events: string[] = []
    const notes: string[] = []
    for (const measure of mnx.parts[0]?.measures ?? []) {
      for (const sequence of measure.sequences) {
        for (const item of sequence.content) {
          if (!('notes' in item)) continue
          if (item.id !== undefined) events.push(item.id)
          for (const note of item.notes ?? []) if (note.id !== undefined) notes.push(note.id)
        }
      }
    }
    const measures = mnx.global.measures.flatMap((measure) =>
      measure.id === undefined ? [] : [measure.id],
    )
    const layouts = (mnx.layouts ?? []).flatMap((layout) =>
      layout.id === undefined ? [] : [layout.id],
    )

    expect(schemaErrors(mnx)).toEqual([])
    expect(events.length).toBeGreaterThan(0)
    expect(notes.length).toBeGreaterThan(0)
    expect(measures.length).toBeGreaterThan(0)
    expect(layouts.length).toBeGreaterThan(0)
    for (const id of [...events, ...notes, ...measures, ...layouts]) {
      expect(GENERATED_ID_PATTERN.test(id)).toBe(true)
    }
  })

  test('skips over an id another part already holds', () => {
    const { mnx, warnings } = convertMusicXML(
      score(
        '<part-list>' +
          '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="Süß"/><score-part id="p1"/>' +
          '<part-group type="stop" number="1"/>' +
          '</part-list>' +
          `<part id="Süß"><measure number="1">${NOTE}</measure></part>` +
          `<part id="p1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.parts.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:part-id'])
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// The notation font. <defaults> is page geometry with no home in MNX, but
// its <music-font> names the SMuFL font the score is engraved in, which is
// MNX's part.smuflFont.
describe('the music font', () => {
  test('carries the font family onto every part', () => {
    const { mnx, warnings } = convertMusicXML(
      '<score-partwise><defaults><music-font font-family="Leland"/></defaults>' +
        '<part-list><score-part id="P1"/><score-part id="P2"/></part-list>' +
        '<part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch>' +
        '<duration>4</duration><type>whole</type></note></measure></part>' +
        '<part id="P2"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>D</step><octave>4</octave></pitch>' +
        '<duration>4</duration><type>whole</type></note></measure></part>' +
        '</score-partwise>',
    )

    expect(mnx.parts.map((p) => p.smuflFont)).toEqual(['Leland', 'Leland'])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('keeps the no-home report for the rest of <defaults>', () => {
    const { mnx, warnings } = convertMusicXML(
      '<score-partwise><defaults><scaling><millimeters>7</millimeters>' +
        '<tenths>40</tenths></scaling><music-font font-family="Leland"/></defaults>' +
        '<part-list><score-part id="P1"/></part-list>' +
        '<part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch>' +
        '<duration>4</duration><type>whole</type></note></measure></part>' +
        '</score-partwise>',
    )

    expect(mnx.parts[0]?.smuflFont).toBe('Leland')
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:element', element: 'defaults' }),
    ])
  })

  test('writes no font where the source names none', () => {
    const { mnx } = convertMusicXML(
      '<score-partwise><part-list><score-part id="P1"/></part-list>' +
        '<part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch>' +
        '<duration>4</duration><type>whole</type></note></measure></part>' +
        '</score-partwise>',
    )

    expect(mnx.parts.every((p) => !('smuflFont' in p))).toBe(true)
  })
})

// The music font's edges: an element naming no family states nothing, and
// an attribute beyond the family is reported like any other unread one.
describe('the music font, at its edges', () => {
  const withDefaults = (defaults: string) =>
    `<score-partwise><defaults>${defaults}</defaults>` +
    '<part-list><score-part id="P1"/></part-list>' +
    '<part id="P1"><measure number="1">' +
    '<attributes><divisions>1</divisions></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    '<duration>4</duration><type>whole</type></note></measure></part>' +
    '</score-partwise>'

  test('writes no font from an element naming no family', () => {
    const { mnx, warnings } = convertMusicXML(withDefaults('<music-font/>'))

    expect(mnx.parts.every((p) => !('smuflFont' in p))).toBe(true)
    expect(warnings).toEqual([])
  })

  // Font size and style are presentation, which the attribute sweep passes
  // over without a word wherever they appear.
  test('passes over the font attributes beside the family', () => {
    const { mnx, warnings } = convertMusicXML(
      withDefaults('<music-font font-family="Leland" font-size="20.5"/>'),
    )

    expect(mnx.parts[0]?.smuflFont).toBe('Leland')
    expect(warnings).toEqual([])
  })

  // The family is the only thing read off the element, so anything else it
  // states that is not presentation is a loss, and the sweep over the element
  // is what reports it.
  test('reports an attribute of the music font that is neither read nor presentation', () => {
    const { mnx, warnings } = convertMusicXML(
      withDefaults('<music-font font-family="Leland" xml:lang="en"/>'),
    )

    expect(mnx.parts[0]?.smuflFont).toBe('Leland')
    expect(warnings.map((w) => w.attribute)).toEqual(['xml:lang'])
  })
})
