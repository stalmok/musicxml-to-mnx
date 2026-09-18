// A tuplet is written with values longer than it sounds: three eighths played
// in the time of two. MusicXML says so twice, once as a ratio on every note
// (<time-modification>) and once as a bracket around them (<tuplet>). MNX
// wraps the notes in one object carrying the ratio.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { fraction } from '../fraction.js'
import type { SequenceItem } from '../model/score.js'
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

/** A quarter outside any ratio, carrying only the bracket marker given. */
function bracketedNote(step: string, bracket = ''): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>12</duration>` +
    '<type>quarter</type>' +
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
  return measures(DIVISIONS + body)
}

/** A score of one part, each body its own measure. */
function measures(...bodies: string[]): string {
  const inner = bodies
    .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
    .join('')
  return `<score-partwise><part id="P1">${inner}</part></score-partwise>`
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

  // A marker stating one side of its ratio and not the other still states
  // something: the side it gives is read, and the other falls back to what
  // the notes say. Nothing said so while every marker stated both sides or
  // neither.
  test('reads the one side of a ratio a marker states', () => {
    const halfMarked =
      '<tuplet-actual><tuplet-number>5</tuplet-number><tuplet-type>16th</tuplet-type>' +
      '</tuplet-actual>'
    const first =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      `<notations><tuplet type="start">${halfMarked}</tuplet></notations></note>`
    const { warnings } = read(
      measure(first + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
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
          '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
          '<notations><tuplet type="start"/></notations></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
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
      { code: 'unrepresentable:tuplet-ratio', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('falls short')
  })

  // A skip inside a bracket the source drew stays inside it: the source's own
  // start and stop markers span the skipped time, so the bracket holds it, in
  // the written units the ratio scales. A skip longer than the bracket counts
  // leaves the content overrunning the ratio, which is the source disagreeing
  // with itself and is reported as such.
  test('states a skip inside a bracket in the units the ratio scales', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          '<forward><duration>4</duration></forward>' +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'space',
      'event',
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.content[1]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 8 },
    })
    expect(warnings).toEqual([])
  })

  // A skip is written at the ratios open when it is filled, so its length is
  // the converter's reading and not the source's. Where the bracket is
  // rewritten over what it holds, the frame it writes moves, and a skip left
  // at its filled length stands for a time the source never passed over. The
  // rate is read off the notes, which carry lengths of their own, and the skip
  // is written at that rate: here the notes are drawn as quarters and last an
  // eighth each, so the bracket writes two written values per eighth of time,
  // and the skipped eighth is a quarter of written space.
  test('writes a skip at the rate the bracket it sits in settles on', () => {
    // Drawn as a quarter, lasting an eighth, under a 3:2 eighth ratio.
    const drawnLong = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>6</duration><type>quarter</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '<normal-type>eighth</normal-type></time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const { content } = read(
      measure(
        drawnLong('C', 'start') +
          '<forward><duration>6</duration></forward>' +
          drawnLong('E', 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 6,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    // Six written eighths in the time of three: the skipped eighth is a
    // quarter of written space, and sounds the eighth the source skipped.
    expect(tuplet?.kind === 'tuplet' && tuplet.content[1]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 4 },
    })
  })

  test('reports a tuplet whose written content overruns its ratio', () => {
    const over =
      tupletNote('C', 4, 'eighth', 'start') +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth') +
      tupletNote('F', 4, 'eighth', 'stop')
    const { warnings } = read(measure(over))

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'unrepresentable:tuplet-ratio', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('overruns')
  })

  // MusicXML lets a bracket start in one measure and stop in the next, and a
  // tuplet in MNX is an item inside one measure's sequence. The bracket holds
  // what fits and the loss is reported, rather than the file being refused.
  //
  // Two of the ratio's three eighths are inside it, and two eighths sounding
  // a sixth of a whole note is a ratio no pair of note values states, so the
  // bracket counts what it holds and takes the time its own ratio gives it.
  test('draws a tuplet the source never closes as far as the barline', () => {
    const { content, warnings } = read(
      measure(tupletNote('C', 4, 'eighth', 'start') + tupletNote('D', 4, 'eighth')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      2, 2,
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-ratio',
    ])
    expect(warnings[0]?.element).toBe('tuplet')
  })

  // A cut bracket holds part of what its ratio counts, so the part it holds
  // is what it states: four sixteenths in the time of three, cut in half, are
  // four thirty-seconds in the time of three. It holds less because the
  // converter cut it, which the span report already says, so the content
  // falling short of the ratio is not reported on top of that.
  test('states the ratio of a cut bracket over the part it holds', () => {
    const quadruplet = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>9</duration>` +
      '<type>16th</type>' +
      '<time-modification><actual-notes>4</actual-notes><normal-notes>3</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const { content, warnings } = read(
      measures(
        '<attributes><divisions>48</divisions></attributes>' +
          quadruplet('C', 'start') +
          quadruplet('D'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: '32nd', dots: 0 },
      multiple: 4,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: '32nd', dots: 0 },
      multiple: 3,
    })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-span'])
  })

  // The bracket ended at the barline, so the stop the source writes in the
  // next measure has nothing to close, and passes over rather than closing
  // the bracket around it or refusing the file. Drawn over notes carrying no
  // ratio, as early-music editions draw a ligature mark.
  test('passes over the stop of a bracket closed at the barline', () => {
    const { warnings } = read(
      measures(
        DIVISIONS + bracketedNote('C', 'start') + bracketedNote('D'),
        bracketedNote('E', 'stop'),
      ),
    )

    // A bracket around notes carrying no ratio states one of its own, which
    // is the first report; the second is the barline cutting it.
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-span',
    ])
  })

  // A stop written inside a bracket the source drew names that bracket. The
  // record of one an earlier barline cut must not take it: the file then
  // loses the bracket the stop really ends, and everything after it is drawn
  // inside a bracket that should have closed.
  test('leaves a stop inside a drawn bracket to that bracket', () => {
    const crossing =
      tupletNote('C', 4, 'eighth', 'start') +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(
      measures(
        DIVISIONS + tupletNote('C', 4, 'eighth', 'start') + tupletNote('D', 4, 'eighth'),
        crossing,
      ),
    )
    const second = content?.[0]

    // One span report, for the bracket the first barline cut. A stop taken by
    // the carried record would leave the second measure's bracket open and
    // cut at its own barline, which would report a second.
    expect(second?.kind === 'tuplet' && second.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // The source may write the stop any number of measures after the barline
  // that cut the bracket, so the record is kept until it is met.
  test('passes over the stop of a cut bracket written measures later', () => {
    const { warnings } = read(
      measures(
        DIVISIONS + bracketedNote('C', 'start') + bracketedNote('D'),
        bracketedNote('E'),
        bracketedNote('F', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-span',
    ])
  })

  test('closes every bracket a measure leaves open, innermost first', () => {
    const nested =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification><notations>' +
      '<tuplet type="start" number="1"/><tuplet type="start" number="2"/></notations></note>'
    const { warnings } = read(measure(nested))

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-ratio',
    ])
  })

  test('writes a bracket cut at the barline into legal MNX', () => {
    const { mnx, warnings } = convertMusicXML(
      measures(
        DIVISIONS + bracketedNote('C', 'start') + bracketedNote('D'),
        bracketedNote('E', 'stop'),
      ),
    )

    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-span',
    ])
  })

  // The note carries no ratio, so nothing opened on it either.
  test('rejects a stop with no tuplet open', () => {
    const bare =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>'

    expect(readFailure(measure(bare)).message).toContain('no tuplet is open')
  })

  // A grace note takes none of the measure's time, so its ratio says nothing
  // about how long a group is, and no bracket says it either.
  test('rejects a grace note carrying a ratio with no bracket to mark it', () => {
    const grace =
      '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'

    expect(readFailure(measure(grace)).message).toContain('grace note carries a tuplet ratio')
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
    expect(warnings[0]?.message).toContain(
      'lasts 2/3 of what it is written as, so that is the ratio converted',
    )
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

  // Four eighths under a marker reading 3:2, sounding for eight thirds of an
  // eighth. No value counts both that and the four eighths written, so the
  // bracket counts the four it holds and keeps the two eighths of space its
  // own ratio gives it.
  test('counts a bracket whose ratio no value states over what it holds', () => {
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

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(4)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // A marker counting less than the bracket holds is restated over what it
  // holds: six eighths under a marker reading 3:2 are six in the time of four,
  // which sounds for the time the source gives them and counts what is there.
  test('states a marker that counts less than its bracket holds over the content', () => {
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
      6, 4,
    ])
    // Six eighths under a bracket that says three: the source's own
    // disagreement, reported as well as restated.
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'inconsistent:tuplet',
    ])
  })

  // The counts a bracket states are worked out by halving the value it opened
  // with until both sides count whole, and where no halving does, by taking
  // the largest value that counts them both. The edges of that search are the
  // smallest count, the deepest halving, and a value the halvings never reach.
  describe('the counts a bracket is scaled to', () => {
    const at = (divisions: number, body: string) =>
      read(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>${String(divisions)}</divisions></attributes>` +
          `${body}</measure></part></score-partwise>`,
      )
    const note = (step: string, duration: number, type: string, markers = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(duration)}</duration><type>${type}</type>` +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'

    // One quarter played in the time of two is a count of one, which is a
    // count MusicXML writes: a bracket over a single note stretched to twice
    // its length. Counted from two upwards, the same bracket would be drawn
    // as two eighths in the time of four.
    test('states a count of one as one', () => {
      const { content } = at(
        12,
        note('C', 24, 'quarter', '<tuplet type="start"/><tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: 'quarter', dots: 0 }, multiple: 1 },
        { value: { base: 'quarter', dots: 0 }, multiple: 2 },
      ])
    })

    // A quarter and a 1024th together count whole in 1024ths and in nothing
    // longer, which is eight halvings down from the quarter the bracket
    // opened with: the last halving the search makes.
    test('reaches a value eight halvings down from the one it opened with', () => {
      const { content } = at(
        256,
        note('C', 128, 'quarter', '<tuplet type="start"/>') +
          note('D', 1, '1024th', '<tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: '1024th', dots: 0 }, multiple: 257 },
        { value: { base: '1024th', dots: 0 }, multiple: 129 },
      ])
    })

    // MNX puts no bound on how many of a value a tuplet counts, so a count
    // past a thousand is stated like any other.
    test('states a count past a thousand', () => {
      const { content, warnings } = at(
        256,
        note('C', 128, 'quarter', '<tuplet type="start"/>') +
          note('D', 512, 'whole') +
          note('E', 1, '1024th', '<tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: '1024th', dots: 0 }, multiple: 1281 },
        { value: { base: '1024th', dots: 0 }, multiple: 641 },
      ])
      expect(warnings.map((w) => w.code)).not.toContain('unrepresentable:tuplet-ratio')
    })

    // A bracket opening on a dotted value counts in dotted values as it
    // halves, so content no dotted value counts falls to the largest value
    // that counts both sides. Four quarters in the time of three dotted
    // quarters, cut after two, are four eighths in the time of three.
    test('counts in a value the halvings never reach', () => {
      const dotted = (step: string, markers = '') =>
        `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
        '<duration>9</duration><type>quarter</type>' +
        '<time-modification><actual-notes>4</actual-notes><normal-notes>3</normal-notes>' +
        '<normal-type>quarter</normal-type><normal-dot/></time-modification>' +
        (markers ? `<notations>${markers}</notations>` : '') +
        '</note>'
      const { content } = at(12, dotted('C', '<tuplet type="start"/>') + dotted('D'))
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: 'eighth', dots: 0 }, multiple: 4 },
        { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      ])
    })
  })

  // A note whose length works out as a ratio no tuplet is written with is a
  // broken duration, not a bracket to be read.
  test('rejects a first note whose length is no ratio a tuplet would state', () => {
    const odd =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration>' +
      '<type>whole</type><notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(odd)).message).toContain('no <time-modification>')
  })

  // Thirty-two either side is the largest count a derived ratio may reach.
  // Both edges are stated and so is one past each, because a bound asserted
  // at one end only could move by one with nothing noticing.
  describe('the largest ratio a note may imply', () => {
    const bracketed = (divisions: number, type: string, duration: number) =>
      '<score-partwise><part id="P1"><measure number="1">' +
      `<attributes><divisions>${String(divisions)}</divisions></attributes>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${String(duration)}</duration>` +
      `<type>${type}</type>` +
      '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>' +
      '</measure></part></score-partwise>'

    // A whole note lasting a thirty-second is thirty-two in the time of one.
    test('reads a note implying thirty-two in the time of one', () => {
      const { content } = read(bracketed(8, 'whole', 1))

      expect(content?.[0]?.kind === 'tuplet' && content[0].inner.multiple).toBe(32)
    })

    test('refuses a note implying thirty-three in the time of one', () => {
      expect(readFailure(bracketed(33, 'whole', 4)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })

    // A thirty-second lasting a whole is one in the time of thirty-two.
    test('reads a note implying one in the time of thirty-two', () => {
      const { content } = read(bracketed(8, '32nd', 32))

      expect(content?.[0]?.kind === 'tuplet' && content[0].outer.multiple).toBe(32)
    })

    test('refuses a note implying one in the time of thirty-three', () => {
      expect(readFailure(bracketed(8, '32nd', 33)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })

    // A note lasting no time implies no ratio: there is nothing to divide its
    // written value by. The guard is stated at zero rather than below it,
    // because a duration is never negative and zero is the case that reaches
    // it.
    test('refuses a note that lasts no time at all', () => {
      expect(readFailure(bracketed(8, 'whole', 0)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })
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

  // One marker stating its own ratio does not say what the other bracket's
  // share is, so the note is refused as soon as any of them leaves it open.
  test('rejects two brackets where only one states its own ratio', () => {
    const half =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations>' +
      '<tuplet type="start" number="1"><tuplet-actual><tuplet-number>3</tuplet-number>' +
      '<tuplet-type>eighth</tuplet-type></tuplet-actual></tuplet>' +
      '<tuplet type="start" number="2"/></notations></note>'

    expect(readFailure(measure(half)).message).toContain('More than one tuplet starts')
  })
})

// A bracket states its outer in the frame the brackets around it are written
// in, not in measure time. A run whose ratio came from its notes sits inside
// an enclosing bracket, whose ratio stands between the time the voice spent
// and the value the inner bracket has to state.
describe('a bracket with no stated ratio inside another bracket', () => {
  // Divisions of 36 to a quarter: an eighth is 18, a sixteenth 9. A triplet
  // eighth lasts 12, and inside a further triplet an eighth lasts 8 and a
  // sixteenth 4, so the inner bracket fills one triplet eighth.
  const nested = (body: string) =>
    read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>36</divisions></attributes>' +
        `${body}</measure></part></score-partwise>`,
    )
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>12</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  // No <time-modification>, so the ratio comes from how long the note lasts
  // against how it is written, which is the two levels multiplied.
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'
  // An eighth and a sixteenth: three sixteenths written, two sounded. The
  // first note alone says eighths, so the bracket is restated as it closes.
  const inner = innerNote('D', 8, 'eighth', 'start') + innerNote('E', 4, '16th', 'stop')

  test('counts the inner bracket in the frame its enclosing bracket writes', () => {
    const { content } = nested(outerNote('C', 'start') + inner + outerNote('G', 'stop'))
    const outer = content?.[0]
    const run = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(run?.kind === 'tuplet' && run.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(run?.kind === 'tuplet' && run.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('leaves the enclosing bracket holding the length its ratio states', () => {
    const { warnings } = nested(outerNote('C', 'start') + inner + outerNote('G', 'stop'))

    // Measured in measure time, the inner bracket states two eighths of space
    // where it takes two sixteenths, and the outer bracket comes out holding
    // four eighths under a ratio counting three.
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
  })
})

// A bracket rewritten over its content states its inner against the time it
// took, so the frame it writes is not the one its opening ratio stated. A
// bracket inside it was written in the opening frame and came out sounding
// for a time the source gives nowhere.
describe('a bracket rewritten inside a bracket that is rewritten too', () => {
  // Divisions of 36 to a quarter: an eighth is 18 and a sixteenth 9. Under
  // the outer 3:2 an eighth should last 12, and C and G last 18 instead, so
  // the outer bracket is rewritten over what it holds.
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>18</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'

  const nested = read(
    '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>36</divisions></attributes>' +
      outerNote('C', 'start') +
      innerNote('D', 12, 'eighth', 'start') +
      innerNote('E', 6, '16th', 'stop') +
      outerNote('G', 'stop') +
      '</measure></part></score-partwise>',
  )
  const outer = nested.content?.[0]
  const inner = outer?.kind === 'tuplet' ? outer.content[1] : undefined

  // C and G are written as eighths and last eighths, so the bracket holds
  // three eighths sounding three eighths.
  test('states the enclosing bracket over the time its notes take', () => {
    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
  })

  // The inner bracket holds three sixteenths and takes an eighth. The frame
  // around it scales nothing, so its outer is the two sixteenths that eighth
  // is written as there. Under the opening 3:2 it came out as three, which
  // the rewritten outer then played as 3/20 of a whole note.
  test('writes the bracket inside it in the frame the outer ends up with', () => {
    expect(inner?.kind === 'tuplet' && inner.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('reports the source disagreeing with itself and nothing else', () => {
    expect(nested.warnings.map((w) => w.code)).toEqual([
      'inconsistent:duration',
      'missing:time-modification',
      'inconsistent:duration',
      'inconsistent:tuplet',
    ])
  })
})

// The same, with a skip among what the outer bracket holds. The skip was
// written at the ratios open when it was filled, so it says nothing about the
// frame the outer ends up with, and reading the rate off it pulls the bracket
// inside back toward the ratio the outer opened with.
describe('a bracket rewritten around a skip and a bracket rewritten too', () => {
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>18</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'

  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>36</divisions></attributes>' +
    outerNote('C', 'start') +
    innerNote('D', 12, 'eighth', 'start') +
    innerNote('E', 6, '16th', 'stop') +
    '<forward><duration>18</duration></forward>' +
    outerNote('G', 'stop') +
    '</measure></part></score-partwise>'
  const nested = read(source)
  const outer = nested.content?.[0]

  // C, G and the skipped eighth each last an eighth, and the bracket inside
  // takes another, so the bracket holds four eighths sounding four eighths.
  test('states the enclosing bracket over the time its notes take', () => {
    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 4,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 4,
    })
  })

  test('writes the skip at the rate the enclosing bracket settles on', () => {
    expect(outer?.kind === 'tuplet' && outer.content[2]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 8 },
    })
  })

  test('leaves output the schema takes', () => {
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })

  // The same reading the skipless bracket gives: three sixteenths in the time
  // of two. Counting the skip as a witness leaves the outer spending seven
  // written sixteenths for every six of time. No pair of note values states
  // that over what this bracket holds, so the bracket keeps the three
  // sixteenths the opening ratio gave it, with nothing reported.
  test('writes the bracket inside it in the frame the outer ends up with', () => {
    const inner = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(inner?.kind === 'tuplet' && inner.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('reports the source disagreeing with itself and nothing else', () => {
    expect(nested.warnings.map((w) => w.code)).toEqual([
      'inconsistent:duration',
      'missing:time-modification',
      'inconsistent:duration',
      'inconsistent:tuplet',
    ])
  })
})

// A bracket holding nothing but another bracket says nothing about how much
// written length it spends for each unit of time, so the bracket inside it
// keeps the frame it was written in when it closed.
describe('a bracket whose whole content is one other bracket', () => {
  // Divisions of 12 to a quarter, so an eighth is 6. Both brackets open on
  // one note and close on the next, and the outer keeps the whole 3:2.
  const both = (step: string, units: number, markers: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations>${markers}</notations></note>`
  const starts = '<tuplet type="start" number="1"/><tuplet type="start" number="2"/>'
  const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'

  const nested = (units: number) =>
    read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>12</divisions></attributes>' +
        both('C', units, starts) +
        both('D', units, stops) +
        '</measure></part></score-partwise>',
    )

  // Each note lasts a quarter, so the pair takes half a whole note where the
  // ratio counts three eighths. The outer is rewritten to six eighths in the
  // time of four, and the inner keeps the six eighths of space the opening
  // 3:2 wrote it in.
  test('keeps the opening frame where nothing else fixes the rate', () => {
    const { content } = nested(12)
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([6, 4])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([2, 6])
  })

  // Here the pair takes the quarter the outer ratio counts, so the outer
  // stands as the source drew it and the inner is written in that.
  test('keeps the opening frame where the enclosing ratio stands', () => {
    const { content } = nested(6)
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([3, 2])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([2, 3])
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

// A <note> stating no <type> is measured from its <duration>, which is the
// time it sounds. Inside a tuplet or a tremolo that time is the written value
// scaled by the ratio, so the ratio is taken back out before the value is
// read.
describe('a note inside a tuplet stating no <type>', () => {
  const typeless = (step: string, units: number) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification></note>'

  test('reads the value the ratio counts, not the time it sounds', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          typeless('D', 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside[1]?.kind === 'event' && inside[1].value).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings).toEqual([])
  })

  // Each note of a two-note tremolo is written with the pair's value and
  // lasts half of it, so the pair scales a written value as a tuplet does.
  test('reads the value the pair of a tremolo counts', () => {
    const typelessTremolo = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>12</duration>` +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + typelessTremolo('E', 'stop')),
    )
    const item = content?.[0]
    const inside = item?.kind === 'multiNoteTremolo' ? item.content : []

    expect(inside[1]?.value).toEqual({ base: 'half', dots: 0 })
    expect(warnings).toEqual([])
  })

  // The pair is what scales the note, and the refusal says so.
  test('names the tremolo where a tremolo is what scales the note', () => {
    const odd =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>5</duration>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'
    let thrown = ''
    try {
      read(measure(tremoloNote('C', 'start') + odd))
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toContain('by the tremolo around it')
  })

  test('refuses a time no note value can write, naming what it is written as', () => {
    let thrown = ''
    try {
      read(
        measure(
          tupletNote('C', 4, 'eighth', 'start') +
            typeless('D', 5) +
            tupletNote('E', 4, 'eighth', 'stop'),
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>. It lasts 5/48 of a whole note, written as 5/32 of a ' +
        'whole note by the tuplet around it, which no note value can write.',
    )
  })

  // Some exporters write a <duration> on a grace note even though it takes
  // no time. No ratio scaled that duration, so none is taken back out of it.
  test('reads a grace note’s own duration inside a bracket unscaled', () => {
    const graceInside =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          graceInside +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []
    const group = inside[1]

    expect(group?.kind === 'grace' && group.content[0]?.value).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings).toEqual([])
  })

  // The same duration is weighed against the written value here as the value
  // is read from there: unscaled, because the ratio scales nothing a grace
  // note carries.
  test('weighs a grace note’s own duration against its value unscaled', () => {
    const graceInside =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          graceInside +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  // A bracket may state a ratio that scales nothing. The refusal then reads
  // as it does outside a bracket, rather than naming one length twice.
  test('names the length once where the ratio scales nothing', () => {
    const oneToOne = (units: number, bracket = '') =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${String(units)}</duration>` +
      '<time-modification><actual-notes>1</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    let thrown = ''
    try {
      read(
        measure(
          `<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>` +
            '<type>quarter</type><time-modification><actual-notes>1</actual-notes>' +
            '<normal-notes>1</normal-notes></time-modification>' +
            '<notations><tuplet type="start"/></notations></note>' +
            oneToOne(5),
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>, and lasts 5/48 of a whole note, which no note value can write.',
    )
  })

  test('names the length plainly where nothing scales it', () => {
    let thrown = ''
    try {
      read(
        measure(
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>, and lasts 5/48 of a whole note, which no note value can write.',
    )
  })

  test('converts to MNX the schema accepts', () => {
    const source = measure(
      tupletNote('C', 4, 'eighth', 'start') +
        typeless('D', 4) +
        tupletNote('E', 4, 'eighth', 'stop'),
    )
    const { mnx } = convertMusicXML(source)

    expect(schemaErrors(mnx)).toEqual([])
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

  // A marker is weighed by its type and its number together. A member stating
  // a different number states a bracket of its own, whatever the chord's
  // marker is.
  const numbered = (step: string, type: string, number: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${type}" number="${number}"/></notations></note>`

  test('reports a start whose number differs from the marker the chord carries', () => {
    const { warnings } = read(
      measure(
        numbered('C', 'start', '1') +
          chordMember('<tuplet type="start" number="2"/>') +
          tupletNote('D', 4, 'eighth') +
          numbered('E', 'stop', '1'),
      ),
    )

    expect(warnings.map((one) => ({ code: one.code, element: one.element }))).toEqual([
      { code: 'unsupported:element', element: 'tuplet' },
    ])
  })

  // The other half of the same key: the same number and the other type is a
  // marker of the member's own too.
  test('reports a start where the marker the chord carries of that number is a stop', () => {
    const { warnings } = read(
      measure(
        numbered('C', 'start', '1') +
          tupletNote('D', 4, 'eighth') +
          numbered('E', 'stop', '1') +
          chordMember('<tuplet type="start" number="1"/>'),
      ),
    )

    expect(warnings.map((one) => ({ code: one.code, element: one.element }))).toEqual([
      { code: 'unsupported:element', element: 'tuplet' },
    ])
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

  // The record of a dropped start outlives the brackets around it, so a stop
  // naming it is swallowed even after every bracket has closed. Read as an
  // ordinary stop it would close a bracket nothing had opened.
  test('swallows the stop of a dropped start after every bracket has closed', () => {
    const after =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type><notations><tuplet type="stop" number="2"/></notations></note>'
    const { content, warnings } = read(
      measure(
        numbered('C', 'start', '1') +
          chordMember('<tuplet type="start" number="2"/>') +
          tupletNote('D', 4, 'eighth') +
          numbered('E', 'stop', '1') +
          after,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
    expect(warnings.map((one) => one.code)).toEqual(['unsupported:element'])
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

  // The record of a dropped start is consumed by the stop that matches it, so
  // a second stop stating the same number is a stop with nothing to close.
  // Nothing said so: the record could have gone on swallowing every stop of
  // that number to the end of the measure.
  test('swallows only the first stop matching a start dropped on a chord member', () => {
    const twice =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      '<notations><tuplet type="stop" number="2"/><tuplet type="stop" number="2"/>' +
      '<tuplet type="stop" number="1"/></notations></note>'

    expect(
      readFailure(
        measure(
          tupletNote('C', 4, 'eighth', 'start') +
            tupletNote('D', 4, 'eighth') +
            chordMember('<tuplet type="start" number="2"/>') +
            twice,
        ),
      ).message,
    ).toContain('A tuplet is closed where no tuplet is open.')
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

  // Time the voice passed over in silence belongs before the group, not
  // after it: a grace note is squeezed in before the note it ornaments, so
  // stating the silence afterwards strands the group where the voice last
  // sounded rather than beside the note it decorates.
  test('states time passed over before the group, not after it', () => {
    const { content } = read(
      measure('<forward><duration>12</duration></forward>' + grace('B') + REAL),
    )

    expect(content?.map((item) => item.kind)).toEqual(['space', 'grace', 'event'])
  })

  test('still takes no time from the measure', () => {
    const { content } = read(measure(grace('B') + REAL + REAL))

    // Two quarters and a grace note fill a 2/4 bar; the grace note adds
    // nothing to that.
    expect(content?.filter((item) => item.kind === 'event')).toHaveLength(2)
  })

  // A bracket runs from its start marker to its stop, and both can sit on a
  // grace note. What it holds then takes none of the measure's time, which
  // MNX has no tuplet to state.
  const graceMarked = (step: string, mark: string) =>
    `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch><type>eighth</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${mark}"/></notations></note>`

  test('drops a bracket that opens and closes on one grace note', () => {
    const { content, warnings } = read(
      measure(
        '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
          '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
          '</time-modification>' +
          '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>' +
          REAL,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  test('drops a bracket that opens on one grace note and closes on the next', () => {
    const { content, warnings } = read(
      measure(graceMarked('B', 'start') + graceMarked('C', 'stop') + REAL),
    )

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    const group = content?.[0]
    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  // The note after the bracket was never inside it, and stays outside it.
  test('leaves the note after such a bracket out of it', () => {
    const { mnx, warnings } = convertMusicXML(
      measure(graceMarked('B', 'start') + graceMarked('C', 'stop') + REAL),
    )
    const items = mnx.parts[0]?.measures?.[0]?.sequences?.[0]?.content

    expect(items?.map((item) => item.type)).toEqual(['grace', undefined])
    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  // A bracket the source drew over a grace note and the notes it ornaments
  // holds time, and is the tuplet the source stated.
  test('keeps a bracket that opens on a grace note and closes on a note', () => {
    const { content, warnings } = read(
      measure(
        graceMarked('B', 'start') +
          tupletNote('C', 4, 'eighth') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          REAL,
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'grace',
      'event',
      'event',
      'event',
    ])
    expect(warnings).toEqual([])
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

  // Time the voice passed over in silence belongs before the tremolo. Stated
  // inside it, the pair would hold a space as well as its two notes, which is
  // no longer a pair.
  test('states time passed over before the pair, not inside it', () => {
    const { content, warnings } = read(
      measure(
        '<forward><duration>12</duration></forward>' +
          tremoloNote('C', 'start') +
          tremoloNote('E', 'stop'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['space', 'multiNoteTremolo'])
    expect(warnings).toEqual([])
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

  // Named in full: a tuplet left open at the end of the measure refuses with
  // a message these words also fit, and a tremolo pushes a list of its own,
  // so a tremolo left open would be refused as a tuplet where this check no
  // longer ran.
  test('rejects a tremolo that is opened and never closed', () => {
    expect(readFailure(measure(tremoloNote('C', 'start'))).message).toContain(
      'A tremolo is opened and never closed.',
    )
  })

  // A tremolo holds its two notes and nothing else. A rest passed over
  // between them is a space in the tremolo, which is neither of the two
  // notes and leaves the pair no longer a pair.
  test('rejects a pair with time passed over between them', () => {
    expect(
      readFailure(
        measure(
          tremoloNote('C', 'start') +
            '<forward><duration>12</duration></forward>' +
            tremoloNote('E', 'stop'),
        ),
      ).message,
    ).toContain('holds something other than two notes')
  })

  // A grace note takes none of the measure's time, so a pair opening on one
  // holds a grace group and a single note rather than two notes.
  test('rejects a pair opening on a grace note', () => {
    const graceStart =
      '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>half</type>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(graceStart + tremoloNote('E', 'stop'))).message).toContain(
      'holds something other than two notes',
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

  // MuseScore writes a two-note tremolo's own pair as a degenerate bracket on
  // each note: eight sixteenths in the time of eight sixteenths, drawn with
  // neither bracket nor number. MNX holds the pair as one item, so the
  // bracket has nowhere to go, and it scales nothing, so passing it over
  // costs no duration.
  test('passes over a bracket of one in the time of one around a tremolo note', () => {
    const degenerate = (step: string, edge: string): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>12</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '<normal-type>quarter</normal-type></time-modification>' +
      '<notations><tuplet type="start" bracket="no" show-number="none">' +
      '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>quarter</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>1</tuplet-number>' +
      '<tuplet-type>quarter</tuplet-type></tuplet-normal></tuplet>' +
      '<tuplet type="stop"/>' +
      `<ornaments><tremolo type="${edge}">3</tremolo></ornaments></notations></note>`

    const { content, warnings } = read(measure(degenerate('C', 'start') + degenerate('E', 'stop')))

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element', 'unsupported:element'])
    expect(warnings[0]?.message).toContain('one note of a two-note tremolo')
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
  //
  // <time-modification> counts the tuplet and the tremolo together, so the
  // triplet's 3:2 and the pair's 2:1 are written as one 6:2.
  test('nests a tremolo inside a tuplet whose bracket rides the same notes', () => {
    const note = (step: string, edge: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>6</duration><type>quarter</type><dot/>' +
      '<time-modification><actual-notes>6</actual-notes><normal-notes>2</normal-notes>' +
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

  // MNX counts a tremolo's beams from one to eight. Both edges are stated,
  // and just outside each, because a range asserted at one end only could
  // have the other move by one with nothing noticing.
  const tremoloOf = (marks: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
    '<type>half</type>' +
    `<notations><ornaments><tremolo type="single">${marks}</tremolo></ornaments></notations></note>`

  test.each(['1', '8'])('draws a tremolo counting %s beams', (marks) => {
    const { content, warnings } = read(measure(tremoloOf(marks)))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo?.marks).toBe(Number(marks))
    expect(warnings).toEqual([])
  })

  test('reports a tremolo counting more beams than MNX draws', () => {
    const { content, warnings } = read(measure(tremoloOf('9')))

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
        ratioNote('C', 4, 'eighth', 6, 4, '<tuplet type="start"/>') +
          ratioNote('D', 4, 'eighth', 6, 4) +
          ratioNote('E', 4, 'eighth', 6, 4) +
          ratioNote('F', 4, 'eighth', 6, 4) +
          ratioNote('G', 4, 'eighth', 6, 4) +
          ratioNote('A', 4, 'eighth', 6, 4, '<tuplet type="stop"/>'),
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
  // The inner one holds all three eighths, so what it states is three in the
  // time of three, a bracket drawn over its content that scales none of it.
  test('gives the outer level the whole ratio where two open on one note', () => {
    const starts = '<tuplet type="start" number="1"/><tuplet type="start" number="2"/>'
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const { content, warnings } = read(
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
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([3, 3])
    // The one in the time of one the inner level opened with is what the
    // division left it, not what the source drew, so the notes disagreeing
    // with it says nothing about the source and is not reported.
    expect(warnings).toEqual([])
  })
})

// MusicXML states a tuplet twice, and the two say different things: the
// ratio on every note is what makes it a tuplet, and the bracket only draws
// one. Exporters write the ratio alone, and the whole file used to be refused
// over it. The ratio fixes the group's length, so consecutive notes carrying
// it divide into one group after another with nothing guessed.
describe('a tuplet the source states as a ratio with no bracket', () => {
  /** A note of `units` divisions written as `type`, with a `played`:`space` ratio. */
  const rated = (step: string, units: number, type: string, played = 3, space = 2) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    `<time-modification><actual-notes>${String(played)}</actual-notes>` +
    `<normal-notes>${String(space)}</normal-notes></time-modification></note>`

  /** A note of `units` divisions written as `type`, with no ratio on it. */
  const plain = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type></note>`

  test('gathers three notes carrying the ratio into one tuplet', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + rated('E', 4, 'eighth')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // Six triplet eighths are two triplets, not one group of six: the ratio
  // says three are played in the time of two, and that is where each closes.
  test('cuts a longer run into one group after another', () => {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A'].map((step) => rated(step, 4, 'eighth')).join('')
    const { content, warnings } = read(measure(notes))

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // A group is full at the written length its ratio counts, whatever values
  // fill it: a triplet quarter and a triplet eighth make three eighths. The
  // quarter says so with <normal-type>, which is what the ratio counts.
  const countedInEighths =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>quarter</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '<normal-type>eighth</normal-type></time-modification></note>' +
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '<normal-type>eighth</normal-type></time-modification></note>'

  test('closes a group of mixed values at the length the ratio counts', () => {
    const { content, warnings } = read(measure(countedInEighths + plain('E', 12, 'quarter')))

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(content?.[1]?.kind).toBe('event')
    expect(warnings).toEqual([])
  })

  test('leaves a note carrying no ratio outside the group', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          plain('F', 12, 'quarter'),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind).toBe('event')
    expect(warnings).toEqual([])
  })

  // A run the source cut short holds two eighths sounding a sixth of a whole
  // note, which no pair of note values states, so it counts what it holds and
  // keeps the space its ratio gives it.
  test('closes a group a note carrying no ratio interrupts', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + plain('E', 12, 'quarter')),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('starts a new group where the ratio changes', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          rated('F', 3, 'eighth', 4, 2) +
          rated('G', 3, 'eighth', 4, 2) +
          rated('A', 3, 'eighth', 4, 2) +
          rated('B', 3, 'eighth', 4, 2),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].inner.multiple).toBe(3)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind === 'tuplet' && content[1].inner.multiple).toBe(4)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(4)
    expect(warnings).toEqual([])
  })

  // The ratio alone does not say which tuplet a note belongs to: three in the
  // time of two and three in the time of one are the same three notes played
  // over different spans.
  test('starts a new group where the space the ratio is played in changes', () => {
    const { content } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 2, 'eighth', 3, 1) +
          rated('F', 2, 'eighth', 3, 1) +
          rated('G', 2, 'eighth', 3, 1),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].outer.multiple).toBe(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(content?.[1]?.kind === 'tuplet' && content[1].outer.multiple).toBe(1)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(3)
  })

  // A ratio stating no <normal-type> counts the note's own written value, so a
  // run written in several values states no one length. It holds together and
  // says what it holds when it closes, as a bracket stating no ratio does.
  // Real files write this: three rests as a whole, a double-dotted quarter and
  // a 16th, each marked three in the time of two, together three halves.
  test('states a run written in several values by what it holds', () => {
    const doubleDotted =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>14</duration>' +
      '<type>quarter</type><dot/><dot/>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(rated('C', 32, 'whole') + doubleDotted + rated('E', 2, '16th')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'half', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'half', dots: 0 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })

  // A grace note takes none of the measure's time, so it neither fills a run
  // nor ends one.
  test('reaches a run over a grace note written inside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>16th</type></note>'
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + grace + rated('E', 4, 'eighth')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(4)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(warnings).toEqual([])
  })

  /** A note of `units` divisions written as `type`, ending a tuplet it never opened. */
  const stopping = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification><notations><tuplet type="stop"/></notations></note>'

  // Real files carry stop markers with no start anywhere: one whole CPDL file
  // writes a stop on every triplet note and opens nothing. Such a marker has
  // no bracket of its own to close, and where it stands at the end of what the
  // ratio counts the two say the same thing.
  test('passes over a stop marker standing where the ratio ends the run', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + stopping('E', 4, 'eighth')),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // The marker states a grouping the ratio contradicts. The ratio is what is
  // converted, so the marker is reported rather than dropped in silence.
  test('reports a stop marker standing short of what the ratio counts', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + stopping('D', 4, 'eighth') + rated('E', 4, 'eighth')),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
    expect(warnings[0]?.element).toBe('tuplet')
  })

  test('closes a group the measure ends inside rather than refusing', () => {
    const source = measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth'))
    const { content, warnings } = read(source)

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })

  // The refusal a grace note's ratio earns is the same inside such a run as
  // outside it: a run gathers notes by the time they take, and a grace note
  // takes none.
  test('rejects a grace note carrying a ratio inside the run', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'

    expect(readFailure(measure(rated('C', 4, 'eighth') + grace)).message).toContain(
      'grace note carries a tuplet ratio',
    )
  })

  // A note inside a bracket the source drew needs no value of its own for the
  // ratio to count: the bracket says where the tuplet runs. Real files write a
  // hidden rest that way, with a ratio and no <type>.
  test('leaves a valueless note inside a drawn bracket alone', () => {
    const valueless =
      '<note><rest/><duration>4</duration>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') + valueless + tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // A run opens on the note's ratio, before the note turns out not to be an
  // event at all. It stands for no tuplet the source wrote.
  test('draws no tuplet for a run that holds nothing', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(measure(measureRest + over))

    expect(content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest'])
  })

  // A skip the ratio still counts room for stands in the group as a space,
  // which is how the same music reads when the source writes a rest there
  // rather than moving its cursor over it.
  test('reaches a group over a skip the ratio counts room for', () => {
    const skipped = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>4</duration></forward>' +
          rated('E', 4, 'eighth'),
      ),
    )
    const written = read(
      measure(
        rated('C', 4, 'eighth') +
          '<note><rest/><duration>4</duration><type>eighth</type>' +
          '<time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes></time-modification></note>' +
          rated('E', 4, 'eighth'),
      ),
    )
    const tuplet = skipped.content?.[0]

    expect(skipped.content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'space',
      'event',
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.content[1]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 8 },
    })
    expect(skipped.warnings).toEqual([])
    // The rest spelling holds a rest where this holds a space, and both fill
    // the group the ratio counts.
    expect(written.content).toHaveLength(1)
    expect(written.warnings).toEqual([])
  })

  // A run gathers notes that follow one another, and nothing the source drew
  // bounds it. A skip that carries the run past what its ratio counts cannot
  // stand inside it, so the run ends and the notes after start a new one.
  test('ends a group at a skip carrying it past what its ratio counts', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>24</duration></forward>' +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'space', 'tuplet'])
    expect(content?.[1]).toEqual({ kind: 'space', duration: { num: 1, den: 2 } })
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(1)
    expect(content?.[2]?.kind === 'tuplet' && content[2].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-ratio',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // A grace note takes none of the measure's time, so the run reaches over it,
  // but the skip standing before it still ends the run.
  test('ends a group at a skip a grace note stands after', () => {
    const graceNote =
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type></note>'
    const { content } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>24</duration></forward>' +
          graceNote +
          rated('D', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'space', 'grace', 'tuplet'])
    expect(content?.[1]).toEqual({ kind: 'space', duration: { num: 1, den: 2 } })
  })

  // A <backup> and a <forward> that cancel out move nothing: five songs of the
  // corpus write such a pair inside a tuplet to place a <direction> earlier.
  test('reaches a group over a backup a forward takes back', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<backup><duration>4</duration></backup><forward><duration>4</duration></forward>' +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth'),
      ),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // The dropped rests still stood somewhere, so the cursor moves on from
  // where each stood, and a second ratio opens a run of its own after the
  // first closes. The voice is a rest filling the measure and holds nothing,
  // so the time between them is no space: it would state silence inside a
  // sequence that has none.
  test('states no space between rests dropped over a measure rest', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over = (units: number, played: number, space: number) =>
      `<note><rest/><duration>${String(units)}</duration><type>eighth</type>` +
      `<time-modification><actual-notes>${String(played)}</actual-notes>` +
      `<normal-notes>${String(space)}</normal-notes></time-modification></note>`
    const { content, warnings } = read(measure(measureRest + over(4, 3, 2) + over(3, 2, 1)))

    expect(content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest', 'redundant:rest'])
  })

  test('converts to MNX the schema accepts', () => {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A'].map((step) => rated(step, 4, 'eighth')).join('')
    const { mnx } = convertMusicXML(measure(notes))

    expect(schemaErrors(mnx)).toEqual([])
  })
})

// MusicXML's <time-modification> is cumulative, so a note that both opens a
// bracket and starts a two-note tremolo states the two ratios multiplied
// together: 6:2 for a tremolo inside a triplet. The tremolo's own share is
// not the bracket's to keep.
describe('a tuplet opening on the note that starts a tremolo', () => {
  // A triplet of quarters whose first quarter is a two-note tremolo. Each
  // note of the pair is written as a quarter and lasts a third of one.
  const inTriplet = (duration: number, actual: number, notations: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><type>quarter</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification>' +
    `<notations>${notations}</notations></note>`
  const tremoloPair = (opening: string) =>
    inTriplet(4, 6, `${opening}<ornaments><tremolo type="start">3</tremolo></ornaments>`) +
    inTriplet(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>')
  const closing = inTriplet(8, 3, '') + inTriplet(8, 3, '<tuplet type="stop"/>')

  test('states the ratio the bracket draws, with the tremolo inside it', () => {
    const { content, warnings } = read(measure(tremoloPair('<tuplet type="start"/>') + closing))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(inside.map((item) => item.kind)).toEqual(['multiNoteTremolo', 'event', 'event'])
    expect(warnings).toEqual([])
  })

  test('reads it as a bracket an earlier note opens is read', () => {
    const opened = read(measure(tremoloPair('<tuplet type="start"/>') + closing))
    const earlier = read(
      measure(
        inTriplet(8, 3, '<tuplet type="start"/>') +
          tremoloPair('') +
          inTriplet(8, 3, '<tuplet type="stop"/>'),
      ),
    )
    const ratioOf = (result: typeof opened) => {
      const tuplet = result.content?.[0]
      return tuplet?.kind === 'tuplet' ? [tuplet.inner.multiple, tuplet.outer.multiple] : []
    }

    expect(ratioOf(earlier)).toEqual([3, 2])
    expect(ratioOf(opened)).toEqual(ratioOf(earlier))
    expect(earlier.warnings).toEqual([])
  })

  // A ratio the source did not write in lowest terms is the number drawn over
  // the bracket, so six in the time of four stays six in the time of four.
  test('keeps the counts the source wrote', () => {
    const sextuplet = (duration: number, actual: number, notations: string) =>
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>${String(duration)}</duration><type>quarter</type>` +
      `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
      '<normal-notes>4</normal-notes></time-modification>' +
      `<notations>${notations}</notations></note>`
    const { content, warnings } = read(
      measure(
        sextuplet(
          4,
          12,
          '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo>' + '</ornaments>',
        ) +
          sextuplet(4, 12, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          sextuplet(8, 6, '').repeat(4) +
          sextuplet(8, 6, '<tuplet type="stop"/>'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(6)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(4)
    expect(warnings).toEqual([])
  })

  // With no <time-modification> the note itself says how long it lasts
  // against how it is written, and that reading counts the tremolo too.
  test('names the bracket it converts where the note states no ratio', () => {
    const bare = (duration: number, notations: string) =>
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>${String(duration)}</duration><type>quarter</type>` +
      `<notations>${notations}</notations></note>`
    const { content, warnings } = read(
      measure(
        bare(4, '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo></ornaments>') +
          bare(4, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          bare(8, '') +
          bare(8, '<tuplet type="stop"/>'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
    expect(warnings[0]?.message).toContain('takes half of that, so the bracket is converted as 2/3')
  })

  // A marker states the bracket's own ratio, which is the cumulative one with
  // the tremolo's half already out of it, so the two agree and it stands.
  test('keeps the ratio a marker states beside the tremolo', () => {
    const portions =
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>quarter</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number>' +
      '<tuplet-type>quarter</tuplet-type></tuplet-normal>'
    const { content, warnings } = read(
      measure(tremoloPair(`<tuplet type="start">${portions}</tuplet>`) + closing),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings).toEqual([])
  })

  // A source that leaves the tremolo out of the ratio disagrees with the
  // notes, which is reported rather than read as the bracket's own.
  test('reports a ratio that does not count the tremolo', () => {
    const understated = (duration: number, notations: string) =>
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>${String(duration)}</duration><type>quarter</type>` +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      `<notations>${notations}</notations></note>`
    const { warnings } = read(
      measure(
        understated(
          4,
          '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo></ornaments>',
        ) +
          understated(4, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          closing,
      ),
    )

    expect(warnings.map((w) => w.code)).toContain('inconsistent:duration')
  })

  test('writes legal MNX for it', () => {
    const { mnx, warnings } = convertMusicXML(
      measure(tremoloPair('<tuplet type="start"/>') + closing),
    )

    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings).toEqual([])
  })
})

// A source that draws no bracket says the tuplet is there in the ratio alone,
// and that ratio counts the tremolo as well. The pair's own share has to come
// out of it before what is left can say whether a tuplet is there at all.
describe('a tuplet stated as a ratio with no bracket, opening on a tremolo', () => {
  // A triplet of quarters whose first quarter is a two-note tremolo, with no
  // <tuplet> anywhere. Each note of the pair is written as a quarter and
  // lasts a sixth of one.
  const rated = (duration: number, actual: number, notations = '') =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><type>quarter</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification>' +
    (notations ? `<notations>${notations}</notations>` : '') +
    '</note>'
  const tremoloPair =
    rated(4, 6, '<ornaments><tremolo type="start">3</tremolo></ornaments>') +
    rated(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>')
  const triplet = tremoloPair + rated(8, 3) + rated(8, 3)

  test('reads the ratio the tremolo leaves as the tuplet', () => {
    const { content, warnings } = read(measure(triplet))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(inside.map((item) => item.kind)).toEqual(['multiNoteTremolo', 'event', 'event'])
    expect(warnings).toEqual([])
  })

  test('reads it as the same music with a bracket drawn around it is read', () => {
    const bracketed = read(
      measure(
        rated(
          4,
          6,
          '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo></ornaments>',
        ) +
          rated(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          rated(8, 3) +
          rated(8, 3, '<tuplet type="stop"/>'),
      ),
    )
    const ratioOf = (result: ReturnType<typeof read>) => {
      const tuplet = result.content?.[0]
      return tuplet?.kind === 'tuplet' ? [tuplet.inner.multiple, tuplet.outer.multiple] : []
    }

    expect(ratioOf(read(measure(triplet)))).toEqual(ratioOf(bracketed))
  })

  // The run reaches over the pair wherever it stands: both notes state the
  // counts the run was opened with, once the pair's share comes out.
  test('keeps a run open around a tremolo standing inside it', () => {
    const { content, warnings } = read(measure(rated(8, 3) + tremoloPair + rated(8, 3)))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(content).toHaveLength(1)
    expect(inside.map((item) => item.kind)).toEqual(['event', 'multiNoteTremolo', 'event'])
    expect(warnings).toEqual([])
  })

  // A two-note tremolo standing on its own carries the same 2:1 and is no
  // tuplet: taking the pair's share out leaves nothing for a tuplet to state.
  test('opens no tuplet around a tremolo the ratio only counts the pair of', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop')),
    )

    expect(content?.map((item) => item.kind)).toEqual(['multiNoteTremolo'])
    expect(warnings).toEqual([])
  })

  // Where the source states no value for the ratio to count, there is nothing
  // for a tuplet to be written in, and the pair is read as the pair it is.
  test('reads a pair stating no value to count as a plain tremolo', () => {
    const typeless =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(typeless + tremoloNote('E', 'stop')))

    expect(content?.map((item) => item.kind)).toEqual(['multiNoteTremolo'])
    expect(warnings).toEqual([])
  })

  test('writes legal MNX for it', () => {
    const { mnx, warnings } = convertMusicXML(measure(triplet))

    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings).toEqual([])
  })
})

// A tuplet in a line laid over its voice belongs to that line. The bracket
// is opened before the note is written, so reading the sequence only at the
// note left the bracket in the line the voice sounded in before, holding
// nothing, while its notes stood outside it in the new line.
describe('a tuplet in a line laid over its voice', () => {
  /** A triplet eighth of voice 1, so that the whole run is one voice. */
  const voiced = (step: string, bracket = ''): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
    '<voice>1</voice><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'

  const laidOver =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
    '<voice>1</voice><type>quarter</type></note>' +
    '<backup><duration>12</duration></backup>' +
    voiced('D', 'start') +
    voiced('E') +
    voiced('F', 'stop')

  test('holds its notes in the line they were written in', () => {
    const warnings = new WarningCollector()
    const result = readScore(parseXmlRoot(measure(laidOver)), warnings)
    const sequences = result.parts[0]?.measures[0]?.sequences

    expect(sequences).toHaveLength(2)
    expect(sequences?.[0]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(sequences?.[1]?.content.map((item) => item.kind)).toEqual(['tuplet'])
  })

  test('converts to MNX the schema accepts', () => {
    const { mnx } = convertMusicXML(measure(laidOver))

    expect(schemaErrors(mnx)).toEqual([])
  })
})

// A bracket states what it holds against the time it takes, and where no pair
// of note values counts that it takes the time its own ratio gives it
// instead. Where no pair of them counts that either, MNX can state no ratio
// over the content at all: a tuplet's content must come to its inner, and
// nothing writes an inner it comes to. The bracket is dropped and what it
// held stands where it stood.
describe('a bracket no pair of note values counts at all', () => {
  // Divisions of 128 to a quarter, so a whole note is 512 and a 128th is 4.
  // The ratio counts one whole note in the time of a triple-dotted 64th,
  // which is fifteen five-hundred-and-twelfths of a whole note. The bracket
  // holds five of those, and five against fifteen is counted only in a fifth
  // of a five-hundred-and-twelfth, which is no note value. Neither is five of
  // them, which is the largest length that counts both.
  const ratio =
    '<time-modification><actual-notes>512</actual-notes><normal-notes>15</normal-notes>' +
    '<normal-type>512th</normal-type></time-modification>'
  const stating =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>128th</type>${ratio}<notations><tuplet type="start">` +
    '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>whole</tuplet-type>' +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>' +
    '<tuplet-dot/><tuplet-dot/><tuplet-dot/></tuplet-normal></tuplet></notations></note>'
  const closing =
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>' +
    `<type>512th</type>${ratio}<notations><tuplet type="stop"/></notations></note>`
  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>128</divisions></attributes>' +
    stating +
    closing +
    '</measure></part></score-partwise>'

  test('writes what it held where it stood', () => {
    const { content } = read(source)

    expect(content?.map((item) => item.kind)).toEqual(['event', 'event'])
  })

  test('says no pair of note values counts what it holds either', () => {
    const { warnings } = read(source)
    const reported = warnings.find((w) => w.code === 'unrepresentable:tuplet-ratio')

    expect(reported?.message).toContain('so the tuplet is not converted')
  })

  test('leaves output the schema takes', () => {
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })

  test('leaves what stands beside it where it stands', () => {
    const before =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>128</duration>' +
      '<type>quarter</type></note>'
    const { content } = read(source.replace(stating, before + stating))

    expect(content?.map((item) => item.kind)).toEqual(['event', 'event', 'event'])
  })
})

// A bracket dropped inside another leaves what it held where it stood, and
// what it held is not the length its outer stated. The bracket around it was
// measured before that happened, so a ratio that counted its content then
// need not count it after, and it is measured again.
describe('a bracket dropped inside one whose ratio counted it', () => {
  // Divisions of 128 to a quarter, so a whole note is 512. The outer bracket
  // counts one triple-dotted 64th, which is fifteen five-hundred-and-twelfths
  // of a whole note, and the inner bracket states exactly that much space, so
  // the outer counts what it holds. The inner bracket holds five of them.
  const ratio =
    '<time-modification><actual-notes>128</actual-notes><normal-notes>1</normal-notes>' +
    '<normal-type>128th</normal-type></time-modification>'
  const dotted = '<tuplet-dot/><tuplet-dot/><tuplet-dot/>'
  const starting =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>128th</type>${ratio}<notations>` +
    '<tuplet type="start" number="1">' +
    `<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>${dotted}` +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>128th</tuplet-type>' +
    '</tuplet-normal></tuplet>' +
    '<tuplet type="start" number="2">' +
    '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>whole</tuplet-type>' +
    '</tuplet-actual>' +
    `<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>${dotted}` +
    '</tuplet-normal></tuplet></notations></note>'
  const closing =
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>' +
    `<type>512th</type>${ratio}<notations>` +
    '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/></notations></note>'
  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>128</divisions></attributes>' +
    starting +
    closing +
    '</measure></part></score-partwise>'

  test('counts the bracket around it over what it holds after the drop', () => {
    const { content } = read(source)
    const outer = content?.[0]

    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: '512th', dots: 0 },
      multiple: 5,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: '512th', dots: 0 },
      multiple: 4,
    })
    expect(outer?.kind === 'tuplet' && outer.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
    ])
  })

  test('leaves output the schema takes', () => {
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })
})

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

  /** A grace note, which takes none of the measure's time. */
  const grace =
    '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type></note>'

  /**
   * A second voice sounding through the whole 2/4 measure, written after the
   * first has run `written` divisions. The first voice names none, which is
   * reported once a second voice is named.
   */
  const underneath = (written: number) =>
    `<backup><duration>${String(written)}</duration></backup>` +
    '<note><pitch><step>A</step><octave>3</octave></pitch><duration>24</duration>' +
    '<voice>2</voice><type>half</type></note>'

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

  test('states the silence the measure ends on inside the bracket', () => {
    const { content, warnings } = timed(TRIPLET + shortQuarter + underneath(20))

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['missing:voice'])
  })

  test('writes that silence at the value the ratio counts it in', () => {
    const { content } = timed(TRIPLET + shortQuarter + underneath(20))
    const tuplet = content?.[1]
    const space = tuplet?.kind === 'tuplet' ? tuplet.content[1] : undefined

    expect(space?.kind === 'space' && space.duration).toEqual(fraction(1, 8))
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

  // A grace note takes none of the measure's time, so the voice has not
  // sounded again where one stands after the bracket.
  test('states the silence past a grace note standing after the bracket', () => {
    const { content, warnings } = timed(TRIPLET + shortQuarter + grace + underneath(20))

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(content?.[2]?.kind).toBe('grace')
    expect(warnings.map((w) => w.code)).toEqual(['missing:voice'])
  })

  // A gap before the grace note is only the silence read so far, not all the
  // silence there is, so a bracket the gap alone cannot complete keeps
  // waiting for the barline rather than settling for what has passed.
  test('keeps waiting where a gap too short to complete it precedes a grace note', () => {
    const { content, warnings } = timed(
      shortQuarter + '<forward><duration>2</duration></forward>' + grace + underneath(10),
    )

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['missing:voice'])
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

  // Nothing in the measure sounds past the bracket, so the measure ends where
  // it does and there is no silence after it. A pickup is the usual case.
  test('counts what the bracket holds where nothing in the measure runs past it', () => {
    const { content, warnings } = read(
      measures(TIMED + shortQuarter).replace(
        '<measure number="1">',
        '<measure number="1" implicit="yes">',
      ),
    )

    expect(stated(content?.[0])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event'],
    })
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:tuplet-ratio',
    ])
  })

  test('states the silence where the measure runs past its time signature', () => {
    const { content, warnings } = timed(
      plain('D', 24, 'half') +
        shortQuarter +
        '<backup><duration>32</duration></backup>' +
        '<note><pitch><step>A</step><octave>3</octave></pitch><duration>36</duration>' +
        '<voice>2</voice><type>half</type><dot/></note>',
    )

    expect(stated(content?.[1])).toEqual({
      inner: { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      outer: { value: { base: 'eighth', dots: 0 }, multiple: 2 },
      held: ['event', 'space'],
    })
    expect(warnings.map((w) => w.code)).toEqual(['missing:voice'])
  })

  // How long the measure runs is what the part writes in it, so a part that
  // states no time signature of its own reads the same as one that does.
  test('states the silence in a part that states no time signature', () => {
    const body = shortQuarter + underneath(8)
    const source =
      '<score-partwise>' +
      `<part id="P1"><measure number="1">${TIMED}${body}</measure></part>` +
      '<part id="P2"><measure number="1"><attributes><divisions>12</divisions></attributes>' +
      `${body}</measure></part>` +
      '</score-partwise>'
    const warnings = new WarningCollector()
    const score = readScore(parseXmlRoot(source), warnings)
    const brackets = score.parts.map((part) => stated(part.measures[0]?.sequences[0]?.content[0]))

    expect(brackets[1]).toEqual(brackets[0])
    expect(brackets[1]?.held).toEqual(['event', 'space'])
    expect(warnings.list().map((w) => w.code)).not.toContain('unrepresentable:tuplet-ratio')
  })

  // The bracket holding a space is a shape no other conversion produces.
  test('leaves output the schema takes', () => {
    const source = measures(TIMED + TRIPLET + shortQuarter + underneath(20))
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })
})
