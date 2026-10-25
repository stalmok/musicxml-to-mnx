// Settling each jump once the whole score is known: which segno a D.S. returns
// to, and whether a D.C. or a D.S. is al Fine or al Coda.

import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { GlobalMeasure, JumpType } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { ReadGlobalMeasure, ReadJump } from './globalMeasures.js'

/** A point in the score: a measure index and a location in that measure. */
interface Point {
  readonly index: number
  readonly location: Fraction
}

const START: Point = { index: 0, location: fraction(0) }

/** A segno, with the name the source gives it. */
interface Sign extends Point {
  readonly name: string | undefined
}

/** What stops a replay: a Fine, a to-coda jump, or neither. */
type ReplayEnd = 'fine' | 'toCoda' | 'none'

const SETTLED: Readonly<Record<'dacapo' | 'dalsegno', Record<ReplayEnd, JumpType>>> = {
  dacapo: { fine: 'dcAlFine', toCoda: 'dcAlCoda', none: 'dc' },
  dalsegno: { fine: 'dsAlFine', toCoda: 'dsAlCoda', none: 'segno' },
}

/**
 * A D.C. or D.S. that meets a Fine on the way back through is al Fine: the
 * player stops there. One that meets a to-coda jump first is al Coda: the
 * player goes on to the coda there. MusicXML says neither on the <sound
 * dacapo> or <sound dalsegno> attribute, only through the marks the score
 * holds, so each jump is settled here once the whole score is known.
 *
 * A D.S. meets only the marks standing after the segno it returns to: replay
 * from a segno written after a Fine never reaches it. A jump is taken once,
 * so the replay runs on past the jump that started it: MusicXML states no al
 * Fine on the jump, and a Fine ends the piece once a jump has been taken,
 * wherever it stands. Marking that jump
 * "dsAlFine" would say the piece ends somewhere it does not, so a score with
 * several signs is matched sign by sign, by the name MusicXML gives them.
 */
export function settleJumps(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): GlobalMeasure[] {
  const signs: Sign[] = measures.flatMap((measure, index) =>
    measure.segno
      ? [{ index, location: measure.segno.value.location, name: measure.segno.value.name }]
      : [],
  )
  const drawsCoda = measures.some((measure) => measure.coda !== undefined)
  // MNX states a to-coda jump only in a score with one coda, so one with no
  // coda to go to is not written, and no D.C. or D.S. is al Coda by it.
  const toCodas = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'tocoda') return undefined
    if (drawsCoda) return jump.value
    warnings.add(
      'unresolved:coda',
      'This to-coda jump goes on to a coda, but the score draws none. The jump is ' +
        'not converted.',
      { measure: index + 1 },
      jump.element,
      'tocoda',
    )
    return undefined
  })
  const returns = segnosReturnedTo(measures, signs, warnings)
  const typeOf = (jump: ReadJump, index: number): JumpType | undefined => {
    if (jump.sound === 'tocoda') return toCodas[index] && 'toCoda'
    if (jump.sound === 'dacapo') return SETTLED.dacapo[replayEnd(measures, toCodas, START)]
    const from = returns.from[index]
    if (from === undefined) return undefined
    // MNX states a jump to a segno only in a score with one, so a D.S. with
    // no segno to find is written as the D.C. a player takes.
    const settled = from === START ? SETTLED.dacapo : SETTLED.dalsegno
    return settled[replayEnd(measures, toCodas, from)]
  }

  return measures.map(
    (
      {
        tempos,
        number,
        barline,
        repeatEnd,
        ending,
        fermata,
        segno,
        coda,
        fine,
        jump,
        multimeasureRest,
        ...measure
      },
      index,
    ) => ({
      ...measure,
      tempos: tempos.map((tempo) => tempo.value),
      number: number?.value,
      barline: barline?.value,
      repeatEnd: repeatEnd?.value,
      ending: ending?.value,
      fermata: fermata?.value,
      segno:
        segno && returns.keeps(index)
          ? { location: segno.value.location, glyph: segno.value.glyph, color: segno.value.color }
          : undefined,
      coda: coda?.value,
      fine: fine?.value,
      jump: jump && written(jump.value, typeOf(jump.value, index)),
      multimeasureRest: multimeasureRest?.value,
    }),
  )
}

function written(jump: ReadJump, type: JumpType | undefined): GlobalMeasure['jump'] {
  return type && { location: jump.location, type }
}

/**
 * Where each measure's D.S. returns to: a segno, the start of the score
 * where the score draws none, or nowhere where the jump is not converted.
 * MNX states a jump to a segno only in a score with one segno, so the segno
 * most jumps return to is kept. The others, and the jumps that return to
 * them, are not converted. As many jumps returning to each keeps the first.
 */
function segnosReturnedTo(
  measures: readonly ReadGlobalMeasure[],
  signs: readonly Sign[],
  warnings: WarningCollector,
): { from: readonly (Point | undefined)[]; keeps: (index: number) => boolean } {
  const resolved = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'dalsegno') return undefined
    const { from, unresolved } = segnoReturnedTo(signs, jump.value.target)
    if (unresolved !== undefined) {
      warnings.add('unresolved:segno', unresolved, { measure: index + 1 }, jump.element, 'dalsegno')
    }
    return from
  })
  const kept = mostReturnedTo(signs, resolved)
  if (kept === undefined) return { from: resolved, keeps: () => true }
  for (const sign of signs) {
    const segno = measures[sign.index]?.segno
    if (sign === kept || segno === undefined) continue
    warnings.add(
      'unrepresentable:jump-destination',
      'The score draws more than one segno and has a dal segno jump, and MNX states one ' +
        'segno in such a score. The segno most jumps return to is kept, and this one is ' +
        'not converted.',
      { measure: sign.index + 1 },
      segno.element,
    )
  }
  const from = resolved.map((from, index) => {
    const jump = measures[index]?.jump
    if (from === undefined || from === kept || jump === undefined) return from
    warnings.add(
      'unrepresentable:jump-destination',
      'This dal segno jump returns to a segno other than the one kept, and MNX states ' +
        'one segno in a score with a dal segno jump. The jump is not converted.',
      { measure: index + 1 },
      jump.element,
      'dalsegno',
    )
    return undefined
  })
  return { from, keeps: (index) => index === kept.index }
}

/** The sign the most destinations name, the first of those named as often. */
function mostReturnedTo<T>(signs: readonly T[], destinations: readonly unknown[]): T | undefined {
  let most: T | undefined
  let count = 0
  for (const sign of signs) {
    const named = destinations.filter((destination) => destination === sign).length
    if (named > count) [most, count] = [sign, named]
  }
  return most
}

/**
 * The first Fine or to-coda jump a replay from `from` meets. A player going
 * back meets them in score order, starting at the sign itself, so a mark
 * earlier in the sign's measure is not met. A Fine written at the same point
 * as a to-coda jump ends the performance before the jump is taken. `toCodas`
 * holds the to-coda jump written on each measure.
 */
function replayEnd(
  measures: readonly ReadGlobalMeasure[],
  toCodas: readonly (ReadJump | undefined)[],
  from: Point,
): ReplayEnd {
  const met = (index: number, location: Fraction): boolean =>
    index > from.index || compareFractions(location, from.location) >= 0
  for (const [offset, { fine: written }] of measures.slice(from.index).entries()) {
    const index = from.index + offset
    const fine = written && met(index, written.value.location) ? written : undefined
    const jump = toCodas[index]
    const toCoda = jump && met(index, jump.location) ? jump : undefined
    if (fine && (!toCoda || compareFractions(fine.value.location, toCoda.location) <= 0)) {
      return 'fine'
    }
    if (toCoda) return 'toCoda'
  }
  return 'none'
}

/**
 * Where a jump goes back to, and why it cannot be told
 * where the source does not settle it. A score drawing one sign settles it
 * whatever either is called, since there is nothing to confuse it with. A
 * score drawing none is taken from its start, which is where a player with no
 * sign to find would go. Past that the name decides, and a name matching no
 * sign leaves the jump alone rather than guessing between them.
 */
function segnoReturnedTo(
  signs: readonly Sign[],
  target: string | undefined,
): { from: Point | undefined; unresolved: string | undefined } {
  if (signs.length === 0) {
    return {
      from: START,
      unresolved:
        'This dal segno jump returns to a segno, but the score draws none. The jump is ' +
        'converted as a da capo jump, which returns to the start of the score.',
    }
  }
  if (signs.length === 1) return { from: signs[0], unresolved: undefined }
  const from = signs.find((sign) => sign.name === target)
  if (from !== undefined) return { from, unresolved: undefined }
  return {
    from,
    unresolved:
      target === undefined
        ? 'This dal segno jump names no segno, and the score draws several. The jump is ' +
          'not converted.'
        : `This dal segno jump returns to the segno "${target}", which is none of the ` +
          'segnos the score draws. The jump is not converted.',
  }
}
