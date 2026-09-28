// MNX's support block states, for the whole document, whether the document
// writes out its accidentals and its beams. A consumer reads it to know
// whether to lay those out by rule or use what the document wrote.
//
// Only a whole conversion produces the block, so these tests use the public
// API. The reader's model is tested beside src/read/.

import { describe, expect, test } from 'vitest'
import { convertValid } from './support/convert.js'

/** One measure of the given notes, with the given `<encoding>` supports. */
function convert(body: string, supports = '') {
  const identification = supports
    ? `<identification><encoding>${supports}</encoding></identification>`
    : ''

  return convertValid(
    '<score-partwise>' +
      identification +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>4</divisions></attributes>' +
      `${body}</measure></part></score-partwise>`,
  ).mnx
}

function note(step: string, alter: string, body: string): string {
  const alterElement = alter === '' ? '' : `<alter>${alter}</alter>`
  return (
    `<note><pitch><step>${step}</step>${alterElement}<octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`
  )
}

function eighth(step: string, marker: string): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration>` +
    `<type>eighth</type><beam number="1">${marker}</beam></note>`
  )
}

const quarter =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

// Whether the document draws its accidentals is read off the finished score,
// not collected while the reader builds it.
describe('the document declaring it states accidentals', () => {
  test('says so once any note draws an accidental', () => {
    const mnx = convert(note('G', '1', '<accidental>sharp</accidental>'))

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  test('does not claim it where the source never draws one', () => {
    const mnx = convert(note('C', '', ''))

    expect(mnx.mnx.support).toBeUndefined()
  })

  test('finds one drawn inside a grace group', () => {
    const mnx = convert(
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
        '<accidental>sharp</accidental></note>' +
        note('C', '', ''),
    )

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  // The notes of a tuplet or a two-note tremolo are inside it, one level
  // below the sequence.
  test('finds one drawn inside a tuplet', () => {
    // Two eighths in the time of three, so each lasts three divisions.
    const duplet = (step: string, marker: string, accidental = '') =>
      `<note><pitch><step>${step}</step><alter>1</alter><octave>4</octave></pitch>` +
      `<duration>3</duration><type>eighth</type>${accidental}` +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>3</normal-notes>' +
      '</time-modification>' +
      `<notations><tuplet type="${marker}"/></notations></note>`
    const mnx = convert(
      duplet('G', 'start', '<accidental>sharp</accidental>') + duplet('A', 'stop'),
    )

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  test('finds one drawn inside a two-note tremolo', () => {
    const tremolo = (type: string, accidental = '') =>
      '<note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch>' +
      `<duration>4</duration><type>half</type>${accidental}` +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
    const mnx = convert(tremolo('start', '<accidental>sharp</accidental>') + tremolo('stop'))

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })
})

// A cautionary or editorial accidental is shown though the rules do not
// require it. That is what MNX's accidental-display `force` means.
describe('a forced accidental', () => {
  test('reaches the output as schema-valid MNX', () => {
    const mnx = convert(note('F', '1', '<accidental cautionary="yes">sharp</accidental>'))

    expect(JSON.stringify(mnx)).toContain('"force":true')
  })
})

// Where the source says nothing about its own beams, whether the document
// states them is read off the finished score, like the accidentals.
describe('the document declaring it states beams', () => {
  test('says so once any measure carries a beam', () => {
    const mnx = convert(eighth('C', 'begin') + eighth('D', 'end'))

    expect(mnx.mnx.support).toEqual({ useBeams: true })
  })

  test('declares both supports where the document draws both', () => {
    const mnx = convert(
      eighth('C', 'begin') +
        '<note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration>' +
        '<type>eighth</type><accidental>sharp</accidental><beam number="1">end</beam></note>',
    )

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true, useBeams: true })
  })

  test('does not claim it where nothing is beamed', () => {
    const mnx = convert(quarter)

    expect(mnx.mnx.support).toBeUndefined()
  })
})

// <encoding><supports> states whether the beams in the file are all of them.
// A score that beams nothing on purpose declares the support and has no beam.
describe('the source declaring it states beams', () => {
  test('states the support where the source declares it and beams nothing', () => {
    const mnx = convert(quarter, '<supports element="beam" type="yes"/>')

    expect(mnx.mnx.support).toEqual({ useBeams: true })
  })

  test('states the accidental support the source declares with no accidental drawn', () => {
    const mnx = convert(quarter, '<supports element="accidental" type="yes"/>')

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  // MNX's support block cannot state a "no" or a declaration narrowed to one
  // attribute, so the document falls back to what it wrote.
  test('leaves the support to what was written for a declaration of "no"', () => {
    const mnx = convert(quarter, '<supports element="beam" type="no"/>')

    expect(mnx.mnx.support).toBeUndefined()
  })

  test('leaves the support to what was written for a declaration on an attribute', () => {
    const mnx = convert(
      quarter,
      '<supports element="accidental" attribute="cautionary" type="yes"/>',
    )

    expect(mnx.mnx.support).toBeUndefined()
  })

  test('reads no declaration from an element that is not <supports>', () => {
    const mnx = convert(quarter, '<supported element="beam" type="yes"/>')

    expect(mnx.mnx.support).toBeUndefined()
  })

  test('states both supports where the source declares both', () => {
    const mnx = convert(
      quarter,
      '<supports element="accidental" type="yes"/><supports element="beam" type="yes"/>',
    )

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true, useBeams: true })
  })
})
