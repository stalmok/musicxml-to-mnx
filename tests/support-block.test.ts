// MNX's support block says once, for the whole document, which notations the
// document's own notation is complete for: the accidentals it draws and the
// beams it groups. A consumer reads it to know whether to lay those out by
// rule or use what the document wrote.
//
// The block is a fact about a converted document, and nothing shorter than a
// conversion produces one, so these go through the public API rather than
// calling the reader and the writer separately. What the model carries is the
// reader's own business and is tested beside src/read/.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import { schemaErrors } from './support/schema.js'

/** One measure of the given notes, with the given `<encoding>` declarations. */
function convert(body: string, supports = '') {
  const identification = supports
    ? `<identification><encoding>${supports}</encoding></identification>`
    : ''

  return convertMusicXML(
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

// Whether the document draws its accidentals is a fact about the whole of it,
// so it is read off the finished score rather than accumulated while it is
// built. That keeps it a property of what was converted rather than of the
// order the reader happened to visit things in.
describe('the document declaring it states accidentals', () => {
  test('says so once any note draws an accidental', () => {
    const mnx = convert(note('G', '1', '<accidental>sharp</accidental>'))

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  test('does not claim it where the source never draws one', () => {
    const mnx = convert(note('C', '', ''))

    expect(mnx.mnx.support).toBeUndefined()
  })

  test('finds one drawn inside a tuplet or a grace group', () => {
    const mnx = convert(
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
        '<accidental>sharp</accidental></note>' +
        note('C', '', ''),
    )

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })
})

// A cautionary or editorial accidental is shown though the rules would not
// require it, which is exactly what MNX's accidental-display `force` means.
// The support block above is what promises a consumer the flag is there.
describe('a forced accidental', () => {
  test('reaches the output as schema-valid MNX', () => {
    const mnx = convert(note('F', '1', '<accidental cautionary="yes">sharp</accidental>'))

    expect(JSON.stringify(mnx)).toContain('"force":true')
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// Where the source says nothing about its own beams, whether the document
// states them is read off the finished score, like the accidentals, so a
// consumer knows to use the beams written rather than beam by rule.
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('does not claim it where nothing is beamed', () => {
    const mnx = convert(quarter)

    expect(mnx.mnx.support).toBeUndefined()
  })
})

// The source states in <encoding><supports> whether the beams in the file are
// the whole of them, and that is a different fact from whether the file holds
// a beam: a score that beams nothing on purpose declares the support and
// carries no beam. The declaration is what the support block restates.
describe('the source declaring it states beams', () => {
  test('states the support where the source declares it and beams nothing', () => {
    const mnx = convert(quarter, '<supports element="beam" type="yes"/>')

    expect(mnx.mnx.support).toEqual({ useBeams: true })
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('states the accidental support the source declares with no accidental drawn', () => {
    const mnx = convert(quarter, '<supports element="accidental" type="yes"/>')

    expect(mnx.mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  // A "no", and a declaration narrowed to one attribute, are statements MNX's
  // support block cannot make, so the document falls back to what it wrote.
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

  // The declaration is <supports> and nothing else. Another element of
  // <encoding> carrying the same attributes states nothing about beams.
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
