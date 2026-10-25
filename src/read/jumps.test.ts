// A D.C. or D.S. is settled once the whole score is read: the first Fine or
// to-coda jump met on the way back through says whether it is al Fine or al
// Coda.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

const SEGNO = '<direction><direction-type><segno/></direction-type></direction>'
const CODA = '<direction><direction-type><coda/></direction-type></direction>'
const FINE = '<sound fine="yes"/>'
const TO_CODA = '<sound tocoda="coda"/>'
const DA_CAPO = '<sound dacapo="yes"/>'
const DAL_SEGNO = '<sound dalsegno="segno"/>'

function score(...bodies: string[]): string {
  const measures = bodies
    .map(
      (body, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
        `${body}</measure>`,
    )
    .join('')
  return `<score-partwise><part id="P1">${measures}</part></score-partwise>`
}

function jumps(...bodies: string[]) {
  const warnings = new WarningCollector()
  const { globalMeasures } = readValid(score(...bodies), warnings)
  return {
    types: globalMeasures.map((measure) => measure.jump?.type),
    warnings: warnings.list(),
  }
}

describe('a D.C.', () => {
  test('is a plain D.C. where the score has no Fine and no to-coda jump', () => {
    expect(jumps(NOTE, NOTE + DA_CAPO).types).toEqual([undefined, 'dc'])
  })

  test('is a D.C. al Fine where the score has a Fine', () => {
    const { types, warnings } = jumps(NOTE + FINE, NOTE + DA_CAPO)

    expect(types).toEqual([undefined, 'dcAlFine'])
    expect(warnings).toEqual([])
  })

  test('is a D.C. al Coda where the score has a to-coda jump', () => {
    const { types, warnings } = jumps(NOTE + TO_CODA, NOTE + DA_CAPO, CODA + NOTE)

    expect(types).toEqual(['toCoda', 'dcAlCoda', undefined])
    expect(warnings).toEqual([])
  })
})

describe('a D.S.', () => {
  test('is a D.S. al Coda where a to-coda jump follows the segno', () => {
    const { types, warnings } = jumps(SEGNO + NOTE + TO_CODA, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(types).toEqual(['toCoda', 'dsAlCoda', undefined])
    expect(warnings).toEqual([])
  })

  // Replay from the segno never reaches a to-coda jump written before it.
  test('stays a plain D.S. where the to-coda jump stands before the segno', () => {
    const { types } = jumps(NOTE + TO_CODA, SEGNO + NOTE, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(types).toEqual(['toCoda', undefined, 'segno', undefined])
  })

  // The jump returns to the second segno, after the to-coda jump.
  test('ignores a to-coda jump before the segno the jump names', () => {
    const named = (name: string) =>
      `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
    const { types } = jumps(
      named('a') + NOTE + TO_CODA,
      named('b') + NOTE,
      NOTE + '<sound dalsegno="b"/>',
      CODA + NOTE,
    )

    expect(types).toEqual(['toCoda', undefined, 'segno', undefined])
  })

  // Replay starts at the segno, not at the start of its measure.
  test('ignores a to-coda jump earlier in the measure than the segno', () => {
    const { types } = jumps(NOTE + TO_CODA + NOTE + SEGNO + NOTE, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(types).toEqual(['toCoda', 'segno', undefined])
  })

  test('ignores a Fine earlier in the measure than a segno on its closing barline', () => {
    const { types } = jumps(
      NOTE + FINE + NOTE + '<barline location="right"><segno/></barline>',
      NOTE + DAL_SEGNO,
    )

    expect(types).toEqual([undefined, 'segno'])
  })

  test('takes a Fine at the same point as the segno', () => {
    expect(jumps(NOTE + SEGNO + FINE + NOTE, NOTE + DAL_SEGNO).types).toEqual([
      undefined,
      'dsAlFine',
    ])
  })
})

// A jump is taken once, so a replay runs on past the jump that started it.
// MusicXML states no al Fine on the jump: a Fine ends the piece once a jump
// has been taken, wherever it stands.
describe('a mark after the jump', () => {
  test('makes a D.S. al Fine of a Fine after the jump', () => {
    expect(jumps(SEGNO + NOTE, NOTE + DAL_SEGNO, NOTE + FINE).types).toEqual([
      undefined,
      'dsAlFine',
      undefined,
    ])
  })

  test('makes a D.C. al Fine of a Fine in a later section', () => {
    expect(jumps(NOTE + DA_CAPO, SEGNO + NOTE + FINE, NOTE + DAL_SEGNO).types).toEqual([
      'dcAlFine',
      undefined,
      'dsAlFine',
    ])
  })
})

// A player going back meets the marks in order, and the first one met
// decides the jump.
describe('a Fine and a to-coda jump in one score', () => {
  test('takes the Fine where it comes first', () => {
    const { types } = jumps(SEGNO + NOTE + FINE, NOTE + TO_CODA, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(types).toEqual([undefined, 'toCoda', 'dsAlFine', undefined])
  })

  test('takes the to-coda jump where it comes first', () => {
    const { types } = jumps(SEGNO + NOTE + TO_CODA, NOTE + FINE, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(types).toEqual(['toCoda', undefined, 'dsAlCoda', undefined])
  })

  // Within one measure, the point each is written at decides.
  test('takes whichever comes first in the one measure', () => {
    const fineFirst = jumps(SEGNO + FINE + NOTE + TO_CODA, NOTE + DAL_SEGNO, CODA + NOTE)
    const toCodaFirst = jumps(SEGNO + TO_CODA + NOTE + FINE, NOTE + DAL_SEGNO, CODA + NOTE)

    expect(fineFirst.types).toEqual(['toCoda', 'dsAlFine', undefined])
    expect(toCodaFirst.types).toEqual(['toCoda', 'dsAlCoda', undefined])
  })

  // Written at one point, the Fine ends the performance there.
  test('takes the Fine where both are written at the same point', () => {
    const { types } = jumps(NOTE + FINE + TO_CODA, NOTE + DA_CAPO, CODA + NOTE)

    expect(types).toEqual(['toCoda', 'dcAlFine', undefined])
  })
})

describe('a to-coda jump', () => {
  // The jump says where it goes only by the coda the score draws.
  test('reports a to-coda jump in a score that draws no coda', () => {
    const { types, warnings } = jumps(NOTE + '\n' + TO_CODA, NOTE + DA_CAPO)

    expect(types).toEqual(['toCoda', 'dcAlCoda'])
    expect(warnings).toEqual([
      {
        code: 'unresolved:coda',
        message:
          'This to-coda jump goes on to a coda, but the score draws none. The jump is ' +
          'converted with no coda to go to.',
        element: 'sound',
        attribute: 'tocoda',
        context: { measure: 1, line: 2 },
      },
    ])
  })

  test('says nothing where a coda is drawn on a barline', () => {
    const { warnings } = jumps(NOTE + TO_CODA, '<barline location="left"><coda/></barline>' + NOTE)

    expect(warnings).toEqual([])
  })
})

describe('jumps written to MNX', () => {
  test('writes a D.S. al Coda the spec schema accepts', () => {
    const { mnx, warnings } = convertValid(
      score(SEGNO + NOTE + TO_CODA, NOTE + DAL_SEGNO, CODA + NOTE),
    )

    expect(mnx.global.measures).toEqual([
      expect.objectContaining({
        segno: { location: { fraction: [0, 1] } },
        jump: { location: { fraction: [1, 4] }, type: 'toCoda' },
      }),
      expect.objectContaining({ jump: { location: { fraction: [1, 4] }, type: 'dsAlCoda' } }),
      expect.objectContaining({ coda: { location: { fraction: [0, 1] } } }),
    ])
    expect(warnings).toEqual([])
  })

  test('writes a D.C. al Fine the spec schema accepts', () => {
    const { mnx } = convertValid(score(NOTE + FINE, NOTE + DA_CAPO))

    expect(mnx.global.measures[1]?.jump).toEqual({
      location: { fraction: [1, 4] },
      type: 'dcAlFine',
    })
  })
})
