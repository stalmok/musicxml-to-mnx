// MNX states the global measures once for the whole score: key, time
// signature, tempo, barline, measure number, repeats, endings, jumps and
// fermatas. MusicXML states them inside each part, so the parts can repeat
// each other or disagree.

import { describe, expect, test } from 'vitest'
import { NO_BARLINE, readFailure, readValid } from '../../tests/support/read.js'
import { NOTE, QUARTER, score } from '../../tests/support/musicxml.js'
import { WarningCollector } from './collector.js'

// A note short enough for any time signature these tests state.
const SHORT = NOTE.replace('whole', 'eighth')

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { score: result, warnings: warnings.list() }
}

describe('several parts', () => {
  test('takes each measure’s key and time from the first part that states them', () => {
    const { score: result } = read(
      score(
        '<part id="P1"><measure number="1">' +
          '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
          `${SHORT}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>' +
          `${SHORT}</measure></part>`,
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
          `${SHORT}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          `${SHORT}</measure></part>`,
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
        `<part id="P1"><measure number="1">${time('3', '4')}${SHORT}</measure>` +
          `<measure number="2">${time('6', '8')}${SHORT}</measure></part>` +
          `<part id="P2"><measure number="1">${time('3', '4')}${SHORT}</measure>` +
          `<measure number="2">${SHORT}</measure></part>`,
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

    expect(result.globalMeasures[2]?.jump?.type).toBe('dsAlFine')
    // MNX states one segno in a score with a dal segno jump, so the first,
    // which no jump returns to, is not converted.
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'sound', 'segno'],
      ['unrepresentable:attribute', 'sound', 'segno'],
      ['unrepresentable:jump-destination', 'segno', undefined],
    ])
    expect(result.globalMeasures[0]?.segno).toBeUndefined()
  })

  // A sign at another point is a different sign, so its name is not taken.
  test('keeps no name from a later part that draws the segno at another point', () => {
    const named = (name: string) =>
      `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
    const segno = '<direction><direction-type><segno/></direction-type></direction>'
    const part = (id: string, first: string) =>
      `<part id="${id}">` +
      `<measure number="1">${first}</measure>` +
      `<measure number="2">${named('b')}${NOTE}</measure>` +
      `<measure number="3">${NOTE}<sound dalsegno="a"/></measure>` +
      '</part>'
    const { warnings } = read(
      score(part('P1', segno + NOTE) + part('P2', NOTE + named('a') + NOTE)),
    )

    expect(warnings.map((w) => w.code)).toContain('unresolved:segno')
  })

  test.each([
    ['the first part', false],
    ['a later part', true],
  ])('keeps the name of a coda that only %s gives', (_, laterNames) => {
    const drawn = '<direction><direction-type><coda/></direction-type>'
    const part = (id: string, naming: boolean) =>
      `<part id="${id}">` +
      `<measure number="1">${NOTE}<sound tocoda="c2"/></measure>` +
      `<measure number="2">${NOTE}<sound dacapo="yes"/></measure>` +
      `<measure number="3">${drawn}${naming ? '<sound coda="c1"/>' : ''}</direction>${NOTE}` +
      '</measure>' +
      `<measure number="4">${drawn}${naming ? '<sound coda="c2"/>' : ''}</direction>${NOTE}` +
      '</measure>' +
      '</part>'
    const { score: result, warnings } = read(
      score(part('P1', !laterNames) + part('P2', laterNames)),
    )

    expect(result.globalMeasures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      false,
      true,
    ])
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:attribute', 'sound', 3],
      ['unrepresentable:attribute', 'sound', 4],
      ['unrepresentable:jump-destination', 'coda', 3],
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

  test.each([
    ['the first part', false],
    ['a later part', true],
  ])('keeps the target of a jump that only %s names', (_, laterNames) => {
    const sign = (name: string) =>
      `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
    const part = (id: string, naming: boolean) =>
      `<part id="${id}">` +
      `<measure number="1">${sign('s1')}${NOTE}</measure>` +
      `<measure number="2">${sign('s2')}${NOTE}</measure>` +
      `<measure number="3">${NOTE}<sound dalsegno="${naming ? 's2' : ''}"/></measure>` +
      '</part>'
    const { score: result, warnings } = read(
      score(part('P1', !laterNames) + part('P2', laterNames)),
    )

    expect(result.globalMeasures[2]?.jump?.type).toBe('segno')
    expect(result.globalMeasures.map((measure) => measure.segno !== undefined)).toEqual([
      false,
      true,
      false,
    ])
    expect(warnings.filter((w) => w.code === 'unrepresentable:cross-part-mark')).toEqual([])
  })

  test('reports parts going on to differently named codas', () => {
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1"><sound tocoda="A"/>${NOTE}</measure></part>` +
          `\n<part id="P2"><measure number="1"><sound tocoda="B"/>${NOTE}</measure></part>`,
      ),
    )

    expect(
      warnings
        .filter((w) => w.code === 'unrepresentable:cross-part-mark')
        .map((w) => [w.element, w.attribute, w.context.line]),
    ).toEqual([['sound', 'tocoda', 2]])
  })

  test('reports parts stating different kinds of jump at the same point', () => {
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1"><sound dacapo="yes"/>${NOTE}</measure></part>` +
          `\n<part id="P2"><measure number="1"><sound tocoda="c"/>${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.jump?.type).toBe('dc')
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'sound', 'tocoda'],
    ])
    expect(warnings[0]?.context.line).toBe(2)
  })

  test('reports parts drawing different codas on the same measure', () => {
    const sign = (glyph: string) =>
      `<direction><direction-type><coda smufl="${glyph}"/></direction-type></direction>${NOTE}`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${sign('coda')}</measure></part>` +
          `\n<part id="P2"><measure number="1">${sign('codaSquare')}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.coda?.glyph).toBe('coda')
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:cross-part-mark', 'coda', undefined],
    ])
    expect(warnings[0]?.context.line).toBe(2)
  })

  test('says nothing where the parts restate the same marks', () => {
    const marked =
      '<barline location="left"><ending number="1" type="start"/></barline>' +
      `<direction><direction-type><segno/><coda/></direction-type></direction><sound dalsegno="A"/>${NOTE}<sound fine="yes"/>` +
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

  test('reports a coda drawn at different points in the measure', () => {
    const coda = '<direction><direction-type><coda/></direction-type></direction>'
    const { score: result, warnings } = read(
      score(
        '<part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${coda}${QUARTER}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${QUARTER}${coda}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.coda?.location).toEqual({ num: 0, den: 1 })
    expect(warnings.map((w) => w.element)).toEqual(['coda'])
  })

  test('reports a coda drawn in different colors', () => {
    const coda = (color: string) =>
      `<direction><direction-type><coda color="${color}"/></direction-type></direction>`
    const { score: result, warnings } = read(
      score(
        `<part id="P1"><measure number="1">${coda('#FF0000')}${NOTE}</measure></part>` +
          `<part id="P2"><measure number="1">${coda('#0000FF')}${NOTE}</measure></part>`,
      ),
    )

    expect(result.globalMeasures[0]?.coda?.color).toBe('#FF0000')
    expect(warnings.map((w) => w.element)).toEqual(['coda'])
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
        `<part id="P1"><measure number="1">${timed('3')}${SHORT}</measure></part>` +
          `<part id="P2"><measure number="1">${timed('4')}${SHORT}</measure></part>`,
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

// MNX requires every part to have as many measures as the score.
describe('parts of different lengths', () => {
  test.each([
    ['stops before', 1],
    ['runs past', 3],
  ])('refuses a part that %s the end of the score', (_name, count) => {
    const measures = (n: number) =>
      Array.from({ length: n }, (_, i) => `<measure number="${String(i + 1)}">${NOTE}</measure>`)
    const error = readFailure(
      score(
        `<part id="P1">${measures(2).join('')}</part>` +
          `<part id="P2">${measures(count).join('')}</part>`,
      ),
    )

    expect(error.detail).toBe(
      `Part P2 has ${String(count)} measures where part P1 has 2. ` +
        'MNX requires every part to have as many measures as the score.',
    )
    expect(error.path).toEqual(['score-partwise', 'part P2'])
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
