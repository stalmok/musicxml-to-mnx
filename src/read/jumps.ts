// The score's measure as the reader holds it while the parts are merged. MNX
// names neither the segno nor the sign a jump returns to, so the model carries
// no name. The reader needs both to tell which segno a D.S. goes back to, and
// drops them once that is settled.

import type { Fraction } from '../fraction.js'
import type { GlobalMeasure, Segno, Tempo } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { Stated } from './element.js'

export interface NamedSegno extends Segno {
  /** What the source calls this sign, where it names one. */
  readonly name?: string
}

/**
 * A dal-segno jump, the only jump the reader finds. Whether it is a D.S. al
 * Fine waits until the whole score is known.
 */
export interface DalSegno {
  /** Where in the measure it is taken, counting from the start. */
  readonly location: Fraction
  /** The name of the segno this jump returns to, where the source gives one. */
  readonly target?: string
}

/** The marks one part states on the score's measure. */
interface ReadMarks {
  readonly number: NonNullable<GlobalMeasure['number']>
  readonly barline: NonNullable<GlobalMeasure['barline']>
  readonly repeatEnd: NonNullable<GlobalMeasure['repeatEnd']>
  // Filled in once the part has met the ending's stop.
  ending: NonNullable<GlobalMeasure['ending']>
  readonly fermata: NonNullable<GlobalMeasure['fermata']>
  readonly segno: NamedSegno
  readonly fine: NonNullable<GlobalMeasure['fine']>
  readonly jump: DalSegno
  readonly multimeasureRest: NonNullable<GlobalMeasure['multimeasureRest']>
}

/**
 * A score measure while the parts are merged, before jumps are settled. Each
 * mark keeps the element that states it, for the warnings about parts that
 * disagree.
 */
export type ReadGlobalMeasure = Omit<GlobalMeasure, keyof ReadMarks | 'tempos'> & {
  [K in keyof ReadMarks]: Stated<ReadMarks[K]> | undefined
} & { readonly tempos: readonly Stated<Tempo>[] }

/**
 * A dal-segno jump returning to a Fine is a "D.S. al Fine": the player goes
 * back to the segno and stops at the Fine. MusicXML says the al-Fine only
 * through the Fine's presence, not on the <sound dalsegno> attribute, so each
 * jump is settled here once the whole score is known. MNX's jump-type enum
 * holds "dsalfine" for this.
 *
 * A Fine only stops a jump that returns to a sign standing before it: replay
 * from a segno written after the Fine never reaches it, and such a jump is a
 * D.S. al Coda or similar, which MNX's jump-type enum cannot state. Marking
 * one "dsalfine" would say the piece ends somewhere it does not, so a score
 * with several signs is matched sign by sign, by the name MusicXML gives them.
 */
export function settleJumps(
  measures: readonly ReadGlobalMeasure[],
  warnings: WarningCollector,
): GlobalMeasure[] {
  const signs = measures.flatMap((measure, index) =>
    measure.segno ? [{ index, name: measure.segno.value.name }] : [],
  )
  const reachesFine = ({ value, element }: Stated<DalSegno>, index: number): boolean => {
    const { from, unresolved } = segnoReturnedTo(signs, value.target)
    if (unresolved !== undefined) {
      warnings.add('unresolved:segno', unresolved, { measure: index + 1 }, element, 'dalsegno')
    }
    // A Fine at or after the sign is reached on the way back through.
    return from !== undefined && measures.some((m, i) => i >= from && m.fine !== undefined)
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
      fine: fine?.value,
      jump: jump && {
        location: jump.value.location,
        type: reachesFine(jump, index) ? 'dsalfine' : 'segno',
      },
      multimeasureRest: multimeasureRest?.value,
    }),
  )
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
        'converted with no segno to return to, and is ended by a Fine anywhere in the score.',
    }
  }
  if (signs.length === 1) return { from: signs[0]?.index, unresolved: undefined }
  const from = signs.find((sign) => sign.name === target)?.index
  if (from !== undefined) return { from, unresolved: undefined }
  const plain = 'The jump is converted as a plain dal segno, not a D.S. al Fine.'
  return {
    from,
    unresolved:
      target === undefined
        ? `This dal segno jump names no segno, and the score draws several. ${plain}`
        : `This dal segno jump returns to the segno "${target}", which is none of the ` +
          `segnos the score draws. ${plain}`,
  }
}
