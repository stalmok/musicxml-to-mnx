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
    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual([
      { kind: 'tremolo', orient: undefined, pointing: undefined, symbol: undefined, marks: 3 },
    ])
    expect(warnings).toEqual([])
  })

  test('rejects a tuplet opening on a note that states no ratio', () => {
    const noRatio =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<notations><tuplet type="start"/></notations></note>'

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

describe('beam levels', () => {
  const beamed = (level: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>eighth</type><beam number="${level}">begin</beam></note>`

  test('reads a beam that states no level as the first one', () => {
    const { content } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>eighth</type><beam>begin</beam></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>eighth</type><beam>end</beam></note>',
      ),
    )

    expect(content).toHaveLength(2)
  })

  test.each(['0', '99', 'first'])('rejects "%s" as a beam level', (level) => {
    expect(readFailure(measure(beamed(level))).message).toContain('not a beam level')
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

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual([])
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

    expect(
      content?.[0]?.kind === 'event' && content[0].markings.map((m) => [m.kind, m.marks]),
    ).toEqual([['tremolo', 3]])
    expect(warnings).toEqual([])
  })

  // Zero beams write an unmeasured tremolo, which MNX cannot state.
  test('reports a single-note tremolo drawn with no beams', () => {
    const unmeasured =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">0</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(unmeasured))

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  test('keeps the first of two single-note tremolos', () => {
    const doubled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">3</tremolo>' +
      '<tremolo type="single">2</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(doubled))

    expect(content?.[0]?.kind === 'event' && content[0].markings.map((m) => m.marks)).toEqual([3])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:marking'])
  })
})
