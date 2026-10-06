import { describe, expect, test } from 'vitest'
import { readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from './collector.js'
import { GENERATED_ID_PATTERN } from '../ids.js'

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
  const result = readValid(source, warnings)
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
    const failure = readFailure('<html/>')

    expect(failure.message).toContain('found <html>')
    // The whole document is wrong, so there is no element inside it to name.
    expect(failure.path).toEqual([])
    expect(failure.line).toBe(1)
  })

  // The parser does not resolve namespaces, so a prefix stays on the name and
  // the plain "found <mx:score-partwise>" message does not explain it.
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

  test('reports what a part list entry holds unread against its part', () => {
    const { warnings } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name><group>score</group>' +
          `</score-part></part-list><part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => [w.element, w.context.part])).toEqual([['group', 'P1']])
  })

  test('reports a part whose id the part list never introduces', () => {
    const { warnings } = read(
      score(
        '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>' +
          `<part id="P9"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual(['The part list has no entry for part "P9".'])
    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['part', 'id']])
    expect(warnings[0]?.context.part).toBe('P9')
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
      { sign: 'F', staffPosition: 2, staff: undefined, position: { num: 0, den: 1 }, hide: false },
    ])
  })

  // A source states a clef in one block and the key and time in the next, so
  // a block stating neither must settle neither.
  test('reads a key and a time signature stated in a later attributes block', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef>' +
          '</attributes>' +
          '<attributes><key><fifths>2</fifths></key>' +
          '<time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          QUARTER,
      ),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 2 })
    expect(result.globalMeasures[0]?.time).toEqual({ count: 3, unit: 4 })
  })

  // A time signature stands until another states one, so the rest filling the
  // second measure is still read against the meter the first stated.
  test('keeps the time in force through a measure stating only a clef', () => {
    const { score: result } = read(
      score(
        '<part id="P1">' +
          '<measure number="1"><attributes><divisions>4</divisions>' +
          '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
          '<type>whole</type></note></measure>' +
          '<measure number="2"><attributes><clef><sign>F</sign><line>4</line></clef>' +
          '</attributes><note><rest/><duration>16</duration></note></measure>' +
          '</part>',
      ),
    )

    expect(result.parts[0]?.measures[1]?.sequences[0]?.fullMeasure).toBeDefined()
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
      { sign: 'G', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 }, hide: false },
    ])
  })

  // A percussion, TAB, jianpu or "none" clef is reported and the part
  // converted without it. A sign neither format states is a broken document.
  test('rejects a clef whose sign MusicXML does not state', () => {
    expect(
      readFailure(measure('<attributes><clef><sign>treble</sign></clef></attributes>')).message,
    ).toContain('"treble" clef cannot be represented')
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
      { sign: 'G', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 }, hide: false },
      { sign: 'F', staffPosition: 2, staff: undefined, position: { num: 1, den: 1 }, hide: false },
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
  // pairs. MNX states one count and unit. Keeping the first pair would say the
  // measure is shorter than it sounds, so the file is refused.
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
  // nothing to check, and a wrong guess would give a wrong length with no
  // warning.
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
  // no home there, so each is reported.
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
  // may not fill in what an earlier one left empty.
  test('does not let a later time signature overwrite senza misura', () => {
    const { score: result } = read(
      measure(
        '<attributes><divisions>1</divisions><time><senza-misura/></time></attributes>' +
          '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          NOTE,
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
      expect.objectContaining({
        code: 'unrepresentable:senza-misura',
        element: 'senza-misura',
        message: expect.stringContaining('converted with no time signature'),
      }),
    ])
  })

  // Reported where the <time> carrying it stands, not where the measure it
  // is settled with begins.
  test('reports senza misura at the line it is written on', () => {
    const { warnings } = read(
      measure(
        '<attributes><divisions>1</divisions></attributes>\n' +
          '<attributes><time><senza-misura/></time></attributes>' +
          NOTE,
      ),
    )

    expect(warnings.map((w) => [w.code, w.context.line])).toEqual([
      ['unrepresentable:senza-misura', 2],
    ])
  })

  // The measure keeps the meter stated before it, so what it says about the
  // unmetered music is what the measure converts, not what the statement
  // asked for.
  test('reports senza misura stated after a meter as a measure that keeps it', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>1</divisions>' +
          '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
          '<attributes><time><senza-misura/></time></attributes>' +
          NOTE,
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual([
      'inconsistent:time',
      'unrepresentable:senza-misura',
    ])
    expect(warnings[1]?.message).toContain('converted with the time signature in force')
  })

  test('rejects a number that is not whole, naming the element', () => {
    expect(
      readFailure(measure('<attributes><key><fifths>two</fifths></key></attributes>')).message,
    ).toContain('<fifths> is not a whole number: "two"')
  })

  // Number() would read these as 16, 1000, 5 and 15.
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

// MNX states a time signature at the start of a measure only. MusicXML can
// state one at any point, and one stated after a measure's notes is how some
// sources write a change that takes effect at the next barline.
describe('a time signature stated after the measure start', () => {
  const timed = (beats: number) =>
    `<attributes><time><beats>${String(beats)}</beats><beat-type>4</beat-type></time></attributes>`
  const note = (duration: number | string, voice = 1) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><voice>${String(voice)}</voice></note>`
  const part = (...measures: string[]) =>
    score(
      '<part id="P1">' +
        measures
          .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
          .join('') +
        '</part>',
    )
  const opening = '<attributes><divisions>12</divisions></attributes>'

  test('takes effect at the next measure when stated after the notes', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test("is the next measure's own when the measure states none before it", () => {
    const { score: result, warnings } = read(part(opening + note(24) + timed(3), note(36)))

    expect(result.globalMeasures.map((m) => m.time)).toEqual([undefined, { count: 3, unit: 4 }])
    expect(warnings).toEqual([])
  })

  // A statement after a <backup> to the start stands where the measure
  // begins, so the notes written before it are measured against it too.
  test('measures the rests written before a statement at the start against it', () => {
    const rest = (voice: number) =>
      `<note><rest/><duration>36</duration><voice>${String(voice)}</voice><type>whole</type></note>`
    const second = (body: string) =>
      read(part(opening + timed(4) + note(48), body)).score.parts[0]?.measures[1]
    const before = second(rest(1) + back(36) + timed(3) + rest(2))
    const after = second(timed(3) + rest(1) + back(36) + rest(2))

    expect(before).toEqual(after)
  })

  test('adds nothing when it restates the time signature in force', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
    expect(warnings).toEqual([])
  })

  test('adds nothing when the next measure restates it', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), timed(3) + note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reports a change partway through a measure and converts it at the next', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + '\n' + timed(3) + note(24), note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        element: 'time',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  // A rest with no written value lasting the measure is the measure's rest.
  // One lasting the late time signature's length is not, since the measure
  // is still the one it opens with.
  test('measures a rest after it against the time signature the measure opens with', () => {
    const rest = (duration: number) =>
      `<note><rest/><duration>${String(duration)}</duration><voice>2</voice></note>`
    const { score: result, warnings } = read(
      part(
        opening +
          timed(4) +
          note(12) +
          timed(3) +
          note(36) +
          '<backup><duration>48</duration></backup>' +
          rest(36) +
          rest(12),
        note(36),
      ),
    )

    const resting = result.parts[0]?.measures[0]?.sequences[1]
    expect(resting?.fullMeasure).toBeUndefined()
    expect(resting?.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:mid-measure-time'])
  })

  // The cursor is back inside the measure, although every note in it is read.
  test('takes a statement after a <backup> into the measure as partway through', () => {
    const { warnings } = read(
      part(
        opening + timed(2) + note(24) + '<backup><duration>12</duration></backup>' + timed(3),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('carries a change of glyph alone to the next measure', () => {
    const common =
      '<attributes><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>' +
      '</attributes>'
    const { score: result } = read(part(opening + timed(4) + note(48) + common, note(48)))

    expect(result.globalMeasures[1]?.time).toEqual({ count: 4, unit: 4, display: 'common' })
  })

  test('reports a change partway through a measure when the next restates it', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(12), timed(3) + note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one the next measure replaces with its own', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), timed(4) + note(48)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 4, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringMatching(
          /at the end of .* The next measure states its own, so it is not converted\.$/,
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one stated after the notes of the last measure', () => {
    const { warnings } = read(part(opening + timed(2) + note(24) + timed(3)))

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining(
          'This is the last measure of the part, so it is not converted.',
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one a later statement in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(12) + timed(4), note(48)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 4, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining(
          'A later one in this measure replaces it, so it is not converted.',
        ),
      }),
    ])
  })

  test('does not carry one a later senza misura in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          timed(3) +
          note(12) +
          '<attributes><time><senza-misura/></time></attributes>',
        note(36),
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
    expect(result.globalMeasures[1]?.time).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:senza-misura',
        // The measure it is written in opens with a meter and keeps it; the
        // unmetered music starts at the measure after.
        message: expect.stringContaining('converted with the time signature in force'),
      }),
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  // The measure states no meter of its own, so MNX keeps the one before it in
  // force over it. What the unmetered statement costs is measured against
  // that, not against the measure's own silence.
  test('reports senza misura in a measure keeping the meter before it', () => {
    const { score: result, warnings } = read(
      part(
        opening + timed(2) + note(24),
        note(24) + '<attributes><time><senza-misura/></time></attributes>',
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      undefined,
      undefined,
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:senza-misura'])
    expect(warnings[0]?.message).toContain('converted with the time signature in force')
  })

  test('reports a restatement partway through after one at the end of the measure', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(24) +
          timed(3) +
          '<backup><duration>24</duration></backup>' +
          note(12, 2) +
          timed(3) +
          note(12, 2),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('keeps a restatement partway through over one at the end of the measure', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          timed(3) +
          '<backup><duration>12</duration></backup>' +
          note(24, 2) +
          timed(3),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('names the first of two restatements at the same point', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          '\n' +
          timed(3) +
          '<backup><duration>12</duration></backup>' +
          note(12, 2) +
          '\n' +
          timed(3) +
          note(12, 2),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  // The first staff's is senza misura, which MNX cannot state, so the change
  // is the second staff's.
  test('names the time signature of a block that MNX can state', () => {
    const { warnings } = read(
      part(
        '<attributes><divisions>12</divisions><staves>2</staves></attributes>' +
          timed(2) +
          note(12) +
          '<attributes><time number="1"><senza-misura/></time>\n' +
          '<time number="2"><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note(12),
        note(36),
      ),
    )

    expect(warnings.filter((w) => w.code === 'unrepresentable:mid-measure-time')).toEqual([
      expect.objectContaining({ context: { part: 'P1', measure: 1, line: 2 } }),
    ])
  })

  test('carries one equal to a time signature the start of the measure did not convert', () => {
    const { score: result } = read(
      part(
        opening + timed(2) + note(24) + '<backup><duration>24</duration></backup>' + timed(3),
        note(24) + timed(3),
        note(36),
      ),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      undefined,
      { count: 3, unit: 4 },
    ])
  })

  test('carries nothing when the last statement returns to the time signature in force', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(6) + timed(2) + note(6), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  test("takes a statement at the start of the measure after a backup as the measure's own", () => {
    const { score: result, warnings } = read(
      part(
        opening + note(24) + '<backup><duration>24</duration></backup>' + timed(2) + note(24, 2),
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
    expect(warnings).toEqual([])
  })

  describe('stated twice at the start of the measure', () => {
    const twice = (second: string) =>
      opening + timed(2) + note(24) + '<backup><duration>24</duration></backup>\n' + second

    test('keeps the first and reports a different second one', () => {
      const { score: result, warnings } = read(part(twice(timed(3) + note(24, 2)), note(24)))

      expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
      expect(warnings).toEqual([
        expect.objectContaining({
          code: 'inconsistent:time',
          element: 'time',
          message: expect.stringContaining('The later one is not converted.'),
          context: { part: 'P1', measure: 1, line: 2 },
        }),
      ])
    })

    test('says nothing when the second restates the first', () => {
      const { warnings } = read(part(twice(timed(2) + note(24, 2))))

      expect(warnings).toEqual([])
    })

    test('reports a second meter stated for the only staff there is', () => {
      const numbered =
        '<attributes><time number="1"><beats>3</beats><beat-type>4</beat-type></time></attributes>'
      const { score: result, warnings } = read(part(twice(numbered + note(24, 2)), note(24)))

      expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
    })

    // A rest with no written value lasting the measure is the measure's rest,
    // so it shows which time signature the next measure is read against.
    test('reads the next measure against the one converted', () => {
      const rest = '<note><rest/><duration>24</duration><voice>1</voice></note>'
      const { score: result } = read(part(twice(timed(3) + note(24, 2)), rest))

      expect(result.parts[0]?.measures[1]?.sequences[0]?.fullMeasure).toBeDefined()
    })

    test('reads the next measure against a late one stated before the restatement', () => {
      const rest = '<note><rest/><duration>36</duration><voice>1</voice></note>'
      const { score: result } = read(
        part(
          opening +
            timed(2) +
            note(24) +
            timed(3) +
            '<backup><duration>24</duration></backup>' +
            timed(2) +
            note(24, 2),
          rest,
        ),
      )

      expect(result.globalMeasures.map((m) => m.time)).toEqual([
        { count: 2, unit: 4 },
        { count: 3, unit: 4 },
      ])
      expect(result.parts[0]?.measures[1]?.sequences[0]?.fullMeasure).toBeDefined()
    })

    test('reports one following senza misura', () => {
      const unmetered = '<attributes><time><senza-misura/></time></attributes>'
      const { score: result, warnings } = read(
        part(
          opening + unmetered + note(24) + '<backup><duration>24</duration></backup>' + timed(3),
        ),
      )

      expect(result.globalMeasures[0]?.time).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:senza-misura',
        'inconsistent:time',
      ])
    })
  })

  // A 3:2 quarter written short of its ratio, which the silence after it to
  // the barline completes. How much silence there is depends on the measure's
  // own time signature, not on the one stated late for the next measure.
  const shortTriplet =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  test("measures the silence to the barline against the measure's own time signature", () => {
    const { warnings } = read(
      part(opening + timed(3) + note(24) + shortTriplet + timed(2), note(24)),
    )

    expect(warnings).toEqual([])
  })

  // The second part states no time signature, so its barline is the one the
  // first part's measure opens with.
  const untimedBeside = (first: string) =>
    score(
      `<part id="P1"><measure number="1">${opening + first}</measure>` +
        `<measure number="2">${note(24)}</measure></part>` +
        `<part id="P2"><measure number="1">${opening + note(24) + shortTriplet}</measure>` +
        `<measure number="2">${note(24)}</measure></part>`,
    )

  test('measures a part stating no time signature against the one the score opens with', () => {
    const { warnings } = read(untimedBeside(timed(3) + note(36) + timed(2)))

    expect(warnings).toEqual([])
  })

  // A figured bass states a <duration> but does not move the cursor.
  test('measures an untimed part against a time signature stated after a figured bass', () => {
    const { warnings } = read(
      untimedBeside(
        '<figured-bass><figure><figure-number>6</figure-number></figure>' +
          '<duration>12</duration></figured-bass>' +
          timed(3) +
          note(36),
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unsupported:element', 'figured-bass'],
    ])
  })

  test('measures an untimed part against the metered one of two per-staff time signatures', () => {
    const { warnings } = read(
      untimedBeside(
        '<attributes><staves>2</staves><time number="1"><senza-misura/></time>' +
          '<time number="2"><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note(36),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:senza-misura',
      'unrepresentable:per-staff-time',
    ])
  })

  test('takes a <forward> as the start of the music when reading ahead', () => {
    const { warnings } = read(
      untimedBeside(timed(3) + '<forward><duration>36</duration></forward>' + timed(2)),
    )

    expect(warnings).toEqual([])
  })

  test('does not take a grace note as the start of the music when reading ahead', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch>' +
      '<voice>1</voice><type>eighth</type></note>'
    const { warnings } = read(untimedBeside(grace + timed(3) + note(36)))

    expect(warnings).toEqual([])
  })

  // The second part states no time signature, so its second measure runs to
  // the barline the first part's second measure opens with.
  const untimedBesideNext = (first: string, length: number) =>
    score(
      `<part id="P1"><measure number="1">${opening + first}</measure>` +
        `<measure number="2">${note(36)}</measure></part>` +
        `<part id="P2"><measure number="1">${opening + note(length)}</measure>` +
        `<measure number="2">${note(24) + shortTriplet}</measure></part>`,
    )
  const back = (duration: number | string) =>
    `<backup><duration>${String(duration)}</duration></backup>`

  test.each([36, '36.0'])(
    'reads ahead a second statement at the start, after a <backup> of %s, as the first one stands',
    (backup) => {
      const { score: result, warnings } = read(
        untimedBesideNext(timed(3) + note(36) + back(backup) + timed(2) + note(36, 2), 36),
      )

      expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 3, unit: 4 }, undefined])
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
    },
  )

  test('reads ahead a late statement before a restatement at the start', () => {
    const { score: result, warnings } = read(
      untimedBesideNext(timed(2) + note(24) + timed(3) + back(24) + timed(2) + note(24, 2), 24),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reads ahead a late statement before the first one at the start', () => {
    const { score: result, warnings } = read(
      untimedBesideNext(note(24) + timed(3) + back(24) + timed(2) + note(24, 2), 24),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reads ahead a statement after a <forward> as late', () => {
    const { warnings } = read(
      untimedBesideNext(timed(2) + '<forward><duration>24</duration></forward>' + timed(3), 24),
    )

    expect(warnings).toEqual([])
  })

  test('reads ahead a chord as one step of the cursor', () => {
    const chord =
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
      '<duration>36</duration><voice>1</voice></note>'
    const { warnings } = read(
      untimedBesideNext(timed(3) + note(36) + chord + back(36) + timed(2) + note(36, 2), 36),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
  })

  test('reads ahead a <backup> past the start as reaching the start', () => {
    const { warnings } = read(
      untimedBesideNext(timed(3) + note(36) + back(48) + timed(2) + note(36, 2), 36),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time', 'inconsistent:backup'])
  })

  test('reads ahead a note written after a <backup> past the start as moving on from the start', () => {
    const { warnings } = read(
      untimedBesideNext(timed(2) + note(24) + back(48) + note(24, 2) + timed(3), 24),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
  })

  test.each([
    ['24', '24'],
    ['24.0', '24'],
  ])('reads ahead a <backup> in the divisions stated before it: %s, %s', (divisions, backup) => {
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${opening + timed(2) + note(24)}` +
          `<attributes><divisions>${divisions}</divisions></attributes>` +
          `<backup><duration>${backup}</duration></backup>${timed(3)}</measure>` +
          `<measure number="2">${note(72)}</measure></part>` +
          `<part id="P2"><measure number="1">${opening + note(24)}</measure>` +
          `<measure number="2">${note(24) + shortTriplet}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:mid-measure-time'])
  })

  test('reads ahead a note with no <duration> as lasting its written value', () => {
    const half =
      '<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><type>half</type></note>'
    const { warnings } = read(untimedBesideNext(timed(2) + half + timed(3), 24))

    expect(warnings).toEqual([])
  })

  test('reads ahead a rest with no <duration> as lasting its written value', () => {
    const half = '<note><rest/><voice>1</voice><type>half</type></note>'
    const { warnings } = read(untimedBesideNext(timed(2) + half + timed(3), 24))

    expect(warnings).toEqual([])
  })

  // A bar of silence is drawn as a whole rest in any meter, so a rest marked
  // as the measure's lasts what the time signature states. A rest not marked
  // lasts the whole it is drawn as. A <backup> of the measure's length after
  // it tells the two apart.
  test.each([
    ['a rest marked as the measure', ' measure="yes"', '<duration>36</duration>'],
    ['a rest not marked', '', '<duration>48</duration>'],
  ])('reads ahead %s with no <duration> as the reader does', (_, mark, duration) => {
    const whole = (stated: string) =>
      `<note><rest${mark}/>${stated}<voice>1</voice><type>whole</type></note>`
    const first = (stated: string) =>
      read(untimedBesideNext(timed(3) + whole(stated) + back(36) + timed(2), 36))
    const stated = first(duration)
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // With no time signature in force, the written value is all there is.
  test("reads ahead a measure's rest with no <duration> and no time as its written value", () => {
    const half = (duration: string) =>
      `<note><rest measure="yes"/>${duration}<voice>1</voice><type>half</type></note>`
    const first = (duration: string) => read(untimedBesideNext(half(duration) + timed(3), 24))
    const stated = first('<duration>24</duration>')
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // The reader drops an extra rest over the measure rest, and still passes
  // over it from the measure start. The read-ahead counts it the same way.
  test('reads ahead a dropped extra rest with no <duration> as the reader passes over it', () => {
    const measureRest = '<note><rest measure="yes"/><duration>24</duration><voice>1</voice></note>'
    const extra = (duration: string) =>
      `<note><rest/>${duration}<voice>1</voice><type>quarter</type></note>`
    const forward = '<forward><duration>12</duration></forward>'
    const first = (duration: string) =>
      read(
        untimedBesideNext(
          timed(2) + measureRest + back(48) + extra(duration) + forward + timed(3),
          24,
        ),
      )
    const stated = first('<duration>12</duration>')
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // A <backup> of the two notes' length returns to the start only where the
  // triplet lasts the quarter its ratio gives it.
  test('reads ahead a note with no <duration> inside a tuplet as its ratio scales it', () => {
    const triplet = (duration: string) =>
      ['start', '', 'stop']
        .map(
          (bracket) =>
            `<note><pitch><step>C</step><octave>4</octave></pitch>${duration}<voice>1</voice>` +
            '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification>' +
            (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
            '</note>',
        )
        .join('')
    const first = (duration: string) =>
      read(
        untimedBesideNext(
          timed(2) + triplet(duration) + note(12) + back(24) + timed(3) + note(24, 2),
          24,
        ),
      )
    const stated = first('<duration>4</duration>')
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // A note of a two-note tremolo lasts half its written value, whether or not
  // it states the pair's ratio. A single-note tremolo scales nothing. A
  // <backup> of a quarter returns to the start only where the pair lasts one.
  test.each([
    ['a two-note tremolo', (type: string) => `<tremolo type="${type}">2</tremolo>`, 6],
    [
      'a two-note tremolo in a second <ornaments>',
      (type: string) => `<trill-mark/></ornaments><ornaments><tremolo type="${type}">2</tremolo>`,
      6,
    ],
    [
      'a two-note tremolo after a single-note one',
      (type: string) => `<tremolo type="single">3</tremolo><tremolo type="${type}">2</tremolo>`,
      6,
    ],
    ['a single-note tremolo', () => '<tremolo type="single">3</tremolo>', 12],
  ])('reads ahead %s stating no ratio and no <duration>', (_, ornament, units) => {
    const notes = (duration: string) =>
      ['start', 'stop']
        .map(
          (type) =>
            `<note><pitch><step>C</step><octave>4</octave></pitch>${duration}<voice>1</voice>` +
            `<type>quarter</type><notations><ornaments>${ornament(type)}</ornaments></notations>` +
            '</note>',
        )
        .join('')
    const first = (duration: string) =>
      read(untimedBesideNext(timed(2) + notes(duration) + back(12) + timed(3) + note(24, 2), 24))
    const stated = first(`<duration>${String(units)}</duration>`)
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  test.each(['actual-notes', 'normal-notes'])(
    'reads ahead a <%s> of 0, which the part reader refuses',
    (name) => {
      const zero =
        '<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice>' +
        '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
        '<normal-notes>2</normal-notes></time-modification></note>'
      const source = untimedBesideNext(
        timed(2) + zero.replace(new RegExp(`(<${name}>)\\d`), '$10') + timed(3),
        24,
      )

      expect(() => read(source)).toThrow(MusicXMLError)
    },
  )

  test('reads ahead a grace note stating a <duration> as taking no time', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration>' +
      '<voice>1</voice><type>eighth</type></note>'
    const { warnings } = read(untimedBesideNext(timed(2) + grace + timed(3) + note(24), 24))

    expect(warnings.map((w) => `${w.code} ${String(w.context.part)}`)).toEqual([
      'inconsistent:time P1',
      'inconsistent:duration P1',
      'unrepresentable:tuplet-ratio P2',
    ])
  })

  test.each(['0', '-3000000000000000'])(
    'reads ahead past a <divisions> of %s, which the part reader refuses',
    (written) => {
      const divisions = `<attributes><divisions>${written}</divisions></attributes>`

      expect(readFailure(untimedBesideNext(divisions + timed(3) + note(36), 36)).message).toContain(
        `<divisions> is ${written}, outside the range`,
      )
    },
  )

  test('reads ahead a broken time signature as stating none', () => {
    const composite =
      '<attributes><time><beats>3</beats><beat-type>4</beat-type>' +
      '<beats>2</beats><beat-type>4</beat-type></time></attributes>'

    const failure = readFailure(untimedBesideNext(timed(3) + note(36) + composite, 36))

    expect(failure.message).toMatch(/composite time signature/)
    expect(failure.path).toEqual(['score-partwise', 'part P1', 'measure 1'])
  })

  // An unmetered measure has no barline to measure silence to, so the time
  // signature before it does not complete a bracket in it.
  test('measures a senza misura measure against no time signature', () => {
    const { warnings } = read(
      part(
        opening + timed(3) + note(36),
        '<attributes><time><senza-misura/></time></attributes>' + note(24) + shortTriplet,
      ),
    )

    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tuplet-ratio')
  })

  test('converts to legal MNX', () => {
    convertValid(part(opening + timed(2) + note(12) + timed(3) + note(12), note(36)))
  })
})

// MNX states a key signature at the start of a measure only, as it does a
// time signature.
describe('a key signature stated after the measure start', () => {
  const keyed = (fifths: number) =>
    `<attributes><key><fifths>${String(fifths)}</fifths></key></attributes>`
  const note = (duration: number | string, voice = 1) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><voice>${String(voice)}</voice></note>`
  const measures = (...bodies: string[]) =>
    bodies.map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`).join('')
  const part = (...bodies: string[]) => score(`<part id="P1">${measures(...bodies)}</part>`)
  const opening =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  test('takes effect at the next measure when stated after the notes', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([])
  })

  test('adds nothing when it restates the key in force', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(2) + note(24) + keyed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 2 }, undefined])
    expect(warnings).toEqual([])
  })

  test('adds nothing when the next measure restates it', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), keyed(2) + note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([])
  })

  test('reports a change partway through a measure and converts it at the next', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + '\n' + keyed(2) + note(12), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        element: 'key',
        message: expect.stringMatching(
          /^A key signature is stated partway through .* It is converted at the next measure\.$/,
        ),
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  test('reports one the next measure replaces with its own', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), keyed(-1) + note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: -1 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringMatching(
          /at the end of .* The next measure states its own, so it is not converted\.$/,
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one stated after the notes of the last measure', () => {
    const { warnings } = read(part(opening + keyed(0) + note(24) + keyed(2)))

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining(
          'This is the last measure of the part, so it is not converted.',
        ),
      }),
    ])
  })

  test('reports one a later statement in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + keyed(2) + note(12) + keyed(3), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 3 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining(
          'A later one in this measure replaces it, so it is not converted.',
        ),
      }),
    ])
  })

  test('does not carry one a later non-traditional key in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(12) +
          keyed(2) +
          note(12) +
          '<attributes><key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>',
        note(24),
      ),
    )

    expect(result.globalMeasures[1]?.key).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:non-traditional-key' }),
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  // The cursor is back inside the measure, although every note in it is read.
  test('takes a statement after a <backup> into the measure as partway through', () => {
    const { warnings } = read(
      part(
        opening + keyed(0) + note(24) + '<backup><duration>12</duration></backup>' + keyed(2),
        note(24),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  // The two statements are one change, written once for each voice. The
  // second stands partway through the measure, so the change is a loss.
  test('reports a restatement partway through after one at the end of the measure', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(24) +
          keyed(2) +
          '<backup><duration>24</duration></backup>' +
          note(12, 2) +
          keyed(2) +
          note(12, 2),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
      }),
    ])
  })

  test('carries one stated after a non-traditional key in the same measure', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(24) +
          '<attributes><key><key-step>F</key-step><key-alter>1</key-alter>' +
          '<key-accidental>sharp</key-accidental></key></attributes>' +
          keyed(2),
        note(24),
      ),
    )

    expect(result.globalMeasures[1]?.key).toEqual({ fifths: 2 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:non-traditional-key'])
  })

  // A second key at the start of a measure is not converted, so the key in
  // force is still the first one.
  test('carries one equal to a key the start of the measure did not convert', () => {
    const { score: result } = read(
      part(
        opening + keyed(0) + note(24) + '<backup><duration>24</duration></backup>' + keyed(2),
        note(24) + keyed(2),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([
      { fifths: 0 },
      undefined,
      { fifths: 2 },
    ])
  })

  test('carries nothing when the last statement returns to the key in force', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + keyed(2) + note(6) + keyed(0) + note(6), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  test("takes a statement at the start of the measure after a backup as the measure's own", () => {
    const { score: result, warnings } = read(
      part(
        opening + note(24) + '<backup><duration>24</duration></backup>' + keyed(2) + note(24, 2),
      ),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 2 })
    expect(warnings).toEqual([])
  })

  describe('stated twice at the start of the measure', () => {
    const twice = (first: string, second: string) =>
      opening + first + note(24) + '<backup><duration>24</duration></backup>\n' + second

    test('keeps the first and reports a different second one', () => {
      const { score: result, warnings } = read(part(twice(keyed(0), keyed(2)), note(24)))

      expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
      expect(warnings).toEqual([
        expect.objectContaining({
          code: 'inconsistent:key',
          element: 'key',
          message: expect.stringContaining('The later one is not converted.'),
          context: { part: 'P1', measure: 1, line: 2 },
        }),
      ])
    })

    test('says nothing when the second restates the first', () => {
      const { warnings } = read(part(twice(keyed(2), keyed(2))))

      expect(warnings).toEqual([])
    })

    // A number tells several staves apart, and a part written on one staff
    // has nothing to tell apart, so a second statement naming staff 1 is a
    // second statement for the part.
    test('reports a second one stated for the only staff there is', () => {
      const numbered = '<attributes><key number="1"><fifths>2</fifths></key></attributes>'
      const { score: result, warnings } = read(part(twice(keyed(0), numbered), note(24)))

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: 0 })
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:key'])
    })

    test('reports one following a key MNX cannot carry', () => {
      const nonTraditional =
        '<attributes><key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>'
      const { score: result, warnings } = read(part(twice(nonTraditional, keyed(2))))

      expect(result.globalMeasures[0]?.key).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:non-traditional-key',
        'inconsistent:key',
      ])
    })
  })

  // Two sharps written read back as C major, which is the key in force.
  test('adds nothing when a transposing part restates its written key', () => {
    const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const { score: result, warnings } = read(
      part(
        opening.replace('</attributes>', `${B_FLAT}</attributes>`) +
          keyed(2) +
          note(12) +
          keyed(2) +
          note(12),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
    expect(warnings).toEqual([])
  })

  // Written a major second above what it sounds, so five flats written read
  // back as seven flats of concert key: the five sharps the other part states,
  // spelled the other way.
  test('carries the concert key of a transposing part, and settles its flip', () => {
    const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const { score: result, warnings } = read(
      score(
        `<part id="P1">${measures(opening + keyed(0) + note(24), keyed(5) + note(24))}</part>` +
          '<part id="P2">' +
          measures(
            opening.replace('</attributes>', `${B_FLAT}</attributes>`) +
              keyed(2) +
              note(24) +
              keyed(-5),
            note(24),
          ) +
          '</part>',
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 5 }])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeDefined()
    expect(warnings).toEqual([])
  })

  test('converts to legal MNX', () => {
    convertValid(part(opening + keyed(0) + note(12) + keyed(2) + note(12), note(24)))
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
    ).toContain('more than one of <pitch>, <unpitched> and <rest>')
  })

  test('rejects a note that is both a pitch and unpitched', () => {
    expect(
      readFailure(
        measure(
          '<note><pitch><step>C</step><octave>4</octave></pitch><unpitched/>' +
            '<type>whole</type></note>',
        ),
      ).message,
    ).toContain('more than one of <pitch>, <unpitched> and <rest>')
  })

  test('rejects a note that sounds nothing at all', () => {
    expect(readFailure(measure('<note><type>whole</type></note>')).message).toContain(
      'none of <pitch>, <unpitched> and <rest>',
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

  // MusicXML types both as a decimal.
  test.each([
    ['4.0', '6.0'],
    ['4', '6.00'],
    ['2.5', '3.75'],
    ['0.5', '.75'],
  ])('reads a <divisions> of %s and a <duration> of %s exactly', (divisions, duration) => {
    const { score: result, warnings } = read(
      measure(
        `<attributes><divisions>${divisions}</divisions></attributes>` +
          `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration></note>`,
      ),
    )

    expect(firstEvent(result)?.value).toEqual({ base: 'quarter', dots: 1 })
    expect(warnings).toEqual([])
  })

  test.each(['1e1', '0x4', '4,0', '-'])('refuses a <divisions> of "%s"', (written) => {
    expect(
      readFailure(measure(`<attributes><divisions>${written}</divisions></attributes>${NOTE}`))
        .message,
    ).toContain(`<divisions> is not a number: "${written}".`)
  })

  test('refuses a <divisions> of 0.0, which must be above 0', () => {
    expect(
      readFailure(measure(`<attributes><divisions>0.0</divisions></attributes>${NOTE}`)).message,
    ).toContain('<divisions> is 0.0, outside the range above 0 to 1000000.')
  })

  test('rejects a duration that no note value can write', () => {
    expect(
      readFailure(
        measure(
          '<attributes><divisions>3</divisions></attributes>' +
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>',
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

  // A tuplet's written value is longer than it sounds, so converting it as an
  // ordinary note would write a measure that does not add up. The ratio the
  // note carries puts it in a tuplet, which counts what it holds and keeps the
  // space the ratio gives it, and the loss is reported.
  test('puts a note carrying a ratio inside a tuplet', () => {
    const { score, warnings } = read(
      measure(
        '<attributes><divisions>3</divisions></attributes>' +
          '<note><rest/><type>eighth</type><duration>1</duration>' +
          '<time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes></time-modification></note>',
      ),
    )
    const item = score.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(item?.kind === 'tuplet' && [item.inner.multiple, item.outer.multiple]).toEqual([1, 2])
    expect(item?.kind === 'tuplet' && item.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
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

  // A measure rest need not state how long it lasts, because the time
  // signature says. Nothing then moves the cursor.
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
  // has no note value, so reading it as an ordinary rest would fail.
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

  // Scores sometimes write an extra rest over the measure rest in the
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

  // The dropped rest still stood somewhere, so the cursor moves on from where
  // it stood. A <backup> reaching before the measure start puts that at the
  // start, as it would for a rest that was written out.
  test('passes over a dropped rest from the measure start where the backup reached past it', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
          '<backup><duration>32</duration></backup>' +
          '<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch>' +
          '<duration>4</duration><voice>2</voice><type>quarter</type></note>',
      ),
    )
    const second = result.parts[0]?.measures[0]?.sequences[1]

    // The dropped rest takes the first quarter, so voice 2 begins a quarter
    // into the measure and states the space before it.
    expect(second?.content.map((item) => item.kind)).toEqual(['space', 'event'])
    expect(warnings.map((w) => w.code).sort()).toEqual(['inconsistent:backup', 'redundant:rest'])
  })

  // Without a duration the rest lasts its written value, and the drop is the same.
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

  // A voice whose measure rest is one line and whose notes are another is
  // closed-score writing: the rest stays the sequence's own, and the notes
  // laid over it become a sequence beside it.
  test('lays a note written over a measure rest into a sequence of its own', () => {
    const { score: result, warnings } = read(
      measure(
        '<attributes><divisions>4</divisions></attributes>' +
          '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch>' +
          '<duration>4</duration><voice>1</voice><type>quarter</type></note>',
      ),
    )
    const sequences = result.parts[0]?.measures[0]?.sequences

    expect(sequences?.[0]?.fullMeasure).toBeDefined()
    expect(sequences?.[1]?.content.map((item) => item.kind)).toEqual(['space', 'event'])
    expect(warnings.map((w) => w.code)).toContain('inconsistent:voice')
  })

  // Written one after the other, with no <backup> laying one over the other,
  // the two are one line saying two things.
  test('still rejects a note written after a measure rest', () => {
    expect(
      readFailure(
        measure(
          '<attributes><divisions>4</divisions></attributes>' +
            '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
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

  // A pickup measure's implicit="yes" says the measure is unnumbered. MNX's
  // measure number is a plain integer override, with no way to state a
  // measure unnumbered.
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

  // <notations> holds a mixture, and some of it is converted. Reporting the
  // block as a whole would claim a slur was dropped when it was carried over,
  // so what is inside it is reported instead. The same holds one level down:
  // an <ornaments> whose tremolo is converted reports only what is passed
  // over.
  test('reports what a notations block holds, not the block itself', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type>' +
          '<notations><tied type="start"/><technical><harmonic/></technical>' +
          '<ornaments><trill-mark/></ornaments></notations></note>',
      ),
    )

    // The <tied> start is a tie the measure never ends, reported as such
    // rather than as an unread block, and first, as the document writes it.
    expect(warnings.map((w) => w.message)).toEqual([
      'A tie starts on a note that nothing ties to, and is not carried over.',
      '<harmonic> cannot be expressed in MNX.',
      '<trill-mark> cannot be expressed in MNX.',
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
  // below its position, so all of them have to be carried, not only the
  // pickup.
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

  // Number() reads "1e2" as 100, and the label is digits alone.
  test('reports a measure label written with an exponent', () => {
    const { score: result, warnings } = read(
      score(`<part id="P1"><measure number="1e2">${NOTE}</measure></part>`),
    )

    expect(result.globalMeasures[0]?.number).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:measure-label'])
  })

  // MNX numbers a measure with a whole number of zero or more, so a negative
  // label has no home, like a lettered one.
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

  // A part avoids a signature of more than seven sharps or flats by writing
  // the enharmonic one: five sharps of concert key are written for a B-flat
  // instrument as five flats rather than the seven sharps its transposition
  // asks for. Read back, that gives a concert key twelve fifths from the
  // score's, which is the same key spelled the other way. MNX states where
  // the part flips, so the score keeps one key and nothing is lost.
  describe('a part that flips its key signature enharmonically', () => {
    /** A part in `fifths`, transposing by `transpose` where it states one. */
    const keyed = (id: string, fifths: number, transpose = '') =>
      `<part id="${id}"><measure number="1"><attributes>` +
      `<key><fifths>${String(fifths)}</fifths></key>${transpose}` +
      `</attributes>${NOTE}</measure></part>`

    /** Written a major second above what it sounds. */
    const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    /** Written a minor third below what it sounds. */
    const E_FLAT = '<transpose><diatonic>2</diatonic><chromatic>3</chromatic></transpose>'

    test('states where it flips, and reports no disagreement', () => {
      const { score: result, warnings } = read(score(keyed('P1', 5) + keyed('P2', -5, B_FLAT)))

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: 5 })
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
      expect(warnings).toEqual([])
    })

    // The point is measured in the fifths the part would write without the
    // flip, so the seven sharps the source drew come back from the score's
    // key and the point together.
    test('brings back the signature the source drew', () => {
      const { mnx } = convertValid(score(keyed('P1', 5) + keyed('P2', -5, B_FLAT)))
      const flipAt = mnx.parts[1]?.transposition?.keyFifthsFlipAt ?? 0
      const interval = mnx.parts[1]?.transposition?.interval
      const concert = mnx.global.measures[0]?.key?.fifths ?? 0
      const written = concert - 12 * (interval?.staffDistance ?? 0) + 7 * (interval?.halfSteps ?? 0)

      expect(written >= flipAt ? written - 12 : written).toBe(-5)
    })

    // The score's key is the first stated at a measure, so a measure where
    // only the flipping part states one would take its spelling and re-spell
    // every other part. What it contributes is the key, in the score's own
    // spelling.
    test('contributes the score’s spelling where it is the only part stating one', () => {
      const restated =
        `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
        `${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(restated))

      expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
        { fifths: 5 },
        { fifths: 5 },
      ])
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
      expect(warnings).toEqual([])
    })

    // A measure the score states no key at has nothing to compare the part
    // against, so the flip is settled by the signature the part writes rather
    // than by how far the merge has reached: the reading another measure of
    // the part settled for the same signature is the one contributed here.
    // Otherwise the measure takes the flipped spelling and the score gains a
    // key change the source does not have.
    test('contributes the score\u2019s spelling before the score states a key', () => {
      const late =
        `<part id="P1"><measure number="1">${NOTE}</measure>` +
        `<measure number="2"><attributes><key><fifths>5</fifths></key></attributes>` +
        `${NOTE}</measure></part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
        `${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(late))

      expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
        { fifths: 5 },
        { fifths: 5 },
      ])
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
      expect(warnings).toEqual([])
    })

    // The score's key in force settles the reading before any other measure
    // does, so a part restating its signature after the score changes spelling
    // takes the new spelling.
    test('contributes the score’s spelling in force after the score changes it', () => {
      const respelled =
        `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><key><fifths>-7</fifths></key></attributes>` +
        `${NOTE}</measure><measure number="3">${NOTE}</measure></part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure>` +
        `<measure number="3"><attributes><key><fifths>-5</fifths></key></attributes>` +
        `${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(respelled))

      expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
        { fifths: 5 },
        { fifths: -7 },
        { fifths: -7 },
      ])
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
      expect(warnings).toEqual([])
      convertValid(score(respelled))
    })

    // The ordinary transposing part: it writes the signature its transposition
    // asks for, so there is nothing to flip and no point to state.
    test('states no point for a part writing the signature it is asked for', () => {
      const { score: result, warnings } = read(score(keyed('P1', 0) + keyed('P2', 2, B_FLAT)))

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
      expect(warnings).toEqual([])
    })

    // The other direction, which is the one the test suite's transposing-
    // instruments file reaches: the score's nine flats leave a B-flat
    // instrument seven flats to write, and it writes five sharps instead. A
    // point below zero adds the twelve fifths back rather than taking them off.
    test('states a point below zero for a part writing the sharper signature', () => {
      const { score: result, warnings } = read(score(keyed('P1', -9) + keyed('P2', 5, B_FLAT)))

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: -9 })
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(-7)
      expect(warnings).toEqual([])
    })

    // A measure the part states no key in contributes none: the key it stands
    // in was settled where it was stated.
    test('contributes nothing for a measure the part states no key in', () => {
      const twoMeasures =
        '<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>' +
        `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
        '<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>' +
        `${B_FLAT}</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(twoMeasures))

      expect(result.globalMeasures[1]?.key).toBeUndefined()
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
      expect(warnings).toEqual([])
    })

    // A part in a different key with no point to state contributes the key it
    // is in, not the score's, and the disagreement is reported.
    test('contributes its own key where it differs and no point is stated', () => {
      const later =
        '<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>' +
        `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
        `<part id="P2"><measure number="1">${NOTE}</measure>` +
        '<measure number="2"><attributes><key><fifths>-9</fifths></key></attributes>' +
        `${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(later))

      expect(result.globalMeasures[1]?.key).toEqual({ fifths: -9 })
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    })

    // One point cannot state a part that writes seven sharps and then five
    // flats for the same five sharps of concert key. The flat spelling is
    // the score's key spelled the other way, so it does not re-spell the
    // parts that stated the key first.
    test.each([
      ['at the measure start', '', '<attributes><key><fifths>-5</fifths></key></attributes>'],
      ['late in the measure before', '<attributes><key><fifths>-5</fifths></key></attributes>', ''],
    ])(
      'keeps the score’s spelling where a part with no point flips %s',
      (_name, lateInFirst, atSecond) => {
        const flipped =
          `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
          `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1"><attributes><key><fifths>7</fifths></key>` +
          `${B_FLAT}</attributes>${NOTE}${lateInFirst}</measure>` +
          `<measure number="2">${atSecond}${NOTE}</measure></part>`
        const { score: result, warnings } = read(score(flipped))

        expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
          { fifths: 5 },
          { fifths: 5 },
        ])
        expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
        expect(warnings.map((w) => [w.code, w.context])).toEqual([
          ['unrepresentable:cross-part-key', { part: 'P2', measure: 2 }],
        ])
        convertValid(score(flipped))
      },
    )

    // A transposing part can be in a different key outright, which no point
    // accounts for: only twelve fifths is the same key spelled the other way.
    test('reports a transposing part in a different key', () => {
      const { score: result, warnings } = read(score(keyed('P1', 0) + keyed('P2', 5, B_FLAT)))

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    })

    // The same point covers a part that flips only where the signature runs
    // deep into the flats and writes what it is asked for elsewhere.
    test('states one point below zero for a part that flips only in the flats', () => {
      const change = (fifths: number) =>
        `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
        `</attributes>${NOTE}</measure>`
      const mixed =
        `<part id="P1"><measure number="1"><attributes><key><fifths>-9</fifths></key>` +
        `</attributes>${NOTE}</measure>${change(0)}</part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure>${change(2)}</part>`
      const { score: result, warnings } = read(score(mixed))

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(-7)
      expect(warnings).toEqual([])
    })

    // A part at concert pitch has no transposition to state a flip on, so a
    // signature twelve fifths from the score's is a disagreement it cannot
    // settle.
    test('reports a part at concert pitch spelling the key the other way', () => {
      const { warnings } = read(score(keyed('P1', 5) + keyed('P2', -7)))

      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    })

    /** Two parts at concert pitch, each stating the keys given, measure by measure. */
    const concert = (...parts: readonly (number | undefined)[][]) =>
      parts
        .map(
          (keys, index) =>
            `<part id="P${String(index + 1)}">` +
            keys
              .map(
                (fifths, measure) =>
                  `<measure number="${String(measure + 1)}">` +
                  (fifths === undefined
                    ? ''
                    : `<attributes><key><fifths>${String(fifths)}</fifths></key></attributes>`) +
                  `${NOTE}</measure>`,
              )
              .join('') +
            '</part>',
        )
        .join('')

    // A part at concert pitch has no point to state either. Where an earlier
    // part has the measure and the score's key is in force, the other
    // spelling is that key. Elsewhere it is the only key stated.
    const key = (measure: number) => ['unrepresentable:cross-part-key', { part: 'P2', measure }]
    test.each([
      [
        'the score’s spelling for the same key written flatter',
        [5, undefined],
        [5, -7],
        [5, 5],
        [key(2)],
      ],
      [
        'the score’s spelling for the same key written sharper',
        [-7, undefined],
        [-7, 5],
        [-7, -7],
        [key(2)],
      ],
      [
        'the score’s spelling after the score changes it',
        [5, -7, undefined],
        [5, undefined, 5],
        [5, -7, -7],
        [key(2), key(3)],
      ],
      [
        'its own spelling where the score has no key in force yet',
        [undefined, -7],
        [5, undefined],
        [5, -7],
        [key(2)],
      ],
      [
        'its own spelling past the measures of a shorter earlier part',
        [5, undefined],
        [5, undefined, -7],
        [5, undefined, -7],
        [['inconsistent:measure-count', { part: 'P1', line: 1 }]],
      ],
    ])('contributes %s', (_name, first, second, expected, reported) => {
      const source = score(concert(first, second))
      const { score: result, warnings } = read(source)

      expect(result.globalMeasures.map((measure) => measure.key?.fifths)).toEqual(expected)
      expect(warnings.map((w) => [w.code, w.context])).toEqual(reported)
      convertValid(source)
    })

    // One point covers the whole part and its sign picks the direction, so a
    // part taking twelve fifths off at one key change and adding twelve at
    // the next cannot be stated. The score's nine flats leave a B-flat
    // instrument seven flats to write, which it spells as five sharps.
    test('reports a part flipping both ways', () => {
      const change = (fifths: number) =>
        `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
        `</attributes>${NOTE}</measure>`
      const both =
        `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `</attributes>${NOTE}</measure>${change(-9)}</part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure>${change(5)}</part>`
      const { score: result, warnings } = read(score(both))

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:cross-part-key',
        'unrepresentable:cross-part-key',
      ])
    })

    // The point stands between the keys the part flips and the keys it writes
    // as its transposition asks, so a part that flips at a smaller signature
    // than one it leaves alone cannot be stated either.
    test('reports a part flipping at a smaller signature than one it leaves alone', () => {
      const change = (fifths: number) =>
        `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
        `</attributes>${NOTE}</measure>`
      const mixed =
        `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `</attributes>${NOTE}</measure>${change(6)}</part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}</measure>${change(8)}</part>`
      const { score: result, warnings } = read(score(mixed))

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
    })

    // A part that flips at a large signature and writes a small one as its
    // transposition asks is covered by one point, which stands between them.
    test('states one point for a part that flips only where the signature is large', () => {
      const change = (fifths: number, transpose = '') =>
        `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
        `${transpose}</attributes>${NOTE}</measure>`
      const mixed =
        `<part id="P1"><measure number="1"><attributes><key><fifths>0</fifths></key>` +
        `</attributes>${NOTE}</measure>${change(5)}</part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>3</fifths></key>` +
        `${E_FLAT}</attributes>${NOTE}</measure>${change(-4)}</part>`
      const { score: result, warnings } = read(score(mixed))

      // An E-flat instrument writes three fifths above what it sounds: the
      // score's C major is its three sharps, and the score's five sharps
      // would be eight, written as four flats instead.
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(8)
      expect(warnings).toEqual([])
    })
  })

  // A repeat sign belongs to the score and is usually written into one part
  // only, so a part not stating one is not disagreeing: the sign any part
  // states is the score's.
  test.each(['P1', 'P2'])('takes a repeat sign from %s where only it states one', (stating) => {
    const keyed = (id: string) =>
      `<part id="${id}"><measure number="1">` +
      (id === stating ? '<barline location="left"><repeat direction="forward"/></barline>' : '') +
      `<attributes><divisions>4</divisions></attributes>${QUARTER}</measure></part>`
    const { score: result, warnings } = read(score(keyed('P1') + keyed('P2')))

    expect(result.globalMeasures[0]?.repeatStart).toBe(true)
    expect(warnings).toEqual([])
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
  // nothing in the measure where another part changes meter disagrees as much
  // as one that states its own.
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

  // Nothing states the score's meter past the last measure of every earlier
  // part: the meter carried there is the one this part wrote itself, so there
  // is no other part to disagree with.
  test('says nothing about a meter change past the measures of a shorter earlier part', () => {
    const time = (count: string, unit: string) =>
      `<attributes><time><beats>${count}</beats><beat-type>${unit}</beat-type></time></attributes>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${time('3', '4')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${time('3', '4')}${NOTE}</measure>` +
          `<measure number="2">${time('6', '8')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[1]?.time).toEqual({ count: 6, unit: 8, display: undefined })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:measure-count'])
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
          '\n<part id="P2"><measure number="1">' +
          `${NOTE}<barline location="right"><bar-style>light-light</bar-style></barline>` +
          '</measure></part>',
      ),
    )

    expect(result.globalMeasures[0]?.barline).toBe('final')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-barline'])
    expect(warnings[0]?.element).toBe('barline')
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1, line: 2 })
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
          `\n<part id="P2"><measure number="1">${segno('')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.segno?.color).toBe('#FF0000')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-segno'])
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1, line: 2 })
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
  // itself, not a format limit.
  test('reports parts numbering the same measure differently', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="0">${NOTE}</measure></part>\n` +
          `<part id="P2"><measure number="5">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.number).toBe(0)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:measure-number'])
    expect(warnings[0]).toMatchObject({ element: 'measure', attribute: 'number' })
    // Named by where the measure sits, as every other report names it; the
    // two labels the parts disagree over are in the message.
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1, line: 2 })
    expect(warnings[0]?.message).toContain('numbered 0 by an earlier part and 5 by this one')
  })

  // A part labelling the measure by its position states no label, so
  // there is nothing for it to disagree with.
  test('says nothing where one part labels the measure by its position', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="0">${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.number).toBe(0)
    expect(warnings).toEqual([])
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
          `\n<part id="P2"><measure number="1">${repeated('3')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.repeatEnd).toEqual({ times: 2 })
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'repeat', undefined],
    ])
    expect(warnings[0]?.element).toBe('repeat')
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1, line: 2 })
  })

  test('reports parts drawing different endings over the same measure', () => {
    const bracketed = (numbers: string) =>
      `<barline location="left"><ending number="${numbers}" type="start"/></barline>${NOTE}` +
      `<barline location="right"><ending number="${numbers}" type="stop"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${bracketed('1')}</measure></part>` +
          `\n<part id="P2"><measure number="1">${bracketed('2')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending).toEqual({ duration: 1, numbers: [1], open: false })
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'ending', undefined],
    ])
    expect(warnings[0]?.element).toBe('ending')
    expect(warnings[0]?.context.line).toBe(2)
  })

  test('reports parts holding different fermatas over the same barline', () => {
    const held = (shape: string) =>
      `${NOTE}<barline location="right"><fermata>${shape}</fermata></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${held('angled')}</measure></part>` +
          `\n<part id="P2"><measure number="1">${held('square')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.fermata?.symbol).toBe('angled')
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'fermata', undefined],
    ])
    expect(warnings[0]?.element).toBe('fermata')
    expect(warnings[0]?.context.line).toBe(2)
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
          `\n<part id="P2"><measure number="1">${sign('B')}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:attribute',
      'unrepresentable:cross-part-segno',
    ])
    expect(warnings[2]?.element).toBe('segno')
    expect(warnings[2]?.context.line).toBe(2)
  })

  // A part leaving the sign unnamed says nothing about its name, so it does
  // not disagree with a part naming it, and the name is kept for the jump.
  test.each([
    ['the first part', false],
    ['a later part', true],
  ])('keeps the name of a segno that only %s gives', (_, laterNames) => {
    const drawn = '<direction><direction-type><segno/></direction-type>'
    const part = (id: string, naming: boolean) =>
      `<part id="${id}">` +
      `<measure number="1">${drawn}${naming ? '<sound segno="s1"/>' : ''}</direction>${NOTE}` +
      '</measure>' +
      `<measure number="2">${drawn}${naming ? '<sound segno="s2"/>' : ''}</direction>${NOTE}` +
      '<sound fine="yes"/></measure>' +
      `<measure number="3">${NOTE}<sound dalsegno="s2"/></measure>` +
      '</part>'
    const { score: result, warnings } = read(
      score(part('P1', !laterNames) + part('P2', laterNames)),
    )

    expect(result.globalMeasures[2]?.jump?.type).toBe('dsalfine')
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'sound', 'segno'],
      ['unrepresentable:attribute', 'sound', 'segno'],
    ])
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
          `\n<part id="P2"><measure number="1">${divisions}${quarter}<sound fine="yes"/>` +
          '</measure></part>',
      ),
    )

    expect(result.globalMeasures[0]?.fine).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'sound', 'fine'],
    ])
    expect(warnings[0]?.context.line).toBe(2)
  })

  test('reports parts jumping back to differently named segnos', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1"><direction><direction-type><segno/></direction-type></direction>` +
          `<sound dalsegno="A"/>${NOTE}</measure></part>` +
          `\n<part id="P2"><measure number="1"><sound dalsegno="B"/>${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.jump).toEqual({
      location: { num: 0, den: 1 },
      type: 'segno',
    })
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'sound', 'dalsegno'],
    ])
    expect(warnings[0]?.context.line).toBe(2)
  })

  test('says nothing where the parts restate the same marks', () => {
    const marked =
      '<barline location="left"><ending number="1" type="start"/></barline>' +
      `<direction><direction-type><segno/></direction-type></direction><sound dalsegno="A"/>${NOTE}<sound fine="yes"/>` +
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
// several fields at once. Each test here differs in one field the tests above
// leave alone.
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

  // Two brackets over the same count of times, agreeing on the first and not
  // on the rest. Every number is compared.
  test('reports an ending whose later numbers differ', () => {
    const bracketed = (numbers: string) =>
      `<barline location="left"><ending number="${numbers}" type="start"/></barline>` +
      `${NOTE}<barline location="right"><ending number="${numbers}" type="stop"/></barline>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${bracketed('1,2')}</measure></part>` +
          `<part id="P2"><measure number="1">${bracketed('1,3')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.ending?.numbers).toEqual([1, 2])
    expect(warnings.map((one) => one.element)).toEqual(['ending'])
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

    expect(result.globalMeasures[0]?.fermata?.placement).toBe('above')
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
        `<part id="P1"><measure number="1">${divisions}<direction><direction-type><segno/></direction-type></direction>` +
          `<sound dalsegno="A"/>${quarter}` +
          '</measure></part>' +
          `<part id="P2"><measure number="1">${divisions}${quarter}<sound dalsegno="A"/>` +
          '</measure></part>',
      ),
    )

    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['sound', 'dalsegno']])
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
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${metronome}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 96 },
    ])
    // The second part restates the mark, so nothing is reported.
    expect(warnings).toEqual([])
  })

  // The same mark at two points is a tempo change, and the parts agree about
  // both. Neither is a restatement of the other, so both are kept.
  test('keeps the same mark the parts state at two points in the measure', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${NOTE}${metronome}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((one) => one.position)).toEqual([
      { num: 0, den: 1 },
      { num: 1, den: 1 },
    ])
    expect(warnings).toEqual([])
  })

  // Two tempos at one point contradict each other: a renderer would draw both
  // over the same beat, and a player would have to pick one. The parts
  // disagree about what the score does, so the first is kept and the
  // disagreement is reported, as it is for every other mark they share.
  test('reports parts stating different tempos at the same point', () => {
    const slower = metronome.replace('96', '60')
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${metronome}${NOTE}</measure></part>\n` +
          `<part id="P2"><measure number="1">${slower}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
    expect(warnings[0]?.element).toBe('metronome')
    expect(warnings[0]?.context).toEqual({ part: 'P2', measure: 1, line: 2 })
    // Named as a disagreement between parts, not within one.
    expect(warnings[0]?.message).toBe(
      'The parts of this score state different tempos at the same point in this measure. ' +
        'The first stated is the one converted.',
    )
  })

  // One part writing two marks at one point is the same disagreement with no
  // other part involved, so the report names no parts.
  test('reports one part stating two different tempos at the same point', () => {
    const slower = metronome.replace('96', '60')
    const { score: result, warnings } = read(
      score(`<part id="P1"><measure number="1">${metronome}\n${slower}${NOTE}</measure></part>`),
    )

    expect(result.globalMeasures[0]?.tempos.map((t) => t.bpm)).toEqual([96])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tempo'])
    expect(warnings[0]).toMatchObject({ element: 'metronome', context: { line: 2 } })
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
// layout, a slur for event ids, a tie for note ids, a system break for measure
// ids, and a struck kit for component ids.
const GENERATED_IDS_MEASURES =
  '<measure number="1">' +
  '<attributes><divisions>4</divisions><staves>2</staves>' +
  '<clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef>' +
  '</attributes>' +
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
  '<note><rest/><duration>8</duration><type>half</type><voice>1</voice>' +
  '<staff>1</staff></note>' +
  '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave>' +
  '</unpitched><duration>8</duration><type>half</type><voice>1</voice>' +
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
    const { mnx, warnings } = convertValid(
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
  })

  test('reports the rename at the part, not at its entry in the part list', () => {
    const { warnings } = convertValid(
      score(
        '<part-list>\n<score-part id="Süß"/>\n</part-list>\n' +
          `<part id="Süß"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => [w.code, w.element, w.context.line])).toEqual([
      ['unrepresentable:part-id', 'part', 4],
    ])
  })

  test('leaves printable ASCII part ids alone', () => {
    const { mnx, warnings } = convertValid(
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
  })

  // A part id that reads like an id the converter generates names two things
  // at once: MNX states every id the same way, so nothing in the document
  // tells the part from the event, and a consumer resolving a slur target by
  // id can reach the part instead.
  test.each(['ev2', 'note1', 'kit1', 'm1', 'layout1'])(
    'renames the part id "%s", which the converter gives something else',
    (id) => {
      const { mnx, warnings } = convertValid(
        score(
          `<part-list><score-part id="${id}"/></part-list>` +
            `<part id="${id}">${GENERATED_IDS_MEASURES}</part>`,
        ),
      )

      expect(mnx.parts.map((part) => part.id)).toEqual(['p1'])
      expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:part-id'])
      expect(warnings[0]?.message).toContain(id)
      expect(warnings[0]?.context.part).toBe(id)
      // The two reasons a part is renamed read differently, so the report
      // says which one this is.
      expect(warnings[0]?.message).toContain(
        'the converter gives events, notes, kit components, measures and the layout',
      )
    },
  )

  // The other half of the same rule: an ordinary source id is left alone, so
  // the shapes the converter reserves stay the only ones renamed.
  test.each(['x1', 'P1', 'measure1', 'event2'])('leaves the part id "%s" alone', (id) => {
    const { mnx, warnings } = convertValid(
      score(
        `<part-list><score-part id="${id}"/></part-list>` +
          `<part id="${id}">${GENERATED_IDS_MEASURES}</part>`,
      ),
    )

    expect(mnx.parts.map((part) => part.id)).toEqual([id])
    expect(warnings).toEqual([])
  })

  // src/ids.ts builds GENERATED_ID_PATTERN from the prefixes countedId and
  // LAYOUT_ID use. This checks it against every id a conversion writes.
  test('states the shape of every id the converter generates', () => {
    const { mnx } = convertValid(
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
          if (!('notes' in item) && !('kitNotes' in item)) continue
          if (item.id !== undefined) events.push(item.id)
          for (const note of ('notes' in item ? item.notes : undefined) ?? []) {
            if (note.id !== undefined) notes.push(note.id)
          }
        }
      }
    }
    const components = Object.keys(mnx.parts[0]?.kit ?? {})
    const measures = mnx.global.measures.flatMap((measure) =>
      measure.id === undefined ? [] : [measure.id],
    )
    const layouts = (mnx.layouts ?? []).flatMap((layout) =>
      layout.id === undefined ? [] : [layout.id],
    )

    expect(events.length).toBeGreaterThan(0)
    expect(notes.length).toBeGreaterThan(0)
    expect(measures.length).toBeGreaterThan(0)
    expect(layouts.length).toBeGreaterThan(0)
    expect(components.length).toBeGreaterThan(0)
    for (const id of [...events, ...notes, ...measures, ...layouts, ...components]) {
      expect(GENERATED_ID_PATTERN.test(id)).toBe(true)
    }
  })

  test('skips over an id another part already holds', () => {
    const { mnx, warnings } = convertValid(
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
  })

  // A layout staff names its part by id, so a second part holding the same
  // one could not be drawn. It is renamed, and drawn after the listed parts.
  test('renames the second of two parts sharing an id, and draws it', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-list>' +
          '<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
          '<score-part id="P1"><part-name>Violin</part-name></score-part>' +
          '<score-part id="P2"/>' +
          '<part-group type="stop" number="1"/>' +
          '</part-list>\n' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>\n` +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>\n` +
          `<part id="P2"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.parts.map((p) => [p.id, p.name])).toEqual([
      ['P1', 'Violin'],
      ['p1', 'Violin'],
      ['P2', undefined],
    ])
    expect(mnx.layouts?.[0]?.content).toEqual([
      {
        type: 'group',
        symbol: 'bracket',
        content: [
          { type: 'staff', labelref: 'name', sources: [{ part: 'P1' }] },
          { type: 'staff', sources: [{ part: 'P2' }] },
        ],
      },
      { type: 'staff', labelref: 'name', sources: [{ part: 'p1' }] },
    ])
    expect(warnings).toEqual([
      {
        code: 'inconsistent:part-id',
        message:
          'A part before this one has the id "P1" too, and MNX names each part once. ' +
          'This part is renamed p1, and takes the part list\'s details for "P1".',
        element: 'part',
        attribute: undefined,
        context: { part: 'P1', line: 3 },
      },
    ])
  })

  // The part list names each part once. A second entry for an id is not
  // converted, so the parts holding the id take the first entry's details.
  test('reports a second part list entry for one id, and keeps the first', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-list><score-part id="P1"><part-name>Violin</part-name></score-part>\n' +
          '<score-part id="P1"><part-name>Viola</part-name>' +
          '<score-instrument id="I1"><instrument-name>Viola</instrument-name>' +
          '</score-instrument></score-part></part-list>' +
          `<part id="P1"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    expect(mnx.parts.map((p) => p.name)).toEqual(['Violin'])
    expect(warnings).toEqual([
      {
        code: 'inconsistent:part-id',
        message:
          'The part list has an entry for part "P1" already, and MNX names each part once. ' +
          'This entry is not converted.',
        element: 'score-part',
        attribute: undefined,
        context: { part: 'P1', line: 2 },
      },
    ])
  })

  test('reads no instrument from a second part list entry for one id', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-list><score-part id="P1"><part-name>Drums</part-name></score-part>\n' +
          '<score-part id="P1"><part-name>Snare</part-name>' +
          '<score-instrument id="I1"><instrument-name>Snare</instrument-name>' +
          '</score-instrument></score-part></part-list>\n' +
          '<part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
          '<clef><sign>percussion</sign></clef></attributes><note><unpitched>' +
          '<display-step>C</display-step><display-octave>5</display-octave></unpitched>' +
          '<duration>4</duration><instrument id="I1"/><type>whole</type></note></measure></part>',
      ),
    )

    expect(mnx.parts[0]?.kit).toEqual({ kit1: { staffPosition: 1 } })
    expect(warnings.map((w) => [w.code, w.element, w.context.line])).toEqual([
      ['inconsistent:part-id', 'score-part', 2],
      ['unresolved:instrument-id', 'instrument', 3],
    ])
  })

  // A rename is reported where the part is, ahead of what the part holds.
  test('reports the renames in document order', () => {
    const { warnings } = convertValid(
      score(
        '<part-list><score-part id="Süß"/></part-list>\n' +
          `<part id="Süß"><measure number="1">${NOTE}<foo/></measure></part>\n` +
          `<part id="Süß"><measure number="1">${NOTE}<foo/></measure></part>`,
      ),
    )

    expect(warnings.map((w) => [w.code, w.element, w.context.line])).toEqual([
      ['unrepresentable:part-id', 'part', 2],
      ['unsupported:element', 'foo', 2],
      ['inconsistent:part-id', 'part', 3],
      ['unsupported:element', 'foo', 3],
    ])
  })

  test('renames each later part sharing an id, and an invalid id once per part', () => {
    const { mnx, warnings } = convertValid(
      score(
        '<part-list><score-part id="Süß"/></part-list>' +
          `<part id="Süß"><measure number="1">${NOTE}</measure></part>` +
          `<part id="Süß"><measure number="1">${NOTE}</measure></part>`,
      ),
    )

    // With no layout to name them, the parts are written with no ids.
    expect(mnx.parts).toHaveLength(2)
    expect('layouts' in mnx).toBe(false)
    expect(warnings.map((w) => [w.code, /renamed (p\d)/.exec(w.message)?.[1]])).toEqual([
      ['unrepresentable:part-id', 'p1'],
      ['inconsistent:part-id', 'p2'],
    ])
  })
})

// The notation font. <defaults> is page geometry with no home in MNX, but
// its <music-font> names the SMuFL font the score is engraved in, which is
// MNX's part.smuflFont.
describe('the music font', () => {
  test('carries the font family onto every part', () => {
    const { mnx, warnings } = convertValid(
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
  })

  test('keeps the no-home report for the rest of <defaults>', () => {
    const { mnx, warnings } = convertValid(
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
    const { mnx } = convertValid(
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
    const { mnx, warnings } = convertValid(withDefaults('<music-font/>'))

    expect(mnx.parts.every((p) => !('smuflFont' in p))).toBe(true)
    expect(warnings).toEqual([])
  })

  // Font size and style are presentation, which the attribute sweep passes
  // over.
  test('passes over the font attributes beside the family', () => {
    const { mnx, warnings } = convertValid(
      withDefaults('<music-font font-family="Leland" font-size="20.5"/>'),
    )

    expect(mnx.parts[0]?.smuflFont).toBe('Leland')
    expect(warnings).toEqual([])
  })

  // The family is the only thing read off the element, so anything else it
  // states that is not presentation is a loss, and the unread sweep reports
  // it.
  test('reports an attribute of the music font that is neither read nor presentation', () => {
    const { mnx, warnings } = convertValid(
      withDefaults('<music-font font-family="Leland" xml:lang="en"/>'),
    )

    expect(mnx.parts[0]?.smuflFont).toBe('Leland')
    expect(warnings.map((w) => w.attribute)).toEqual(['xml:lang'])
  })
})
