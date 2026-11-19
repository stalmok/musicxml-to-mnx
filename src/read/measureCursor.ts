// MusicXML's cursor through one measure. Notes advance it, <backup> rewinds it
// so another voice can be written over the same span, and <forward> skips
// ahead.

import { addFractions, compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'

export class MeasureCursor {
  #at: Fraction = fraction(0)
  /**
   * The furthest the cursor has run in the measure, over notes, rests filling
   * the measure and <forward> alike: a <forward> is how MusicXML writes
   * silence it draws nothing for.
   */
  #furthest: Fraction = fraction(0)
  /**
   * The <backup> that carried the cursor before the measure start, held until
   * something is written out there or a <forward> brings the cursor back.
   */
  #reached: { warnings: WarningCollector; context: ReportContext; backup: XmlElement } | undefined

  /** Where the cursor stands, before the measure start where a <backup> took it there. */
  at(): Fraction {
    return this.#at
  }

  /**
   * Where the cursor has reached, from the start of the measure. A <backup>
   * that carried it before the start reads as the start, since nothing sounds
   * before a measure begins; the cursor itself is left where the source put
   * it, because a <forward> can still bring it back.
   */
  position(): Fraction {
    return compareFractions(this.#at, fraction(0)) < 0 ? fraction(0) : this.#at
  }

  /** The furthest the cursor has run in the measure. */
  furthest(): Fraction {
    return this.#furthest
  }

  /**
   * Moves the cursor, as <backup> and <forward> do.
   *
   * A <backup> reaching past the start of the measure is how exporters return
   * to the start of a measure a voice has not filled: the source backs up by
   * the whole measure's length whatever that voice wrote. Whatever is written
   * out there is written at the start instead.
   *
   * The cursor itself is left where the source put it, because a <forward>
   * can bring it back: sources write the pair to reach a point they draw at
   * the measure start. Taking the cursor to the start on the <backup> alone
   * would put everything after the <forward> that much later. The
   * <backup> that reached out is held rather than reported, so that a reach
   * a <forward> cancels is not reported and a reach several
   * <forward>s cancel is reported once.
   */
  shift(by: Fraction, warnings: WarningCollector, context: ReportContext, moved: XmlElement): void {
    this.advance(by)
    if (compareFractions(this.#at, fraction(0)) >= 0) {
      this.#reached = undefined
      return
    }
    this.#reached ??= { warnings, context, backup: moved }
  }

  /**
   * The cursor where something is about to be written, and where it then
   * stays: writing at the measure start settles what a <backup> reaching
   * past it meant, and no later <forward> can take that back. The reach is
   * reported here.
   */
  writeAt(): void {
    if (compareFractions(this.#at, fraction(0)) >= 0) return

    const reached = this.#reached
    /* v8 ignore next -- the cursor goes negative only through shift(). */
    if (reached) {
      reached.warnings.add(
        'inconsistent:backup',
        'A <backup> reaches back further than the measure has run, and the music written ' +
          'out there is written at the start of the measure instead.',
        reached.context,
        reached.backup,
      )
    }
    this.#reached = undefined
    this.#at = fraction(0)
  }

  advance(by: Fraction): void {
    this.moveTo(addFractions(this.#at, by))
  }

  moveTo(position: Fraction): void {
    this.#at = position
    if (compareFractions(position, this.#furthest) > 0) this.#furthest = position
  }

  /** Moves the cursor on without the measure growing by it. */
  skip(by: Fraction): void {
    this.#at = addFractions(this.#at, by)
  }
}
