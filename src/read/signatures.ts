// Settling key and time signatures. MusicXML states one per staff, anywhere
// in a measure, and in each part; MNX states one key and one time signature
// for the whole score, only where a measure begins. A measure collects every
// statement it reads, and settles them once it is whole. A statement after the
// start is held for the next measure, and what is still held at the end of
// the part is reported. The parts' keys and time signatures are then settled
// against each other.
//
// Before any part is read, every part's time signatures are read ahead, so a
// part that states none runs to the barline the other parts state.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
  negate,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { Key, TimeSignature, Transposition } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, requireChild, trimmedText } from '../xml/tree.js'
import { firstTimeStated } from './attributes.js'
import type { AttributesReading, StaffSignature } from './attributes.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import { lengthOf } from './duration.js'
import type { ReadGlobalMeasure } from './jumps.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseExactDecimal } from './numbers.js'
import type { HeldSignature, PartState } from './state.js'
import { keyFifthsFlipAt, writtenFifths, writtenFifthsWithFlip } from './transposition.js'

/**
 * A key or time signature stated after the start of a measure. A statement
 * MNX cannot carry, such as senza misura or a non-traditional key, states none.
 */
interface LateSignature<T> {
  value: T | undefined
  at: Fraction
  /** The <key> or <time> stating it. */
  element: XmlElement
}

/** What reports and compares a key or a time signature stated late. */
interface SignatureKind<T> {
  element: 'key' | 'time'
  /** What to call one of these in a report, where "key" alone is too short. */
  name: 'key' | 'time signature'
  /** Whether a statement says what another says, down to how it is drawn. */
  same: (a: T, b: T | undefined) => boolean
  /**
   * Whether two staves are in the same signature. Looser than `same` for a
   * time signature: 4/4 as a C and 4/4 as numbers are one meter drawn two
   * ways, which is not the staves disagreeing about the meter.
   */
  agrees: (a: T, b: T | undefined) => boolean
}

function sameMeter(a: TimeSignature, b: TimeSignature): boolean {
  return a.count === b.count && a.unit === b.unit
}

function sameTime(a: TimeSignature, b: TimeSignature | undefined): boolean {
  return b !== undefined && sameMeter(a, b) && a.display === b.display
}

const sameFifths = (a: Key, b: Key | undefined): boolean => b !== undefined && a.fifths === b.fifths

const KEY: SignatureKind<Key> = {
  element: 'key',
  name: 'key',
  same: sameFifths,
  agrees: sameFifths,
}

const TIME: SignatureKind<TimeSignature> = {
  element: 'time',
  name: 'time signature',
  same: sameTime,
  agrees: (a, b) => b !== undefined && sameMeter(a, b),
}

/**
 * What the blocks at one point of a measure state about one signature: the
 * place the report reads at, and every statement they make there.
 */
interface StatedAt<T> {
  at: Fraction
  place: WarningPlace
  /** The first statement, where staves that disagree are reported. */
  first: StaffSignature<T>
  statements: StaffSignature<T>[]
}

/** What a measure converts once its signatures are settled. */
export interface SettledSignatures {
  key: Key | undefined
  time: TimeSignature | undefined
}

/**
 * Every key and time signature one measure states, collected as the measure
 * is walked and settled once it is whole.
 */
export class MeasureSignatures {
  readonly #state: PartState
  readonly #warnings: WarningCollector
  readonly #context: ReportContext
  readonly #path: DocumentPath
  #key: Key | undefined
  #time: TimeSignature | undefined
  // Whether an <attributes> block has spoken on each. Kept apart from the
  // values, because a statement MNX cannot carry, such as senza misura or a
  // non-traditional key, reads as a statement with no value, and a later
  // block in the same measure may not overwrite it.
  #keySettled = false
  #timeSettled = false
  // Key and time signatures stated after the measure start.
  readonly #lateKeys: LateSignature<Key>[] = []
  readonly #lateTimes: LateSignature<TimeSignature>[] = []
  // Every key and time signature stated where the measure begins, whichever
  // block states it, settled once the measure is whole. Each is reported
  // through the place the first of them was read at, so the report still
  // reads where the source states it.
  readonly #keyGroups: StatedAt<Key>[] = []
  readonly #timeGroups: StatedAt<TimeSignature>[] = []
  // Every unmetered statement the measure makes, reported once the measure
  // has settled what it converts.
  readonly #unmetered: { place: WarningPlace; element: XmlElement }[] = []

  constructor(
    state: PartState,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
  ) {
    this.#state = state
    this.#warnings = warnings
    this.#context = context
    this.#path = path
  }

  /** Takes what one <attributes> block states, read at `at` in the measure. */
  add(reading: AttributesReading, at: Fraction): void {
    const atStart = compareFractions(at, fraction(0)) === 0
    const [firstKey] = reading.keys
    if (firstKey) {
      this.#statedAt(this.#keyGroups, at, firstKey).statements.push(...reading.keys)
      if (atStart) {
        if (!this.#keySettled) this.#key = reading.key
        this.#keySettled = true
      } else {
        this.#lateKeys.push({ value: reading.key, at, element: statingOf(reading.keys, firstKey) })
      }
    }
    // Taken after the key, and before the settlement of the time blocks
    // around it, so the reports of one block read in the order it states
    // them.
    for (const stated of reading.times) {
      if (stated.value === undefined) {
        this.#unmetered.push({
          place: this.#warnings.reserve(),
          element: requireChild(stated.element, 'senza-misura', this.#path),
        })
      }
    }
    const [firstTime] = reading.times
    if (firstTime) {
      this.#statedAt(this.#timeGroups, at, firstTime).statements.push(...reading.times)
      if (atStart) {
        // A second statement at the start changes nothing. A senza-misura
        // statement clears it: the music is unmetered from here on, whatever
        // was in force before.
        if (!this.#timeSettled) this.#time = reading.time
        this.#timeSettled = true
      } else {
        this.#lateTimes.push({
          value: reading.time,
          at,
          element: statingOf(reading.times, firstTime),
        })
      }
    }
  }

  /**
   * Settles what the measure converts and reports what it loses. `end` is
   * the furthest the measure's cursor ran.
   */
  settle(end: Fraction): SettledSignatures {
    const state = this.#state
    const warnings = this.#warnings
    const context = this.#context
    // Settled with the measure whole, so a staff stated in a block of its own
    // stands beside the staves the blocks around it state.
    for (const group of this.#keyGroups) {
      settleStated(KEY, group, this.#key, state.staves, state.staffKeys, warnings, context)
    }
    for (const group of this.#timeGroups) {
      settleStated(TIME, group, this.#time, state.staves, state.staffTimes, warnings, context)
    }

    // A measure stating none, or one MNX cannot carry, leaves the one before
    // in force.
    const key = opening(
      KEY,
      state.lateKey,
      { settled: this.#keySettled, value: this.#key },
      warnings,
    )
    state.convertedKey = key ?? state.convertedKey
    state.lateKey = holdLate(KEY, this.#lateKeys, state.convertedKey, end, warnings, context)
    const time = opening(
      TIME,
      state.lateTime,
      { settled: this.#timeSettled, value: this.#time },
      warnings,
    )
    state.convertedTime = time ?? state.convertedTime
    state.lateTime = holdLate(TIME, this.#lateTimes, state.convertedTime, end, warnings, context)

    // Unmetered music is a loss whatever the measure converts. What it says
    // depends on that: a measure stating a time signature beside the unmetered
    // one, and one carrying an unmetered statement past its start, are both
    // converted with a meter the music they cover does not have. Measured
    // against the meter in force, not the measure's own statement, because a
    // measure stating none keeps the one before it.
    for (const { place, element: senzaMisura } of this.#unmetered) {
      warnings.addAt(
        place,
        'unrepresentable:senza-misura',
        'This music is written senza misura, and MNX states meter as a time signature ' +
          `or nothing. The measure is converted with ${
            state.convertedTime ? 'the time signature in force' : 'no time signature'
          }.`,
        context,
        senzaMisura,
      )
    }

    return { key, time }
  }

  #statedAt<T>(groups: StatedAt<T>[], at: Fraction, first: StaffSignature<T>): StatedAt<T> {
    const opened = groups.find((group) => compareFractions(group.at, at) === 0)
    if (opened) return opened
    const group: StatedAt<T> = { at, place: this.#warnings.reserve(), first, statements: [] }
    groups.push(group)
    return group
  }
}

/**
 * Reports a key or time signature the part's last measure stated after its
 * start, which no measure is left to take.
 */
export function reportHeldAtPartEnd(state: PartState, warnings: WarningCollector): void {
  const outcome = 'This is the last measure of the part, so it is not converted.'
  if (state.lateKey) reportLate(KEY, state.lateKey, outcome, warnings)
  if (state.lateTime) reportLate(TIME, state.lateTime, outcome, warnings)
}

/**
 * The signature a measure opens with: its own, stated at its start, or else
 * the one the measure before held for it. The held one is reported where it
 * is a loss.
 */
function opening<T>(
  kind: SignatureKind<T>,
  held: HeldSignature<T> | undefined,
  own: { settled: boolean; value: T | undefined },
  warnings: WarningCollector,
): T | undefined {
  if (held && own.settled && !(own.value && kind.same(own.value, held.value))) {
    reportLate(kind, held, 'The next measure states its own, so it is not converted.', warnings)
  } else if (held?.partway) {
    reportLate(kind, held, 'It is converted at the next measure.', warnings)
  }
  return held && !own.settled ? held.value : own.value
}

/**
 * The last signature a measure stated after its start, held for the next
 * measure where it differs from the one MNX has in force. Each change before
 * it is replaced, and reported.
 */
function holdLate<T>(
  kind: SignatureKind<T>,
  lates: readonly LateSignature<T>[],
  inForce: T | undefined,
  end: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): HeldSignature<T> | undefined {
  const changes: LateSignature<T>[] = []
  let current = inForce
  for (const late of lates) {
    const restated = changes.at(-1)
    if (late.value === undefined || !kind.same(late.value, current)) changes.push(late)
    // The same change written again, as each voice may write it after a
    // <backup>. It stands where the earliest of them does.
    else if (restated && compareFractions(late.at, restated.at) < 0) {
      changes[changes.length - 1] = late
    }
    current = late.value
  }
  const held = ({ at, element }: LateSignature<T>, value: T): HeldSignature<T> => ({
    value,
    partway: compareFractions(at, end) < 0,
    context,
    element,
  })
  const last = changes.pop()
  for (const replaced of changes) {
    // One MNX cannot carry, such as senza misura, is reported where it is read.
    if (replaced.value === undefined) continue
    reportLate(
      kind,
      held(replaced, replaced.value),
      'A later one in this measure replaces it, so it is not converted.',
      warnings,
    )
  }
  if (!last || last.value === undefined || kind.same(last.value, inForce)) return undefined
  return held(last, last.value)
}

/**
 * Reports the staves of a part left in different signatures at one point, or
 * left with one where another has none. What each staff has in force is
 * carried in `inForce`, which these statements update.
 *
 * Taken together rather than block by block: MusicXML writes one <key> or
 * <time> per staff, and a measure may spread them over several <attributes>,
 * so a block stating one staff's is only partial until the others are seen.
 * A block with no number speaks for every staff, and a later statement for a
 * staff replaces the one before it. Every statement is read against the
 * staves the part had where it was made, not the count the measure ends on.
 *
 * Compared against what the staves carry, not against this point alone: a
 * measure restating for one staff what every staff already has leaves them
 * in the same signature, and loses nothing.
 */
function reportAcrossStaves<T>(
  kind: SignatureKind<T>,
  statements: readonly StaffSignature<T>[],
  staves: number,
  inForce: Map<number, T | undefined>,
  warnings: WarningCollector,
  context: ReportContext,
  opening: XmlElement,
  place: WarningPlace,
): void {
  const stated = new Set<number>()
  for (const statement of statements) {
    for (let staff = 1; staff <= statement.staves; staff += 1) {
      if (statement.staff === undefined || statement.staff === staff) {
        inForce.set(staff, statement.value)
        stated.add(staff)
      }
    }
  }
  // A staff the part gains after every statement here is not one they left
  // unstated: it takes the signature the part is in, which is the first
  // staff's, the one every other staff is compared against.
  const had = Math.max(...statements.map((statement) => statement.staves))
  for (let staff = had + 1; staff <= staves; staff += 1) {
    inForce.set(staff, inForce.get(1))
    stated.add(staff)
  }
  const values = Array.from({ length: staves }, (_unused, index) => inForce.get(index + 1))
  const first = values[0]
  if (
    !values.some((value) =>
      first === undefined ? value !== undefined : !kind.agrees(first, value),
    )
  ) {
    return
  }
  // Which of them is converted is left to the reports that settle each
  // statement. The one converted is the first MNX can state, not the first
  // stated: a staff written senza misura or in a non-traditional key states
  // one MNX cannot carry, and a later staff's stands instead.
  const disagreement =
    stated.size < staves
      ? `A ${kind.element} signature is stated for one staff and not the others, and MNX ` +
        'states one for the whole score.'
      : `The staves of this part are in different ${kind.name}s, and MNX states one ` +
        `${kind.name} for the score.`
  warnings.addAt(
    place,
    `unrepresentable:per-staff-${kind.element}`,
    `${disagreement} The one converted stands for every staff.`,
    context,
    opening,
  )
}

/**
 * Reports what a measure states about one signature where it begins, against
 * the one converted: the staves may leave one of their own unstated or
 * disagree, and what they state may not be what the measure converts, which
 * is the first stated there that MNX can state.
 *
 * The two answer different questions, so both are asked. Staves in different
 * signatures and a point contradicting itself are separate losses, and a
 * measure can hold one, the other, or both.
 */
function settleStated<T>(
  kind: SignatureKind<T>,
  group: StatedAt<T>,
  converted: T | undefined,
  staves: number,
  inForce: Map<number, T | undefined>,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  reportAcrossStaves(
    kind,
    group.statements,
    staves,
    inForce,
    warnings,
    context,
    group.first.element,
    group.place,
  )
  // Only what the measure opens with is settled against a converted value:
  // one stated after the start is carried to the next measure, and what
  // becomes of it is settled there.
  if (compareFractions(group.at, fraction(0)) !== 0) return
  const restated = restatement(group.statements)
  if (restated) {
    reportSecondAtStart(kind, converted, restated, warnings, context, group.place)
  }
}

/**
 * The last statement at one point, where it says again what an earlier one
 * there already said rather than narrowing it. One speaking for every staff
 * replaces every statement before it, and one naming a staff replaces the
 * statement that named the same staff. A statement naming a staff no earlier
 * one named refines the signature stated for every staff, which is how a
 * part states one and then changes a single staff's.
 */
function restatement<T>(statements: readonly StaffSignature<T>[]): StaffSignature<T> | undefined {
  const named = new Set<number | undefined>()
  let last: StaffSignature<T> | undefined
  for (const statement of statements) {
    last = statement.staff === undefined || named.has(statement.staff) ? statement : undefined
    named.add(statement.staff)
  }
  return last
}

/**
 * The <key> or <time> a block's signature is read from: the first statement
 * MNX can hold, or else the first.
 */
function statingOf<T>(statements: readonly StaffSignature<T>[], first: StaffSignature<T>) {
  return (statements.find((statement) => statement.value !== undefined) ?? first).element
}

/**
 * Reports a key or time signature stated again at the start of a measure,
 * differing from the first one stated there, which stands.
 */
function reportSecondAtStart<T>(
  kind: SignatureKind<T>,
  first: T | undefined,
  second: StaffSignature<T>,
  warnings: WarningCollector,
  context: ReportContext,
  place: WarningPlace,
): void {
  if (first === undefined ? second.value === undefined : kind.same(first, second.value)) return
  warnings.addAt(
    place,
    `inconsistent:${kind.element}`,
    `Two different ${kind.element} signatures are stated at the start of this measure. ` +
      'The later one is not converted.',
    context,
    second.element,
  )
}

function reportLate<T>(
  kind: SignatureKind<T>,
  late: HeldSignature<T>,
  outcome: string,
  warnings: WarningCollector,
): void {
  warnings.add(
    `unrepresentable:mid-measure-${kind.element}`,
    `A ${kind.element} signature is stated ${late.partway ? 'partway through' : 'at the end of'} this ` +
      `measure, and MNX states one only where a measure begins. ${outcome}`,
    late.context,
    late.element,
  )
}

/**
 * The time signature each measure of the score opens with, as the first part
 * stating one there has it. Takes each part's own, as timesInForce reads them.
 */
export function scoreTimesInForce(
  perPart: readonly (readonly (TimeSignature | undefined)[])[],
): (TimeSignature | undefined)[] {
  const longest = Math.max(0, ...perPart.map((times) => times.length))
  return Array.from({ length: longest }, (_, index) =>
    perPart.map((times) => times[index]).find((time) => time !== undefined),
  )
}

/**
 * The time signature each measure of a part opens with, read ahead of the
 * part itself: a statement at the start can follow notes written before a
 * <backup>, and those are measured against it, and a part that states none
 * of its own runs to the barline the other parts state, and those may be read
 * after it. It answers one question
 * per statement, whether it stands where the measure begins, so its cursor
 * moves by the rules the measure builder's does. The first statement at the
 * start stands, and the last one after it opens the next measure. The part
 * reader reports or refuses whatever here is broken, so nothing here reports
 * anything, and a value it cannot read counts as nothing.
 */
export function timesInForce(part: XmlElement): (TimeSignature | undefined)[] {
  let inForce: TimeSignature | undefined
  let divisions = fraction(1)
  return children(part, 'measure').map((measure) => {
    let opens = inForce
    let settled = false
    let late = false
    let cursor = fraction(0)
    const by = (found: XmlElement) => {
      const duration = child(found, 'duration')
      const count = duration && parseExactDecimal(trimmedText(duration))
      return divideFractions(count ?? fraction(0), multiplyFractions(divisions, fraction(4)))
    }
    // A note's own <time-modification> states every ratio around it, nested
    // ones multiplied.
    const ratioOf = (found: XmlElement) => {
      const ratio = child(found, 'time-modification')
      const count = (name: string) => {
        const stated = ratio && child(ratio, name)
        const value = stated && parseExactDecimal(trimmedText(stated))
        return value && compareFractions(value, fraction(0)) > 0 ? value : undefined
      }
      const actual = count('actual-notes')
      const normal = count('normal-notes')
      return actual && normal ? divideFractions(normal, actual) : fraction(1)
    }
    // A grace note takes none of the measure's time, whatever it states. A
    // note stating no <duration> lasts its written value as its ratio scales
    // it, except a rest marked as the measure's, which lasts the measure where
    // a time signature says how long that is.
    const noteLength = (found: XmlElement) => {
      if (child(found, 'grace')) return fraction(0)
      if (child(found, 'duration')) return by(found)
      const rest = child(found, 'rest')
      if (rest && opens && attribute(rest, 'measure') === 'yes') {
        return fraction(opens.count, opens.unit)
      }
      const type = child(found, 'type')
      const base = type && noteValueBaseOf(type)
      return base
        ? multiplyFractions(lengthOf({ base, dots: children(found, 'dot').length }), ratioOf(found))
        : fraction(0)
    }
    for (const found of measure.children) {
      if (found.name === 'forward') cursor = addFractions(cursor, by(found))
      else if (found.name === 'backup') cursor = addFractions(cursor, negate(by(found)))
      else if (found.name === 'note' && !child(found, 'chord')) {
        // Written out, a note before the measure start stands at the start.
        if (compareFractions(cursor, fraction(0)) < 0) cursor = fraction(0)
        cursor = addFractions(cursor, noteLength(found))
      }
      if (found.name !== 'attributes') continue
      const stated = child(found, 'divisions')
      const count = stated && parseExactDecimal(trimmedText(stated))
      if (count && compareFractions(count, fraction(0)) > 0) divisions = count
      if (!child(found, 'time')) continue
      let time: TimeSignature | undefined
      try {
        time = firstTimeStated(found)
      } catch (error) {
        if (!(error instanceof MusicXMLError)) throw error
      }
      if (compareFractions(cursor, fraction(0)) > 0) {
        late = true
        inForce = time
      } else if (!settled) {
        settled = true
        opens = time
        if (!late) inForce = time
      }
    }
    return opens
  })
}

interface KeyPair {
  /** The fifths the score sounds in. */
  score: number
  /** The fifths this part sounds in: the key it writes, transposition applied. */
  part: number
}

/**
 * The key the score is in and the key a part states, at every measure the
 * part writes, or nothing at a measure where neither states one and where
 * either side is still silent.
 *
 * What each side has in force, not just what it states: a key stands until
 * the next one, so a part that says nothing in the measure where the score
 * changes key is disagreeing all the same. Held only where one side states a
 * key there, so a disagreement is reported once where it starts rather than
 * once per measure it spans, and only where an earlier part has the measure,
 * since past that the key in force is this part's own.
 */
function keysInForce(
  target: readonly ReadGlobalMeasure[],
  found: readonly ReadGlobalMeasure[],
): (KeyPair | undefined)[] {
  let inScore: Key | undefined
  let inPart: Key | undefined
  return found.map((measure, index) => {
    const existing = target[index]
    inScore = existing?.key ?? inScore
    inPart = measure.key ?? inPart
    if (!existing || !(existing.key ?? measure.key) || !inScore || !inPart) return undefined
    return { score: inScore.fifths, part: inPart.fifths }
  })
}

/**
 * Whether a part is in a different meter from the score, at every measure the
 * part writes. Compared as the key is: by what each side has in force, only
 * where one side states a time signature, and only where an earlier part has
 * the measure.
 */
function timesDisagree(
  target: readonly ReadGlobalMeasure[],
  found: readonly ReadGlobalMeasure[],
): boolean[] {
  let inScore: TimeSignature | undefined
  let inPart: TimeSignature | undefined
  return found.map((measure, index) => {
    const existing = target[index]
    inScore = existing?.time ?? inScore
    inPart = measure.time ?? inPart
    return Boolean(
      existing &&
      (existing.time ?? measure.time) &&
      inScore &&
      inPart &&
      !sameMeter(inScore, inPart),
    )
  })
}

/** A part's signatures settled against those of the parts read before it. */
export interface AcrossParts {
  /** Where the part flips to the enharmonic signature, if it does. */
  flipAt: number | undefined
  /** The key each measure of the part gives the score. */
  contributed: (Key | undefined)[]
  /** Whether the part is in a different key from the score at a measure. */
  keyDisagreesAt: (index: number) => boolean
  /** Whether the part is in a different meter from the score at a measure. */
  timeDisagreesAt: (index: number) => boolean
}

/**
 * Settles a part's keys and time signatures against the score's, as the
 * parts before it merged them into `target`.
 */
export function settleAcrossParts(
  target: readonly ReadGlobalMeasure[],
  found: readonly ReadGlobalMeasure[],
  transposition: Transposition | undefined,
): AcrossParts {
  // A transposing part writing the enharmonic signature reads back as a key
  // twelve fifths from the rest of the score's, which is the same key spelled
  // the other way rather than a different one. MNX states where such a part
  // flips, so the keys are settled first and only what the flip point does
  // not account for is reported.
  const keys = keysInForce(target, found)
  const flipAt = keyFifthsFlipAt(
    keys.filter((pair) => pair !== undefined),
    transposition,
  )

  // What the score is in, for each key this part reads back, taken from the
  // measures where both sides state one. The first reading settled for a
  // signature is the one it keeps, as the first stated wins throughout here.
  const spellings = new Map<number, number>()
  for (const pair of keys) {
    if (pair && !spellings.has(pair.part)) spellings.set(pair.part, pair.score)
  }

  // A flipped signature reads back as the score's key in the other spelling,
  // so what such a measure contributes to the score is the score's own. The
  // part states it in the spelling it writes, and the point above brings that
  // back, while a measure no earlier part stated a key at would otherwise put
  // the flipped spelling on the whole score and re-spell every other part.
  //
  // A measure the score states no key at yet has no pair to compare, so the
  // flip is settled by the signature the part writes rather than by how far
  // the merge has reached: the reading another measure of this part settled
  // for the same signature is the one contributed here. A signature no
  // measure settles is read as it stands, since nothing says a flip covers it.
  //
  // A part with no point to state that writes the score's key in the other
  // spelling is reported as a disagreement. Where an earlier part has the
  // measure and the score's key is in force, that spelling is still the
  // score's key, so it does not re-spell the parts that stated it first.
  const settled = (index: number, fifths: number): number | undefined => {
    if (flipAt !== undefined) return keys[index]?.score ?? spellings.get(fifths)
    return target[index] ? keys[index]?.score : undefined
  }
  const contributed = found.map((measure, index) => {
    if (!measure.key) return measure.key
    const inScore = settled(index, measure.key.fifths)
    if (inScore === undefined || Math.abs(inScore - measure.key.fifths) !== 12) {
      return measure.key
    }
    return { ...measure.key, fifths: inScore }
  })

  const keyDisagreesAt = (index: number): boolean => {
    const pair = keys[index]
    return (
      pair !== undefined &&
      writtenFifthsWithFlip(pair.score, transposition, flipAt) !==
        writtenFifths(pair.part, transposition)
    )
  }
  const times = timesDisagree(target, found)
  return {
    flipAt,
    contributed,
    keyDisagreesAt,
    timeDisagreesAt: (index) => times[index] === true,
  }
}
