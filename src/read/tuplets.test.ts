// A tuplet is written with values longer than it sounds: three eighths played
// in the time of two. MusicXML says so twice, once as a ratio on every note
// (<time-modification>) and once as a bracket around them (<tuplet>). MNX
// wraps the notes in one object carrying the ratio.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const DIVISIONS = '<attributes><divisions>12</divisions></attributes>'

/**
 * A note lasting `units` divisions, written as `type`, inside a 3:2 tuplet.
 * `bracket` places the start or stop marker.
 */
function tupletNote(step: string, units: number, type: string, bracket = ''): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'
  )
}

/**
 * One note of a two-note tremolo: written as a half, lasting a quarter of
 * the measure (12 divisions), with the pair's 2:1 ratio.
 */
function tremoloNote(step: string, type: string, marks = '3'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>12</duration><type>half</type>' +
    '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
    '</time-modification>' +
    `<notations><ornaments><tremolo type="${type}">${marks}</tremolo></ornaments></notations>` +
    '</note>'
  )
}

/** Three eighths in the time of two, which together fill one quarter. */
const TRIPLET =
  tupletNote('C', 4, 'eighth', 'start') +
  tupletNote('D', 4, 'eighth') +
  tupletNote('E', 4, 'eighth', 'stop')

function measure(body: string): string {
  return `<score-partwise><part id="P1"><measure number="1">${DIVISIONS}${body}</measure></part></score-partwise>`
}

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readScore(parseXmlRoot(source), warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
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

describe('tuplet display', () => {
  const displayed =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
    '<notations><tuplet type="start" bracket="no" show-number="none" show-type="both"/></notations></note>' +
    tupletNote('D', 4, 'eighth') +
    tupletNote('E', 4, 'eighth', 'stop')

  test('carries the bracket and number and value display from the source', () => {
    const { content } = read(measure(displayed))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('no')
    expect(tuplet?.kind === 'tuplet' && tuplet.showNumber).toBe('noNumber')
    expect(tuplet?.kind === 'tuplet' && tuplet.showValue).toBe('both')
  })

  // The standard way to number only the first tuplet of a run: the source
  // wraps each later <tuplet> in <notations print-object="no">. Hiding the
  // whole notation is the tuplet drawn with no bracket, no number and no
  // value, which the display settings state.
  test('states a hidden tuplet notation as drawn with nothing', () => {
    const hidden =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations print-object="no"><tuplet type="start"/></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(measure(hidden))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('no')
    expect(tuplet?.kind === 'tuplet' && tuplet.showNumber).toBe('noNumber')
    expect(tuplet?.kind === 'tuplet' && tuplet.showValue).toBe('noNumber')
    expect(warnings).toEqual([])
  })

  // print-object="no" hides the whole block, so a display attribute stated
  // inside it is hidden with the rest.
  test('hides the number past a marker stating it shown', () => {
    const hidden =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations print-object="no"><tuplet type="start" bracket="yes" show-number="both"/>' +
      '</notations></note>' +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(measure(hidden))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('no')
    expect(tuplet?.kind === 'tuplet' && tuplet.showNumber).toBe('noNumber')
    expect(warnings).toEqual([])
  })

  // A hidden block holding anything besides tuplet markers still has no
  // home, and the report now names what the block holds.
  test('still reports a hidden block holding more than tuplets', () => {
    const hidden =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations print-object="no"><tuplet type="start"/>' +
      '<articulations><staccato/></articulations></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(measure(hidden))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['print-object'])
    expect(warnings[0]?.message).toContain('The block holds <tuplet>.')
  })

  test('leaves the display unset when the source states none', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.showNumber).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.showValue).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.orient).toBeUndefined()
  })

  // MusicXML says which side of the notes the bracket is drawn on with
  // placement; MNX states it as the tuplet's orient.
  test('carries the placement onto the tuplet as its orient', () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start" placement="below"/></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(measure(placed))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.orient).toBe('below')
    expect(warnings).toEqual([])
  })

  // A stop marker's placement restates the start's, which the tuplet's
  // orient already carries, so nothing is lost and nothing is reported.
  test('writes the orient onto schema-valid MNX, reading the placement the stop restates', () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start" placement="above"/></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="stop" placement="above"/></notations></note>'
    const { mnx, warnings } = convertMusicXML(measure(placed))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!item || !('type' in item) || item.type !== 'tuplet') throw new Error('expected a tuplet')

    expect(item.orient).toBe('above')
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes the display onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(measure(displayed))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!item || !('type' in item) || item.type !== 'tuplet') throw new Error('expected a tuplet')

    expect(item.bracket).toBe('no')
    expect(item.showNumber).toBe('noNumber')
    expect(item.showValue).toBe('both')
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Two tuplets may start on the same note, told apart by number, and each
  // start marker carries its own display attributes.
  test('gives each of two tuplets starting on the same note its own display', () => {
    const innerNote = (step: string, markers = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>9</actual-notes><normal-notes>4</normal-notes>' +
      '</time-modification>' +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'
    const outerNote = (step: string, markers = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>12</duration><type>quarter</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'
    const source =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>18</divisions></attributes>' +
      innerNote(
        'C',
        '<tuplet type="start" number="1" bracket="yes" show-number="both" placement="above"/>' +
          '<tuplet type="start" number="2" bracket="no" show-number="none" placement="below"/>',
      ) +
      innerNote('D') +
      innerNote('E', '<tuplet type="stop" number="2"/>') +
      outerNote('F') +
      outerNote('G', '<tuplet type="stop" number="1"/>') +
      '</measure></part></score-partwise>'

    const { mnx } = convertMusicXML(source)
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!outer || !('type' in outer) || outer.type !== 'tuplet')
      throw new Error('expected a tuplet')
    const inner = outer.content[0]
    if (!inner || !('type' in inner) || inner.type !== 'tuplet')
      throw new Error('expected a tuplet')

    expect(outer.bracket).toBe('yes')
    expect(outer.showNumber).toBe('both')
    expect(outer.orient).toBe('above')
    expect(inner.bracket).toBe('no')
    expect(inner.showNumber).toBe('noNumber')
    expect(inner.orient).toBe('below')
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// A start marker may carry <tuplet-actual> and <tuplet-normal>, stating its
// own tuplet's ratio. A note's <time-modification> is cumulative, so when two
// tuplets start on the same note it cannot say which level takes which share;
// the markers can.
describe('tuplet ratios stated on the start marker', () => {
  const threeInTwoEighths =
    '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
    '</tuplet-normal>'

  const note = (
    step: string,
    duration: number,
    actual: number,
    normal: number,
    markers = '',
  ): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>eighth</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  // A triplet of eighths nested inside another triplet of eighths, both
  // brackets starting on the first note. The innermost notes carry the
  // cumulative 9:4, and each bracket's own 3:2 comes from its start marker.
  const doubleStart =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>9</divisions></attributes>' +
    note(
      'C',
      2,
      9,
      4,
      `<tuplet type="start" number="1">${threeInTwoEighths}</tuplet>` +
        `<tuplet type="start" number="2">${threeInTwoEighths}</tuplet>`,
    ) +
    note('D', 2, 9, 4) +
    note('E', 2, 9, 4, '<tuplet type="stop" number="2"/>') +
    note('F', 3, 3, 2, '<tuplet type="stop" number="1"/>') +
    '</measure></part></score-partwise>'

  test('states each of two tuplets starting on the same note as its own ratio', () => {
    const { mnx, warnings } = convertMusicXML(doubleStart)
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!outer || !('type' in outer) || outer.type !== 'tuplet')
      throw new Error('expected a tuplet')
    const inner = outer.content[0]
    if (!inner || !('type' in inner) || inner.type !== 'tuplet')
      throw new Error('expected a tuplet')

    expect(outer.inner).toEqual({ duration: { base: 'eighth' }, multiple: 3 })
    expect(outer.outer).toEqual({ duration: { base: 'eighth' }, multiple: 2 })
    expect(inner.inner).toEqual({ duration: { base: 'eighth' }, multiple: 3 })
    expect(inner.outer).toEqual({ duration: { base: 'eighth' }, multiple: 2 })
    expect(
      warnings.filter(
        (w) => w.code === 'inconsistent:tuplet' || w.code === 'inconsistent:duration',
      ),
    ).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // One marker is enough: the other level's share is what remains of the
  // cumulative ratio once the stated one is divided out.
  test('recovers the unmarked of two tuplets starting together from the marked one', () => {
    const oneMarked =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>9</divisions></attributes>' +
      note(
        'C',
        2,
        9,
        4,
        `<tuplet type="start" number="1">${threeInTwoEighths}</tuplet>` +
          '<tuplet type="start" number="2"/>',
      ) +
      note('D', 2, 9, 4) +
      note('E', 2, 9, 4, '<tuplet type="stop" number="2"/>') +
      note('F', 3, 3, 2, '<tuplet type="stop" number="1"/>') +
      '</measure></part></score-partwise>'
    const { content, warnings } = read(oneMarked)
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })

  // The notes' <time-modification> is what the durations follow, so it
  // governs timing. A start marker stating a different ratio is reported, and
  // the ratio the notes state is the one converted.
  test('keeps the ratio the notes state when the marker disagrees, and reports it', () => {
    const disagreeing =
      '<tuplet-actual><tuplet-number>5</tuplet-number><tuplet-type>16th</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>4</tuplet-number><tuplet-type>16th</tuplet-type>' +
      '</tuplet-normal>'
    const first =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      `<notations><tuplet type="start">${disagreeing}</tuplet></notations></note>`
    const { content, warnings } = read(
      measure(first + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
    expect(warnings[0]?.message).toContain('start marker')
  })

  // <tuplet-actual> and <tuplet-normal> may each be left out, and either may
  // state only its number. What is left out comes from <time-modification>.
  test('fills what the marker leaves out from the time-modification', () => {
    const numbersOnly = '<tuplet-actual><tuplet-number>3</tuplet-number></tuplet-actual>'
    const first =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      `<notations><tuplet type="start">${numbersOnly}</tuplet></notations></note>`
    const { content, warnings } = read(
      measure(first + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })
})

// A <tuplet> marker's number can state tuplets that cross: one closes while
// another, opened later, stays open. MNX's tuplets nest, so a crossing cannot
// be stated; each stop is matched to the innermost open tuplet, and a stop
// naming a different one is reported.
describe('crossing tuplet numbers', () => {
  const threeInTwoEighths =
    '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
    '</tuplet-normal>'

  const note = (
    step: string,
    duration: number,
    actual: number,
    normal: number,
    markers = '',
  ): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>eighth</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  // Two tuplets start on one note; the one numbered 1 stops first, while the
  // one numbered 2, opened later, runs on. Both stops close the innermost
  // open tuplet instead, and each names a different one, so each reports the
  // crossing.
  const crossed =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>9</divisions></attributes>' +
    note(
      'C',
      2,
      9,
      4,
      `<tuplet type="start" number="1">${threeInTwoEighths}</tuplet>` +
        `<tuplet type="start" number="2">${threeInTwoEighths}</tuplet>`,
    ) +
    note('D', 2, 9, 4) +
    note('E', 2, 9, 4, '<tuplet type="stop" number="1"/>') +
    note('F', 3, 3, 2, '<tuplet type="stop" number="2"/>') +
    '</measure></part></score-partwise>'

  test('reports a stop naming a tuplet that is not the innermost open one', () => {
    const { mnx, warnings } = convertMusicXML(crossed)

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'unrepresentable:tuplet-crossing', element: 'tuplet' },
      { code: 'unrepresentable:tuplet-crossing', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('cross')

    // The conversion itself stays the nesting: the outer tuplet holds the
    // inner one, exactly as when the stops match the nesting.
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!outer || !('type' in outer) || outer.type !== 'tuplet')
      throw new Error('expected a tuplet')
    const inner = outer.content[0]
    expect(inner && 'type' in inner && inner.type).toBe('tuplet')
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Nested tuplets may end on the same note, and MusicXML does not constrain
  // which stop is written first inside <notations>. Whatever the order, the
  // note's stops close the same tuplets, so nothing crosses.
  test.each([
    ['<tuplet type="stop" number="1"/><tuplet type="stop" number="2"/>'],
    ['<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'],
  ])('says nothing when nested tuplets stop on one note as %s', (stops) => {
    const nested =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>9</divisions></attributes>' +
      note('C', 3, 3, 2, `<tuplet type="start" number="1">${threeInTwoEighths}</tuplet>`) +
      note('D', 2, 9, 4, `<tuplet type="start" number="2">${threeInTwoEighths}</tuplet>`) +
      note('E', 2, 9, 4) +
      note('F', 2, 9, 4, stops) +
      '</measure></part></score-partwise>'
    const { warnings } = convertMusicXML(nested)

    expect(warnings).toEqual([])
  })

  // A marker that states no number is tuplet 1, so an unnumbered marker and
  // one numbered 1 name the same tuplet.
  test('matches a stop that states no number to a start numbered 1', () => {
    const numberedStart =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start" number="1"/></notations></note>'
    const { warnings } = read(
      measure(numberedStart + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
    )

    expect(warnings).toEqual([])
  })

  test('matches a numbered stop to a start that states no number', () => {
    const numberedStop =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="stop" number="1"/></notations></note>'
    const { warnings } = read(
      measure(tupletNote('C', 4, 'eighth', 'start') + tupletNote('D', 4, 'eighth') + numberedStop),
    )

    expect(warnings).toEqual([])
  })
})

describe('tuplets', () => {
  test('wraps the notes in one tuplet', () => {
    const { content } = read(measure(TRIPLET))

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind).toBe('tuplet')
  })

  test('states what is played and the space it is played in', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
  })

  test('keeps the notes inside it, with the values they are written with', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside).toHaveLength(3)
    expect(inside[0]?.kind === 'event' && inside[0].value).toEqual({ base: 'eighth', dots: 0 })
  })

  test('takes only the time it really lasts from the measure', () => {
    // The triplet fills one quarter, so a following quarter completes a 2/4
    // bar rather than being pushed past the barline.
    const { content } = read(
      measure(
        TRIPLET +
          '<note><pitch><step>G</step><octave>4</octave></pitch>' +
          '<duration>12</duration><type>quarter</type></note>',
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
  })

  test('reads a ratio whose written value differs from the notes inside', () => {
    const { content } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
          '<type>16th</type><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
          '<notations><tuplet type="start"/></notations></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration>' +
          '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
          '<notations><tuplet type="stop"/></notations></note>',
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.value).toEqual({ base: 'eighth', dots: 0 })
  })

  // MusicXML's <time-modification> is cumulative: a note inside two tuplets
  // states the combined ratio of both, not the inner level's own. A triplet
  // 16th inside a triplet eighth carries 9:4 (3*3 : 2*2). The inner tuplet
  // must still be stated as its own 3:2, and the durations must add up
  // through both ratios.
  test('recovers the inner ratio from a cumulative nested time-modification', () => {
    const outerNote = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>6</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const innerNote = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>2</duration><type>16th</type>' +
      '<time-modification><actual-notes>9</actual-notes><normal-notes>4</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const source =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>18</divisions></attributes>' +
      outerNote('C', 'start') +
      innerNote('D', 'start') +
      innerNote('E') +
      innerNote('F', 'stop') +
      outerNote('G', 'stop') +
      '</measure></part></score-partwise>'
    const { content, warnings } = read(source)
    const outer = content?.[0]
    const nested = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(nested?.kind === 'tuplet' && nested.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(nested?.kind === 'tuplet' && nested.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
    expect(
      warnings.filter(
        (w) => w.code === 'inconsistent:duration' || w.code === 'inconsistent:tuplet',
      ),
    ).toEqual([])
  })

  // MusicXML allows a note to carry several <notations> blocks, and exporters
  // use that: a tie in one, a tuplet marker in another.
  test('finds a bracket in any of a note\u2019s notations blocks', () => {
    const withSecondBlock =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      '<notations><tied type="stop"/></notations>' +
      '<notations print-object="no"><tuplet type="start"/></notations></note>'
    const { content } = read(
      measure(
        withSecondBlock + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content?.[0]?.kind).toBe('tuplet')
  })

  // A note inside a tuplet is meant to last less than it is written as; that
  // is what the ratio says. Only a duration that disagrees even through the
  // ratio is the source disagreeing with itself.
  test('says nothing about a duration the tuplet ratio accounts for', () => {
    const { warnings } = read(measure(TRIPLET))

    expect(warnings.filter((w) => w.code === 'inconsistent:duration')).toEqual([])
  })

  test('reports a duration that disagrees even through the tuplet ratio', () => {
    // Written as a quarter inside a 3:2 tuplet, so it should last 8 of the
    // measure's 12 divisions, but the source gives it 4. The quarter also
    // pushes the bracket's content past its ratio, which is reported over
    // the tuplet.
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'quarter') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    expect(warnings.filter((w) => w.code === 'inconsistent:duration')).toHaveLength(1)
    expect(warnings.filter((w) => w.code === 'inconsistent:tuplet')).toHaveLength(1)
  })

  // A voice that first sounds partway through the measure passes over the
  // time before that in silence. When its first note opens a tuplet, that
  // silence belongs before the bracket, not inside it, where the ratio would
  // scale it.
  test('puts the silence before a tuplet outside its bracket', () => {
    const other =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type><voice>1</voice></note>'
    const late = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>eighth</type><voice>2</voice>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const warnings = new WarningCollector()
    const result = readScore(
      parseXmlRoot(measure(other + late('C', 'start') + late('D') + late('E', 'stop'))),
      warnings,
    )
    const content = result.parts[0]?.measures[0]?.sequences[1]?.content

    expect(content?.map((item) => item.kind)).toEqual(['space', 'tuplet'])
    expect(warnings.list().filter((w) => w.element === 'tuplet')).toEqual([])
  })

  // A gap inside the bracket, as a <forward> between its notes leaves, is
  // scaled by the ratio like everything else there, so the space that states
  // it has to be in written units: a skipped triplet eighth is written as an
  // eighth even though it lasts a twelfth of a whole note.
  test('states a gap inside the bracket in written values', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          '<forward><duration>4</duration></forward>' +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside.map((item) => item.kind)).toEqual(['event', 'space', 'event'])
    expect(inside[1]?.kind === 'space' && inside[1].duration).toEqual({ num: 1, den: 8 })
    expect(warnings.filter((w) => w.element === 'tuplet')).toEqual([])
  })

  // Real scores contain brackets whose content does not add up to the stated
  // ratio: a lone quarter under a 3:2 eighth ratio, standing for a triplet
  // quarter. The content is converted as written, and the disagreement is
  // reported, because a consumer cannot tell how much time such a tuplet
  // means to take.
  test('reports a tuplet whose written content falls short of its ratio', () => {
    const partial =
      '<note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration>' +
      '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
      '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>'
    const { warnings } = read(measure(partial))

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'inconsistent:tuplet', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('falls short')
  })

  test('reports a tuplet whose written content overruns its ratio', () => {
    const over =
      tupletNote('C', 4, 'eighth', 'start') +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth') +
      tupletNote('F', 4, 'eighth', 'stop')
    const { warnings } = read(measure(over))

    expect(warnings.map((w) => w.element)).toEqual(['tuplet'])
    expect(warnings[0]?.message).toContain('overruns')
  })

  test('rejects a tuplet the source never closes', () => {
    expect(
      readFailure(measure(tupletNote('C', 4, 'eighth', 'start') + tupletNote('D', 4, 'eighth')))
        .message,
    ).toContain('never closed')
  })

  test('rejects a stop with no tuplet open', () => {
    expect(readFailure(measure(tupletNote('C', 4, 'eighth', 'stop'))).message).toContain(
      'no tuplet is open',
    )
  })

  // Without brackets there is nothing to say where one tuplet ends and the
  // next begins, and guessing would invent a grouping the source never wrote.
  test('rejects a tuplet with no bracket to mark it', () => {
    expect(readFailure(measure(tupletNote('C', 4, 'eighth'))).message).toContain('bracket')
  })

  // A tremolo written across two notes carries <time-modification> as well,
  // but it is not a tuplet: the pair is one tremolo item.
  test('does not mistake a tremolo written across two notes for a tuplet', () => {
    const { content } = read(measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop')))

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
  })

  // One written on a single note lasts what it is written as, and is a mark
  // on the event.
  test('converts a note carrying a tremolo of its own', () => {
    const tremolo =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(tremolo))

    expect(content?.[0]?.kind === 'event' && content[0].value).toEqual({ base: 'half', dots: 0 })
    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({
      tremolo: { orient: undefined, marks: 3 },
    })
    expect(warnings).toEqual([])
  })

  test('rejects a tuplet opening on a note that says nothing about its length', () => {
    const noRatio =
      '<note><rest/><duration>4</duration>' + '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(noRatio)).message).toContain('no <time-modification>')
  })

  test('rejects a tuplet with no note value to count', () => {
    const noValue =
      '<note><rest/><duration>4</duration>' +
      '<time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(noValue)).message).toContain('no note value to count')
  })

  test('rejects a normal-type it does not know', () => {
    const oddType =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '<normal-type>triangle</normal-type></time-modification>' +
      '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(oddType)).message).toContain('Unknown note type "triangle"')
  })
})

// Real engravers write a bracket with no ratio beside it: ten songs of the
// Lieder corpus carry one, and the whole file used to be refused over it. The
// note itself says what the ratio is, as how long it lasts against how it is
// written, so that is what is converted.
describe('a bracket the source states no ratio for', () => {
  /** A note of `units` divisions written as an eighth, bracketed or not. */
  const bare = (step: string, units: number, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'

  // Two eighths lasting an eighth each: a bracket that changes no duration,
  // which is drawn over what it holds and states two in the time of two.
  test('states a bracket over notes that play as written', () => {
    const { content, warnings } = read(measure(bare('C', 6, 'start') + bare('D', 6, 'stop')))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
  })

  // Three eighths in the time of two, written by an exporter that left the
  // <time-modification> out. The durations say 3:2, so the tuplet does.
  test('reads the ratio of a triplet whose ratio was left out', () => {
    const { content, warnings } = read(
      measure(bare('C', 4, 'start') + bare('D', 4) + bare('E', 4, 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
    expect(warnings[0]?.message).toContain('lasts 2/3 of what it is written as')
  })

  // The bracket states what it holds against the time it takes, so a bracket
  // over two different values is counted in one that divides them both. Read
  // from its first note alone, this stated a half note of space where the
  // source has a quarter, and the measure came out a quarter longer.
  test('counts a bracket over two different values in one that fits both', () => {
    const quarter =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
      '<type>quarter</type><notations><tuplet type="start"/></notations></note>'
    const eighth =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>'
    const { content } = read(measure(quarter + eighth))
    const tuplet = content?.[0]

    // Three eighths written, two eighths of space: the quarter and the eighth
    // together take one quarter of the measure, which is what they last.
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
  })

  // A marker stating its own ratio has said what the bracket is; only the
  // <time-modification> beside the note is missing. Scaling that to the
  // content would redraw the number the source put over the bracket.
  test('keeps a ratio the start marker states of its own', () => {
    const stating =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal></tuplet></notations></note>'
    const { content, warnings } = read(
      measure(stating + bare('D', 4) + bare('E', 4) + bare('F', 4, 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    // Four eighths under a bracket that says three: the source's own
    // disagreement, which is reported rather than scaled away.
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'inconsistent:tuplet',
    ])
  })

  // The same rule where scaling the bracket to its content would state a
  // different number: six eighths under a marker reading 3:2 are six in the
  // time of four, and the source's own 3:2 is what is drawn over them.
  test('keeps the stated ratio rather than the one its content would state', () => {
    const stating =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal></tuplet></notations></note>'
    const { content, warnings } = read(
      measure(
        stating + bare('D', 4) + bare('E', 4) + bare('F', 4) + bare('G', 4) + bare('A', 4, 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      3, 2,
    ])
    // Six eighths under a bracket that says three: the source's own
    // disagreement, reported rather than scaled away.
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'inconsistent:tuplet',
    ])
  })

  // A note whose length works out as a ratio no tuplet is written with is a
  // broken duration, not a bracket to be read.
  test('rejects a first note whose length is no ratio a tuplet would state', () => {
    const odd =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration>' +
      '<type>whole</type><notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(odd)).message).toContain('no <time-modification>')
  })

  test('writes MNX the spec schema accepts for one', () => {
    const { mnx } = convertMusicXML(measure(bare('C', 4, 'start') + bare('D', 4, 'stop')))

    expect(schemaErrors(mnx)).toEqual([])
  })

  // Nothing says how one ratio would divide between two brackets, so the
  // document is still refused rather than the division invented.
  test('rejects two brackets opening together with no ratio', () => {
    const doubled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start" number="1"/>' +
      '<tuplet type="start" number="2"/></notations></note>'

    expect(readFailure(measure(doubled)).message).toContain('More than one tuplet starts')
  })
})

// A note inside a tuplet is weighed against its written value scaled by the
// ratio around it. The report named the written value alone, so a note in a
// triplet came out as "written as an eighth but lasts an eighth": the same
// length twice, reading as a fault here rather than in the source.
describe('a note inside a tuplet lasting the wrong time', () => {
  test('names the length the ratio wants, not the written one twice', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 6, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const reported = warnings.filter((w) => w.code === 'inconsistent:duration')

    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toBe(
      'A <note> is written as an eighth, which the tuplet around it makes 1/12 of a ' +
        'whole note, but it lasts an eighth. The written value is the one converted.',
    )
  })

  // Each note of a two-note tremolo is written with the value of the pair and
  // lasts half of it, so a tremolo scales a written value as a tuplet does.
  // The report used to call it a tuplet, in a document holding none.
  test('names the tremolo where a tremolo is what scales the note', () => {
    // Each note is written as a half, so the pair wants a quarter each; both
    // last a dotted quarter instead, which is the source disagreeing with
    // itself while the tremolo is what scales them.
    const long = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>18</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
    const { warnings } = read(measure(long('C', 'start') + long('E', 'stop')))
    const reported = warnings.filter((w) => w.code === 'inconsistent:duration')

    expect(reported[0]?.message).toContain('which the tremolo around it makes')
  })

  // Outside a tuplet nothing scales the written value, and the report says
  // the two lengths plainly.
  test('says the written value and the length plainly outside a tuplet', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
          '<type>eighth</type></note>',
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
    expect(warnings[0]?.message).toBe(
      'A <note> is written as an eighth but lasts a quarter. The written value is the one converted.',
    )
  })
})

describe('beam levels', () => {
  const beamed = (level: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>' +
    `<type>eighth</type><beam number="${level}">begin</beam></note>`

  test('reads a beam that states no level as the first one', () => {
    const { content } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>' +
          '<type>eighth</type><beam>begin</beam></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
          '<type>eighth</type><beam>end</beam></note>',
      ),
    )

    expect(content).toHaveLength(2)
  })

  // How a note is beamed is drawing rather than duration: the measure adds up
  // whether or not the beam is drawn. A level outside the eight a stem can
  // carry is reported and the beam left undrawn, the way a fanned beam on the
  // same element is, rather than the whole document being refused over it.
  test.each(['0', '99', 'first'])('reports "%s" as a beam level, and converts', (level) => {
    const { content, warnings } = read(measure(beamed(level)))

    expect(content).toHaveLength(1)
    expect(warnings).toMatchObject([
      {
        code: 'unresolved:attribute-value',
        element: 'beam',
        attribute: 'number',
      },
    ])
    expect(warnings[0]?.message).toContain(`is "${level}"`)
  })

  // The beams the note does state at a level that exists are still drawn.
  test('keeps the beams beside one at a level that does not exist', () => {
    const note = (step: string, beams: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>3</duration>` +
      `<type>16th</type>${beams}</note>`
    const { warnings } = read(
      measure(
        note('C', '<beam number="1">begin</beam><beam number="9">begin</beam>') +
          note('D', '<beam number="1">end</beam><beam number="9">end</beam>'),
      ),
    )

    expect(warnings.map((w) => w.attribute)).toEqual(['number', 'number'])
  })
})

// A bracket opens around a whole event, and a chord member is read after the
// event it joins is already placed, so a start marker written on one names a
// tuplet this converter cannot draw. It is reported rather than dropped, and
// the stop that matches it is dropped with it.
describe('a tuplet marker on a chord member', () => {
  const chordMember = (markers: string) =>
    '<note><chord/><pitch><step>F</step><octave>4</octave></pitch>' +
    '<duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations>${markers}</notations></note>`

  // A bracket around a chord is drawn by writing the same marker on every
  // note of it, which Sibelius and MuseScore both do. Read again on each
  // member, the stop closed a bracket nothing had opened and refused the
  // document; four songs of the wider corpora were refused for it.
  test('passes over a marker that restates the one the chord itself carries', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          chordMember('<tuplet type="start"/>') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          chordMember('<tuplet type="stop"/>'),
      ),
    )

    expect(warnings).toEqual([])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })

  // Sibelius leaves <voice> off a chord member, so the marker is weighed
  // against the chord it joins rather than against the unnamed voice.
  test('passes over a restatement on a member that states no voice', () => {
    const voiced = (step: string, markers = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      '<type>eighth</type><voice>1</voice>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'
    const { content, warnings } = read(
      measure(
        voiced('C', '<tuplet type="start"/>') +
          voiced('D') +
          voiced('E', '<tuplet type="stop"/>') +
          chordMember('<tuplet type="stop"/>'),
      ),
    )

    expect(warnings).toEqual([])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
  })

  test('reports a start written on a chord member', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          chordMember('<tuplet type="start" number="2"/>') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'unsupported:element', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('chord member')
    // The bracket the source did draw is untouched, and holds all three events.
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })

  test('drops the stop that matches a start dropped on a chord member', () => {
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const stopsBoth =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      `<notations>${stops}</notations></note>`
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          chordMember('<tuplet type="start" number="2"/>') +
          stopsBoth,
      ),
    )

    // Only the dropped start is reported: the stop closes nothing, so no
    // crossing is claimed and the outer bracket still closes on this note.
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
  })

  // A mis-tracked stop is what would nest the brackets wrongly, so the output
  // is validated rather than only compared.
  test('writes the bracket that is left onto schema-valid MNX', () => {
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const { mnx, warnings } = convertMusicXML(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          chordMember('<tuplet type="start" number="2"/>') +
          '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>eighth</type>' +
          '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
          `</time-modification><notations>${stops}</notations></note>`,
      ),
    )
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(outer && 'type' in outer && outer.type).toBe('tuplet')
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A source that never nests tuplets numbers every one of them 1, so a
  // dropped start and the bracket around it share a number as a matter of
  // course. The bracket's own stop closes the bracket; taking it for the
  // dropped start left the bracket open and refused the whole document.
  test('leaves the open bracket its own stop where both are numbered alike', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          chordMember('<tuplet type="start"/>') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })

  // A stop on a chord member closes correctly, because the chord it joins is
  // the last event inside the bracket. Only a start has nowhere to go.
  test('closes the bracket on a stop written on a chord member', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth') +
          chordMember('<tuplet type="stop"/>'),
      ),
    )

    expect(warnings).toEqual([])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })
})

describe('grace notes', () => {
  const grace = (step: string, extra = '') =>
    `<note><grace${extra}/><pitch><step>${step}</step><octave>5</octave></pitch>` +
    '<type>eighth</type></note>'
  const REAL =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
    '<type>quarter</type></note>'

  test('gathers the grace notes into a group before the note they lead to', () => {
    const { content } = read(measure(grace('B') + REAL))

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
  })

  test('keeps consecutive grace notes in one group', () => {
    const { content } = read(measure(grace('B') + grace('C') + REAL))
    const group = content?.[0]

    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    // None of them is drawn with a slash, so the group is not either: the
    // slash is carried from the notes that state one.
    expect(group?.kind === 'grace' && group.slashed).toBe(false)
  })

  test('notes when the group is drawn with a slash', () => {
    const { content } = read(measure(grace('B', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  // A bare grace element is an appoggiatura, drawn without a slash, and the
  // document states that: the schema declares no default for slash, so an
  // absent one is unspecified rather than false.
  test('converts a bare grace element to a group stating slash false', () => {
    const { mnx, warnings } = convertMusicXML(measure(grace('B') + REAL))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(item).toMatchObject({ type: 'grace', slash: false })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('marks the group as slashed even when the slash is on a later note', () => {
    const { content } = read(measure(grace('B') + grace('C', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  test('still takes no time from the measure', () => {
    const { content } = read(measure(grace('B') + REAL + REAL))

    // Two quarters and a grace note fill a 2/4 bar; the grace note adds
    // nothing to that.
    expect(content?.filter((item) => item.kind === 'event')).toHaveLength(2)
  })
})

// A tremolo written across two notes gives each the value of the pair while
// the pair occupies that value once, stated as the note's <duration> and a
// 2:1 <time-modification>. MNX gathers the pair into one tremolo item.
describe('two-note tremolos', () => {
  test('gathers the pair into one item, warning about nothing', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop')),
    )

    expect(content).toHaveLength(1)
    const item = content?.[0]
    expect(item?.kind === 'multiNoteTremolo' && item.marks).toBe(3)
    expect(item?.kind === 'multiNoteTremolo' && item.outer).toEqual({
      value: { base: 'quarter', dots: 0 },
      multiple: 2,
    })
    expect(
      item?.kind === 'multiNoteTremolo' && item.content.map((event) => event.value.base),
    ).toEqual(['half', 'half'])
    expect(warnings).toEqual([])
  })

  // The mark is usually drawn with three beams, and that is what an empty
  // element means.
  test('draws three beams where the source does not count them', () => {
    const { content } = read(measure(tremoloNote('C', 'start', '') + tremoloNote('E', 'stop', '')))

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(3)
  })

  test('keeps the notes of a chord together under the tremolo', () => {
    const chord =
      '<note><chord/><pitch><step>G</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>half</type></note>'
    const { content } = read(
      measure(tremoloNote('C', 'start') + chord + tremoloNote('E', 'stop') + chord),
    )

    const item = content?.[0]
    expect(
      item?.kind === 'multiNoteTremolo' && item.content.map((event) => event.notes.length),
    ).toEqual([2, 2])
  })

  test('rejects a tremolo that stops where none is open', () => {
    expect(readFailure(measure(tremoloNote('C', 'stop'))).message).toContain(
      'stops where none is open',
    )
  })

  test('rejects a tremolo that is opened and never closed', () => {
    expect(readFailure(measure(tremoloNote('C', 'start'))).message).toContain(
      'opened and never closed',
    )
  })

  test('rejects a pair whose notes last different times', () => {
    const shorter =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>quarter</type><notations><ornaments><tremolo type="stop">3</tremolo>' +
      '</ornaments></notations></note>'

    expect(readFailure(measure(tremoloNote('C', 'start') + shorter)).message).toContain(
      'last different times',
    )
  })

  // The same degradation a single-note tremolo gets: the pair still
  // converts, drawn the usual way, and the loss is reported.
  test('draws three beams where the stated count cannot be', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start', '9') + tremoloNote('E', 'stop', '9')),
    )

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:element',
      'unrepresentable:element',
    ])
  })

  // Both ends count the beams joining the pair, and there is one pair to
  // draw.
  test('reports ends that count different beams, keeping the start', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start', '2') + tremoloNote('E', 'stop', '4')),
    )

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tremolo'])
  })

  // MNX has nowhere on a two-note tremolo to say which side it is drawn on.
  test('reports a placement the pair cannot carry', () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start" placement="above">3</tremolo>' +
      '</ornaments></notations></note>'
    const { content, warnings } = read(measure(placed + tremoloNote('E', 'stop')))

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  // A tuplet edge and a tremolo edge can land on different notes. Popping
  // the wrong frame would lose notes without a word, so both directions
  // refuse.
  test('rejects a tuplet closing inside a tremolo', () => {
    const opens =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"/></notations></note>'
    const closesBoth =
      '<note><pitch><step>D</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="stop"/>' +
      '<ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(opens + closesBoth)).message).toContain(
      'closes inside a two-note tremolo',
    )
  })

  test('rejects a tuplet starting inside a tremolo', () => {
    const startsBoth =
      '<note><pitch><step>E</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"/>' +
      '<ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(tremoloNote('C', 'start') + startsBoth)).message).toContain(
      'starts inside a two-note tremolo',
    )
  })

  // An unmeasured tremolo names no beam count at all.
  test('reports an unmeasured tremolo, which MNX cannot state', () => {
    const unmeasured =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="unmeasured"/></ornaments></notations></note>'
    const { content, warnings } = read(measure(unmeasured))

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
    expect(warnings[0]?.message).toContain('unmeasured')
  })

  // A pair may sit inside a tuplet, its bracket starting and stopping on the
  // same notes as the tremolo. The bracket is the outer grouping, and inside
  // it the tremolo's time is stated in the written values the ratio scales: a
  // pair of dotted quarters standing for three eighths in the time of two
  // occupies two written dotted eighths.
  test('nests a tremolo inside a tuplet whose bracket rides the same notes', () => {
    const note = (step: string, edge: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>6</duration><type>quarter</type><dot/>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '<normal-type>eighth</normal-type></time-modification>' +
      `<notations><tuplet type="${edge}"/>` +
      `<ornaments><tremolo type="${edge}">3</tremolo>` +
      '</ornaments></notations></note>'
    const { content, warnings } = read(measure(note('C', 'start') + note('E', 'stop')))

    expect(content?.[0]?.kind).toBe('tuplet')
    const inner = content?.[0]?.kind === 'tuplet' ? content[0].content[0] : undefined
    expect(inner?.kind).toBe('multiNoteTremolo')
    expect(inner?.kind === 'multiNoteTremolo' && inner.outer).toEqual({
      value: { base: 'eighth', dots: 1 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })

  test('rejects a tremolo starting inside another', () => {
    expect(
      readFailure(measure(tremoloNote('C', 'start') + tremoloNote('E', 'start'))).message,
    ).toContain('inside another')
  })

  // A note between the pair belongs to neither of them.
  test('rejects a tremolo holding more than its two notes', () => {
    const between =
      '<note><pitch><step>D</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>quarter</type></note>'

    expect(
      readFailure(measure(tremoloNote('C', 'start') + between + tremoloNote('E', 'stop'))).message,
    ).toContain('something other than two notes')
  })

  test('rejects a pair whose time no note value can write', () => {
    const third = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>half</type>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`

    expect(readFailure(measure(third('C', 'start') + third('E', 'stop'))).message).toContain(
      'no note value can write',
    )
  })

  // A bare <tremolo/> is a single-note tremolo, drawn the usual way: single
  // is MusicXML's default type, and three beams is how the mark is drawn
  // where the source does not count them.
  test('reads a tremolo that states neither type nor count', () => {
    const bare =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type><notations><ornaments><tremolo/></ornaments></notations></note>'
    const { content, warnings } = read(measure(bare))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo).toEqual({
      orient: undefined,
      marks: 3,
    })
    expect(warnings).toEqual([])
  })

  // Zero beams write an unmeasured tremolo, which MNX cannot state.
  test('reports a single-note tremolo drawn with no beams', () => {
    const unmeasured =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">0</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(unmeasured))

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  test('keeps the first of two single-note tremolos', () => {
    const doubled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">3</tremolo>' +
      '<tremolo type="single">2</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(doubled))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo?.marks).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:marking'])
  })
})

// The ratio a bracket states, level by level, is worked out from the note's
// <time-modification> and the brackets already open around it. Each step of
// that arithmetic is a decision, and each is stated here as the ratio it
// produces.
describe('the ratio each level of a tuplet states', () => {
  const measureOf = (divisions: number, body: string) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes><divisions>${String(divisions)}</divisions></attributes>` +
    `${body}</measure></part></score-partwise>`

  const ratioNote = (
    step: string,
    duration: number,
    type: string,
    actual: number,
    normal: number,
    markers = '',
  ) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>${type}</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  // Six in the time of four is not three in the time of two: the source drew
  // six notes, and the bracket says so. The outermost level keeps the ratio
  // the notes state, rather than the smallest fraction equal to it.
  test('keeps the counts the source wrote at the outermost level', () => {
    const { content } = read(
      measureOf(
        12,
        ratioNote('C', 8, 'eighth', 6, 4, '<tuplet type="start"/>') +
          ratioNote('D', 8, 'eighth', 6, 4) +
          ratioNote('E', 8, 'eighth', 6, 4, '<tuplet type="stop"/>'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 6,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 4,
    })
  })

  // One of the two brackets states the whole of the ratio the notes carry, so
  // the other holds what is left, which is nothing: a bracket drawn over what
  // it holds and changing nothing. It is still a bracket the source drew, and
  // still closes on its own stop.
  test('keeps the level left with nothing to state', () => {
    const threeInTwo =
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal>'
    const starts =
      `<tuplet type="start" number="1">${threeInTwo}</tuplet>` + '<tuplet type="start" number="2"/>'
    // The inner bracket closes on the note it opened on, so it holds the one
    // eighth its 1:1 states and nothing disagrees.
    const { content, warnings } = read(
      measureOf(
        12,
        ratioNote('C', 4, 'eighth', 3, 2, starts + '<tuplet type="stop" number="2"/>') +
          ratioNote('D', 4, 'eighth', 3, 2) +
          ratioNote('E', 4, 'eighth', 3, 2, '<tuplet type="stop" number="1"/>'),
      ),
    )
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([3, 2])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([1, 1])
    expect(warnings).toEqual([])
  })

  // A note's <time-modification> states the ratio of every level together, so
  // where two brackets open on one note and neither says what its own share
  // is, the outer one takes the whole of it and the inner one changes nothing.
  test('gives the outer level the whole ratio where two open on one note', () => {
    const starts = '<tuplet type="start" number="1"/><tuplet type="start" number="2"/>'
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const { content } = read(
      measureOf(
        12,
        ratioNote('C', 4, 'eighth', 3, 2, starts) +
          ratioNote('D', 4, 'eighth', 3, 2) +
          ratioNote('E', 4, 'eighth', 3, 2, stops),
      ),
    )
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([3, 2])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([1, 1])
  })
})
