import { describe, expect, test } from 'vitest'
import { NO_BARLINE, notesOf, readFailure, readValid } from '../../tests/support/read.js'
import { measure, NOTE, QUARTER, score } from '../../tests/support/musicxml.js'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
import { GENERATED_ID_PATTERN } from '../ids.js'

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
        '<attributes><divisions>1</divisions><time><senza-misura>X</senza-misura></time>' +
          '</attributes>' +
          NOTE,
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

describe('notes', () => {
  test('reads a pitch, including its alteration', () => {
    const { score: result } = read(
      measure(
        '<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch>' +
          '<type>quarter</type></note>',
      ),
    )

    expect(notesOf(firstEvent(result))[0]?.pitch).toEqual({
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

    expect(event?.body).toEqual({ kind: 'rest', staffPosition: undefined })
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
      '<score-partwise>\n<part id="P1">\n<measure number="1">\n<grouping type="start"/>\n' +
        `${NOTE}\n</measure>\n</part>\n</score-partwise>`,
    )

    expect(warnings).toEqual([
      {
        code: 'unsupported:element',
        message: '<grouping> is not converted yet.',
        // Named as a field, so a report can be grouped by what was lost
        // without parsing the sentence written for a person to read.
        element: 'grouping',
        context: { part: 'P1', measure: 1, line: 4 },
      },
    ])
  })

  test('reports a chord symbol as notation MNX cannot express', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>' +
        `${NOTE}</measure></part></score-partwise>`,
    )

    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      ['unrepresentable:element', 'harmony', '<harmony> cannot be expressed in MNX.'],
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
    // rather than as an unread block.
    expect(warnings.map((w) => w.message)).toEqual([
      '<harmonic> cannot be expressed in MNX.',
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
