// The instrument transposition of one part, as its measures are read.
//
// MusicXML writes one <transpose> per staff, told apart by a "number"
// attribute, and can change it at any <attributes>. MNX states one for the
// part. Each staff keeps the last one given to it, and a staff given none
// sounds as written. The pitches follow the first staff that is given one.
//
// A part that changes instrument partway keeps the first transposition in
// force at a pitched note, and reports the change. A part with no pitched
// note keeps the one its first key is converted with, or else the last one in
// force. Together, the <transpose> statements before that point state where
// the part starts, however many <attributes> they take.

import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { Pitch, Transposition } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import type { Stated } from './element.js'
import { concertFifths, soundingPitch, writtenFifths } from './transposition.js'

/** One <transpose>, with the staff it names, if any. */
export interface StatedTransposition {
  readonly value: Transposition
  readonly staff: number | undefined
  readonly element: XmlElement
}

/** A key converted before the part is fixed, with the transposition it was converted with. */
interface UnfixedKey {
  readonly transposition: Transposition | undefined
  readonly place: WarningPlace
  readonly context: ReportContext
  readonly element: XmlElement
}

/** Where the reports about a measure's <transpose> statements go, once it is read. */
interface MeasureCheck {
  readonly place: WarningPlace
  readonly context: ReportContext
  /**
   * The measure's first <transpose>, or the <staves> that changed the
   * transposition in force where the measure states none.
   */
  element: XmlElement
  /** Every <transpose> the measure states. */
  readonly stated: Set<XmlElement>
  /**
   * The measure's first <transpose> or <staves> that puts the part in a
   * transposition other than the one it is written out in.
   */
  change: XmlElement | undefined
}

const CONCERT_PITCH: Transposition = { staffDistance: 0, halfSteps: 0, keyFifthsFlipAt: undefined }

export class PartTransposition {
  /**
   * The transposition in force now. Every pitch is carried by it to what the
   * instrument sounds, and the key signature to the key the music sounds in.
   * Undefined at concert pitch.
   */
  #inForce: Transposition | undefined
  /**
   * The one written out. Undefined until the part is fixed; a value of
   * undefined is concert pitch.
   */
  #fixed: { value: Transposition | undefined } | undefined
  #unfixedKeys: UnfixedKey[] = []
  /**
   * What a <transpose> naming no staff gave. It gives every staff, including
   * any the part adds later, and clears what single staves were given before.
   */
  #every: Stated<Transposition> | undefined
  #staves = new Map<number, Stated<Transposition>>()
  #check: MeasureCheck | undefined

  /**
   * The pitch a written note sounds, by the transposition in force. The part
   * is fixed in that transposition at its first pitched note.
   */
  sounding(written: Pitch, warnings: WarningCollector): Pitch {
    this.#fix(warnings, this.#inForce)
    return this.#inForce ? soundingPitch(written, this.#inForce) : written
  }

  /** The key the music sounds in, from the fifths the part writes now. */
  concertFifths(written: number): number {
    return this.#inForce ? concertFifths(written, this.#inForce) : written
  }

  /** How many staff steps the part writes a pitch above the one it sounds now. */
  get staffDistance(): number {
    return this.#inForce?.staffDistance ?? 0
  }

  /**
   * Records a key converted now, to be checked against the transposition the
   * part is fixed in. A key converted once the part is fixed is converted
   * with that one.
   */
  keyConverted(place: WarningPlace, context: ReportContext, element: XmlElement): void {
    if (!this.#fixed) {
      this.#unfixedKeys.push({ transposition: this.#inForce, place, context, element })
    }
  }

  /**
   * Takes in the <transpose> statements of one <attributes> block, in a part
   * of `staves` staves. `resized` is a <staves> in the same block, which can
   * drop the staff the notes follow. A block that drops it and states a
   * <transpose> is read as one step.
   */
  takeStatements(
    stated: readonly StatedTransposition[],
    resized: XmlElement | undefined,
    staves: number,
    warnings: WarningCollector,
    context: ReportContext,
  ): void {
    const [opening] = stated
    if (!opening) {
      if (resized === undefined) return
      const change = this.#follow(staves, resized)
      if (change) this.#measureCheck(warnings, context, resized).change ??= change
      return
    }

    for (const { value, staff, element } of stated) {
      if (staff === undefined) {
        this.#every = { value, element }
        this.#staves.clear()
      } else {
        this.#staves.set(staff, { value, element })
      }
    }
    const check = this.#measureCheck(warnings, context, opening.element)
    // A <staves> earlier in the measure may have opened the check.
    if (check.stated.size === 0) check.element = opening.element
    for (const { element } of stated) check.stated.add(element)
    check.change ??= this.#follow(staves, opening.element)
  }

  /**
   * Drops what each staff past `staves` was given. Added back, such a staff
   * takes the one every staff has.
   */
  dropStaves(staves: number): void {
    for (const staff of this.#staves.keys()) if (staff > staves) this.#staves.delete(staff)
  }

  /**
   * Reports what the <transpose> statements of a measure leave unconvertible,
   * once the measure is read: a source can give each staff its own in
   * separate <attributes>. Staves transposed by different intervals are
   * reported at the <transpose> of this measure given to the first staff that
   * differs, or at the measure's first <transpose> where that staff was given
   * none here. A <transpose> that puts the part in a transposition other than
   * the one it is written out in changes instrument. The first such
   * <transpose> of the measure is reported, even where a later one changes
   * back.
   */
  settleMeasure(staves: number, warnings: WarningCollector): void {
    const check = this.#check
    if (check === undefined) return
    this.#check = undefined

    const given = this.#given(staves)
    const first = given[0]?.value ?? CONCERT_PITCH
    const differing = given.findIndex(
      (one) => !sameTransposition(one?.value ?? CONCERT_PITCH, first),
    )
    if (differing !== -1) {
      const named = given[differing]?.element
      warnings.addAt(
        check.place,
        'unrepresentable:per-staff-transposition',
        'The staves of this part are transposed by different intervals, and MNX states one ' +
          'for the part. The notes follow the first staff that is given one.',
        check.context,
        named !== undefined && check.stated.has(named) ? named : check.element,
      )
    }

    if (check.change !== undefined) {
      warnings.addAt(
        check.place,
        'unrepresentable:transposition-change',
        'A part changes instrument partway, and MNX states one transposition for the part. ' +
          'The one in force at the first pitched note is written out; the notes sound as each ' +
          'instrument plays them.',
        check.context,
        check.change,
      )
    }
  }

  /**
   * The transposition the part is written out in, once the whole part is
   * read. A part with no pitched note is fixed in the transposition of its
   * first key, which writes that key as the source states it.
   */
  finish(warnings: WarningCollector): Transposition | undefined {
    const [firstKey] = this.#unfixedKeys
    return this.#fix(warnings, firstKey ? firstKey.transposition : this.#inForce)
  }

  /**
   * Fixes the part in `transposition`, unless it is fixed already, and gives
   * the one it is fixed in. A key converted before then with a transposition
   * that writes other fifths is written out in a key the source does not
   * state, so the first such key is reported.
   */
  #fix(
    warnings: WarningCollector,
    transposition: Transposition | undefined,
  ): Transposition | undefined {
    if (this.#fixed) return this.#fixed.value
    this.#fixed = { value: transposition }
    const fifths = writtenFifths(0, transposition)
    const differing = this.#unfixedKeys.find(
      (key) => writtenFifths(0, key.transposition) !== fifths,
    )
    this.#unfixedKeys = []
    if (differing !== undefined) {
      warnings.addAt(
        differing.place,
        'unrepresentable:transposition-change',
        'MNX states one transposition for a part, and this key is written in another one. ' +
          "It is written out in the part's transposition, which gives it other fifths.",
        differing.context,
        differing.element,
      )
    }
    return transposition
  }

  #measureCheck(
    warnings: WarningCollector,
    context: ReportContext,
    element: XmlElement,
  ): MeasureCheck {
    return (this.#check ??= {
      place: warnings.reserve(),
      context,
      element,
      stated: new Set(),
      change: undefined,
    })
  }

  /**
   * Moves the notes to the transposition of the first staff given one. Where
   * that changes the part to a transposition other than the one it is
   * written out in, returns what to report the change at: the <transpose>
   * now in force, or `cause` where no staff is given one.
   */
  #follow(staves: number, cause: XmlElement): XmlElement | undefined {
    const before = this.#inForce ?? CONCERT_PITCH
    const inForce = this.#given(staves).find((one) => one !== undefined)
    this.#inForce = inForce?.value
    const now = inForce?.value ?? CONCERT_PITCH
    const first = this.#fixed
    if (first === undefined || sameTransposition(before, now)) return undefined
    if (sameTransposition(first.value ?? CONCERT_PITCH, now)) return undefined
    return inForce?.element ?? cause
  }

  /** What each staff of the part was last given, by staff number from one. */
  #given(staves: number): (Stated<Transposition> | undefined)[] {
    return Array.from({ length: staves }, (_, i) => this.#staves.get(i + 1) ?? this.#every)
  }
}

function sameTransposition(one: Transposition, other: Transposition): boolean {
  return one.staffDistance === other.staffDistance && one.halfSteps === other.halfSteps
}
