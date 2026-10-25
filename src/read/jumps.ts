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

/** A segno, a coda or a Fine, with the name the source gives it. */
interface Sign extends Point {
  readonly name: string | undefined
}

/** The marks on a measure that a jump goes to or stops at. */
type Destination = 'segno' | 'coda' | 'fine'

/** What stops a replay: a Fine, a to-coda jump, or neither. */
type ReplayEnd = 'fine' | 'toCoda' | 'none'

/** A D.C. or D.S. replay, and the measure of the Fine that stops it. */
interface Replay {
  readonly settled: Record<ReplayEnd, JumpType>
  readonly end: ReplayEnd
  readonly fine?: number
}

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
 *
 * MNX states a jump that goes to a segno, a coda or a Fine only in a score
 * with exactly one of it, so a score with several keeps one. See keepOne.
 */
export function settleJumps(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): GlobalMeasure[] {
  const returns = segnosReturnedTo(measures, warnings)
  const goesTo = codasGoneTo(measures, warnings)
  const toCodas = goesTo.to.map((to, index) => (to ? measures[index]?.jump?.value : undefined))
  const replays = measures.map(({ jump }, index): Replay | undefined => {
    if (jump?.value.sound === 'dacapo') {
      return { settled: SETTLED.dacapo, ...replayEnd(measures, toCodas, START) }
    }
    const from = returns.to[index]
    if (from === undefined) return undefined
    // MNX states a jump to a segno only in a score with one, so a D.S. with
    // no segno to find is written as the D.C. a player takes.
    const settled = from === START ? SETTLED.dacapo : SETTLED.dalsegno
    return { settled, ...replayEnd(measures, toCodas, from) }
  })
  const fines = signsOf(measures, 'fine')
  const stopsAt = keepOne(
    measures,
    'fine',
    fines,
    replays.map((replay) => fines.find((fine) => fine.index === replay?.fine)),
    warnings,
  )
  const typeOf = (jump: ReadJump, index: number): JumpType | undefined => {
    if (jump.sound === 'tocoda') return toCodas[index] && 'toCoda'
    const replay = replays[index]
    if (replay === undefined || (replay.end === 'fine' && stopsAt.to[index] === undefined)) {
      return undefined
    }
    return replay.settled[replay.end]
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
      fine: stopsAt.keeps(index) ? fine?.value : undefined,
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
 * called. Past that the name decides, as it does for a segno. Where no coda
 * has the jump's name, the codas with no name are the ones it can go to: many
 * sources name the jump and not the sign. A to-coda jump goes on through the
 * score, so among the codas it can go to it goes to the first after it.
 */
function codasGoneTo(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): Destinations {
  const signs = signsOf(measures, 'coda')
  const resolved = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'tocoda') return undefined
    const { target, location } = jump.value
    const byName = signs.filter((sign) => sign.name === target)
    const unnamed = signs.filter((sign) => sign.name === undefined)
    const named = signs.length === 1 ? signs : byName.length > 0 ? byName : unnamed
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

function signsOf(measures: readonly ReadGlobalMeasure[], kind: Destination): Sign[] {
  return measures.flatMap((measure, index) => {
    const sign: { location: Fraction; name?: string } | undefined = measure[kind]?.value
    return sign ? [{ index, location: sign.location, name: sign.name }] : []
  })
}

const JUMP_NAMES: Readonly<Record<ReadJump['sound'], string>> = {
  dacapo: 'da capo',
  dalsegno: 'dal segno',
  tocoda: 'to-coda',
}

/** How a sign not kept, and a jump going to one, are reported. */
const NOT_KEPT: Readonly<
  Record<Destination, { sign: string; attribute?: string; jump: (name: string) => string }>
> = {
  segno: {
    sign:
      'The score draws more than one segno and has a dal segno jump, and MNX states one ' +
      'segno in such a score. The segno most jumps go to is kept, and this one is not ' +
      'converted.',
    jump: (name) =>
      `This ${name} jump goes to a segno other than the one kept, and MNX states one ` +
      'segno in a score with a dal segno jump. The jump is not converted.',
  },
  coda: {
    sign:
      'The score draws more than one coda and has a to-coda jump, and MNX states one ' +
      'coda in such a score. The coda most jumps go to is kept, and this one is not ' +
      'converted.',
    jump: (name) =>
      `This ${name} jump goes to a coda other than the one kept, and MNX states one coda ` +
      'in a score with a to-coda jump. The jump is not converted.',
  },
  fine: {
    sign:
      'The score has more than one Fine and an al Fine jump, and MNX states one Fine in ' +
      'such a score. The Fine most jumps stop at is kept, and this one is not converted.',
    attribute: 'fine',
    jump: (name) =>
      `This ${name} jump stops at a Fine other than the one kept, and MNX states one Fine ` +
      'in a score with an al Fine jump. The jump is not converted.',
  },
}

/**
 * MNX states a jump to a segno, a coda or a Fine only in a score with one of
 * it. The sign most jumps go to is kept. The others, and the jumps that go
 * to them, are not converted. As many jumps going to each keeps the first.
 */
function keepOne(
  measures: readonly ReadGlobalMeasure[],
  kind: Destination,
  signs: readonly Sign[],
  resolved: readonly (Point | undefined)[],
  warnings: WarningCollector,
): Destinations {
  const kept = mostGoneTo(signs, resolved)
  if (kept === undefined) return { to: resolved, keeps: () => true }
  const report = NOT_KEPT[kind]
  for (const sign of signs) {
    const drawn = measures[sign.index]?.[kind]
    if (sign === kept || drawn === undefined) continue
    warnings.add(
      'unrepresentable:jump-destination',
      report.sign,
      { measure: sign.index + 1 },
      drawn.element,
      report.attribute,
    )
  }
  const to = resolved.map((to, index) => {
    const written = measures[index]?.jump
    if (to === undefined || to === kept || written === undefined) return to
    warnings.add(
      'unrepresentable:jump-destination',
      report.jump(JUMP_NAMES[written.value.sound]),
      { measure: index + 1 },
      written.element,
      written.value.sound,
    )
    return undefined
  })
  return { to, keeps: (index) => index === kept.index }
}

/** The sign the most destinations name, the first of those named as often. */
function mostGoneTo<T>(signs: readonly T[], destinations: readonly unknown[]): T | undefined {
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
): Omit<Replay, 'settled'> {
  const met = (index: number, location: Fraction): boolean =>
    index > from.index || compareFractions(location, from.location) >= 0
  for (const [offset, { fine: written }] of measures.slice(from.index).entries()) {
    const index = from.index + offset
    const fine = written && met(index, written.value.location) ? written : undefined
    const jump = toCodas[index]
    const toCoda = jump && met(index, jump.location) ? jump : undefined
    if (fine && (!toCoda || compareFractions(fine.value.location, toCoda.location) <= 0)) {
      return { end: 'fine', fine: index }
    }
    if (toCoda) return { end: 'toCoda' }
  }
  return { end: 'none' }
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
