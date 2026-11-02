// A D.C. or D.S. is settled once the whole score is read: the first Fine or
// to-coda jump met on the way back through says whether it is al Fine or al
// Coda.

import { readFailure, readValid } from '../../tests/support/read.js'
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

  // Replay from the segno never reaches a Fine written before it.
  test('stays a plain D.S. where the Fine stands before the segno', () => {
    expect(jumps(NOTE + FINE, SEGNO + NOTE, NOTE + DAL_SEGNO).types).toEqual([
      undefined,
      undefined,
      'segno',
    ])
  })

  test('takes a Fine at the same point as the segno', () => {
    expect(jumps(NOTE + SEGNO + FINE + NOTE, NOTE + DAL_SEGNO).types).toEqual([
      undefined,
      'dsAlFine',
    ])
  })
})

// <sound segno> and <sound coda> with no sign beside them mark a destination
// for playback only. MNX's segno and coda are drawn signs, so a jump that goes
// to one is not converted.
describe('a jump to a sign the score does not draw', () => {
  const undrawn = (warnings: readonly ConversionWarning[]) =>
    warnings
      .filter((w) => w.code === 'unrepresentable:undrawn-destination')
      .map((w) => [w.message, w.element, w.attribute, w.context.measure])

  test('does not convert a D.S. to a segno marked only for playback', () => {
    const { types, warnings } = jumps('<sound segno="a"/>' + NOTE, NOTE + '<sound dalsegno="a"/>')

    expect(types).toEqual([undefined, undefined])
    expect(undrawn(warnings)).toEqual([
      [
        'This dal segno jump returns to a segno the score marks only for playback, with ' +
          '<sound segno>, and does not draw. MNX states a segno only as a drawn sign, so ' +
          'the jump is not converted.',
        'sound',
        'dalsegno',
        2,
      ],
    ])
  })

  test('does not convert a D.S. to an undrawn segno in a direction', () => {
    const { types, warnings } = jumps(
      '<direction><direction-type><words>here</words></direction-type>' +
        '<sound segno="a"/></direction>' +
        NOTE,
      NOTE + '<sound dalsegno="a"/>',
    )

    expect(types).toEqual([undefined, undefined])
    expect(undrawn(warnings).map((w) => w[3])).toEqual([2])
  })

  // The score draws one segno, so the D.S. returns to it.
  test('returns a D.S. naming an undrawn segno to the one drawn', () => {
    const { types, warnings } = jumps(
      '<direction><direction-type><segno/></direction-type><sound segno="b"/></direction>' + NOTE,
      '<sound segno="a"/>' + NOTE,
      NOTE + '<sound dalsegno="a"/>',
    )

    expect(types).toEqual([undefined, undefined, 'segno'])
    expect(undrawn(warnings)).toEqual([])
  })

  test('returns a D.S. naming no sign to the one segno drawn', () => {
    const { types, warnings } = jumps(
      SEGNO + NOTE,
      '<sound segno="a"/>' + NOTE,
      NOTE + '<sound dalsegno=""/>',
    )

    expect(types).toEqual([undefined, undefined, 'segno'])
    expect(undrawn(warnings)).toEqual([])
  })

  // Another part draws the sign at that measure.
  test('converts a D.S. to a segno another part draws', () => {
    const warnings = new WarningCollector()
    const part = (id: string, first: string) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>4</divisions></attributes>` +
      `${first}${NOTE}</measure><measure number="2">${NOTE}<sound dalsegno="a"/></measure></part>`
    const { globalMeasures } = readValid(
      '<score-partwise>' +
        part('P1', '<sound segno="a"/>') +
        part(
          'P2',
          '<direction><direction-type><segno/></direction-type><sound segno="a"/></direction>',
        ) +
        '</score-partwise>',
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([undefined, 'segno'])
    expect(undrawn(warnings.list())).toEqual([])
  })

  test('does not convert a to-coda jump to a coda marked only for playback', () => {
    const { types, warnings } = jumps(
      NOTE + '<sound tocoda="c"/>',
      NOTE + DA_CAPO,
      '<sound coda="c"/>' + NOTE,
    )

    expect(types).toEqual([undefined, 'dc', undefined])
    expect(undrawn(warnings)).toEqual([
      [
        'This to-coda jump goes on to a coda the score marks only for playback, with ' +
          '<sound coda>, and does not draw. MNX states a coda only as a drawn sign, so ' +
          'the jump is not converted.',
        'sound',
        'tocoda',
        1,
      ],
    ])
  })

  test('does not convert a D.S. to a segno marked only for playback, whatever it names', () => {
    const { types, warnings } = jumps('<sound segno="S"/>' + NOTE, NOTE + '<sound dalsegno="T"/>')

    expect(types).toEqual([undefined, undefined])
    expect(undrawn(warnings).map((w) => w[3])).toEqual([2])
  })

  test('does not convert a D.S. to one of several segnos marked only for playback', () => {
    const { types, warnings } = jumps(
      '<sound segno="a"/>' + NOTE,
      '<sound segno="c"/>' + NOTE,
      NOTE + '<sound dalsegno="a"/>',
    )

    expect(types).toEqual([undefined, undefined, undefined])
    expect(undrawn(warnings).map((w) => w[3])).toEqual([3])
  })

  // A segno marked for playback counts only where the score draws none.
  test('returns a D.S. to the one segno drawn, past a segno marked for playback', () => {
    const { types, warnings } = jumps(
      NOTE,
      SEGNO + NOTE,
      '<direction><direction-type><words>here</words></direction-type>' +
        '<sound segno="segno"/></direction>' +
        NOTE,
      NOTE + '<sound dalsegno="segno"/>',
    )

    expect(types).toEqual([undefined, undefined, undefined, 'segno'])
    expect(undrawn(warnings)).toEqual([])
  })

  test('takes a to-coda jump marking a coda beside it to the one coda drawn', () => {
    const { types, warnings } = jumps(
      NOTE,
      NOTE + '<sound tocoda="coda" coda="coda"/>',
      NOTE + DA_CAPO,
      CODA + NOTE,
    )

    expect(types).toEqual([undefined, 'toCoda', 'dcAlCoda', undefined])
    expect(undrawn(warnings)).toEqual([])
  })

  test('does not convert a D.S. to a segno one part of several marks for playback', () => {
    const warnings = new WarningCollector()
    const part = (id: string, mark: string) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>4</divisions></attributes>` +
      `${mark}${NOTE}</measure><measure number="2">${NOTE}<sound dalsegno="a"/></measure></part>`
    const { globalMeasures } = readValid(
      `<score-partwise>${part('P1', '')}${part('P2', '<sound segno="a"/>')}</score-partwise>`,
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([undefined, undefined])
    expect(undrawn(warnings.list()).map((w) => w[3])).toEqual([2])
  })

  // A coda marked for playback is no segno.
  test('refuses a D.S. where the score marks only a coda for playback', () => {
    expect(readFailure(score('<sound coda="c"/>' + NOTE, NOTE + DAL_SEGNO)).detail).toContain(
      'draws no segno',
    )
  })

  // The dropped to-coda jump does not end the replay, so the Fine after it does.
  test('makes a D.S. al Fine where it meets only a to-coda jump not converted', () => {
    const { types, warnings } = jumps(
      SEGNO + NOTE + '<sound tocoda="c"/>',
      NOTE + FINE,
      NOTE + DAL_SEGNO,
      '<sound coda="c"/>' + NOTE,
    )

    expect(types).toEqual([undefined, undefined, 'dsAlFine', undefined])
    expect(undrawn(warnings).map((w) => w[3])).toEqual([1])
  })

  test('writes the score without the jump onto schema-valid MNX', () => {
    const { mnx } = convertValid(score('<sound segno="a"/>' + NOTE, NOTE + '<sound dalsegno="a"/>'))

    expect(mnx.global.measures.map((measure) => measure.jump)).toEqual([undefined, undefined])
  })
})

// MNX states a jump to a segno, a coda or a Fine only in a score with exactly
// one of it.
describe('a jump in a score without exactly one sign for it', () => {
  const segno = (name: string) =>
    `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
  const coda = (name: string) =>
    `<direction><direction-type><coda/></direction-type><sound coda="${name}"/></direction>`

  test.each([
    [
      'a D.S. where the score draws no segno',
      [NOTE, NOTE + '\n' + DAL_SEGNO],
      'The score has a dal segno jump and draws no segno. MNX requires exactly one segno ' +
        'in a score with a dal segno jump.',
      ['score-partwise', 'measure 2'],
    ],
    [
      'a D.S. where the score draws two segnos',
      [segno('a') + NOTE, segno('b') + NOTE, NOTE + '\n' + '<sound dalsegno="a"/>'],
      'The score has a dal segno jump and draws 2 segnos. MNX requires exactly one segno ' +
        'in a score with a dal segno jump.',
      ['score-partwise', 'measure 3'],
    ],
    [
      'a to-coda jump where the score draws no coda',
      [NOTE + '\n' + TO_CODA, NOTE + DA_CAPO],
      'The score has a to-coda jump and draws no coda. MNX requires exactly one coda ' +
        'in a score with a to-coda jump.',
      ['score-partwise', 'measure 1'],
    ],
    [
      'a to-coda jump where the score draws two codas',
      [NOTE + '\n' + TO_CODA, NOTE + DA_CAPO, coda('coda') + NOTE, coda('coda') + NOTE],
      'The score has a to-coda jump and draws 2 codas. MNX requires exactly one coda ' +
        'in a score with a to-coda jump.',
      ['score-partwise', 'measure 1'],
    ],
    [
      'an al Fine jump where the score has two Fines',
      [NOTE + FINE, NOTE + '\n' + DA_CAPO, NOTE + FINE],
      'The score has an al Fine jump and 2 Fines. MNX requires exactly one Fine in a score ' +
        'with an al Fine jump.',
      ['score-partwise', 'measure 2'],
    ],
  ])('refuses %s', (_, bodies, detail, path) => {
    const error = readFailure(score(...bodies))

    expect(error.detail).toBe(detail)
    expect(error.path).toEqual(path)
    expect(error.line).toBe(2)
  })

  test('names the measure of the jump as the source numbers it', () => {
    const source = score(NOTE, NOTE + DAL_SEGNO).replace(
      '<measure number="2">',
      '<measure number="7">',
    )

    expect(readFailure(source).path).toEqual(['score-partwise', 'measure 7'])
  })

  test('keeps every segno and coda where no jump goes to them', () => {
    const { mnx, warnings } = convertValid(
      score(segno('a') + NOTE, segno('b') + NOTE, coda('c') + NOTE, coda('d') + NOTE + DA_CAPO),
    )

    expect(
      mnx.global.measures.map((measure) => [
        measure.segno !== undefined,
        measure.coda !== undefined,
      ]),
    ).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ])
    expect(mnx.global.measures[3]?.jump?.type).toBe('dc')
    expect(warnings.map((w) => w.code)).not.toContain('unrepresentable:element')
  })

  test('keeps every Fine where no jump is al Fine', () => {
    const { types } = jumps(NOTE + TO_CODA, NOTE + FINE, NOTE + FINE, NOTE + DA_CAPO, CODA + NOTE)

    expect(types).toEqual(['toCoda', undefined, undefined, 'dcAlCoda', undefined])
  })

  test('goes to the only coda whatever it is named', () => {
    const { types, warnings } = jumps(
      NOTE + '<sound tocoda="x"/>',
      NOTE + DA_CAPO,
      coda('a') + NOTE,
    )

    expect(types).toEqual(['toCoda', 'dcAlCoda', undefined])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:attribute'])
  })

  test('says nothing where a coda is drawn on a barline', () => {
    const { warnings } = jumps(NOTE + TO_CODA, '<barline location="left"><coda/></barline>' + NOTE)

    expect(warnings).toEqual([])
  })
})

// A segno or a coda at the point of a jump is how a source draws the jump:
// "D.S." beside a segno, "To Coda" or "al Coda" beside a coda. It is not a
// sign the jump goes to.
describe('a sign drawn at the point of a jump', () => {
  const drawn = (sign: string, sound: string) =>
    `<direction><direction-type><${sign}/></direction-type>${sound}</direction>`
  const TO_CODA_WORDS =
    '<direction><direction-type><words>To Coda</words></direction-type>' + TO_CODA + '</direction>'

  function signs(source: string) {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(source, warnings)
    return {
      types: globalMeasures.map((measure) => measure.jump?.type),
      segnos: globalMeasures.map((measure) => measure.segno !== undefined),
      codas: globalMeasures.map((measure) => measure.coda !== undefined),
      warnings: warnings.list().map((w) => w.element),
    }
  }

  test.each([
    ['in a direction before the <sound tocoda>', CODA + TO_CODA, []],
    ['in a direction after the <sound tocoda>', TO_CODA + CODA, []],
    ['apart from the direction that holds the <sound tocoda>', CODA + TO_CODA_WORDS, ['words']],
    ['on the barline the <sound tocoda> stands at', TO_CODA + '<barline><coda/></barline>', []],
  ])('takes a coda %s as the to-coda jump', (_, marks, losses) => {
    const result = signs(score(NOTE + marks, NOTE + DA_CAPO, CODA + NOTE))

    expect(result.types).toEqual(['toCoda', 'dcAlCoda', undefined])
    expect(result.codas).toEqual([false, false, true])
    expect(result.warnings).toEqual(losses)
  })

  test('takes a segno in the direction of a D.S. as the D.S.', () => {
    const result = signs(score(SEGNO + NOTE, NOTE + drawn('segno', DAL_SEGNO)))

    expect(result.types).toEqual([undefined, 'segno'])
    expect(result.segnos).toEqual([true, false])
    expect(result.warnings).toEqual([])
  })

  test.each([
    ['D.C.', NOTE + TO_CODA, DA_CAPO, 'dcAlCoda'],
    ['D.S.', SEGNO + NOTE + TO_CODA, DAL_SEGNO, 'dsAlCoda'],
  ])('takes a coda in the direction of a %s as al Coda', (_, opening, sound, type) => {
    const result = signs(score(opening, NOTE + drawn('coda', sound), CODA + NOTE))

    expect(result.types).toEqual(['toCoda', type, undefined])
    expect(result.codas).toEqual([false, false, true])
    expect(result.warnings).toEqual([])
  })

  // Without a to-coda jump, nothing is al Coda, and a coda goes nowhere.
  test.each([
    ['D.C.', DA_CAPO, 'dc'],
    ['D.S.', DAL_SEGNO, 'segno'],
  ])('keeps a coda in the direction of a %s in a score with no to-coda jump', (_, sound, type) => {
    const result = signs(score(SEGNO + NOTE, NOTE + drawn('coda', sound)))

    expect(result.types).toEqual([undefined, type])
    expect(result.codas).toEqual([false, true])
  })

  test('keeps a segno in the direction of a D.C.', () => {
    const result = signs(score(NOTE + drawn('segno', DA_CAPO)))

    expect(result.types).toEqual(['dc'])
    expect(result.segnos).toEqual([true])
  })

  // MNX states one sign of each kind per measure. The jump's drawing is not
  // a second one.
  test.each([
    ['segno', SEGNO + NOTE + drawn('segno', DAL_SEGNO), ['segno'], 'segno'],
    ['coda', CODA + NOTE + CODA + TO_CODA, ['toCoda'], 'coda'],
  ] as const)(
    'keeps a %s at the start of the jump’s measure without a report',
    (_, body, types, kind) => {
      const warnings = new WarningCollector()
      const { globalMeasures } = readValid(score(body), warnings)

      expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual(types)
      expect(globalMeasures[0]?.[kind]?.location).toEqual({ num: 0, den: 1 })
      expect(warnings.list()).toEqual([])
    },
  )

  // A coda before the coda section can share the point of the D.C. or D.S.
  // that leads there.
  test.each([
    ['D.C.', '', DA_CAPO, 'dcAlCoda'],
    ['D.S.', SEGNO, DAL_SEGNO, 'dsAlCoda'],
  ])('takes the only coda at the point of a %s as the coda', (_, segno, sound, type) => {
    const result = signs(
      score(segno + NOTE + TO_CODA, NOTE + sound + '<barline><coda/></barline>', NOTE),
    )

    expect(result.types).toEqual(['toCoda', type, undefined])
    expect(result.codas).toEqual([false, true, false])
    expect(result.warnings).toEqual([])
  })

  test('reports a coda at the point of a D.S. that meets no to-coda jump', () => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(
      score(NOTE + TO_CODA, SEGNO + NOTE, NOTE + drawn('coda', DAL_SEGNO), CODA + NOTE),
      warnings,
    )

    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([
      'toCoda',
      undefined,
      'segno',
      undefined,
    ])
    expect(globalMeasures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      false,
      true,
    ])
    expect(warnings.list().map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:element', 'coda', 3],
    ])
  })

  // The jump is not converted, so nothing else draws the sign.
  test.each([
    [
      'segno beside a D.S.',
      [NOTE + '<sound segno="s"/>', NOTE + drawn('segno', DAL_SEGNO)],
      'segno',
    ],
    ['coda beside a to-coda jump', [NOTE + CODA + TO_CODA, NOTE + '<sound coda="coda"/>'], 'coda'],
  ] as const)('keeps a %s to a sign marked only for playback', (_, bodies, kind) => {
    const warnings = new WarningCollector()
    const { globalMeasures } = readValid(score(...bodies), warnings)

    expect(globalMeasures.map((measure) => measure.jump?.type)).toEqual([undefined, undefined])
    expect(globalMeasures.map((measure) => measure[kind] !== undefined)).toEqual(
      kind === 'segno' ? [false, true] : [true, false],
    )
    expect(warnings.list().map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:undrawn-destination',
    ])
  })

  // MNX states one jump per measure, so the second is reported, and its
  // drawing goes with it.
  test.each([
    [
      'a second to-coda jump',
      [NOTE + drawn('coda', TO_CODA) + NOTE + '\n' + drawn('coda', TO_CODA), NOTE + DA_CAPO, CODA],
      ['toCoda', 'dcAlCoda', undefined],
      [false, false, true],
    ],
    [
      'a to-coda jump after a D.S.',
      [SEGNO + NOTE, DAL_SEGNO + NOTE + '\n' + drawn('coda', TO_CODA)],
      [undefined, 'segno'],
      [false, false],
    ],
  ])('drops the coda drawn by %s the measure cannot hold', (_, bodies, types, codas) => {
    const result = signs(score(...bodies))

    expect(result.types).toEqual(types)
    expect(result.codas).toEqual(codas)
    expect(result.warnings).toEqual(['sound'])
  })

  test('counts a coda at another point of the to-coda jump’s measure', () => {
    const error = readFailure(score(CODA + NOTE + TO_CODA, NOTE + DA_CAPO, CODA + NOTE))

    expect(error.detail).toContain('draws 2 codas')
  })

  // Each part restates the score's marks, one with the <sound> and one
  // without.
  test.each([
    ['P1', 'P2'],
    ['P2', 'P1'],
  ])('takes the coda %s draws with no jump as the to-coda jump %s states', (_, sounding) => {
    const part = (id: string) =>
      `<part id="${id}">` +
      `<measure number="1"><attributes><divisions>4</divisions></attributes>${NOTE}` +
      (id === sounding ? drawn('coda', TO_CODA) : CODA) +
      '</measure>' +
      `<measure number="2">${NOTE}${id === sounding ? DA_CAPO : ''}</measure>` +
      `<measure number="3">${CODA}${NOTE}</measure></part>`
    const result = signs(`<score-partwise>${part('P1')}${part('P2')}</score-partwise>`)

    expect(result.types).toEqual(['toCoda', 'dcAlCoda', undefined])
    expect(result.codas).toEqual([false, false, true])
    expect(result.warnings).toEqual([])
  })

  test('writes one coda to schema-valid MNX', () => {
    const { mnx } = convertValid(score(NOTE + CODA + TO_CODA, NOTE + DA_CAPO, CODA + NOTE))

    expect(mnx.global.measures.map((measure) => measure.coda !== undefined)).toEqual([
      false,
      false,
      true,
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

// MNX names no segno, so two at one point are one mark whatever the source
// calls them.
describe('two marks at one point', () => {
  test('takes two segnos at one point with different names as one', () => {
    const namedSegno = (name: string) =>
      `<direction><direction-type><segno/></direction-type><sound segno="${name}"/></direction>`
    const { warnings } = jumps(namedSegno('a') + '\n' + namedSegno('b') + NOTE)

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'segno'],
      ['unrepresentable:attribute', 'segno'],
    ])
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
