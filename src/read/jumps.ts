// Settling each jump once the whole score is known: whether a D.C. or a D.S.
// is al Fine or al Coda.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { GlobalMeasure, JumpType } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { Stated } from './element.js'
import type { ReadGlobalMeasure, ReadJump, UndrawnSign } from './globalMeasures.js'

/** A point in the score: a measure index and a location in that measure. */
interface Point {
  readonly index: number
  readonly location: Fraction
}

const START: Point = { index: 0, location: fraction(0) }

/**
 * Where a jump to a segno or a coda goes: the one the score draws, or a mark
 * for playback only where it draws none.
 */
type Destination = Point | 'undrawn'

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
 * MNX states a jump that goes to a segno, a coda or a Fine only in a score
 * with exactly one of it, so a score with none or several is refused.
 */
export function settleJumps(
  measures: readonly ReadGlobalMeasure[],
  /** The signs each part marks only for playback, by part and then by measure. */
  undrawn: readonly (readonly (readonly Stated<UndrawnSign>[])[])[],
  warnings: WarningCollector,
  path: DocumentPath,
): GlobalMeasure[] {
  const marked = (kind: UndrawnSign['kind']) =>
    undrawn.some((part) => part.some((marks) => marks.some(({ value }) => value.kind === kind)))
  const destination = (kind: UndrawnSign['kind'], placed: PlacedJump) =>
    onlySign(measures, kind, marked(kind), placed, path)
  const toCodas = measures.map(({ jump, number }, index) => {
    if (jump?.value.sound !== 'tocoda') return undefined
    if (destination('coda', { jump, index, label: number?.value }) !== 'undrawn') {
      return jump.value
    }
    reportUndrawn('coda', jump, index, warnings)
    return undefined
  })
  const replays = measures.map(({ jump, number }, index) => {
    if (jump?.value.sound === 'dacapo') {
      return { settled: SETTLED.dacapo, ...replayEnd(measures, toCodas, START) }
    }
    if (jump?.value.sound !== 'dalsegno') return undefined
    const segno = destination('segno', { jump, index, label: number?.value })
    if (segno === 'undrawn') {
      reportUndrawn('segno', jump, index, warnings)
      return undefined
    }
    return { settled: SETTLED.dalsegno, ...replayEnd(measures, toCodas, segno) }
  })
  requireOneFine(measures, replays, path)

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
    ) => {
      const replay = replays[index]
      const type = toCodas[index] ? 'toCoda' : replay?.settled[replay.end]
      return {
        ...measure,
        tempos: tempos.map((tempo) => tempo.value),
        number: number?.value,
        barline: barline?.value,
        repeatEnd: repeatEnd?.value,
        ending: ending?.value,
        fermata: fermata?.value,
        segno: segno && {
          location: segno.value.location,
          glyph: segno.value.glyph,
          color: segno.value.color,
        },
        coda: coda && {
          location: coda.value.location,
          glyph: coda.value.glyph,
          color: coda.value.color,
        },
        fine: fine?.value,
        jump: jump && type && { location: jump.value.location, type },
        multimeasureRest: multimeasureRest?.value,
      }
    },
  )
}

const JUMP_NAMES: Readonly<Record<UndrawnSign['kind'], string>> = {
  segno: 'dal segno',
  coda: 'to-coda',
}

/** A jump, where it stands, and the label of its measure. */
interface PlacedJump {
  readonly jump: Stated<ReadJump>
  readonly index: number
  readonly label: number | undefined
}

/** The first jump that `matches` takes, in score order. */
function firstJump(
  measures: readonly ReadGlobalMeasure[],
  matches: (jump: ReadJump, index: number) => boolean,
): PlacedJump | undefined {
  return measures
    .flatMap(({ jump, number }, index) =>
      jump && matches(jump.value, index) ? [{ jump, index, label: number?.value }] : [],
    )
    .at(0)
}

/**
 * Where a jump to a segno or a coda goes: the one sign of that kind the score
 * draws. A score drawing none marks one for playback only, or has nowhere for
 * the jump to go.
 */
function onlySign(
  measures: readonly ReadGlobalMeasure[],
  kind: UndrawnSign['kind'],
  marked: boolean,
  placed: PlacedJump,
  path: DocumentPath,
): Destination {
  const drawn = measures.flatMap((measure, index) => {
    const sign = measure[kind]?.value
    return sign ? [{ index, location: sign.location }] : []
  })
  const [only, ...others] = drawn
  if (only !== undefined && others.length === 0) return only
  if (only === undefined && marked) return 'undrawn'
  const name = JUMP_NAMES[kind]
  throw refusal(
    `The score has a ${name} jump and draws ${counted(drawn.length, kind)}. MNX requires ` +
      `exactly one ${kind} in a score with a ${name} jump.`,
    placed,
    path,
  )
}

/** Refuses a score whose replays stop at a Fine where it has more than one. */
function requireOneFine(
  measures: readonly ReadGlobalMeasure[],
  replays: readonly ({ end: ReplayEnd } | undefined)[],
  path: DocumentPath,
): void {
  const first = firstJump(measures, (_, index) => replays[index]?.end === 'fine')
  const fines = measures.filter((measure) => measure.fine !== undefined).length
  if (first === undefined || fines === 1) return
  throw refusal(
    `The score has an al Fine jump and ${counted(fines, 'Fine')}. MNX requires exactly ` +
      'one Fine in a score with an al Fine jump.',
    first,
    path,
  )
}

function counted(count: number, kind: string): string {
  return count === 0 ? `no ${kind}` : `${String(count)} ${kind}s`
}

function refusal(message: string, { jump, index, label }: PlacedJump, path: DocumentPath) {
  return new MusicXMLError(message, {
    path: [...path, `measure ${String(label ?? index + 1)}`],
    line: jump.element.line,
  })
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
): { end: ReplayEnd } {
  const met = (index: number, location: Fraction): boolean =>
    index > from.index || compareFractions(location, from.location) >= 0
  for (const [offset, { fine: written }] of measures.slice(from.index).entries()) {
    const index = from.index + offset
    const fine = written && met(index, written.value.location) ? written : undefined
    const jump = toCodas[index]
    const toCoda = jump && met(index, jump.location) ? jump : undefined
    if (fine && (!toCoda || compareFractions(fine.value.location, toCoda.location) <= 0)) {
      return { end: 'fine' }
    }
    if (toCoda) return { end: 'toCoda' }
  }
  return { end: 'none' }
}
