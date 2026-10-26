// Settling each jump once the whole score is known: which segno a D.S. returns
// to, and whether a D.C. or a D.S. is al Fine or al Coda.

import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { GlobalMeasure, JumpType } from '../model/score.js'
import type { WarningCollector, WarningPlace } from './collector.js'
import type { Stated } from './element.js'
import type { ReadGlobalMeasure, ReadJump, UndrawnSign } from './globalMeasures.js'

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
  /** The signs each part marks only for playback, by part and then by measure. */
  undrawn: readonly (readonly (readonly Stated<UndrawnSign>[])[])[],
  warnings: WarningCollector,
): GlobalMeasure[] {
  const unseen = undrawnSigns(measures, undrawn)
  const segnos = signsOf(measures, 'segno')
  const toSegnos = segnosResolved(measures, segnos, unseen.segno, warnings)
  // The segno kept waits on the coda, which says where each replay ends, but
  // its reports come first.
  const segnoReports = warnings.reserve()
  const goesTo = codasGoneTo(measures, unseen.coda, warnings)
  const toCodas = goesTo.to.map((to, index) => (to ? measures[index]?.jump?.value : undefined))
  const replaysFrom = (returnsTo: readonly (Point | undefined)[]) =>
    measures.map(({ jump }, index): Replay | undefined => {
      if (jump?.value.sound === 'dacapo') {
        return { settled: SETTLED.dacapo, ...replayEnd(measures, toCodas, START) }
      }
      const from = returnsTo[index]
      if (from === undefined) return undefined
      // MNX states a jump to a segno only in a score with one, so a D.S. with
      // no segno to find is written as the D.C. a player takes.
      const settled = from === START ? SETTLED.dacapo : SETTLED.dalsegno
      return { settled, ...replayEnd(measures, toCodas, from) }
    })
  const fines = signsOf(measures, 'fine')
  const finesStoppedAt = (replays: readonly (Replay | undefined)[]) =>
    replays.map((replay) => fines.find((fine) => fine.index === replay?.fine))
  // The number of D.C. and D.S. jumps kept where only this segno is.
  const keptWith = (segno: Sign): number => {
    const replays = replaysFrom(toSegnos.map((to) => (to === segno ? to : undefined)))
    const fine = mostGoneTo(fines, finesStoppedAt(replays))
    return replays.filter(
      (replay) => replay !== undefined && (replay.end !== 'fine' || replay.fine === fine?.index),
    ).length
  }
  const returns = keepOne(
    measures,
    'segno',
    segnos,
    toSegnos,
    warnings,
    segnoKept(segnos, toSegnos, keptWith),
    segnoReports,
  )
  const replays = replaysFrom(returns.to)
  const stopsAt = keepOne(measures, 'fine', fines, finesStoppedAt(replays), warnings)
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
function segnosResolved(
  measures: readonly ReadGlobalMeasure[],
  signs: readonly Sign[],
  undrawn: readonly Sign[],
  warnings: WarningCollector,
): (Point | undefined)[] {
  return measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'dalsegno') return undefined
    if (goesToUndrawn(signs, undrawn, jump.value.target)) {
      reportUndrawn('segno', jump, index, warnings)
      return undefined
    }
    const { from, unresolved } = segnoReturnedTo(signs, jump.value.target, index)
    if (unresolved !== undefined) {
      warnings.add('unresolved:segno', unresolved, { measure: index + 1 }, jump.element, 'dalsegno')
    }
    return from
  })
}

/**
 * The segno to keep in a score that draws several: the one most D.S. jumps
 * return to. A D.S. kept with it can still be lost where it stops at a Fine
 * that is not kept, so a segno that keeps more jumps once the Fine is chosen
 * wins. As many kept keeps the one most jumps return to.
 */
function segnoKept(
  segnos: readonly Sign[],
  returnsTo: readonly (Point | undefined)[],
  keptWith: (segno: Sign) => number,
): Sign | undefined {
  let kept = mostGoneTo(segnos, returnsTo)
  if (kept === undefined || segnos.length === 1) return kept
  let most = keptWith(kept)
  for (const segno of segnos) {
    if (!returnsTo.includes(segno)) continue
    const count = keptWith(segno)
    if (count > most) [kept, most] = [segno, count]
  }
  return kept
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
  undrawn: readonly Sign[],
  warnings: WarningCollector,
): Destinations {
  const signs = signsOf(measures, 'coda')
  const resolved = measures.map(({ jump }, index) => {
    if (jump?.value.sound !== 'tocoda') return undefined
    const { target, location } = jump.value
    const after = (sign: Sign) =>
      sign.index > index || (sign.index === index && compareFractions(sign.location, location) >= 0)
    if (goesToUndrawn(signs, undrawn.filter(after), target)) {
      reportUndrawn('coda', jump, index, warnings)
      return undefined
    }
    const byName = signs.filter((sign) => sign.name === target)
    const unnamed = signs.filter((sign) => sign.name === undefined)
    const named = signs.length === 1 ? signs : byName.length > 0 ? byName : unnamed
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

/**
 * The segnos and codas the parts mark only for playback, where no part draws
 * a sign of that kind on the measure.
 */
function undrawnSigns(
  measures: readonly ReadGlobalMeasure[],
  undrawn: readonly (readonly (readonly Stated<UndrawnSign>[])[])[],
): Record<UndrawnSign['kind'], Sign[]> {
  const signs: Record<UndrawnSign['kind'], Sign[]> = { segno: [], coda: [] }
  for (const part of undrawn) {
    part.forEach((marks, index) => {
      for (const { value } of marks) {
        if (measures[index]?.[value.kind] !== undefined) continue
        signs[value.kind].push({ index, location: value.location, name: value.name })
      }
    })
  }
  return signs
}

/**
 * Whether a jump goes to a sign marked only for playback. One drawn sign with
 * no name settles every jump, as it does among drawn signs. Past that, the
 * jump goes to an undrawn sign where it names one and no drawn sign has that
 * name, or, in a score that draws none, where it names none.
 */
function goesToUndrawn(
  signs: readonly Sign[],
  undrawn: readonly Sign[],
  target: string | undefined,
): boolean {
  if (undrawn.length === 0) return false
  if (signs.length === 1 && signs[0]?.name === undefined) return false
  const named = undrawn.some((sign) => sign.name === target)
  if (signs.length === 0) return target === undefined || named
  return named && signs.every((sign) => sign.name !== target)
}

function reportUndrawn(
  kind: UndrawnSign['kind'],
  jump: Stated<ReadJump>,
  index: number,
  warnings: WarningCollector,
): void {
  const goes = kind === 'segno' ? 'This dal segno jump returns to' : 'This to-coda jump goes on to'
  warnings.add(
    'unrepresentable:undrawn-destination',
    `${goes} a ${kind} the score marks only for playback, with <sound ${kind}>, and does ` +
      `not draw. MNX states a ${kind} only as a drawn sign, so the jump is not converted.`,
    { measure: index + 1 },
    jump.element,
    jump.value.sound,
  )
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
 * it. The sign most jumps go to is kept, unless `kept` names another. The
 * others, and the jumps that go to them, are not converted. As many jumps
 * going to each keeps the first. The reports go at `place`, where given.
 */
function keepOne(
  measures: readonly ReadGlobalMeasure[],
  kind: Destination,
  signs: readonly Sign[],
  resolved: readonly (Point | undefined)[],
  warnings: WarningCollector,
  kept = mostGoneTo(signs, resolved),
  place?: WarningPlace,
): Destinations {
  if (kept === undefined) return { to: resolved, keeps: () => true }
  const report = NOT_KEPT[kind]
  for (const sign of signs) {
    const drawn = measures[sign.index]?.[kind]
    if (sign === kept || drawn === undefined) continue
    warnings.addAt(
      place ?? warnings.reserve(),
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
    warnings.addAt(
      place ?? warnings.reserve(),
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
 *
 * Many sources give every segno one name, and a score in sections draws one
 * in each. Among the segnos of its name, or the unnamed ones for a jump that
 * names none, a jump returns to the nearest in an earlier measure. One in the jump's own measure is drawn beside the D.S.,
 * not returned to. With none in an earlier measure, the first is taken.
 */
function segnoReturnedTo(
  signs: readonly Sign[],
  target: string | undefined,
  index: number,
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
  const named = signs.filter((sign) => sign.name === target)
  const from = named.filter((sign) => sign.index < index).at(-1) ?? named[0]
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
