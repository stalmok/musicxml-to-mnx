// A D.C. or D.S. is settled once the whole score is read: the first Fine or
// to-coda jump met on the way back through says whether it is al Fine or al
// Coda.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
import type { ConversionWarning } from '../warnings.js'

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

  // Only the segno's own measure is cut at the segno.
  test('takes a Fine in a later measure at an earlier point than the segno', () => {
    expect(jumps(NOTE + NOTE + SEGNO + NOTE, NOTE + FINE, NOTE + DAL_SEGNO).types).toEqual([
      undefined,
      undefined,
      'dsAlFine',
    ])
  })

  test('takes a Fine at the same point as the segno', () => {
    expect(jumps(NOTE + SEGNO + FINE + NOTE, NOTE + DAL_SEGNO).types).toEqual([
      undefined,
      'dsAlFine',
    ])
  })
})

// MNX states a jump to a segno only in a score with one segno. A player with
// no segno to find goes back to the start, which MNX states as a D.C.
describe('a D.S. in a score that draws no segno', () => {
  test('is a plain D.C. where the replay meets no Fine and no to-coda jump', () => {
    const { types, warnings } = jumps(NOTE, NOTE + DAL_SEGNO)

    expect(types).toEqual([undefined, 'dc'])
    expect(warnings.map((w) => w.code)).toEqual(['unresolved:segno'])
  })

  test('is a D.C. al Coda where the replay meets a to-coda jump', () => {
    expect(jumps(NOTE + TO_CODA, NOTE + DAL_SEGNO, CODA + NOTE).types).toEqual([
      'toCoda',
      'dcAlCoda',
      undefined,
    ])
  })

  test('is written as a D.C. the spec schema accepts', () => {
    const { mnx } = convertValid(score(NOTE + FINE, NOTE + DAL_SEGNO))

    expect(mnx.global.measures.map((measure) => measure.jump?.type)).toEqual([
      undefined,
      'dcAlFine',
    ])
    expect(mnx.global.measures.some((measure) => measure.segno !== undefined)).toBe(false)
  })
})

// MNX states a jump to a segno only in a score with one segno. The segno most
// jumps return to is kept. The other segnos, and the jumps that return to
// them, are not converted.
describe('a D.S. in a score that draws several segnos', () => {
  const named = (name: string) =>
    `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
  const dalSegno = (name: string) => `<sound dalsegno="${name}"/>`
  // A named segno also reports its name, which MNX cannot state.
  const destinations = (warnings: readonly ConversionWarning[]) =>
    warnings.filter((w) => w.code === 'unrepresentable:jump-destination')

  test('keeps the segno most jumps return to', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(
        named('a') + NOTE,
        named('b') + NOTE,
        NOTE + dalSegno('a'),
        NOTE + dalSegno('b'),
        NOTE + dalSegno('b'),
      ),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.segno !== undefined)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ])
    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([
      undefined,
      undefined,
      undefined,
      'segno',
      'segno',
    ])
    expect(
      destinations(warnings.list()).map((w) => [w.code, w.element, w.context.measure]),
    ).toEqual([
      ['unrepresentable:jump-destination', 'segno', 1],
      ['unrepresentable:jump-destination', 'sound', 3],
    ])
  })

  test('keeps the first segno where as many jumps return to each', () => {
    const { types, warnings } = jumps(
      named('a') + NOTE,
      named('b') + NOTE,
      NOTE + dalSegno('b'),
      NOTE + dalSegno('a'),
    )

    expect(types).toEqual([undefined, undefined, undefined, 'segno'])
    expect(destinations(warnings).map((w) => [w.element, w.context.measure])).toEqual([
      ['segno', 2],
      ['sound', 3],
    ])
  })

  test('drops a segno no jump returns to', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(named('a') + NOTE, NOTE + dalSegno('a'), named('b') + NOTE),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.segno !== undefined)).toEqual([
      true,
      false,
      false,
    ])
    expect(destinations(warnings.list())).toEqual([
      {
        code: 'unrepresentable:jump-destination',
        message:
          'The score draws more than one segno and has a dal segno jump, and MNX states ' +
          'one segno in such a score. The segno most jumps go to is kept, and this one ' +
          'is not converted.',
        element: 'segno',
        context: { measure: 3, line: 1 },
      },
    ])
  })

  test('reports a jump to a segno that is not kept', () => {
    const { warnings } = jumps(
      named('a') + NOTE,
      named('b') + NOTE + '\n' + dalSegno('a'),
      NOTE + dalSegno('b'),
      NOTE + dalSegno('b'),
    )

    expect(warnings).toContainEqual({
      code: 'unrepresentable:jump-destination',
      message:
        'This dal segno jump goes to a segno other than the one kept, and MNX states ' +
        'one segno in a score with a dal segno jump. The jump is not converted.',
      element: 'sound',
      attribute: 'dalsegno',
      context: { measure: 2, line: 2 },
    })
  })

  test('keeps every segno where no jump returns to one', () => {
    const { warnings } = jumps(named('a') + NOTE, named('b') + NOTE, NOTE + DA_CAPO)

    expect(destinations(warnings)).toEqual([])
  })

  test('writes one segno the spec schema accepts', () => {
    const { mnx } = convertValid(score(named('a') + NOTE, named('b') + NOTE, NOTE + dalSegno('b')))

    expect(mnx.global.measures.map((measure) => measure.segno !== undefined)).toEqual([
      false,
      true,
      false,
    ])
    expect(mnx.global.measures[2]?.jump?.type).toBe('segno')
  })
})

// MNX states a to-coda jump only in a score with one coda. The coda most
// to-coda jumps go to is kept, as for a segno.
describe('a to-coda jump in a score that draws several codas', () => {
  const named = (name: string) =>
    `<direction><direction-type><coda/></direction-type><sound coda="${name}"/></direction>`
  const toCoda = (name: string) => `<sound tocoda="${name}"/>`
  const destinations = (warnings: readonly ConversionWarning[]) =>
    warnings.filter((w) => w.code === 'unrepresentable:jump-destination')

  test('keeps the coda most jumps go to', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(
        NOTE + toCoda('b'),
        NOTE + DA_CAPO,
        named('a') + NOTE + toCoda('a'),
        named('b') + NOTE,
        NOTE + toCoda('b'),
      ),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ])
    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([
      'toCoda',
      'dcAlCoda',
      undefined,
      undefined,
      'toCoda',
    ])
    expect(destinations(warnings.list())).toEqual([
      {
        code: 'unrepresentable:jump-destination',
        message:
          'The score draws more than one coda and has a to-coda jump, and MNX states one ' +
          'coda in such a score. The coda most jumps go to is kept, and this one is not ' +
          'converted.',
        element: 'coda',
        context: { measure: 3, line: 1 },
      },
      {
        code: 'unrepresentable:jump-destination',
        message:
          'This to-coda jump goes to a coda other than the one kept, and MNX states one ' +
          'coda in a score with a to-coda jump. The jump is not converted.',
        element: 'sound',
        attribute: 'tocoda',
        context: { measure: 3, line: 1 },
      },
    ])
  })

  // MuseScore names every coda "coda". A to-coda jump goes on to a coda
  // after it.
  test('goes to the first coda after the jump among codas of one name', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(named('coda') + NOTE, NOTE + toCoda('coda'), NOTE + DA_CAPO, named('coda') + NOTE),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      false,
      true,
    ])
    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([
      undefined,
      'toCoda',
      'dcAlCoda',
      undefined,
    ])
  })

  test('compares the points of a coda and the jump in one measure', () => {
    const codas = (...bodies: string[]) => {
      const { globalMeasures } = readValid(score(...bodies), new WarningCollector())
      return globalMeasures.map((measure) => measure.coda !== undefined)
    }

    expect(
      codas(
        named('coda') + NOTE,
        NOTE + toCoda('coda') + named('coda') + NOTE,
        named('coda') + NOTE,
      ),
    ).toEqual([false, true, false])
    expect(
      codas(
        named('coda') + NOTE,
        named('coda') + NOTE + toCoda('coda') + NOTE,
        named('coda') + NOTE,
      ),
    ).toEqual([false, false, true])
  })

  // Only the coda's own measure is compared by point.
  test('passes over a coda in an earlier measure at a later point', () => {
    const { globalMeasures } = readValid(
      score(NOTE + NOTE + named('coda') + NOTE, toCoda('coda') + NOTE, named('coda') + NOTE),
      new WarningCollector(),
    )

    expect(globalMeasures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      true,
    ])
  })

  test('drops and reports a jump with no coda of its name after it', () => {
    const { types, warnings } = jumps(
      named('coda') + NOTE,
      named('coda') + NOTE,
      NOTE + '\n' + toCoda('coda'),
    )

    expect(types).toEqual([undefined, undefined, undefined])
    expect(warnings.filter((w) => w.code === 'unresolved:coda')).toEqual([
      {
        code: 'unresolved:coda',
        message:
          'This to-coda jump goes on to the coda "coda", but the score draws several ' +
          'codas of that name and none after the jump. The jump is not converted.',
        element: 'sound',
        attribute: 'tocoda',
        context: { measure: 3, line: 2 },
      },
    ])
  })

  test('matches a coda the barline names', () => {
    const { types, warnings } = jumps(
      NOTE + toCoda('b'),
      NOTE + DA_CAPO,
      '<barline location="left" coda="a"><coda/></barline>' + NOTE,
      '<barline location="left" coda="b"><coda/></barline>' + NOTE,
    )

    expect(types).toEqual(['toCoda', 'dcAlCoda', undefined, undefined])
    expect(destinations(warnings).map((w) => w.context.measure)).toEqual([3])
  })

  // Without the jump, the D.C. plays through to the end.
  test('drops and reports a jump naming none of the codas', () => {
    const { types, warnings } = jumps(
      NOTE + '\n' + toCoda('c'),
      NOTE + DA_CAPO,
      named('a') + NOTE,
      named('b') + NOTE,
    )

    expect(types).toEqual([undefined, 'dc', undefined, undefined])
    expect(warnings.filter((w) => w.code === 'unresolved:coda')).toEqual([
      {
        code: 'unresolved:coda',
        message:
          'This to-coda jump goes on to the coda "c", which is none of the codas the ' +
          'score draws. The jump is not converted.',
        element: 'sound',
        attribute: 'tocoda',
        context: { measure: 1, line: 2 },
      },
    ])
    expect(destinations(warnings)).toEqual([])
  })

  test('drops and reports a jump naming no coda', () => {
    const { types, warnings } = jumps(
      NOTE + '<sound tocoda=""/>',
      named('a') + NOTE,
      named('b') + NOTE,
    )

    expect(types).toEqual([undefined, undefined, undefined])
    expect(warnings.filter((w) => w.code === 'unresolved:coda').map((w) => w.message)).toEqual([
      'This to-coda jump names no coda, and the score draws several. The jump is not converted.',
    ])
  })

  test('goes to the only coda whatever it is named', () => {
    const { types, warnings } = jumps(NOTE + toCoda('x'), NOTE + DA_CAPO, named('a') + NOTE)

    expect(types).toEqual(['toCoda', 'dcAlCoda', undefined])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:attribute'])
  })

  test('writes one coda the spec schema accepts', () => {
    const { mnx } = convertValid(
      score(NOTE + toCoda('b'), NOTE + DA_CAPO, named('a') + NOTE, named('b') + NOTE),
    )

    expect(mnx.global.measures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      false,
      true,
    ])
  })
})

// MNX states an al Fine jump only in a score with one Fine. The Fine most al
// Fine jumps stop at is kept, as for a segno.
describe('an al Fine jump in a score that has several Fines', () => {
  const destinations = (warnings: readonly ConversionWarning[]) =>
    warnings.filter((w) => w.code === 'unrepresentable:jump-destination')

  test('keeps the Fine most jumps stop at', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(
        NOTE + FINE,
        NOTE + '\n' + DA_CAPO,
        SEGNO + NOTE + '\n' + FINE,
        NOTE + DAL_SEGNO,
        NOTE + DAL_SEGNO,
      ),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.fine !== undefined)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ])
    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([
      undefined,
      undefined,
      undefined,
      'dsAlFine',
      'dsAlFine',
    ])
    expect(destinations(warnings.list())).toEqual([
      {
        code: 'unrepresentable:jump-destination',
        message:
          'The score has more than one Fine and an al Fine jump, and MNX states one Fine ' +
          'in such a score. The Fine most jumps stop at is kept, and this one is not ' +
          'converted.',
        element: 'sound',
        attribute: 'fine',
        context: { measure: 1, line: 1 },
      },
      {
        code: 'unrepresentable:jump-destination',
        message:
          'This da capo jump stops at a Fine other than the one kept, and MNX states one ' +
          'Fine in a score with an al Fine jump. The jump is not converted.',
        element: 'sound',
        attribute: 'dacapo',
        context: { measure: 2, line: 2 },
      },
    ])
  })

  test('keeps every Fine where no jump is al Fine', () => {
    const { types, warnings } = jumps(
      NOTE + TO_CODA,
      NOTE + FINE,
      NOTE + FINE,
      NOTE + DA_CAPO,
      CODA + NOTE,
    )

    expect(types).toEqual(['toCoda', undefined, undefined, 'dcAlCoda', undefined])
    expect(destinations(warnings)).toEqual([])
  })

  test('drops a Fine no jump stops at', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(score(NOTE + FINE, NOTE + DA_CAPO, NOTE + FINE), warnings)

    expect(globalMeasures.map((measure) => measure.fine !== undefined)).toEqual([
      true,
      false,
      false,
    ])
    expect(destinations(warnings.list()).map((w) => w.context.measure)).toEqual([3])
  })

  test('writes one Fine the spec schema accepts', () => {
    const { mnx } = convertValid(score(NOTE + FINE, NOTE + DA_CAPO, NOTE + FINE))

    expect(mnx.global.measures.map((measure) => measure.fine !== undefined)).toEqual([
      true,
      false,
      false,
    ])
    expect(mnx.global.measures[1]?.jump?.type).toBe('dcAlFine')
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
  // The jump says where it goes only by the coda the score draws, and MNX
  // states a to-coda jump only in a score with one coda. Without the jump, the
  // D.C. plays through to the end.
  test('drops and reports a to-coda jump in a score that draws no coda', () => {
    const { types, warnings } = jumps(NOTE + '\n' + TO_CODA, NOTE + DA_CAPO)

    expect(types).toEqual([undefined, 'dc'])
    expect(warnings).toEqual([
      {
        code: 'unresolved:coda',
        message:
          'This to-coda jump goes on to a coda, but the score draws none. The jump is ' +
          'not converted.',
        element: 'sound',
        attribute: 'tocoda',
        context: { measure: 1, line: 2 },
      },
    ])
  })

  test('leaves a D.S. that meets only a dropped to-coda jump al Fine', () => {
    const { types } = jumps(SEGNO + NOTE + TO_CODA, NOTE + FINE, NOTE + DAL_SEGNO)

    expect(types).toEqual([undefined, undefined, 'dsAlFine'])
  })

  test('writes no to-coda jump where the score draws no coda', () => {
    const { mnx } = convertValid(score(NOTE + TO_CODA, NOTE + DA_CAPO))

    expect(mnx.global.measures.map((measure) => measure.jump?.type)).toEqual([undefined, 'dc'])
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
