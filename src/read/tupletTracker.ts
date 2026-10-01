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
import type { ReportContext, WarningCollector } from './collector.js'
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
import type { NoteValueQuantity, SequenceItem, Space, Tuplet } from '../model/score.js'
import type { Draft } from './draft.js'

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
}

/**
 * A two-note tremolo currently being gathered: the notes it holds are kept
 * apart from the content, and join it as one item once it closes.
 */
export interface OpenTremolo {
  opened: 'tremolo'
  list: SequenceItem[]
  marks: number
  durations: Fraction[]
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

  constructor(content: SequenceItem[]) {
    this.#content = content
  }

  /**
   * The list a note added now would go into: the innermost bracket's, or the
   * sequence's own where no bracket is open.
   */
  list(): SequenceItem[] {
    return this.#open.at(-1)?.list ?? this.#content
  }

  /** How much of its written value a note lasts, given the tuplets around it. */
  tupletFactor(): Fraction {
    return this.#tuplets()
      .map((open) => open.ratio)
      .reduce(multiplyFractions, fraction(1))
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

  /** Records how long a note gathered into the open tremolo lasts, where one is open. */
  addTremoloNote(duration: Fraction): void {
    this.#tremolo()?.durations.push(duration)
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
    this.list().push(space)
    // A bracket rewritten when it closes moves the frame this length was
    // taken in, so the skip waits for it. A tremolo is the innermost frame
    // whenever there is one, and states what it holds itself.
    const around = this.#open.at(-1)
    if (around?.opened === 'tuplet') around.skips.push({ space, spent: gap })
  }

  /**
   * Starts the tuplets a note opens, outermost first. Notes added after them
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
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    // A tremolo holds exactly its two notes, so no bracket may open inside
    // one.
    if (this.#tremolo()) {
      throw new MusicXMLError('A tuplet starts inside a two-note tremolo.', { path, line })
    }

    const levels = tupletLevels(
      this.#tuplets().map((open) => open.ratio),
      inner,
      outer,
      starts,
      warnings,
      context,
    )

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

      const within = this.list()
      within.push(tuplet)
      this.#open.push({
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
      })
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
    const within = this.list()
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
    })
  }

  /**
   * Whether the tuplet the ratio alone opened ends at the time the sequence
   * has passed over in silence, from `end` to `cursor`. A skip inside such a run stands in
   * it as a space, the way a rest written there would, so a skip the ratio
   * still counts room for leaves the run open. One that carries the run past
   * what its ratio counts cannot be inside it, because the run is gathered
   * from what follows the ratio and nothing the source drew bounds it. False
   * where no such tuplet is open.
   */
  impliedEndsAtGap(cursor: Fraction, end: Fraction): boolean {
    const open = this.#implied()
    if (!open) return false
    const gap = subtractFractions(cursor, end)
    if (compareFractions(gap, fraction(0)) <= 0) return false
    // Stated in the run's written units, as everything inside it is.
    const held = addFractions(
      writtenLengthOf(open.tuplet.content),
      divideFractions(gap, this.tupletFactor()),
    )
    return compareFractions(held, countedLengthOf(open)) > 0
  }

  /**
   * Whether the tuplet the ratio alone opened ends before a note stating
   * `quantities`, written at `cursor` with the sequence reaching `end`. It takes the note while the note
   * states the same counts and the tuplet holds less than what its first
   * note's ratio counts. False where no such tuplet is open.
   */
  impliedEndsBefore(
    cursor: Fraction,
    end: Fraction,
    quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined,
  ): boolean {
    const open = this.#implied()
    if (!open) return false
    if (this.impliedEndsAtGap(cursor, end)) return true
    if (!quantities) return true
    return !sameCounts(open.tuplet, quantities) || tupletFilled(open)
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
  openTremolo(marks: number, path: DocumentPath, line: number): void {
    if (this.#tremolo()) {
      throw new MusicXMLError('A tremolo starts inside another tremolo.', { path, line })
    }
    this.#open.push({ opened: 'tremolo', list: [], marks, durations: [] })
  }

  /** Stops the tremolo being gathered, and hands back what it holds. */
  closeTremolo(path: DocumentPath, line: number): OpenTremolo {
    const pending = this.#tremolo()
    if (!pending) {
      throw new MusicXMLError('A tremolo stops where none is open.', { path, line })
    }
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
   * numbers their start markers stated, innermost first.
   *
   * A tremolo holds exactly its two notes, so one left open is a source the
   * reader can make no sense of and the document is refused.
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
    if (this.#tremolo()) {
      throw new MusicXMLError('A tremolo is opened and never closed.', { path, line })
    }
    const numbers: string[] = []
    // Every frame left is a bracket: a tremolo left open is refused above.
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
    // A run with no bracket has no stop, so it is reported where it opened,
    // and so is a bracket the barline closes.
    const at = stop ?? closed.element

    const { tuplet } = closed
    // A run the ratio alone opened on a note that turned out not to be an
    // event holds nothing. It stands for no tuplet the source wrote, so it
    // goes rather than being drawn empty. Such a run opens only where no other
    // bracket is, and everything written while it is open goes inside it, so
    // it is the last item of the sequence's own list.
    if (closed.unbracketed && tuplet.content.length === 0) {
      closed.within.pop()
      return closed.number
    }
    // A bracket that holds nothing taking any of the measure's time, which is
    // what a bracket opening and closing on grace notes holds. MNX states a
    // tuplet as a written length against the time it is played in, and a
    // grace note gives neither, so there is no tuplet to write.
    if (writtenLengthOf(tuplet.content).num === 0) {
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

  /** The tuplets open around a note, outermost first. */
  #tuplets(): OpenTuplet[] {
    return this.#open.filter((frame) => frame.opened === 'tuplet')
  }
}
