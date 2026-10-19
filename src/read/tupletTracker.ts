// What one sequence of a voice is inside while its measure is read: the
// tuplets and the two-note tremolo open around the next note, the tuplet
// starts dropped where no bracket could begin, the markers the chord's own
// note carried, and the brackets closed and waiting for the measure to be
// whole. A tuplet and a tremolo share one stack, because each gathers what is
// written in it and the innermost one takes the next note.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
  subtractFractions,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { XmlElement } from '../xml/parse.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import {
  quantityLength,
  ratioOf,
  sameCounts,
  settleClaims,
  tupletLevels,
  unwrapTuplet,
  writtenLengthOf,
} from './tuplets.js'
import type { OpenSkip, TupletClaim, TupletStart, VoiceTail } from './tuplets.js'
import type {
  Event,
  NoteValue,
  NoteValueQuantity,
  SequenceItem,
  Space,
  Tuplet,
} from '../model/score.js'
import { describeValue, lengthOf, noteValueOf } from './duration.js'
import type { Draft } from './draft.js'

/**
 * What one note stated about the brackets it opened, kept so their levels can
 * be worked out again against the brackets of the line they move to. See
 * moveLastTo.
 */
interface Opening {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
  starts: readonly TupletStart[]
  /** The brackets the note opened. */
  frames: OpenTuplet[]
  /** The brackets the source drew that were open around the note, outermost first. */
  around: readonly OpenTuplet[]
  /**
   * The start marker whose ratio disagrees with the note's
   * <time-modification>. It is reported in the note's place in the warning
   * list when the last bracket the note opened closes, so a bracket that
   * moves to another line before then is checked against that line. Where
   * every bracket closed over grace notes alone, the report waits for the
   * measure to be whole, as the group can still move. See HeldOpening.
   */
  disagreeing: XmlElement | undefined
  place: WarningPlace
}

/**
 * An opening whose brackets all closed over grace notes alone, and the grace
 * group holding its note. The group can still move to the line of the note
 * it leads into, where its markers are checked again.
 */
interface HeldOpening {
  opening: Opening
  group: SequenceItem
}

/**
 * A tuplet bracket currently open: the list its notes go in, how much of
 * its written value a note inside lasts (2/3 inside a triplet), and
 * the number its start marker gave it, for its stop to be checked against.
 */
interface OpenTuplet {
  opened: 'tuplet'
  list: SequenceItem[]
  /** Still a draft: a bracket stating no ratio of its own states one when it
   * closes, against what it turned out to hold. */
  tuplet: Draft<Tuplet>
  ratio: Fraction
  number: string
  /**
   * True where the ratio was read from the bracket's first note rather than
   * stated, so the bracket states what it holds once it closes.
   */
  derived: boolean
  /**
   * The ratio the source stated for this level: its own marker gave it, or
   * one level opened and the note's <time-modification> is all of it. Unset
   * where the converter worked it out, by reading it off the first note or by
   * dividing a cumulative ratio between levels. Such a ratio says nothing
   * about what the source drew over the bracket.
   */
  stated: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined
  /** Where this voice's content ran to when the bracket opened. */
  openEnd: Fraction
  /**
   * True where the source stated the ratio and drew no bracket, so what the
   * ratio counts is what says where the tuplet ends.
   */
  unbracketed: boolean
  /**
   * The <tuplet> that opened it, or for a run with no bracket the
   * <time-modification> of its first note. A run with no bracket has no
   * stop, so it is reported here.
   */
  element: XmlElement
  /** The list this bracket sits in, for dropping it from where it stands. */
  within: SequenceItem[]
  /** The brackets that closed inside this one, for its claim to carry. */
  children: TupletClaim[]
  /** The skips filled directly inside this one, waiting for its frame. */
  skips: OpenSkip[]
  /** What the note that opened it stated. Unset for a run with no bracket. */
  opening: Opening | undefined
  /** True once it closed holding nothing that takes any of the measure's time. */
  untimed: boolean
}

/**
 * A two-note tremolo currently being gathered: the notes it holds are kept
 * apart from the content, and join it as one item once it closes.
 */
export interface OpenTremolo {
  opened: 'tremolo'
  list: SequenceItem[]
  marks: number
  /** The notes it holds, which are halved where it turns out to have one end. */
  events: Draft<Event>[]
  durations: Fraction[]
  /** The <tremolo> marker that opened it. */
  element: XmlElement
}

/**
 * One bracket the voice is inside. A tuplet and a tremolo each gather what
 * is written in them, and each carries what it needs to close, so closing
 * one while the other is open cannot pop the wrong frame and lose what it
 * held.
 */
type OpenBracket = OpenTuplet | OpenTremolo

/** Whether the tuplet holds at least what its ratio counts. */
function tupletFilled(open: OpenTuplet): boolean {
  return compareFractions(writtenLengthOf(open.tuplet.content), countedLengthOf(open)) >= 0
}

/** The written length a tuplet's ratio counts, for example three eighths. */
function countedLengthOf(open: OpenTuplet): Fraction {
  return quantityLength(open.tuplet.inner)
}

/**
 * The value a note of a two-note tremolo with one end is converted as: it is
 * written with the pair's value and lasts half of it.
 */
function halfOf(value: NoteValue, path: DocumentPath, line: number): NoteValue {
  const half = noteValueOf(multiplyFractions(lengthOf(value), fraction(1, 2)))
  if (!half) {
    throw new MusicXMLError(
      `A note of a tremolo with one end is written as ${describeValue(value)}, and no ` +
        'note value is half of it.',
      { path, line },
    )
  }
  return half
}

/**
 * Sets the share of each bracket `opening` opened, against `line`, the ratios
 * of the brackets the source drew that are open in the line the note moves
 * to, and the brackets around the note that move with it or closed over
 * grace notes alone. A bracket still open where the note stood holds what
 * takes time there, so it stays in that line.
 */
function relevel(
  opening: Opening,
  line: readonly Fraction[],
  moving: readonly OpenBracket[],
): void {
  const settles = (frame: OpenTuplet) => frame.untimed || moving.includes(frame)
  const { levels, disagreeing } = tupletLevels(
    [...line, ...opening.around.filter(settles).map((frame) => frame.ratio)],
    opening.inner,
    opening.outer,
    opening.starts,
  )
  opening.disagreeing = disagreeing
  for (const frame of opening.frames.filter(settles)) {
    const level = levels.find((candidate) => candidate.element === frame.element)
    /* v8 ignore next -- each start a note opened gives one level. */
    if (!level) throw new Error('A bracket opened with no level of its own.')
    frame.tuplet.inner = level.inner
    frame.tuplet.outer = level.outer
    frame.ratio = ratioOf(level.inner, level.outer)
    if (frame.stated) frame.stated = { inner: level.inner, outer: level.outer }
  }
}

function reportDisagreeing(
  opening: Opening,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  if (!opening.disagreeing) return
  warnings.addAt(
    opening.place,
    'inconsistent:tuplet',
    "A tuplet's start marker states a ratio that disagrees with the notes' " +
      '<time-modification>. The ratio the notes state is the one converted.',
    context,
    opening.disagreeing,
  )
}

function removeLastFrom(list: SequenceItem[], expected: SequenceItem): void {
  if (list.at(-1) !== expected) throw new Error('The item to remove is not the last one written.')
  list.pop()
}

export class TupletTracker {
  /**
   * The brackets this sequence is inside, outermost first. Notes go into the
   * innermost one's list, or in `content` where none is open. No bracket
   * opens inside a tremolo, so a tremolo is always the innermost.
   */
  readonly #open: OpenBracket[] = []
  /**
   * The numbers of tuplets whose start marker was read but never opened,
   * because it was written where no bracket can begin. The stop matching one
   * is dropped with it, rather than closing the bracket around it.
   */
  readonly #dropped: string[] = []
  /**
   * The brackets this sequence has closed, outermost first in the order the
   * source closed them. Each waits for the measure to be whole. See
   * TupletClaim.
   */
  readonly #claims: TupletClaim[] = []
  /** The sequence's own item list, which holds what no bracket does. */
  readonly #content: SequenceItem[]
  /** The openings whose report waits for the measure to be whole. */
  readonly #held: HeldOpening[] = []

  constructor(content: SequenceItem[]) {
    this.#content = content
  }

  /** Adds an item after what is written so far, inside every bracket open. */
  append(item: SequenceItem): void {
    this.#list().push(item)
  }

  /** The item written last inside every bracket open, if any. */
  last(): SequenceItem | undefined {
    return this.#list().at(-1)
  }

  /**
   * The item written last before the brackets opened since that hold nothing
   * but each other, where any such bracket is open.
   */
  lastBeforeOpened(): SequenceItem | undefined {
    const outermost = this.#openedEmpty().at(0)
    return outermost?.within.at(-2)
  }

  /**
   * Moves `item`, the item written last before the brackets opened since that
   * hold nothing but each other, inside the innermost of them.
   */
  moveIntoOpened(item: SequenceItem): void {
    const [outermost] = this.#openedEmpty()
    /* v8 ignore next -- the caller checks lastBeforeOpened first. */
    if (outermost?.within.at(-2) !== item) throw new Error('The item is not before the brackets.')
    outermost.within.splice(-2, 1)
    this.#list().push(item)
  }

  /**
   * Whether a bracket opened where the item written last stands, so it holds
   * nothing else and moves with it. See moveLastTo.
   */
  bracketOpensOnLast(): boolean {
    const innermost = this.#open.at(-1)
    return innermost?.opened === 'tuplet' && innermost.list.length === 1
  }

  /**
   * Closes the run the ratio alone opened where brackets are open inside it,
   * and puts the brackets after it. Only a bracket starting on a grace note
   * opens inside such a run. A note that takes time goes inside the bracket,
   * so the run ends where the bracket starts, as it does before a bracket
   * starting on that note. A bracket that closed over grace notes alone, or
   * moved away with them, leaves the run open.
   */
  closeImpliedBeneath(
    end: Fraction,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const [run, ...above] = this.#open
    const [first] = above
    if (run?.opened !== 'tuplet' || !run.unbracketed || first?.opened !== 'tuplet') return
    this.#open.length = 1
    removeLastFrom(run.list, first.tuplet)
    this.#close(run, end, warnings, context, path, line, false)
    first.within = this.#list()
    first.within.push(first.tuplet)
    this.#open.push(...above)
  }

  /**
   * Moves `item`, which must be the item written last inside every bracket
   * open, to the end of `to`. The brackets open around it that hold nothing
   * else were opened where it stands, so they move with it. Each level's
   * share of the note's ratio is worked out again against the brackets open
   * in `to`, for the brackets that move and for those that closed over grace
   * notes alone. `openEnd` is where `to` has reached.
   */
  moveLastTo(item: SequenceItem, to: TupletTracker, openEnd: Fraction): void {
    removeLastFrom(this.#list(), item)
    const moving: OpenBracket[] = []
    for (let frame = this.#open.at(-1); frame?.list.length === 0; frame = this.#open.at(-1)) {
      this.#open.pop()
      if (frame.opened === 'tuplet') removeLastFrom(frame.within, frame.tuplet)
      moving.unshift(frame)
    }
    const held = this.#held.filter((entry) => entry.group === item)
    this.#held.splice(0, this.#held.length, ...this.#held.filter((entry) => entry.group !== item))

    const openings = new Set<Opening>()
    for (const frame of moving) {
      if (frame.opened === 'tuplet' && frame.opening) openings.add(frame.opening)
    }
    for (const { opening } of held) openings.add(opening)
    // A note inside another note's bracket has that bracket around it as
    // well, so the outer opening is settled first.
    const line = to.#drawnRatios()
    for (const opening of [...openings].sort((a, b) => a.around.length - b.around.length)) {
      relevel(opening, line, moving)
    }

    for (const frame of moving) {
      if (frame.opened === 'tuplet') {
        frame.within = to.#list()
        frame.within.push(frame.tuplet)
        frame.openEnd = openEnd
      }
      to.#open.push(frame)
    }
    to.#list().push(item)
    to.#held.push(...held)
  }

  /** How much of its written value a note lasts, given the tuplets around it. */
  tupletFactor(): Fraction {
    return this.#tuplets()
      .map((open) => open.ratio)
      .reduce(multiplyFractions, fraction(1))
  }

  /**
   * The ratio of each open tuplet, outermost first, where the source stated
   * every one of them. Undefined where the converter worked any of them out.
   */
  statedRatios(): Fraction[] | undefined {
    const open = this.#tuplets()
    return open.every((tuplet) => tuplet.stated) ? open.map((tuplet) => tuplet.ratio) : undefined
  }

  /**
   * The same, with a two-note tremolo counted as well. Inside one each note is
   * written with the value of the pair, so it lasts half of it.
   */
  noteFactor(): Fraction {
    const factor = this.tupletFactor()
    return this.#tremolo() ? multiplyFractions(factor, fraction(1, 2)) : factor
  }

  /**
   * What is open around a note scaling its written value, for a report to
   * name. The tremolo is the nearer of the two where both are open, since no
   * bracket opens inside one.
   */
  scaledBy(): 'tuplet' | 'tremolo' | undefined {
    return this.#open.at(-1)?.opened
  }

  /** Whether a two-note tremolo is being gathered. */
  insideTremolo(): boolean {
    return this.#tremolo() !== undefined
  }

  /** Records a note gathered into the open tremolo and how long it lasts, where one is open. */
  addTremoloNote(event: Draft<Event>, duration: Fraction): void {
    const pending = this.#tremolo()
    pending?.events.push(event)
    pending?.durations.push(duration)
  }

  /** Whether a tuplet or a tremolo is open around a note. */
  insideBracket(): boolean {
    return this.#open.length > 0
  }

  /** Whether this sequence is inside a tuplet stated as a ratio with no bracket. */
  insideImplied(): boolean {
    return this.#implied() !== undefined
  }

  /**
   * Whether a tuplet the source drew a bracket for is open. A run the ratio
   * alone opened is not one.
   */
  insideDrawnBracket(): boolean {
    return this.#tuplets().some((open) => !open.unbracketed)
  }

  /**
   * States time the sequence passed over in silence as a space, in the
   * innermost list. Inside a tuplet everything is written in values the ratio
   * scales, so a gap there is stated in written units: a skipped triplet
   * eighth is written as an eighth even though it lasts a twelfth of a whole
   * note.
   */
  addSkip(gap: Fraction): void {
    const space: Draft<Space> = {
      kind: 'space',
      duration: divideFractions(gap, this.tupletFactor()),
    }
    this.#list().push(space)
    // A bracket rewritten when it closes moves the frame this length was
    // taken in, so the skip waits for it. A tremolo is the innermost frame
    // whenever there is one, and states what it holds itself.
    const around = this.#open.at(-1)
    if (around?.opened === 'tuplet') around.skips.push({ space, spent: gap })
  }

  /**
   * Starts the tuplets a note opens, outermost first as written, until a stop
   * reorders them (see nestStopping). Notes added after them
   * go inside, until each is closed. `inner` and `outer` are the note's
   * cumulative <time-modification>; each level's own share is settled by
   * `tupletLevels`. `openEnd` is where the sequence has reached, before
   * anything the brackets hold. A bracket that states no ratio compares it
   * with where the sequence reaches when the bracket closes, to state the
   * time it took.
   */
  openTuplets(
    inner: NoteValueQuantity,
    outer: NoteValueQuantity,
    starts: readonly TupletStart[],
    /**
     * True where the ratio was read from the note rather than stated by a
     * <time-modification>. Such a ratio speaks for that one note, so the
     * multiples are scaled to what the bracket holds once it closes.
     */
    derived: boolean,
    openEnd: Fraction,
    warnings: WarningCollector,
    path: DocumentPath,
    line: number,
  ): void {
    // A tremolo holds exactly its two notes, so no bracket may open inside
    // one.
    if (this.#tremolo()) {
      throw new MusicXMLError('A tuplet starts inside a two-note tremolo.', { path, line })
    }

    const around = this.#tuplets().filter((open) => !open.unbracketed)
    const { levels, disagreeing } = tupletLevels(
      around.map((open) => open.ratio),
      inner,
      outer,
      starts,
    )
    const opening: Opening = {
      inner,
      outer,
      starts,
      frames: [],
      around,
      disagreeing,
      place: warnings.reserve(),
    }

    for (const [index, level] of levels.entries()) {
      const { display } = level
      const content: SequenceItem[] = []
      // A setting the source states is set; one it does not is left off the
      // tuplet, rather than set to undefined, because MNX reads an absent
      // key as the renderer's choice. Written as assignments rather than as
      // conditional spreads, because a spread of { bracket: undefined } into a
      // tuplet type-checks.
      const tuplet: Draft<Tuplet> = {
        kind: 'tuplet',
        inner: level.inner,
        outer: level.outer,
        content,
      }
      if (display.bracket !== undefined) tuplet.bracket = display.bracket
      if (display.showNumber !== undefined) tuplet.showNumber = display.showNumber
      if (display.showValue !== undefined) tuplet.showValue = display.showValue
      if (display.placement !== undefined) tuplet.placement = display.placement

      const within = this.#list()
      within.push(tuplet)
      const frame: OpenTuplet = {
        opened: 'tuplet',
        list: content,
        tuplet,
        ratio: ratioOf(level.inner, level.outer),
        number: level.number,
        // A level whose own marker stated its ratio states it already, and
        // rescaling that to the content would overwrite what the source drew.
        derived: derived && starts[index]?.stated === undefined,
        stated:
          starts[index]?.stated !== undefined || (!derived && levels.length === 1)
            ? { inner: level.inner, outer: level.outer }
            : undefined,
        openEnd,
        unbracketed: false,
        element: level.element,
        within,
        children: [],
        skips: [],
        opening,
        untimed: false,
      }
      opening.frames.push(frame)
      this.#open.push(frame)
    }
  }

  /**
   * Starts a tuplet the source stated as a ratio with no bracket around it.
   * Opened only where nothing else is, so it is always the one frame this
   * sequence is inside.
   */
  openImplied(
    inner: NoteValueQuantity,
    outer: NoteValueQuantity,
    ratio: XmlElement,
    openEnd: Fraction,
  ): void {
    const content: SequenceItem[] = []
    const tuplet: Draft<Tuplet> = { kind: 'tuplet', inner, outer, content }
    const within = this.#list()
    within.push(tuplet)
    this.#open.push({
      opened: 'tuplet',
      list: content,
      tuplet,
      ratio: ratioOf(inner, outer),
      // No marker numbered it, and no stop of its own closes it.
      number: '1',
      derived: false,
      // The notes state the ratio; where the run ends is the converter's
      // reading of where they stop agreeing with it.
      stated: undefined,
      openEnd,
      unbracketed: true,
      element: ratio,
      within,
      children: [],
      skips: [],
      opening: undefined,
      untimed: false,
    })
  }

  /**
   * Whether the tuplet the ratio alone opened holds all its ratio counts once
   * the time the sequence has passed over in silence, from `end` to `cursor`,
   * stands inside it. A skip inside such a run stands in it as a space, the
   * way a rest written there would, so a skip the ratio still counts room for
   * leaves the run open, and one that fills the run exactly completes it. One
   * that carries the run past what its ratio counts cannot be inside it,
   * because the run is gathered from what follows the ratio and nothing the
   * source drew bounds it. Either way the run ends. False where no such tuplet
   * is open.
   */
  impliedFullAt(cursor: Fraction, end: Fraction): boolean {
    const open = this.#implied()
    return (
      open !== undefined &&
      compareFractions(this.#heldAt(open, cursor, end), countedLengthOf(open)) >= 0
    )
  }

  /**
   * Whether the time the sequence has passed over in silence, from `end` to
   * `cursor`, fills exactly what the tuplet the ratio alone opened still
   * counts room for, so the skip goes inside the run before it closes. False
   * where no such tuplet is open.
   */
  impliedCompletedAt(cursor: Fraction, end: Fraction): boolean {
    const open = this.#implied()
    return (
      open !== undefined &&
      compareFractions(this.#heldAt(open, cursor, end), countedLengthOf(open)) === 0
    )
  }

  /**
   * Whether the tuplet the ratio alone opened ends before a note stating
   * `quantities`, written at `cursor` with the sequence reaching `end`. It
   * takes the note while the note states the same counts and the tuplet,
   * with any skip before the note inside it, holds less than what its first
   * note's ratio counts. False where no such tuplet is open.
   */
  impliedEndsBefore(
    cursor: Fraction,
    end: Fraction,
    quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined,
  ): boolean {
    const open = this.#implied()
    if (!open) return false
    if (this.impliedFullAt(cursor, end)) return true
    if (!quantities) return true
    return !sameCounts(open.tuplet, quantities)
  }

  /**
   * Whether the tuplet the ratio alone opened holds all its ratio counts, so
   * a stop marker written here agrees with where the ratio ends it. False
   * where no such tuplet is open.
   */
  impliedFilled(): boolean {
    const open = this.#implied()
    return open !== undefined && tupletFilled(open)
  }

  /**
   * Starts a two-note tremolo. The notes added while it is open are
   * gathered, and join the content as one item when it closes.
   */
  openTremolo(marks: number, element: XmlElement): void {
    /* v8 ignore next 3 -- a note that opens one converts the one open first, and a grace note opens none. */
    if (this.#tremolo()) {
      throw new Error('A tremolo starts inside another tremolo.')
    }
    this.#open.push({ opened: 'tremolo', list: [], marks, events: [], durations: [], element })
  }

  /**
   * Converts the tremolo being gathered, which has only one end, as the plain
   * notes it holds, and hands back the marker that opened it. Undefined where
   * no tremolo is open.
   */
  convertUnclosedTremolo(path: DocumentPath, line: number): XmlElement | undefined {
    const pending = this.#tremolo()
    if (!pending) return undefined
    this.#open.pop()
    for (const event of pending.events) event.value = halfOf(event.value, path, line)
    this.#list().push(...pending.list)
    return pending.element
  }

  /** Whether the tremolo being gathered was opened by `marker`. */
  tremoloOpenedBy(marker: XmlElement): boolean {
    return this.#tremolo()?.element === marker
  }

  /** Stops the tremolo being gathered, and hands back what it holds. */
  closeTremolo(): OpenTremolo {
    const pending = this.#tremolo()
    /* v8 ignore next -- a stop where none is open opens one around its own note. */
    if (!pending) throw new Error('A tremolo stops where none is open.')
    // With no bracket able to open inside a tremolo, its frame is on top
    // whenever one is open.
    this.#open.pop()
    return pending
  }

  /**
   * Records a tuplet this sequence never opened, by the number its start
   * marker stated, so the stop that matches it can be dropped with it.
   */
  dropStart(number: string): void {
    this.#dropped.push(number)
  }

  /**
   * Whether a stop under this number matches a start dropped under it,
   * consuming the record where it does, so a second stop stating the number
   * closes an open bracket as any other stop does. A bracket the source drew
   * under the number and still open is what the stop closes instead: the
   * source numbers every tuplet 1 unless it nests them, so a dropped start
   * and an open bracket often share a number.
   */
  takesDroppedStart(number: string): boolean {
    if (this.#tuplets().some((open) => !open.unbracketed && open.number === number)) return false
    const at = this.#dropped.lastIndexOf(number)
    if (at < 0) return false
    this.#dropped.splice(at, 1)
    return true
  }

  /**
   * Moves the brackets numbered in `stopping` inside the others opened on the
   * same note, keeping the written order within each group. MusicXML does not
   * constrain which start marker on a note is written first, so the order
   * they open in says nothing about which is inside. Brackets that hold
   * nothing but each other hold the same notes, so the one that stops first
   * is the inner one. The stop numbers can be the mistake instead, so the
   * brackets move only where the notes fill the last stopping one written.
   * `stopping` holds the numbers the note's stops state.
   */
  nestStopping(stopping: ReadonlySet<string>): void {
    const together: OpenTuplet[] = []
    for (let at = this.#open.length - 1; at >= 0; at -= 1) {
      const frame = this.#open[at]
      if (frame?.opened !== 'tuplet' || frame.unbracketed) break
      const inside = together[0]
      if (inside && frame.list[0] !== inside.tuplet) break
      together.unshift(frame)
    }
    const order = [
      ...together.filter((open) => !stopping.has(open.number)),
      ...together.filter((open) => stopping.has(open.number)),
    ]
    const [outermost] = together
    const innermost = together.at(-1)
    const inner = order.at(-1)
    if (!outermost || !innermost || !inner) return
    if (compareFractions(writtenLengthOf(innermost.list), countedLengthOf(inner)) < 0) return

    // Only the innermost holds notes, closed brackets and skips.
    const held = innermost.list
    ;[inner.children, innermost.children] = [innermost.children, inner.children]
    ;[inner.skips, innermost.skips] = [innermost.skips, inner.skips]
    let { within } = outermost
    removeLastFrom(within, outermost.tuplet)
    for (const open of order) {
      within.push(open.tuplet)
      open.within = within
      open.list = open === inner ? held : []
      open.tuplet.content = open.list
      within = open.list
    }
    this.#open.splice(this.#open.length - order.length, order.length, ...order)
  }

  /**
   * Closes the innermost open tuplet, handing back the number its start
   * marker stated so the caller can check the note's stops as a batch: which
   * stop is written first on a note is not constrained, so a crossing shows
   * only when the note's stated numbers and the closed ones disagree as sets.
   * `stop` is the <tuplet> marker closing it, and `end` is where the sequence
   * has reached.
   */
  closeTuplet(
    end: Fraction,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
    stop: XmlElement,
  ): string | undefined {
    const closed = this.#open.at(-1)
    // A stop naming a bracket this voice never opened. A bracket whose start
    // was dropped and one an earlier measure closed at its barline are both
    // answered for already, so what is left is a marker the source wrote
    // where nothing of its can end. It takes none of the measure's time, so
    // the measure still adds up without it.
    if (!closed) {
      warnings.add(
        'inconsistent:tuplet',
        'A <tuplet> stops where no tuplet is open, and names no bracket this measure ' +
          'dropped or carried in. The marker is passed over.',
        context,
        stop,
      )
      return undefined
    }
    return this.#close(closed, end, warnings, context, path, line, false, stop)
  }

  /** Closes the run the ratio alone opened, where one is open. */
  closeImplied(
    end: Fraction,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const open = this.#implied()
    if (open) this.#close(open, end, warnings, context, path, line, false)
  }

  /**
   * Closes every bracket still open at the barline, and hands back the
   * numbers their start markers stated, innermost first. A tremolo still
   * open is converted before this, as the innermost frame.
   *
   * A <tuplet> bracket may start in one measure and stop in the next, and MNX
   * states a tuplet inside one measure's sequence, so a bracket still open
   * here is closed at the barline and the loss reported.
   */
  closeAtBarline(
    end: Fraction,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): string[] {
    const numbers: string[] = []
    // Every frame left is a bracket: a tremolo left open is converted first.
    for (let open = this.#open.at(-1); open?.opened === 'tuplet'; open = this.#open.at(-1)) {
      warnings.add(
        'unrepresentable:tuplet-span',
        'A tuplet bracket runs past the end of the measure, and MNX states a tuplet ' +
          'inside one measure. It is drawn as far as the barline, over the notes of ' +
          'it that this measure holds.',
        context,
        open.element,
      )
      numbers.push(this.#close(open, end, warnings, context, path, line, true))
    }
    return numbers
  }

  /**
   * Settles every bracket this sequence closed, the measure being whole, and
   * hands back where the sequence runs to. See settleClaims.
   */
  settle(voice: VoiceTail, warnings: WarningCollector, context: ReportContext): Fraction {
    for (const { opening } of this.#held) reportDisagreeing(opening, warnings, context)
    this.#held.length = 0
    const end = settleClaims(this.#claims, voice, warnings, context)
    this.#claims.length = 0
    return end
  }

  /**
   * Closes the innermost frame, which is `closed`. `cut` marks a close the
   * barline forced rather than a stop the source wrote, so the bracket
   * holding less than its ratio counts is the converter's doing and is not
   * reported again.
   */
  #close(
    closed: OpenBracket,
    end: Fraction,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
    cut: boolean,
    stop?: XmlElement,
  ): string {
    // A tremolo edge and a tuplet edge can fall on different notes. Popping
    // the tremolo's frame here would lose the notes it holds, so a bracket
    // closing across an open tremolo refuses instead.
    if (closed.opened === 'tremolo') {
      throw new MusicXMLError('A tuplet closes inside a two-note tremolo.', { path, line })
    }
    this.#open.pop()
    const { tuplet } = closed
    closed.untimed = writtenLengthOf(tuplet.content).num === 0
    this.#closeOpening(closed, warnings, context)
    // A run with no bracket has no stop, so it is reported where it opened,
    // and so is a bracket the barline closes.
    const at = stop ?? closed.element

    // A run the ratio alone opened on a note that turned out not to be an
    // event holds nothing. It stands for no tuplet the source wrote, so it
    // goes rather than being drawn empty.
    if (closed.unbracketed && tuplet.content.length === 0) {
      removeLastFrom(closed.within, tuplet)
      return closed.number
    }
    // A bracket that holds nothing taking any of the measure's time, which is
    // what a bracket opening and closing on grace notes holds. MNX states a
    // tuplet as a written length against the time it is played in, and a
    // grace note gives neither, so there is no tuplet to write.
    if (closed.untimed) {
      unwrapTuplet(closed.within, tuplet)
      warnings.add(
        'unrepresentable:tuplet-untimed',
        "A tuplet bracket holds nothing that takes any of the measure's time, as a bracket " +
          'over grace notes alone does. MNX states a tuplet as a written length against the ' +
          'time it is played in, so the bracket is not converted and what it holds is ' +
          'written as it stands.',
        context,
        at,
      )
      return closed.number
    }
    // Sources contain brackets whose content does not add up to the
    // stated ratio: a lone quarter under a 3:2 eighth ratio, standing for a
    // triplet quarter. MNX sequences a tuplet by advancing the cursor over
    // its outer and requires the content to come to inner, so such a bracket
    // is rewritten to count the notes it holds, which leaves them sounding
    // for the time the source gives them. Which reading it takes is settled
    // once the measure is whole.
    const claim: TupletClaim = {
      tuplet,
      within: closed.within,
      stated: closed.stated,
      derived: closed.derived,
      unbracketed: closed.unbracketed,
      cut,
      openEnd: closed.openEnd,
      spent: subtractFractions(end, closed.openEnd),
      frame: this.tupletFactor(),
      children: closed.children,
      skips: closed.skips,
      place: warnings.reserve(),
      element: at,
    }
    // A bracket still open around this one holds the claim, so that the two
    // settle together: this one's outer is written in the frame that one
    // ends up with.
    const around = this.#tuplets().at(-1)
    if (around) around.children.push(claim)
    else this.#claims.push(claim)

    return closed.number
  }

  /**
   * Reports the start marker of the note that opened `closed` where `closed`
   * is the last of its brackets to close. Where every one of them closed over
   * grace notes alone, the report waits for the measure to be whole, because
   * the group holding the note can still move to another line.
   */
  #closeOpening(closed: OpenTuplet, warnings: WarningCollector, context: ReportContext): void {
    const { opening } = closed
    if (!opening || opening.frames.some((frame) => this.#open.includes(frame))) return
    const group = closed.tuplet.content.find((item) => item.kind === 'grace')
    if (group && opening.frames.every((frame) => frame.untimed)) {
      this.#held.push({ opening, group })
    } else {
      reportDisagreeing(opening, warnings, context)
    }
  }

  /**
   * The written length `open` holds with the time the sequence has passed
   * over in silence, from `end` to `cursor`, inside it. Stated in the run's
   * written units, as everything inside it is.
   */
  #heldAt(open: OpenTuplet, cursor: Fraction, end: Fraction): Fraction {
    const gap = subtractFractions(cursor, end)
    const skipped = compareFractions(gap, fraction(0)) > 0 ? gap : fraction(0)
    return addFractions(
      writtenLengthOf(open.tuplet.content),
      divideFractions(skipped, this.tupletFactor()),
    )
  }

  /**
   * The tremolo being gathered, when one is. No bracket opens inside a tremolo,
   * so it is the innermost frame whenever there is one.
   */
  #tremolo(): OpenTremolo | undefined {
    const frame = this.#open.at(-1)
    return frame?.opened === 'tremolo' ? frame : undefined
  }

  /** The tuplet the ratio alone opened, where the sequence is inside one. */
  #implied(): OpenTuplet | undefined {
    const open = this.#open.at(-1)
    return open?.opened === 'tuplet' && open.unbracketed ? open : undefined
  }

  /**
   * The list a note added now would go into: the innermost bracket's, or the
   * sequence's own where no bracket is open.
   */
  #list(): SequenceItem[] {
    return this.#open.at(-1)?.list ?? this.#content
  }

  /**
   * The brackets open innermost that hold nothing but each other, outermost
   * first.
   */
  #openedEmpty(): OpenTuplet[] {
    const opened: OpenTuplet[] = []
    for (let at = this.#open.length - 1; at >= 0; at -= 1) {
      const frame = this.#open[at]
      const held = opened.length === 0 ? 0 : 1
      if (frame?.opened !== 'tuplet' || frame.list.length !== held) break
      opened.unshift(frame)
    }
    return opened
  }

  /**
   * The ratios of the brackets the source drew that are open, outermost
   * first. A run the ratio alone opened is open around a bracket only where a
   * grace note starts the bracket, and the run closes before the bracket's
   * first note that takes time, so the bracket's share is not divided by it.
   */
  #drawnRatios(): Fraction[] {
    return this.#tuplets()
      .filter((open) => !open.unbracketed)
      .map((open) => open.ratio)
  }

  /** The tuplets open around a note, outermost first. */
  #tuplets(): OpenTuplet[] {
    return this.#open.filter((frame) => frame.opened === 'tuplet')
  }
}
