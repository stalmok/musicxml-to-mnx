// A tuplet is written with values longer than it sounds: three eighths played
// in the time of two. MusicXML says so twice, once as a ratio on every note
// (<time-modification>) and once as a bracket around them (<tuplet>). MNX
// wraps the notes in one object carrying the ratio.

import { describe, expect, test } from 'vitest'
import {
  bracketedNote,
  DIVISIONS,
  marker,
  measure,
  measures,
  tremoloNote,
  TRIPLET,
  tupletNote,
} from '../../tests/support/tuplets.js'
import { readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import type { SequenceItem } from '../model/score.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
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
  // home, and the report names what the block holds.
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
    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['notations', 'print-object']])
    expect(warnings[0]?.message).toContain('The block holds <tuplet>.')
  })

  test('leaves the display unset when the source states none', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.showNumber).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.showValue).toBeUndefined()
    expect(tuplet?.kind === 'tuplet' && tuplet.placement).toBeUndefined()
  })

  test('carries the placement onto the tuplet', () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start" placement="below"/></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth', 'stop')
    const { content, warnings } = read(measure(placed))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.placement).toBe('below')
    expect(warnings).toEqual([])
  })

  // A stop marker's placement restates the start's, which the tuplet's
  // placement already carries, so nothing is lost and nothing is reported.
  test("writes the tuplet's placement onto schema-valid MNX, reading the one the stop restates", () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start" placement="above"/></notations></note>' +
      tupletNote('D', 4, 'eighth') +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="stop" placement="above"/></notations></note>'
    const { mnx, warnings } = convertValid(measure(placed))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!item || !('type' in item) || item.type !== 'tuplet') throw new Error('expected a tuplet')

    expect(item.placement).toBe('above')
    expect(warnings).toEqual([])
  })

  test('says nothing of the ratio a stop marker restates', () => {
    const portions =
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type></tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type></tuplet-normal>'
    const restated =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      `<notations><tuplet type="start">${portions}</tuplet></notations></note>` +
      tupletNote('D', 4, 'eighth') +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' +
      `<notations><tuplet type="stop">${portions}</tuplet></notations></note>`
    const { mnx, warnings } = convertValid(measure(restated))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(item && 'type' in item && item.type).toBe('tuplet')
    expect(warnings).toEqual([])
  })

  test('writes the display onto schema-valid MNX', () => {
    const { mnx } = convertValid(measure(displayed))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!item || !('type' in item) || item.type !== 'tuplet') throw new Error('expected a tuplet')

    expect(item.bracket).toBe('no')
    expect(item.showNumber).toBe('noNumber')
    expect(item.showValue).toBe('both')
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

    const { mnx } = convertValid(source)
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!outer || !('type' in outer) || outer.type !== 'tuplet')
      throw new Error('expected a tuplet')
    const inner = outer.content[0]
    if (!inner || !('type' in inner) || inner.type !== 'tuplet')
      throw new Error('expected a tuplet')

    expect(outer.bracket).toBe('yes')
    expect(outer.showNumber).toBe('both')
    expect(outer.placement).toBe('above')
    expect(inner.bracket).toBe('no')
    expect(inner.showNumber).toBe('noNumber')
    expect(inner.placement).toBe('below')
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
    const { mnx, warnings } = convertValid(doubleStart)
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
  // the notes say.
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

  test('says nothing of a dot a marker states with no value to dot', () => {
    const first =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"><tuplet-actual>' +
      '<tuplet-number>3</tuplet-number><tuplet-dot/></tuplet-actual></tuplet></notations></note>'
    const { warnings } = convertValid(
      measure(first + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
    )

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

  // D's marker states 5:4 inside C's 3:2, which disagrees with D's 9:4.
  test('reports a disagreeing marker on a bracket inside one another note opened', () => {
    const ratio = (actual: number, normal: number) =>
      `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
      `<normal-notes>${String(normal)}</normal-notes></time-modification>`
    const quarter = (step: string, markers: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>12</duration>` +
      `<type>quarter</type>${ratio(3, 2)}<notations>${markers}</notations></note>`
    const eighth = (step: string, markers = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>eighth</type>${ratio(9, 4)}<notations>${markers}</notations></note>`
    const fiveInFour =
      '<tuplet-actual><tuplet-number>5</tuplet-number></tuplet-actual>' +
      '<tuplet-normal><tuplet-number>4</tuplet-number></tuplet-normal>'
    const { warnings } = read(
      measures(
        '<attributes><divisions>18</divisions></attributes>' +
          quarter('C', '<tuplet type="start" number="1"/>') +
          eighth('D', `<tuplet type="start" number="2">${fiveInFour}</tuplet>`) +
          eighth('E') +
          eighth('F', '<tuplet type="stop" number="2"/>') +
          quarter('G', '<tuplet type="stop" number="1"/>'),
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([['inconsistent:tuplet', 'tuplet']])
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
    type = 'eighth',
  ): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>${type}</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  // The tuplet numbered 1 opens first and stops first, while the one
  // numbered 2, opened on the next note, runs on. Both stops close the
  // innermost open tuplet instead, and each names a different one, so each
  // reports the crossing.
  const crossed =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>18</divisions></attributes>' +
    note('C', 3, 3, 2, `<tuplet type="start" number="1">${threeInTwoEighths}</tuplet>`, '16th') +
    note('D', 4, 9, 4, `<tuplet type="start" number="2">${threeInTwoEighths}</tuplet>`) +
    note('E', 4, 9, 4) +
    note('F', 4, 9, 4, '<tuplet type="stop" number="1"/>') +
    note('G', 3, 3, 2, '<tuplet type="stop" number="2"/>', '16th') +
    '</measure></part></score-partwise>'

  test('reports a stop naming a tuplet that is not the innermost open one', () => {
    const { mnx, warnings } = convertValid(crossed)

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'unrepresentable:tuplet-crossing', element: 'tuplet' },
      { code: 'unrepresentable:tuplet-crossing', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('cross')

    // The conversion itself stays the nesting: the outer tuplet holds the
    // inner one, as when the stops match the nesting.
    const outer = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    if (!outer || !('type' in outer) || outer.type !== 'tuplet')
      throw new Error('expected a tuplet')
    const inner = outer.content[1]
    expect(inner && 'type' in inner && inner.type).toBe('tuplet')
  })

  // Nested tuplets may end on the same note, and MusicXML does not constrain
  // which stop is written first inside <notations> or which number the outer
  // tuplet takes. Either way, the note's stops close the same tuplets, so
  // nothing crosses.
  test.each([
    ['1', '<tuplet type="stop" number="1"/><tuplet type="stop" number="2"/>'],
    ['1', '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'],
    ['2', '<tuplet type="stop" number="1"/><tuplet type="stop" number="2"/>'],
    ['2', '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'],
  ])('says nothing when nested tuplets, outer %s, stop on one note as %s', (outer, stops) => {
    const inner = outer === '1' ? '2' : '1'
    const nested =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>9</divisions></attributes>' +
      note('C', 3, 3, 2, `<tuplet type="start" number="${outer}">${threeInTwoEighths}</tuplet>`) +
      note('D', 2, 9, 4, `<tuplet type="start" number="${inner}">${threeInTwoEighths}</tuplet>`) +
      note('E', 2, 9, 4) +
      note('F', 2, 9, 4, stops) +
      '</measure></part></score-partwise>'
    const { warnings } = convertValid(nested)

    expect(warnings).toEqual([])
  })

  // One tuplet starts on a note and two more on the next. A later note's
  // first stop closes the innermost, as it names; its second names the
  // outermost but closes the middle one. The report is at the second stop, on
  // its own line.
  test('reports the crossing at the stop that crosses, not the first stop of the note', () => {
    const start = (number: string): string =>
      `<tuplet type="start" number="${number}">${threeInTwoEighths}</tuplet>`
    const source = [
      '<score-partwise><part id="P1"><measure number="1">',
      '<attributes><divisions>54</divisions></attributes>',
      note('C', 18, 3, 2, start('1')),
      note('D', 8, 27, 8, start('2') + start('3')),
      note('E', 8, 27, 8, '<tuplet type="stop" number="3"/>\n<tuplet type="stop" number="1"/>'),
      '</measure></part></score-partwise>',
    ].join('\n')
    const { warnings } = convertValid(source)
    const crossings = warnings.filter((w) => w.code === 'unrepresentable:tuplet-crossing')

    expect(crossings.map((w) => w.context.line)).toEqual([6])
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

// MusicXML does not constrain the order of the start markers on one note, so
// the stops are what say how tuplets opening together nest.
describe('tuplets opening on one note', () => {
  const ratioStart = (number: string, actual: number, normal: number, type: string): string =>
    `<tuplet type="start" number="${number}">` +
    `<tuplet-actual><tuplet-number>${String(actual)}</tuplet-number>` +
    `<tuplet-type>${type}</tuplet-type></tuplet-actual>` +
    `<tuplet-normal><tuplet-number>${String(normal)}</tuplet-number>` +
    `<tuplet-type>${type}</tuplet-type></tuplet-normal></tuplet>`

  const note = (
    step: string,
    duration: number,
    type: string,
    actual: number,
    normal: number,
    markers = '',
  ): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>${type}</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  const ratiosOf = (item: SequenceItem | undefined) =>
    item?.kind === 'tuplet' && [item.inner.value.base, item.inner.multiple, item.outer.multiple]

  // A quarter triplet whose first quarter is an eighth triplet, whose first
  // eighth is a sixteenth triplet. The markers are written innermost first,
  // and each stop closes the bracket it names. A <forward> in place of the
  // second sixteenth is a skip, which moves with the notes.
  test.each([
    ['a note', note('D', 2, '16th', 27, 8)],
    ['a forward', '<forward><duration>2</duration></forward>'],
  ])('nests the tuplet that stops first innermost, the second sixteenth %s', (_, second) => {
    const stop = (number: string) => `<tuplet type="stop" number="${number}"/>`
    const { content, warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>27</divisions></attributes>' +
        note(
          'C',
          2,
          '16th',
          27,
          8,
          ratioStart('1', 3, 2, '16th') +
            ratioStart('2', 3, 2, 'eighth') +
            ratioStart('3', 3, 2, 'quarter'),
        ) +
        second +
        note('E', 2, '16th', 27, 8, stop('1')) +
        note('F', 6, 'eighth', 9, 4) +
        note('G', 6, 'eighth', 9, 4, stop('2')) +
        note('A', 18, 'quarter', 3, 2) +
        note('B', 18, 'quarter', 3, 2, stop('3')) +
        '</measure></part></score-partwise>',
    )
    const quarters = content?.[0]
    const eighths = quarters?.kind === 'tuplet' ? quarters.content[0] : undefined
    const sixteenths = eighths?.kind === 'tuplet' ? eighths.content[0] : undefined

    expect(warnings).toEqual([])
    expect(content).toHaveLength(1)
    expect(ratiosOf(quarters)).toEqual(['quarter', 3, 2])
    expect(quarters?.kind === 'tuplet' && quarters.content).toHaveLength(3)
    expect(ratiosOf(eighths)).toEqual(['eighth', 3, 2])
    expect(eighths?.kind === 'tuplet' && eighths.content).toHaveLength(3)
    expect(ratiosOf(sixteenths)).toEqual(['16th', 3, 2])
    expect(sixteenths?.kind === 'tuplet' && sixteenths.content).toHaveLength(3)
  })

  // An eighth triplet whose first eighth is a sixteenth triplet, written
  // outermost first, with the stop numbers the wrong way round. The three
  // sixteenths fill the inner bracket and not the outer one the first stop
  // names, so the stops are what cross.
  test('keeps the written order where the notes do not fill the bracket a stop names', () => {
    const { content, warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>9</divisions></attributes>' +
        note(
          'C',
          1,
          '16th',
          9,
          4,
          ratioStart('1', 3, 2, 'eighth') + ratioStart('2', 3, 2, '16th'),
        ) +
        note('D', 1, '16th', 9, 4) +
        note('E', 1, '16th', 9, 4, '<tuplet type="stop" number="1"/>') +
        note('F', 3, 'eighth', 3, 2) +
        note('G', 3, 'eighth', 3, 2, '<tuplet type="stop" number="2"/>') +
        '</measure></part></score-partwise>',
    )
    const outer = content?.[0]

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-crossing',
      'unrepresentable:tuplet-crossing',
    ])
    expect(ratiosOf(outer)).toEqual(['eighth', 3, 2])
    expect(ratiosOf(outer?.kind === 'tuplet' ? outer.content[0] : undefined)).toEqual([
      '16th',
      3,
      2,
    ])
  })

  // Two sixteenth triplets, the second written holding the first. The notes
  // fill either one, so the stops say which is inside.
  test('nests by the stops where the notes fill both brackets', () => {
    const { content, warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>18</divisions></attributes>' +
        note(
          'C',
          2,
          '16th',
          9,
          4,
          ratioStart('1', 3, 2, '16th').replace('number="1"', 'number="1" placement="above"') +
            ratioStart('2', 3, 2, '16th'),
        ) +
        note('D', 2, '16th', 9, 4) +
        note('E', 2, '16th', 9, 4, '<tuplet type="stop" number="1"/>') +
        note('F', 3, '16th', 3, 2, '<tuplet type="stop" number="2"/>') +
        '</measure></part></score-partwise>',
    )
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(warnings).toEqual([])
    expect(outer?.kind === 'tuplet' && outer.placement).toBeUndefined()
    expect(inner?.kind === 'tuplet' && inner.placement).toBe('above')
  })

  // Both stop on one note, so the stops say nothing about which is inside,
  // and the order the starts are written in stands, whichever stop comes
  // first. The second states no ratio, so it takes 1:1 and is rewritten to
  // the three eighths it holds.
  test.each([
    ['<tuplet type="stop" number="1"/><tuplet type="stop" number="2"/>'],
    ['<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'],
  ])('keeps the written order where both stop on one note as %s', (stops) => {
    const starts =
      `<tuplet type="start" number="1" placement="above">` +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number>' +
      '<tuplet-type>eighth</tuplet-type></tuplet-normal></tuplet>' +
      '<tuplet type="start" number="2" placement="below"/>'
    const { content, warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>12</divisions></attributes>' +
        note('C', 4, 'eighth', 3, 2, starts) +
        note('D', 4, 'eighth', 3, 2) +
        note('E', 4, 'eighth', 3, 2, stops) +
        '</measure></part></score-partwise>',
    )
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(warnings).toEqual([])
    expect(outer?.kind === 'tuplet' && outer.placement).toBe('above')
    expect(inner?.kind === 'tuplet' && inner.placement).toBe('below')
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
    const result = readValid(
      measure(other + late('C', 'start') + late('D') + late('E', 'stop')),
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

  // Scores contain brackets whose content does not add up to the stated
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
  // rewritten over what it holds, the frame it writes moves, and a skip left at
  // its filled length would stand for a time the source never skipped. The
  // frame is read off the notes, which carry lengths of their own, and the skip
  // is written in that frame: here the notes are drawn as quarters and last an
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
  // four thirty-seconds in the time of three. The span report already covers
  // the cut, so the content falling short of the ratio is not reported again.
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
  // record of one an earlier barline cut must not take it. Otherwise the
  // bracket the stop ends is lost, and everything after it is drawn inside a
  // bracket that should have closed.
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

  // The stop names the bracket the source drew around it however the two are
  // numbered. Taking it for the bracket an earlier barline cut would leave the
  // drawn one open to that barline, and leave the record standing to match a
  // later stop.
  test('leaves a stop to a drawn bracket numbered otherwise than the cut one', () => {
    const { warnings } = read(
      measures(
        DIVISIONS +
          tupletNote('C', 4, 'eighth', 'start', '2') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth'),
        tupletNote('F', 4, 'eighth', 'start', '1') +
          tupletNote('G', 4, 'eighth') +
          tupletNote('A', 4, 'eighth', 'stop', '2'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-crossing',
    ])
  })

  // A run the ratio alone opened is no bracket of the source's, so a carried
  // stop is taken over it. This is the shape a cut bracket usually carries on
  // in: the notes after the barline state the same ratio and nothing else.
  test('takes a carried stop over a run the ratio alone opened', () => {
    const { warnings } = read(
      measures(
        DIVISIONS +
          tupletNote('C', 4, 'eighth', 'start', '2') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth'),
        tupletNote('F', 4, 'eighth') +
          tupletNote('G', 4, 'eighth', 'stop', '2') +
          tupletNote('A', 4, 'eighth'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-span'])
  })

  // A voice may be written as two lines sounding at once, and a bracket open in
  // either of them is a bracket the stop can name. Reading only the line the
  // stop is written in would take it for the cut bracket instead.
  test('leaves a stop to a drawn bracket open in another line of the voice', () => {
    const { warnings } = read(
      measures(
        DIVISIONS +
          tupletNote('C', 4, 'eighth', 'start', '2') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth'),
        bracketedNote('F', 'start', '1') +
          '<backup><duration>12</duration></backup>' +
          bracketedNote('G', 'stop', '2'),
      ),
    )

    // The bracket around notes carrying no ratio states one of its own, and the
    // voice sounding two notes at once is read as two lines. Between them, the
    // stop ends nothing and the drawn bracket is cut at the second barline.
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'missing:time-modification',
      'inconsistent:tuplet',
      'unrepresentable:tuplet-span',
      'inconsistent:voice',
    ])
  })

  // The record is kept per voice: the bracket the barline cut was one voice's,
  // and a stop another voice writes ends nothing of its own.
  test('leaves a carried stop to the voice whose bracket was cut', () => {
    const voiced = (body: string, voice: string): string =>
      body.replace('</note>', `<voice>${voice}</voice></note>`)
    const { warnings } = read(
      measures(
        DIVISIONS +
          voiced(tupletNote('C', 4, 'eighth', 'start'), '1') +
          voiced(tupletNote('D', 4, 'eighth'), '1') +
          voiced(tupletNote('E', 4, 'eighth'), '1'),
        voiced(bracketedNote('F', 'stop'), '2'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'inconsistent:tuplet',
    ])
  })

  // And per number: a stop numbered otherwise than the bracket the barline cut
  // names no tuplet of the source's that ended, and is reported where it is met.
  test('leaves a carried stop to the number the cut bracket stated', () => {
    const { warnings } = read(
      measures(
        DIVISIONS +
          tupletNote('C', 4, 'eighth', 'start', '1') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth'),
        bracketedNote('F', 'stop', '2'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'inconsistent:tuplet',
    ])
  })

  // One cut bracket takes one stop. A second stop stating the same number ends
  // nothing, and is reported as any other stop with no bracket to close.
  test('takes one carried stop per bracket the barline cut', () => {
    const { warnings } = read(
      measures(
        DIVISIONS +
          tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth'),
        bracketedNote('F', 'stop') + bracketedNote('G', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-span',
      'inconsistent:tuplet',
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
    const { warnings } = convertValid(
      measures(
        DIVISIONS + bracketedNote('C', 'start') + bracketedNote('D'),
        bracketedNote('E', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-span',
    ])
  })

  // The note carries no ratio, so nothing opened on it either. A marker that
  // ends nothing takes none of the measure's time, so the measure still adds
  // up without it and the file converts.
  test('passes over a stop with no tuplet open', () => {
    const bare =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>'
    const { content, warnings } = read(measure(bare))

    expect(content?.map((item) => item.kind)).toEqual(['event'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  // A grace note carrying the stop is the same construct.
  test('passes over a stop a grace note carries with no tuplet open', () => {
    const graceStop =
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
      '<notations><tuplet type="stop"/></notations></note>'
    const { content, warnings } = read(measure(graceStop + bracketedNote('C')))

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
  })

  test('leaves output the schema takes where a stop closes nothing', () => {
    const graceStop =
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
      '<notations><tuplet type="stop"/></notations></note>'

    convertValid(measure(graceStop + bracketedNote('C')))
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
      tremolo: { placement: undefined, marks: 3 },
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
  // note of it, which Sibelius and MuseScore both do.
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

  test('passes over a restatement that states how the bracket is drawn', () => {
    const drawn = '<tuplet type="start" bracket="yes" show-number="actual"/>'
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth').replace('</note>', `<notations>${drawn}</notations></note>`) +
          chordMember(drawn) +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
    expect(content?.[0]).toMatchObject({ bracket: 'yes', showNumber: 'inner' })
  })

  // A tuplet shows the played count unless it states otherwise.
  test('passes over a restatement that states the default number shown', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          chordMember('<tuplet type="start" show-number="actual"/>') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  // A bracket is drawn as its start says, so a stop names it and says
  // nothing more.
  test('passes over a stop that places itself elsewhere', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          chordMember('<tuplet type="stop" placement="above"/>'),
      ),
    )

    expect(warnings).toEqual([])
  })

  test('reports a restatement drawn where the chord’s own is hidden', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth').replace(
          '</note>',
          '<notations print-object="no"><tuplet type="start"/></notations></note>',
        ) +
          chordMember('<tuplet type="start"/>') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content?.[0]).toMatchObject({ bracket: 'no' })
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['inconsistent:tuplet', 'tuplet']])
  })

  test('reports a restatement that draws the bracket another way', () => {
    const drawn = (bracket: string) => `<tuplet type="start" bracket="${bracket}"/>`
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth').replace(
          '</note>',
          `<notations>${drawn('yes')}</notations></note>`,
        ) +
          chordMember(drawn('no')) +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content?.[0]).toMatchObject({ bracket: 'yes' })
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'inconsistent:tuplet',
        'tuplet',
        'A note of a chord carries a <tuplet> another way than the note it joins. MNX ' +
          "states the tuplet once for the chord, and the chord's own is the one converted.",
      ],
    ])
  })

  // Sibelius leaves <voice> off a chord member, so the marker is compared
  // with the chord it joins rather than against the unnamed voice.
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

  // A marker is compared by its type and its number together. A member stating
  // a different number states a bracket of its own, whatever the chord's
  // marker is.
  const numbered = (step: string, type: string, number: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${type}" number="${number}"/></notations></note>`

  // A marker that states no number is tuplet 1.
  test('passes over a restatement that leaves out the number 1', () => {
    const { content, warnings } = read(
      measure(
        numbered('C', 'start', '1') +
          chordMember('<tuplet type="start"/>') +
          tupletNote('D', 4, 'eighth') +
          numbered('E', 'stop', '1'),
      ),
    )

    expect(warnings).toEqual([])
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
  })

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
          chordMember('<tuplet type="start" number="2" bracket="yes"/>') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    // The one warning accounts for the marker whole, how it is drawn included.
    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'unsupported:element', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('chord member')
    // The bracket the source did draw is untouched, and holds all three events.
    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })

  // The record of a dropped start outlives the brackets around it, so a stop
  // naming it is matched and dropped even after every bracket has closed. Read
  // as an ordinary stop it would close a bracket nothing had opened.
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

  test('swallows a stop numbered 1 after a dropped start that states no number', () => {
    const after =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type><notations><tuplet type="stop" number="1"/></notations></note>'
    const { content, warnings } = read(
      measure(
        numbered('C', 'start', '2') +
          chordMember('<tuplet type="start"/>') +
          tupletNote('D', 4, 'eighth') +
          numbered('E', 'stop', '2') +
          after,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
    expect(warnings.map((one) => one.code)).toEqual(['unsupported:element'])
  })

  // A run the ratio alone opens has no bracket in the source, so a stop
  // written inside it belongs to the start the chord member dropped.
  test('drops the stop of a dropped start inside a run with no bracket', () => {
    const rated = (step: string, markers = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'
    const { content, warnings } = read(
      measure(
        rated('C') +
          chordMember('<tuplet type="start"/>') +
          rated('D', '<tuplet type="stop"/>') +
          rated('E'),
      ),
    )

    expect(warnings.map((one) => one.code)).toEqual(['unsupported:element'])
    expect(content?.map((item) => item.kind === 'tuplet' && item.content.length)).toEqual([3])
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
  test('swallows only the first stop matching a start dropped on a chord member', () => {
    const twice =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      '<notations><tuplet type="stop" number="2"/><tuplet type="stop" number="2"/>' +
      '<tuplet type="stop" number="1"/></notations></note>'

    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          chordMember('<tuplet type="start" number="2"/>') +
          twice,
      ),
    )

    // The second stop of that number closes the bracket the source drew, and
    // the stop naming that bracket is then the one with nothing to close.
    expect(warnings.map((w) => w.code)).toEqual([
      'unsupported:element',
      'inconsistent:tuplet',
      'unrepresentable:tuplet-crossing',
    ])
  })

  // A mis-tracked stop would nest the brackets wrongly.
  test('writes the bracket that is left onto schema-valid MNX', () => {
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const { mnx, warnings } = convertValid(
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
  })

  // A source that never nests tuplets numbers every one of them 1, so a
  // dropped start and the bracket around it share a number. The
  // bracket's own stop closes the bracket. Taking it for the
  // dropped start would leave the bracket open.
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

// The ratio a bracket states, level by level, is worked out from the note's
// <time-modification> and the brackets already open around it. Each test
// states one step of that arithmetic by the ratio it produces.
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

// A tuplet in a sequence laid over its voice belongs to that sequence. The
// bracket is opened before the note is written, and must still end up in the
// note's sequence.
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
    const result = readValid(measure(laidOver), warnings)
    const sequences = result.parts[0]?.measures[0]?.sequences

    expect(sequences).toHaveLength(2)
    expect(sequences?.[0]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(sequences?.[1]?.content.map((item) => item.kind)).toEqual(['tuplet'])
  })

  test('converts to MNX the schema accepts', () => {
    convertValid(measure(laidOver))
  })

  // A grace note leads into the note after it, and goes to that note's line.
  // A grace note that stops a bracket belongs to the bracket, so it stays in
  // the line the bracket is in.
  const closedOnGrace =
    voiced('C', 'start') +
    voiced('D') +
    voiced('E') +
    '<backup><duration>12</duration></backup>' +
    '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><voice>1</voice>' +
    '<type>eighth</type><notations><tuplet type="stop"/></notations></note>' +
    '<note><pitch><step>F</step><octave>4</octave></pitch><duration>48</duration>' +
    '<voice>1</voice><type>whole</type></note>'

  test('keeps a bracket a grace note closes, and the grace note in it', () => {
    const warnings = new WarningCollector()
    const result = readValid(measure(closedOnGrace), warnings)
    const sequences = result.parts[0]?.measures[0]?.sequences
    const tuplet = sequences?.[0]?.content[0]

    expect(sequences?.[0]?.content.map((item) => item.kind)).toEqual(['tuplet'])
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'event',
      'grace',
    ])
    expect(sequences?.[1]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(warnings.list().map((w) => w.code)).toEqual(['inconsistent:voice'])
  })

  test('converts a bracket closed on a grace note to MNX the schema accepts', () => {
    convertValid(measure(closedOnGrace))
  })
})

// A start marker reads the ratio on its note itself, so what that read passes
// over is still reported.
test('reports what the ratio on a note opening a bracket holds besides its counts', () => {
  const opening =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><extra/></time-modification>' +
    marker('start') +
    '</note>'
  const { warnings } = read(
    measure(opening + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop')),
  )

  expect(warnings.map((w) => [w.code, w.element])).toEqual([['unsupported:element', 'extra']])
})
