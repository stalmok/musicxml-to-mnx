// The segno and jump as the reader holds them. MNX names neither the sign nor
// the sign a jump returns to, so the model carries no name. The reader needs
// both to tell which segno a D.S. goes back to, and drops them once that is
// settled.

import type { Fraction } from '../fraction.js'
import type { GlobalMeasure, Segno } from '../model/score.js'

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

/** A score measure while the parts are merged, before jumps are settled. */
export type ReadGlobalMeasure = Omit<GlobalMeasure, 'segno' | 'jump'> & {
  readonly segno: NamedSegno | undefined
  readonly jump: DalSegno | undefined
}

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
export function settleJumps(measures: readonly ReadGlobalMeasure[]): GlobalMeasure[] {
  const signs = measures.flatMap((measure, index) =>
    measure.segno ? [{ index, name: measure.segno.name }] : [],
  )
  const reachesFine = (jump: DalSegno): boolean => {
    const from = segnoReturnedTo(signs, jump.target)
    // A Fine at or after the sign is reached on the way back through.
    return from !== undefined && measures.some((m, i) => i >= from && m.fine !== undefined)
  }

  return measures.map(({ segno, jump, ...measure }) => ({
    ...measure,
    segno: segno && { location: segno.location, glyph: segno.glyph, color: segno.color },
    jump: jump && { location: jump.location, type: reachesFine(jump) ? 'dsalfine' : 'segno' },
  }))
}

/**
 * Where a jump goes back to, as a measure index. A score drawing one sign
 * settles it whatever either is called, since there is nothing to confuse it
 * with. A score drawing none is taken from its start, which is where a player
 * with no sign to find would go. Past that the name decides, and a name
 * matching no sign leaves the jump alone rather than guessing between them.
 */
function segnoReturnedTo(
  signs: readonly { index: number; name: string | undefined }[],
  target: string | undefined,
): number | undefined {
  if (signs.length === 0) return 0
  if (signs.length === 1) return signs[0]?.index
  return signs.find((sign) => sign.name === target)?.index
}
