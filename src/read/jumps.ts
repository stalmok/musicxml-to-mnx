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

/** A segno or a coda, with the name the source gives it. */
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
  const returns = segnosReturnedTo(measures, warnings)
  const goesTo = codasGoneTo(measures, warnings)
  const toCodas = goesTo.to.map((to, index) => (to ? measures[index]?.jump?.value : undefined))
  const typeOf = (jump: ReadJump, index: number): JumpType | undefined => {
    if (jump.sound === 'tocoda') return toCodas[index] && 'toCoda'
    if (jump.sound === 'dacapo') return SETTLED.dacapo[replayEnd(measures, toCodas, START)]
    const from = returns.to[index]
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
      coda:
        coda && goesTo.keeps(index)
          ? { location: coda.value.location, glyph: coda.value.glyph, color: coda.value.color }
          : undefined,
      fine: fine?.value,
      jump: jump && written(jump.value, typeOf(jump.value, index)),
      multimeasureRest: multimeasureRest?.value,
    }),
  )
}

function written(jump: ReadJump, type: JumpType | undefined): GlobalMeasure['jump'] {
  return type && { location: jump.location, type }
}

/** Where each measure's jump goes, and whether a measure's sign is kept. */
interface Destinations {
  readonly to: readonly (Point | undefined)[]
  readonly keeps: (index: number) => boolean
}

/**
 * Where each measure's D.S. returns to: a segno, the start of the score
 * where the score draws none, or nowhere where the jump is not converted.
 */
function segnosReturnedTo(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): Destinations {
  const signs = signsOf(measures, 'segno')
  const resolved = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'dalsegno') return undefined
    const { from, unresolved } = segnoReturnedTo(signs, jump.value.target)
    if (unresolved !== undefined) {
      warnings.add('unresolved:segno', unresolved, { measure: index + 1 }, jump.element, 'dalsegno')
    }
    return from
  })
  return keepOne(measures, 'segno', signs, resolved, warnings)
}

/**
 * Where each measure's to-coda jump goes: a coda, or nowhere where the jump
 * is not converted. A score drawing one coda settles it whatever either is
 * called. Past that the name decides, as it does for a segno. A to-coda jump
 * goes on through the score, so among codas sharing its name it goes to the
 * first after it.
 */
function codasGoneTo(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): Destinations {
  const signs = signsOf(measures, 'coda')
  const resolved = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'tocoda') return undefined
    const { target, location } = jump.value
    const named = signs.length === 1 ? signs : signs.filter((sign) => sign.name === target)
    const after = (sign: Sign) =>
      sign.index > index || (sign.index === index && compareFractions(sign.location, location) >= 0)
    const to = named.length === 1 ? named[0] : named.find(after)
    if (to !== undefined) return to
    warnings.add(
      'unresolved:coda',
      signs.length === 0
        ? 'This to-coda jump goes on to a coda, but the score draws none. The jump is ' +
            'not converted.'
        : target === undefined
          ? 'This to-coda jump names no coda, and the score draws several. The jump is ' +
            'not converted.'
          : named.length === 0
            ? `This to-coda jump goes on to the coda "${target}", which is none of the ` +
              'codas the score draws. The jump is not converted.'
            : `This to-coda jump goes on to the coda "${target}", but the score draws ` +
              'several codas of that name and none after the jump. The jump is not converted.',
      { measure: index + 1 },
      jump.element,
      'tocoda',
    )
    return undefined
  })
  return keepOne(measures, 'coda', signs, resolved, warnings)
}

function signsOf(measures: readonly ReadGlobalMeasure[], kind: 'segno' | 'coda'): Sign[] {
  return measures.flatMap((measure, index) => {
    const sign = measure[kind]?.value
    return sign ? [{ index, location: sign.location, name: sign.name }] : []
  })
}

const JUMP_TO: Readonly<Record<'segno' | 'coda', { name: string; attribute: string }>> = {
  segno: { name: 'dal segno', attribute: 'dalsegno' },
  coda: { name: 'to-coda', attribute: 'tocoda' },
}

/**
 * MNX states a jump to a segno only in a score with one segno, and a jump to
 * a coda only in a score with one coda. The sign most jumps go to is kept.
 * The others, and the jumps that go to them, are not converted. As many
 * jumps going to each keeps the first.
 */
function keepOne(
  measures: readonly ReadGlobalMeasure[],
  kind: 'segno' | 'coda',
  signs: readonly Sign[],
  resolved: readonly (Point | undefined)[],
  warnings: WarningCollector,
): Destinations {
  const kept = mostReturnedTo(signs, resolved)
  if (kept === undefined) return { to: resolved, keeps: () => true }
  const jump = JUMP_TO[kind]
  for (const sign of signs) {
    const drawn = measures[sign.index]?.[kind]
    if (sign === kept || drawn === undefined) continue
    warnings.add(
      'unrepresentable:jump-destination',
      `The score draws more than one ${kind} and has a ${jump.name} jump, and MNX states ` +
        `one ${kind} in such a score. The ${kind} most jumps go to is kept, and this one ` +
        'is not converted.',
      { measure: sign.index + 1 },
      drawn.element,
    )
  }
  const to = resolved.map((to, index) => {
    const written = measures[index]?.jump
    if (to === undefined || to === kept || written === undefined) return to
    warnings.add(
      'unrepresentable:jump-destination',
      `This ${jump.name} jump goes to a ${kind} other than the one kept, and MNX states ` +
        `one ${kind} in a score with a ${jump.name} jump. The jump is not converted.`,
      { measure: index + 1 },
      written.element,
      jump.attribute,
    )
    return undefined
  })
  return { to, keeps: (index) => index === kept.index }
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
