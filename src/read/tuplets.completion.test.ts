// A bracket whose notes come short of what its ratio counts is completed by
// the silence or the notes around it.

import { describe, expect, test } from 'vitest'
import { measures, TRIPLET } from '../../tests/support/tuplets.js'
import { readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { fraction } from '../fraction.js'
import type { SequenceItem } from '../model/score.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

// A quarter under a 3:2 eighth ratio fills two of a bracket's three eighth
// slots. On its own it is a quarter sounding two thirds of a quarter, which
// no pair of note values states. Where the voice is silent for the slot it
// leaves, the bracket states that silence and keeps the ratio the source drew.
describe('a bracket the silence after it completes', () => {
  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  /** A quarter taking two of the three eighth slots of its own bracket. */
  const shortQuarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  /** A note of `units` divisions written as `type`, with no ratio on it. */
  const plain = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type></note>`

  /** An eighth taking one of the three eighth slots of its own bracket. */
  const shortEighth =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  /** A grace note, which takes none of the measure's time. */
  const grace =
    '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type></note>'

  /** The same, opening and closing a bracket of its own. */
  const graceBracket =
    '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>'

  /** Divisions and nothing else: the part states no time signature. */
  const UNTIMED = '<attributes><divisions>12</divisions></attributes>'

  /**
   * A second voice sounding through a 2/4 measure, written after the first
   * has run `written` divisions. The first voice names none, which is
   * reported once a second voice is named.
   */
  const underneath = (written: number) =>
    `<backup><duration>${String(written)}</duration></backup>` +
    '<note><pitch><step>A</step><octave>3</octave></pitch><duration>24</duration>' +
    '<voice>2</voice><type>half</type></note>'

  /** A score of two parts, each writing one measure. */
  const twoParts = (first: string, second: string) =>
    '<score-partwise>' +
    `<part id="P1"><measure number="1">${first}</measure></part>` +
    `<part id="P2"><measure number="1">${second}</measure></part>` +
    '</score-partwise>'

  /** Two parts writing the same measure, the second stating no time signature. */
  const untimedPart = twoParts(
    TIMED + shortQuarter + underneath(8),
    UNTIMED + shortQuarter + underneath(8),
  )

  /** A part writing only the bracket, beside one filling the measure. */
  const shortPart = twoParts(TIMED + plain('D', 24, 'half'), TIMED + shortQuarter)

  function untimed(body: string) {
    return read(measures(UNTIMED + body))
  }

  function timed(body: string) {
    return read(measures(TIMED + body))
  }

  /** The bracket, with what it holds named by kind. */
  function stated(item: SequenceItem | undefined) {
    if (item?.kind !== 'tuplet') return undefined
    return {
      inner: item.inner,
      outer: item.outer,
      held: item.content.map((held) => held.kind),
    }
  }

  /** The written lengths of the spaces the bracket holds. */
  function spaces(item: SequenceItem | undefined) {
    if (item?.kind !== 'tuplet') return undefined
    return item.content.flatMap((held) => (held.kind === 'space' ? [held.duration] : []))
  }

  test('states the silence the measure ends on inside the bracket', () => {
    const { content, warnings } = timed(TRIPLET + shortQuarter)

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings).toEqual([])
  })

  test('writes that silence at the value the ratio counts it in', () => {
    const { content } = timed(TRIPLET + shortQuarter)
    const tuplet = content?.[1]
    const space = tuplet?.kind === 'tuplet' ? tuplet.content[1] : undefined

    expect(space?.kind === 'space' && space.duration).toEqual(fraction(1, 8))
  })

  test('leaves a grace note carried from another line beside the note it ornaments', () => {
    const { content } = timed(
      shortQuarter +
        '<backup><duration>8</duration></backup>' +
        plain('D', 24, 'half') +
        '<backup><duration>12</duration></backup>' +
        grace +
        plain('E', 6, 'eighth'),
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space'])
    expect(content?.slice(1).map((item) => item.kind)).toEqual(['grace', 'event'])
  })

  test('states a gap the source skips over inside the bracket', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>4</duration></forward>' + plain('D', 12, 'quarter'),
    )

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(content?.[1]?.kind).toBe('event')
    expect(warnings).toEqual([])
  })

  test('counts what the bracket holds where the voice sounds straight after', () => {
    const { content, warnings } = timed(shortQuarter + plain('D', 12, 'quarter'))

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  // Silence completes a bracket only where its notes sound at its ratio.
  // These two eighths each last 5 of the 4 divisions 3:2 gives them.
  test('leaves a bracket whose notes do not sound at its ratio uncompleted', () => {
    const slow = (step: string, bracket: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>5</duration>` +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      `<notations><tuplet type="${bracket}"/></notations></note>`
    const { content } = timed(slow('C', 'start') + slow('D', 'stop'))

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'event'],
    })
  })

  // The start marker states the ratio, so the bracket is the source's own
  // even where its notes state no <time-modification>.
  test('takes in the rest after a bracket whose marker states its ratio', () => {
    const marked =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number>' +
      '<tuplet-type>eighth</tuplet-type></tuplet-normal></tuplet></notations></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>' +
      '<note><rest/><duration>4</duration><type>eighth</type></note>'
    const { content } = timed(marked + plain('F', 6, 'eighth'))

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'event', 'event'],
    })
  })

  // Only a rest is taken in this way. A note lasting what the ratio gives it
  // but stating no ratio of its own stays where the source wrote it.
  test('leaves a note after a bracket whose marker states its ratio outside it', () => {
    const marked =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number>' +
      '<tuplet-type>eighth</tuplet-type></tuplet-normal></tuplet></notations></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>' +
      plain('E', 4, 'eighth')
    const { content } = timed(marked + plain('F', 6, 'eighth'))

    expect(stated(content?.[0])?.held).toEqual(['event', 'event'])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event', 'event'])
  })

  // A grace note takes none of the measure's time, so the voice has not
  // sounded again where one stands after the bracket.
  test('states the silence past a grace note standing after the bracket', () => {
    const { content, warnings } = timed(TRIPLET + shortQuarter + grace)

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'grace', 'space'],
    })
    expect(content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A gap before the grace note is only the silence read so far, not all the
  // silence there is, so a bracket the gap alone cannot complete keeps
  // waiting for the barline rather than settling for what has passed.
  test('keeps waiting where a gap too short to complete it precedes a grace note', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>2</duration></forward>' + grace,
    )

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space', 'grace', 'space'],
    })
    expect(spaces(content?.[0])).toEqual([fraction(1, 16), fraction(1, 16)])
    expect(content).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  // A grace note where the silence completes the bracket leads into what
  // follows it, not into the end of the bracket.
  test('leaves a grace note standing where the bracket ends outside it', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>4</duration></forward>' + grace,
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space'])
    expect(content?.slice(1).map((item) => item.kind)).toEqual(['grace'])
    expect(warnings).toEqual([])
  })

  // A grace note that opens a bracket of its own is a grace note still: it
  // takes none of the measure's time, so the silence around it is one
  // silence, read to the end.
  test.each([
    [
      'standing after the bracket',
      graceBracket + '<forward><duration>4</duration></forward>',
      ['event', 'grace', 'space'],
    ],
    [
      'between two gaps after the bracket',
      '<forward><duration>2</duration></forward>' +
        graceBracket +
        '<forward><duration>2</duration></forward>',
      ['event', 'space', 'grace', 'space'],
    ],
  ])('states the silence past a grace note %s that opens a bracket', (_, between, held) => {
    const { content, warnings } = timed(shortQuarter + between + plain('D', 12, 'quarter'))

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held,
    })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  test('takes no more of a longer gap after the bracket than it is missing', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>8</duration></forward>' + plain('D', 6, 'eighth'),
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space'])
    expect(content?.[1]?.kind === 'space' && content[1].duration).toEqual(fraction(1, 12))
    expect(warnings).toEqual([])
  })

  test('counts the silence on both sides of a grace note toward the bracket', () => {
    const { content, warnings } = timed(
      shortQuarter +
        '<forward><duration>2</duration></forward>' +
        grace +
        '<forward><duration>3</duration></forward>' +
        grace,
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space', 'grace', 'space'])
    expect(spaces(content?.[0])).toEqual([fraction(1, 16), fraction(1, 16)])
    expect(content?.slice(1).map((item) => item.kind)).toEqual(['space', 'grace'])
    expect(content?.[1]?.kind === 'space' && content[1].duration).toEqual(fraction(1, 48))
    expect(warnings).toEqual([])
  })

  test('counts the silence on both sides of a grace note where the voice sounds again', () => {
    const { content, warnings } = timed(
      shortQuarter +
        '<forward><duration>2</duration></forward>' +
        grace +
        '<forward><duration>2</duration></forward>' +
        plain('D', 12, 'quarter'),
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space', 'grace', 'space'])
    expect(content?.slice(1).map((item) => item.kind)).toEqual(['event'])
    expect(warnings).toEqual([])
  })

  test('counts what the bracket holds where the silence falls short of its ratio', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>2</duration></forward>' + plain('D', 6, 'eighth'),
    )

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  // A trailing <forward> past the time signature is how a source hangs a
  // direction after the last note. The bracket takes in the silence out
  // there, so the voice runs past the time signature.
  test('refuses a bracket the silence past the time signature completes', () => {
    const error = readFailure(
      measures(
        TIMED +
          plain('D', 12, 'quarter') +
          plain('E', 6, 'eighth') +
          shortEighth +
          '<forward><duration>8</duration></forward>',
      ),
    )

    expect(error.detail).toContain('past the 2/4 its time signature allows')
  })

  // A bracket holding three eighths in the time of two states what the source
  // wrote and needs nothing invented. Stretching it back to the 6:4 the
  // source drew would draw it over silence the source did not.
  test('counts what the bracket holds where a pair of note values states it', () => {
    const sixFour = (step: string, bracket = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>6</actual-notes><normal-notes>4</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const { content, warnings } = timed(sixFour('C', 'start') + sixFour('D') + sixFour('E', 'stop'))

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'event', 'event'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  // The other parts fill the measure, so the part that stops early is silent
  // to the barline, not a measure of its own that ends with the bracket.
  test('states the silence in a part that stops before the others', () => {
    const warnings = new WarningCollector()
    const score = readValid(shortPart, warnings)

    expect(stated(score.parts[1]?.measures[0]?.sequences[0]?.content[0])?.held).toEqual([
      'event',
      'space',
    ])
    expect(warnings.list()).toEqual([])
  })

  // Where the part states no time signature, how far it writes in the measure
  // is all there is to say how long the measure runs.
  test('states the silence in a part that states no time signature', () => {
    const warnings = new WarningCollector()
    const score = readValid(untimedPart, warnings)
    const brackets = score.parts.map((part) => stated(part.measures[0]?.sequences[0]?.content[0]))

    expect(brackets[1]).toEqual(brackets[0])
    expect(brackets[1]?.held).toEqual(['event', 'space'])
    expect(warnings.list().map((w) => w.code)).not.toContain('unrepresentable:tuplet-ratio')
  })

  // The score states the time signature once for every part, so a part that
  // leaves it off still runs to the barline the others state, whichever of
  // them comes first.
  test.each([
    ['after', twoParts(TIMED + plain('D', 24, 'half'), UNTIMED + shortQuarter), 1],
    ['before', twoParts(UNTIMED + shortQuarter, TIMED + plain('D', 24, 'half')), 0],
  ])(
    'states the silence in a part with no time signature written %s one that states it',
    (_, source, untimed) => {
      const warnings = new WarningCollector()
      const score = readValid(source, warnings)
      const bracket = score.parts[untimed]?.measures[0]?.sequences[0]?.content[0]

      expect(stated(bracket)?.held).toEqual(['event', 'space'])
      expect(warnings.list()).toEqual([])
    },
  )

  test('states the silence to the barline a rest filling the measure runs to', () => {
    const { content } = untimed(
      shortQuarter +
        '<backup><duration>8</duration></backup>' +
        '<note><rest measure="yes"/><duration>24</duration><voice>2</voice></note>',
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space'])
  })

  // A <forward> is how MusicXML writes silence it draws nothing for, such as a
  // hidden rest, so the time it passes over is the measure's all the same.
  test('states the silence a part with no time signature skips to', () => {
    const { content, warnings } = untimed(
      shortQuarter + '<forward><duration>16</duration></forward>',
    )

    expect(stated(content?.[0])?.held).toEqual(['event', 'space'])
    expect(warnings).toEqual([])
  })

  test('counts what the bracket holds where a part with no time signature ends with it', () => {
    const { content, warnings } = untimed(shortQuarter)

    expect(stated(content?.[0])?.held).toEqual(['event'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test.each([
    ['completed at the barline', measures(TIMED + TRIPLET + shortQuarter)],
    ['completed in a part that stops before the others', shortPart],
    ['completed in a part with no time signature', untimedPart],
    [
      'completed by a skip',
      measures(UNTIMED + shortQuarter + '<forward><duration>16</duration></forward>'),
    ],
    ['counted in a part with no time signature', measures(UNTIMED + shortQuarter)],
    ['holding a grace note', measures(TIMED + shortQuarter + grace)],
    [
      'completed at the barline around a grace note',
      measures(TIMED + shortQuarter + '<forward><duration>2</duration></forward>' + grace),
    ],
    [
      'completed by the silence on both sides of a grace note',
      measures(
        TIMED +
          shortQuarter +
          '<forward><duration>2</duration></forward>' +
          grace +
          '<forward><duration>3</duration></forward>' +
          grace,
      ),
    ],
    [
      'completed around a grace note where the voice sounds again',
      measures(
        TIMED +
          shortQuarter +
          '<forward><duration>2</duration></forward>' +
          grace +
          '<forward><duration>2</duration></forward>' +
          plain('D', 12, 'quarter'),
      ),
    ],
    [
      'completed where a grace note stands',
      measures(TIMED + shortQuarter + '<forward><duration>4</duration></forward>' + grace),
    ],
  ])('leaves output the schema takes: a bracket %s', (_, source) => {
    convertValid(source)
  })
})

// A ratio states its counts against a note value, and a source that leaves
// <normal-type> off states them against the value of the bracket's first
// note. That says nothing about how wide the bracket it drew is: a lone half
// under 3:2 counts halves, and the same three against two counted in quarters
// is the same ratio over a bracket a quarter wide.
describe('a bracket completed in a value narrower than its ratio states', () => {
  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  /** A half under a 3:2 with no <normal-type>, so the ratio counts halves. */
  const lonelyHalf =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
    '<type>half</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes></time-modification>' +
    '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>'

  /** An eighth under the same ratio, which counts eighths. */
  const shortEighth =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  const plain = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type></note>`

  function timed(body: string) {
    return read(measures(TIMED + body))
  }

  /** The bracket, with what it holds named by kind. */
  function stated(item: SequenceItem | undefined) {
    if (item?.kind !== 'tuplet') return undefined
    return {
      inner: item.inner,
      outer: item.outer,
      held: item.content.map((held) => held.kind),
    }
  }

  // Counted in halves the bracket is missing two of them, which is more
  // silence than a 2/4 measure holds. Counted in quarters it is missing one,
  // which the silence gives exactly.
  test('counts the ratio in the value the silence around the bracket fits', () => {
    const { content, warnings } = timed(lonelyHalf)

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'quarter', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'quarter', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  test('says the ratio is counted in a value the source does not count it in', () => {
    const { warnings } = timed(lonelyHalf)

    expect(warnings[0]?.message).toContain('stated in a narrower note value')
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: 1 })
  })

  test('keeps the widest value the silence fits', () => {
    const { content, warnings } = timed(
      plain('D', 12, 'quarter') +
        plain('E', 6, 'eighth') +
        shortEighth +
        '<forward><duration>2</duration></forward>',
    )

    expect(stated(content?.[2])).toEqual({
      inner: { value: { base: '16th', dots: 0 }, multiple: 3 },
      outer: { value: { base: '16th', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  // In eighths the bracket is missing two of them, and the skip before it
  // holds a quarter of that. In sixteenths it is missing one, which the skip
  // gives exactly, and the bracket then starts on its own beat.
  const lead =
    plain('D', 6, 'eighth') +
    '<forward><duration>2</duration></forward>' +
    shortEighth +
    plain('E', 12, 'quarter')

  test('takes the silence before the bracket in the narrower value as well', () => {
    const { content, warnings } = timed(lead)

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: '16th', dots: 0 }, multiple: 3 },
      outer: { value: { base: '16th', dots: 0 }, multiple: 2 },
      held: ['space', 'event'],
    })
    expect(content?.map((item) => item.kind)).toEqual(['event', 'tuplet', 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  test.each([
    ['at the barline', lonelyHalf],
    [
      'by the gap after it',
      plain('D', 12, 'quarter') +
        plain('E', 6, 'eighth') +
        shortEighth +
        '<forward><duration>2</duration></forward>',
    ],
    ['by the gap before it', lead],
  ])('leaves output the schema takes: a bracket completed %s', (_, body) => {
    convertValid(measures(TIMED + body))
  })
})

// A source can stop a bracket before the notes its ratio counts are all in,
// and carry on with notes that state the ratio and no bracket. Those notes
// already sound at the ratio, so the bracket can take them in and the measure
// keeps the time the source gives it.
describe('a bracket completed by the run of notes after it', () => {
  // 2/2 with divisions of 12: a quarter is 12 and the measure 48. Under 3:2
  // a quarter lasts 8.
  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>2</beat-type></time></attributes>'

  const rated = (body: string, markers = '', units = 8, actual = 3) =>
    `<note>${body}<duration>${String(units)}</duration><type>quarter</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification>' +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'
  const tripletRest = (markers = '') => rated('<rest/>', markers)
  const tripletNote = (step: string, markers = '', units = 8, actual = 3) =>
    rated(`<pitch><step>${step}</step><octave>5</octave></pitch>`, markers, units, actual)
  const plainRest = (units: number, type: string) =>
    `<note><rest/><duration>${String(units)}</duration><type>${type}</type></note>`

  /** The bracket the source drew, stopped after two of its three quarters. */
  const stoppedEarly = tripletRest('<tuplet type="start"/>') + tripletRest('<tuplet type="stop"/>')

  function timed(body: string) {
    return read(measures(TIMED + body))
  }

  function shape(content: readonly SequenceItem[] | undefined): unknown[] {
    return (content ?? []).map((item) =>
      item.kind === 'tuplet'
        ? [item.inner.multiple, item.outer.multiple, item.content.length]
        : item.kind,
    )
  }

  test('takes the note after it inside the bracket', () => {
    const { content, warnings } = timed(plainRest(24, 'half') + stoppedEarly + tripletNote('D'))

    expect(shape(content)).toEqual(['event', [3, 2, 3]])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  // The bracket ends up drawn over a note the source draws it outside of.
  test('says the bracket is drawn over the note the source draws outside it', () => {
    const { warnings } = timed(plainRest(24, 'half') + stoppedEarly + tripletNote('D'))

    expect(warnings[0]?.message).toContain('drawn inside the bracket')
    expect(warnings[0]?.context).toEqual({ part: 'P1', measure: 1, line: 1 })
  })

  // The stop the source writes on that note names a bracket that is not
  // running, which is the source disagreeing with itself.
  test('takes it in where a stop the source wrote closes it', () => {
    const { content, warnings } = timed(
      plainRest(24, 'half') + stoppedEarly + tripletNote('D', '<tuplet type="stop"/>'),
    )

    expect(shape(content)).toEqual(['event', [3, 2, 3]])
    // One for the stop the source wrote where nothing was running, one for
    // the note the bracket is now drawn over.
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet', 'inconsistent:tuplet'])
  })

  // What the run keeps is settled against the time it still takes, not the
  // time it took before it gave notes up. One triplet quarter on its own is
  // a ratio no pair of note values states, which is reported.
  test('takes no more of the run than the bracket is missing', () => {
    const { content, warnings } = timed(stoppedEarly + tripletNote('D') + tripletNote('E'))

    expect(shape(content)).toEqual([
      [3, 2, 3],
      [1, 2, 1],
    ])
    expect(warnings.map((w) => w.code)).toEqual([
      'inconsistent:tuplet',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // The run stands between the bracket and the silence beyond it, so the
  // bracket reaches that silence only once the whole run has moved in.
  test('takes the silence past the run in once the whole run has moved in', () => {
    const { content } = timed(
      tripletRest('<tuplet type="start"/><tuplet type="stop"/>') + tripletNote('D'),
    )
    const bracket = content?.[0]

    expect(shape(content)).toEqual([[3, 2, 3]])
    expect(bracket?.kind === 'tuplet' && bracket.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'space',
    ])
  })

  // A run stating another ratio sounds at that ratio, not at the bracket's.
  test('leaves a run stating another ratio where it stands', () => {
    const { content } = timed(plainRest(12, 'quarter') + stoppedEarly + tripletNote('D', '', 6, 4))

    expect(shape(content)).toEqual(['event', [2, 2, 2], [2, 1, 1]])
  })

  // Silence between the two is what the bracket takes in, and the run is no
  // longer what stands after it.
  test('leaves a run the bracket does not reach where it stands', () => {
    const { content } = timed(
      stoppedEarly + '<forward><duration>8</duration></forward>' + tripletNote('D'),
    )

    expect(shape(content)).toEqual([
      [3, 2, 3],
      [1, 2, 1],
    ])
    const bracket = content?.[0]
    expect(bracket?.kind === 'tuplet' && bracket.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'space',
    ])
  })

  // A note that does not sound at the ratio it states would carry its own
  // disagreement into the bracket.
  test('leaves a run whose notes do not sound at the ratio where it stands', () => {
    const { content, warnings } = timed(
      plainRest(12, 'quarter') + stoppedEarly + tripletNote('D', '', 6),
    )

    expect(shape(content)).toEqual(['event', [2, 2, 2], [2, 1, 1]])
    expect(warnings.map((w) => w.code)).toContain('inconsistent:duration')
  })

  // A gap inside the run stands in it as a space, written at the run's frame.
  // The bracket's frame is the same ratio, so the space moves in as it is.
  // The run settles what it still holds against the time it still takes, and
  // a space it gave up is no longer its to write.
  test('takes a skip standing inside the run in with the notes around it', () => {
    const half =
      '<note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration>' +
      '<type>half</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification></note>'
    const { content, warnings } = timed(
      tripletNote('C', '<tuplet type="start"/><tuplet type="stop"/>') +
        tripletNote('D') +
        '<forward><duration>8</duration></forward>' +
        half,
    )
    const bracket = content?.[0]
    const space = bracket?.kind === 'tuplet' ? bracket.content[2] : undefined

    expect(shape(content)).toEqual([
      [3, 2, 3],
      [2, 2, 1],
    ])
    expect(space?.kind === 'space' && space.duration).toEqual(fraction(1, 4))
    expect(warnings.map((w) => w.code)).toEqual([
      'inconsistent:tuplet',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // A bracket the source drew says where it runs, so it is not a run the
  // bracket before it may reach into.
  test('leaves a bracket the source drew standing after it alone', () => {
    const lone = tripletNote('C', '<tuplet type="start"/><tuplet type="stop"/>')
    const { content } = timed(
      lone + tripletNote('D', '<tuplet type="start"/><tuplet type="stop"/>'),
    )

    expect(shape(content)).toEqual([
      [1, 2, 1],
      [3, 2, 2],
    ])
  })

  // The bracket is missing less than the run's first note is wide, so no note
  // moves in and the run goes on standing between it and the silence.
  test('reaches no silence past a run whose first note does not fit', () => {
    const eighth = (step: string, markers = '') =>
      `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration>` +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'
    const { content, warnings } = timed(
      eighth('C', '<tuplet type="start"/>') +
        eighth('D', '<tuplet type="stop"/>') +
        tripletNote('E') +
        tripletNote('F'),
    )

    expect(shape(content)).toEqual([
      [2, 2, 2],
      [2, 2, 2],
    ])
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-ratio',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // The run states 5:2 but sounds at the bracket's 3:2, so the bracket takes
  // B in. What the run keeps is the skip and D, a quarter lasting 10
  // divisions. The skip of 3 divisions is written in D's frame, 12 written
  // per 10 sounded, so 3/40 of a whole note, and not at the 5:2 it was filled
  // at.
  test('writes a skip the run keeps in the frame of the notes it keeps', () => {
    const { content } = timed(
      stoppedEarly +
        tripletNote('B', '', 8, 5) +
        '<forward><duration>3</duration></forward>' +
        tripletNote('D', '', 10, 5),
    )

    expect(content?.find((item) => item.kind === 'space')).toEqual({
      kind: 'space',
      duration: fraction(3, 40),
    })
  })

  test('leaves output the schema takes', () => {
    const source = measures(TIMED + plainRest(24, 'half') + stoppedEarly + tripletNote('D'))

    convertValid(source)
  })
})

// A bracket short of what its ratio counts is completed by the silence after
// it. A source that draws that silence as a rest of the tuplet's own and
// leaves it outside the bracket has written the same music, so it converts
// the same way: the rest moves inside the bracket.
describe('a bracket completed by the rest written after it', () => {
  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  /** A quarter taking two of the three eighth slots of its own bracket. */
  const shortQuarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'
  const rest = (units: number, type: string) =>
    `<note><rest/><duration>${String(units)}</duration><type>${type}</type></note>`
  const quarter =
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration>' +
    '<type>quarter</type></note>'

  /** An eighth rest lasting a triplet eighth, which is the slot left over. */
  const tripletRest = rest(4, 'eighth')
  /** The same music with the rest left implicit, which the cursor skips. */
  const gap = '<forward><duration>4</duration></forward>'

  function timed(body: string) {
    return read(measures(TIMED + body))
  }

  function shape(content: readonly SequenceItem[] | undefined): unknown[] {
    return (content ?? []).map((item) =>
      item.kind === 'tuplet'
        ? [item.inner.multiple, item.outer.multiple, item.content.map((held) => held.kind)]
        : item.kind,
    )
  }

  test('draws the rest inside the bracket', () => {
    const { content } = timed(shortQuarter + tripletRest + quarter)

    expect(shape(content)).toEqual([[3, 2, ['event', 'event']], 'event'])
  })

  test('keeps the rest at the value the source drew it with', () => {
    const { content } = timed(shortQuarter + tripletRest + quarter)
    const bracket = content?.[0]
    const held = bracket?.kind === 'tuplet' ? bracket.content[1] : undefined

    expect(held?.kind === 'event' && held.value).toEqual({ base: 'eighth', dots: 0 })
  })

  test('says the rest is drawn where the source does not draw it', () => {
    const { warnings } = timed(shortQuarter + tripletRest + quarter)
    const reported = warnings.find((w) => w.code === 'inconsistent:tuplet')

    expect(reported?.message).toContain('drawn inside the bracket')
    expect(reported?.context).toEqual({ part: 'P1', measure: 1, line: 1 })
  })

  // Nothing is drawn inside the bracket where the silence before it is what
  // completes it, so there is nothing to report either.
  test('says nothing where the rest after is wider than the bracket is missing', () => {
    const { content, warnings } = timed(
      '<forward><duration>4</duration></forward>' + shortQuarter + rest(8, 'quarter'),
    )

    expect(shape(content)).toEqual([[3, 2, ['space', 'event']], 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
  })

  // The rest is drawn and the gap is not, so one holds an event where the
  // other holds a space. The ratio the bracket takes is the same.
  test('states the same ratio as the gap the rest stands for', () => {
    const ratio = (content: readonly SequenceItem[] | undefined) => {
      const bracket = content?.[0]
      return bracket?.kind === 'tuplet' ? [bracket.inner, bracket.outer] : undefined
    }
    const written = timed(shortQuarter + tripletRest + quarter)
    const skipped = timed(shortQuarter + gap + quarter)

    expect(ratio(written.content)).toEqual(ratio(skipped.content))
    expect(skipped.warnings).toEqual([])
  })

  // A rest that lasts what it is written as is silence beside the bracket,
  // not a note of the tuplet the source left outside it.
  test('leaves a rest that lasts what it is written as where it stands', () => {
    const { content, warnings } = timed(shortQuarter + rest(6, 'eighth'))

    expect(shape(content)).toEqual([[2, 2, ['event']], 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('leaves output the schema takes', () => {
    const source = measures(TIMED + shortQuarter + tripletRest + quarter)

    convertValid(source)
  })
})

// A pickup measure's beats line up with the barline it ends on, not the one
// it begins on, and it has no silence past its own end. Both bound what a
// short bracket in one can take.
describe('a short bracket in a pickup measure', () => {
  const FOUR =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'

  /** One note under a 3:2 eighth ratio, opening and closing its own bracket. */
  const alone =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  function pickup(body: string) {
    const warnings = new WarningCollector()
    const source =
      '<score-partwise><part id="P1"><measure number="1" implicit="yes">' +
      FOUR +
      body +
      '</measure></part></score-partwise>'
    const score = readValid(source, warnings)
    return {
      content: score.parts[0]?.measures[0]?.sequences[0]?.content,
      // The attribute is a loss as a statement about the numbering, reported
      // whether or not the anchor is read off it.
      warnings: warnings.list().filter((w) => w.code !== 'unrepresentable:attribute'),
    }
  }

  /** Each item by kind, a bracket as what it holds. */
  function shape(content: readonly SequenceItem[] | undefined): unknown[] {
    return (content ?? []).map((item) =>
      item.kind === 'tuplet' ? item.content.map((held) => held.kind) : item.kind,
    )
  }

  test('counts what the bracket holds where the pickup ends with it', () => {
    const { content, warnings } = pickup(alone)

    expect(shape(content)).toEqual([['event']])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('takes the silence before the bracket from the barline the pickup ends on', () => {
    const { content, warnings } = pickup('<forward><duration>10</duration></forward>' + alone)

    expect(shape(content)).toEqual(['space', ['space', 'event']])
    expect(content?.[0]?.kind === 'space' && content[0].duration).toEqual(fraction(1, 8))
    expect(warnings).toEqual([])
  })

  test('leaves output the schema takes', () => {
    const source =
      '<score-partwise><part id="P1"><measure number="1" implicit="yes">' +
      FOUR +
      '<forward><duration>10</duration></forward>' +
      alone +
      '</measure></part></score-partwise>'

    convertValid(source)
  })
})

// A bracket's missing slots can stand before its notes as well as after them.
// Where the voice is silent on both sides, the bracket takes what puts its
// start on a multiple of its outer from the barline, which is where the beat
// it divides begins.
describe('a bracket the silence before it completes', () => {
  const TIMED =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  /** One note under a 3:2 eighth ratio, opening and closing its own bracket. */
  const alone = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '<normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  const skip = (units: number) => `<forward><duration>${String(units)}</duration></forward>`

  const plain = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type></note>`

  function timed(body: string) {
    return read(measures(TIMED + body))
  }

  // A bracket its notes and the silence around it cannot complete takes the
  // time its ratio gives it, more than its notes sound for. A 3/4 measure has
  // room for that.
  function roomy(body: string) {
    return read(measures(TIMED.replace('<beats>2</beats>', '<beats>3</beats>') + body))
  }

  /** Each item by kind, a bracket as what it holds. */
  function shape(content: readonly SequenceItem[] | undefined): unknown[] {
    return (content ?? []).map((item) =>
      item.kind === 'tuplet' ? item.content.map((held) => held.kind) : item.kind,
    )
  }

  test('states the silence before the bracket inside it', () => {
    const { content, warnings } = timed(
      skip(4) + alone('C', 8, 'quarter') + plain('D', 12, 'quarter'),
    )

    expect(shape(content)).toEqual([['space', 'event'], 'event'])
    expect(warnings).toEqual([])
  })

  test('writes that silence at the value the ratio counts it in', () => {
    const { content } = timed(skip(4) + alone('C', 8, 'quarter') + plain('D', 12, 'quarter'))
    const tuplet = content?.[0]
    const space = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

    expect(space?.kind === 'space' && space.duration).toEqual(fraction(1, 8))
  })

  /** A grace note, which takes none of the measure's time. */
  const grace =
    '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type></note>'

  // A grace note takes none of the measure's time, so the skip written before
  // it still stands straight before the bracket. The group is drawn where the
  // bracket now runs, so it moves inside with the silence.
  test('states the silence past a grace note standing before the bracket', () => {
    const { content, warnings } = timed(
      skip(4) + grace + alone('C', 8, 'quarter') + plain('D', 12, 'quarter'),
    )

    expect(shape(content)).toEqual([['space', 'grace', 'event'], 'event'])
    expect(warnings).toEqual([])
  })

  // Nothing but a grace group stands before a bracket opening the measure, so
  // there is no skip for the silence to come off.
  test('takes the silence after where only a grace note stands before', () => {
    const { content, warnings } = timed(grace + alone('C', 8, 'quarter'))

    expect(shape(content)).toEqual(['grace', ['event', 'space']])
    expect(warnings).toEqual([])
  })

  test('splits the silence around a note standing in the middle of its bracket', () => {
    const { content, warnings } = timed(
      skip(4) + alone('C', 4, 'eighth') + skip(4) + plain('D', 12, 'quarter'),
    )

    expect(shape(content)).toEqual([['space', 'event', 'space'], 'event'])
    expect(warnings).toEqual([])
  })

  test('takes the silence before rather than after where that puts the bracket on its beat', () => {
    const { content, warnings } = timed(
      skip(4) + alone('C', 8, 'quarter') + skip(4) + alone('D', 8, 'quarter'),
    )

    expect(shape(content)).toEqual([
      ['space', 'event'],
      ['space', 'event'],
    ])
    expect(warnings).toEqual([])
  })

  test('takes the silence before a bracket that ends at the barline', () => {
    const { content, warnings } = timed(
      plain('D', 12, 'quarter') + skip(4) + alone('C', 8, 'quarter'),
    )

    expect(shape(content)).toEqual(['event', ['space', 'event']])
    expect(warnings).toEqual([])
  })

  // The beats of an ordinary measure are counted from the barline it begins
  // on, whatever the cursor does after the bracket.
  test('counts the lead from the measure start where the cursor runs past the signature', () => {
    const { content, warnings } = timed(skip(4) + alone('C', 8, 'quarter') + skip(26))

    expect(shape(content)).toEqual([['space', 'event']])
    expect(warnings).toEqual([])
  })

  test('leaves the rest of a longer silence before the bracket', () => {
    const { content, warnings } = timed(skip(16) + alone('C', 8, 'quarter'))

    expect(shape(content)).toEqual(['space', ['space', 'event']])
    expect(content?.[0]?.kind === 'space' && content[0].duration).toEqual(fraction(1, 4))
    expect(warnings).toEqual([])
  })

  test('leaves outside the bracket a silence that would not put it on its beat', () => {
    const { content, warnings } = timed(
      plain('D', 6, 'eighth') + skip(2) + alone('C', 8, 'quarter') + skip(8),
    )

    expect(shape(content)).toEqual(['event', 'space', ['event', 'space']])
    expect(warnings).toEqual([])
  })

  test('counts what the bracket holds where the silence before it falls short', () => {
    const { content, warnings } = roomy(
      plain('D', 6, 'eighth') + skip(2) + alone('C', 8, 'quarter') + plain('E', 6, 'eighth'),
    )

    expect(shape(content)).toEqual(['event', 'space', ['event'], 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('keeps the silence before where the silence after falls short', () => {
    const { content, warnings } = roomy(
      skip(4) + alone('C', 4, 'eighth') + plain('E', 12, 'quarter') + skip(4),
    )

    expect(shape(content)).toEqual(['space', ['event'], 'event'])
    expect(content?.[0]?.kind === 'space' && content[0].duration).toEqual(fraction(1, 12))
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('takes no more silence before than the bracket is missing', () => {
    const { content, warnings } = roomy(
      skip(8) + alone('C', 8, 'quarter') + plain('D', 6, 'eighth'),
    )

    expect(shape(content)).toEqual(['space', ['event'], 'event'])
    expect(content?.[0]?.kind === 'space' && content[0].duration).toEqual(fraction(1, 6))
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test.each([
    ['before', skip(4) + alone('C', 8, 'quarter') + plain('D', 12, 'quarter')],
    ['around', skip(4) + alone('C', 4, 'eighth') + skip(4) + plain('D', 12, 'quarter')],
    ['at the barline', plain('D', 12, 'quarter') + skip(4) + alone('C', 8, 'quarter')],
    [
      'past a grace note before it',
      skip(4) + grace + alone('C', 8, 'quarter') + plain('D', 12, 'quarter'),
    ],
    ['after a grace note opening the measure', grace + alone('C', 8, 'quarter')],
  ])('leaves output the schema takes: a bracket completed %s', (_, body) => {
    convertValid(measures(TIMED + body))
  })
})
