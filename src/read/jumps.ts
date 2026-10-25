// Settling each jump once the whole score is known: which segno a D.S. returns
// to, and whether a D.C. or a D.S. is al Fine or al Coda.

import { compareFractions } from '../fraction.js'
import type { GlobalMeasure, JumpType } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { Stated } from './element.js'
import type { ReadGlobalMeasure, ReadJump } from './globalMeasures.js'

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
 * from a segno written after a Fine never reaches it. Marking that jump
 * "dsAlFine" would say the piece ends somewhere it does not, so a score with
 * several signs is matched sign by sign, by the name MusicXML gives them.
 */
export function settleJumps(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): GlobalMeasure[] {
  const signs = measures.flatMap((measure, index) =>
    measure.segno ? [{ index, name: measure.segno.value.name }] : [],
  )
  const drawsCoda = measures.some((measure) => measure.coda !== undefined)
  const typeOf = ({ value, element }: Stated<ReadJump>, index: number): JumpType => {
    if (value.sound === 'tocoda') {
      if (!drawsCoda) {
        warnings.add(
          'unresolved:coda',
          'This to-coda jump goes on to a coda, but the score draws none. The jump is ' +
            'converted with no coda to go to.',
          { measure: index + 1 },
          element,
          'tocoda',
        )
      }
      return 'toCoda'
    }
    if (value.sound === 'dacapo') return SETTLED.dacapo[replayEnd(measures, 0)]
    const { from, unresolved } = segnoReturnedTo(signs, value.target)
    if (unresolved !== undefined) {
      warnings.add('unresolved:segno', unresolved, { measure: index + 1 }, element, 'dalsegno')
    }
    return SETTLED.dalsegno[from === undefined ? 'none' : replayEnd(measures, from)]
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
      segno: segno && {
        location: segno.value.location,
        glyph: segno.value.glyph,
        color: segno.value.color,
      },
      coda: coda?.value,
      fine: fine?.value,
      jump: jump && { location: jump.value.location, type: typeOf(jump, index) },
      multimeasureRest: multimeasureRest?.value,
    }),
  )
}

/**
 * The first Fine or to-coda jump a replay from the measure at `from` meets.
 * A player going back meets them in score order. A Fine written at the same
 * point as a to-coda jump ends the performance before the jump is taken.
 */
function replayEnd(measures: readonly ReadGlobalMeasure[], from: number): ReplayEnd {
  for (const { fine, jump } of measures.slice(from)) {
    const toCoda = jump?.value.sound === 'tocoda' ? jump.value : undefined
    if (fine && (!toCoda || compareFractions(fine.value.location, toCoda.location) <= 0)) {
      return 'fine'
    }
    if (toCoda) return 'toCoda'
  }
  return 'none'
}

/**
 * Where a jump goes back to, as a measure index, and why it cannot be told
 * where the source does not settle it. A score drawing one sign settles it
 * whatever either is called, since there is nothing to confuse it with. A
 * score drawing none is taken from its start, which is where a player with no
 * sign to find would go. Past that the name decides, and a name matching no
 * sign leaves the jump alone rather than guessing between them.
 */
function segnoReturnedTo(
  signs: readonly { index: number; name: string | undefined }[],
  target: string | undefined,
): { from: number | undefined; unresolved: string | undefined } {
  if (signs.length === 0) {
    return {
      from: 0,
      unresolved:
        'This dal segno jump returns to a segno, but the score draws none. The jump is ' +
        'converted with no segno to return to, and is settled as if it returned to the ' +
        'start of the score.',
    }
  }
  if (signs.length === 1) return { from: signs[0]?.index, unresolved: undefined }
  const from = signs.find((sign) => sign.name === target)?.index
  if (from !== undefined) return { from, unresolved: undefined }
  const plain = 'The jump is converted as a plain dal segno, not a D.S. al Fine or al Coda.'
  return {
    from,
    unresolved:
      target === undefined
        ? `This dal segno jump names no segno, and the score draws several. ${plain}`
        : `This dal segno jump returns to the segno "${target}", which is none of the ` +
          `segnos the score draws. ${plain}`,
  }
}
