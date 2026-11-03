// Joining up the two ends of a hairpin or an octave shift.
//
// MusicXML writes each as a start and a stop direction, often measures apart.
// MNX states it once, where it begins, with the place where it ends.

import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  DynamicValue,
  GradualDynamic,
  Measure,
  Ottava,
  OttavaAmount,
  SpanStop,
  WedgeType,
} from '../model/score.js'
import type { Draft } from './draft.js'
import type { CoveredEvent, EventTimeline } from './timeline.js'
import { reportAt } from './collector.js'
import type { WarningCollector, WrittenAt } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'
import { reportLoneWording } from './wording.js'
import type { Wording } from './wording.js'
import { pairSpans } from './spanPairing.js'
import type { EndPlace, SpanEnd, StopEnd } from './spanPairing.js'

/** An event read on a staff, and the measure it is in. */
interface LastSeen {
  measure: number
  event: CoveredEvent
}

/** An octave shift that has begun, waiting to learn where it stops. */
export interface OpenOttava {
  readonly measure: number
  readonly position: Fraction
  readonly value: OttavaAmount
  readonly staff: number | undefined
  readonly placement?: 'above' | 'below'
}

/**
 * A hairpin that has begun, waiting to learn where it stops. It goes into the
 * measure only once closed, because MNX requires a hairpin to state its end.
 */
export interface OpenHairpin {
  readonly measure: number
  readonly position: Fraction
  readonly wedge: WedgeType
  readonly value?: DynamicValue
  /** Where a diminuendo states niente on its start, which is its end's circle. */
  readonly nienteAt?: WrittenAt
  readonly staff: number | undefined
  readonly placement?: 'above' | 'below'
  prefix?: string
  suffix?: string
  /**
   * How many other dynamics the measure held when the hairpin was read, which
   * is where it goes among them, so the measure keeps the order of the source.
   */
  readonly slot: number
}

/**
 * A hairpin's stop, handed back before the hairpin it closes is known. Which
 * one that is depends on ends not read yet. A <backup> can write a start
 * after this stop, although the music puts that start earlier.
 */
export interface WedgeStop {
  /** Wording at the closing edge. It waits until the pairing says which
   * hairpin the stop closes, and becomes that hairpin's suffix. */
  wording?: Wording
  /** Whether the stop states niente, which only a diminuendo's stop can. */
  niente?: boolean
}

/** A hairpin end, and on a stop the wording waiting at it. */
type WedgeEnd = SpanEnd<OpenHairpin, WedgeStop>

/**
 * Reports the niente circle at the end of a hairpin, once for each hairpin.
 * MNX states the level a hairpin starts from and none it ends at. MusicXML
 * draws the circle at the end only of a diminuendo.
 */
function reportNienteEnd(
  open: OpenHairpin,
  stop: StopEnd<WedgeStop>,
  warnings: WarningCollector,
): void {
  const where = open.nienteAt ?? (stop.stop.niente === true ? stop.where : undefined)
  if (where === undefined) return
  if (open.wedge === 'decreasing') {
    warnings.addAt(
      where.place.place,
      'unrepresentable:attribute',
      'The niente circle at the end of a <wedge> cannot be expressed in MNX, ' +
        'which states only the level a hairpin starts from.',
      where.context,
      where.element,
      'niente',
    )
  } else {
    warnings.addAt(
      where.place.place,
      'unresolved:attribute-value',
      nienteOutOfPlace('closing a crescendo'),
      where.context,
      where.element,
      'niente',
    )
  }
}

/** The report of a niente where MusicXML gives it no meaning. */
export function nienteOutOfPlace(where: string): string {
  return (
    `A <wedge> ${where} states niente "yes", which MusicXML defines only where a ` +
    'crescendo starts or a diminuendo stops, so it is not carried over.'
  )
}

/** The wording a hairpin carries, quoted for a report, or '' where it has none. */
function wordingOf(hairpin: OpenHairpin): string {
  return [hairpin.prefix, hairpin.suffix]
    .filter((text) => text !== undefined)
    .map((text) => `"${text}"`)
    .join(' and ')
}

export class SpannerResolver implements PartCollector {
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: WedgeEnd[] = []

  /** Notes where a hairpin begins, to be paired once the part is read. */
  startWedge(open: OpenHairpin, number: string, where: WrittenAt): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure: open.measure,
      position: open.position,
      covers: open.position,
      // The staff is the hairpin's own, so the two cannot disagree about it.
      staff: open.staff,
      payload: open,
      where,
    })
  }

  /**
   * The same, where one stops. Hands back a handle for the stop rather than
   * the hairpin it closes, because which hairpin that is cannot be told until
   * the whole part is in: a stop closes the most recently opened hairpin of
   * its number, and a <backup> writes a start the music puts earlier than
   * this stop after it in the document. Wording written at the closing edge
   * waits on the handle and is put on the hairpin by the pairing.
   */
  stopWedge(
    number: string,
    measure: number,
    position: Fraction,
    graceWritten: number,
    staff: number | undefined,
    where: WrittenAt,
  ): WedgeStop {
    const stop: WedgeStop = {}
    this.#wedgeEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      covers: position,
      graceWritten,
      staff,
      where,
      stop,
    })
    return stop
  }

  /**
   * Notes a hairpin start the reader dropped and already reported, so the stop
   * the source wrote for it is consumed rather than reported as an orphan.
   */
  dropWedgeStart(
    number: string,
    measure: number,
    position: Fraction,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#wedgeEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      dropped: true,
      where,
    })
  }

  /**
   * Pairs the hairpins and the octave shifts once the whole part is read. One
   * entry point, so a caller cannot pair the spans and skip the report of
   * what stays unpaired.
   */
  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void {
    const partMeasures = measures.map((reading) => reading.measure)
    this.#resolveWedges(partMeasures, warnings)
    this.#resolveOttavas(partMeasures, warnings)
  }

  /** Joins every hairpin in the part, once all of both ends are in. */
  #resolveWedges(measures: readonly Measure[], warnings: WarningCollector): void {
    // MNX requires a gradual dynamic to state where it ends, so a hairpin
    // left with no stop is not carried over. A hairpin's stop covers the
    // point where it is written, so no stop covers a point before its start;
    // the backwards message is for when the two differ, as an octave shift's
    // do.
    const messages = {
      'orphan-stop': 'A hairpin stops where none had started, and is not carried over.',
      'backwards-stop':
        'A hairpin would end before it starts, its stop covering a point earlier ' +
        'than its start, and is not carried over.',
      'unclosed-start': 'A hairpin starts where nothing ends it, and is not carried over.',
    }
    const closed = new Map<StopEnd<WedgeStop>, GradualDynamic>()
    const built = new Map<OpenHairpin, GradualDynamic>()
    pairSpans<OpenHairpin, WedgeStop>(
      this.#wedgeEnds,
      (open, stop) => {
        // The grace note the hairpin ends on is stated where the stop covers
        // one, and the key left off where it does not: MNX reads an absent
        // key as the beat itself. Assigned, not spread in, so the compiler
        // tells an absent key from an undefined one.
        const end: Draft<SpanStop> = { measure: stop.measure, position: stop.covers }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        const hairpin: Draft<GradualDynamic> = {
          kind: 'gradual',
          position: open.position,
          wedge: open.wedge,
          end,
          staff: open.staff,
        }
        // A hairpin stating no staff applies to all of them, so only one
        // naming its staff can end on another.
        if (open.staff !== undefined && stop.staff !== undefined && stop.staff !== open.staff) {
          hairpin.staffEnd = stop.staff
        }
        if (open.value !== undefined) hairpin.value = open.value
        reportNienteEnd(open, stop, warnings)
        if (open.placement !== undefined) hairpin.placement = open.placement
        if (open.prefix !== undefined) hairpin.prefix = open.prefix
        if (open.suffix !== undefined) hairpin.suffix = open.suffix
        built.set(open, hairpin)
        closed.set(stop, hairpin)
      },
      (reason, end) => {
        // Only a start can carry wording, and only an unclosed one reaches here.
        const words = end.kind === 'start' && !end.dropped ? wordingOf(end.payload) : ''
        const message =
          words === ''
            ? messages[reason]
            : `A hairpin starts where nothing ends it, and is not carried over, nor its wording ${words}.`
        reportAt(end.where, 'unclosed:spanner', message, warnings)
      },
      'stop-first',
      (start) => {
        if (start.dropped) return
        const words = wordingOf(start.payload)
        reportAt(
          start.where,
          'unclosed:spanner',
          'A hairpin stops at the point where it starts, and is not carried over' +
            (words === '' ? '.' : `, nor its wording ${words}.`),
          warnings,
        )
      },
    )

    // Wording written at a closing edge goes on the hairpin the pairing joins
    // to that stop. It qualifies no mark where the stop closed nothing, and
    // where the hairpin already carries wording from its starting edge: the
    // source wrote both, so the closing words do not overwrite the opening.
    for (const end of this.#wedgeEnds) {
      if (end.kind !== 'stop' || !end.stop.wording) continue
      const wording = end.stop.wording
      const hairpin = closed.get(end)
      if (hairpin && hairpin.suffix === undefined) hairpin.suffix = wording.text
      else reportLoneWording(wording, warnings)
    }

    // Each closed hairpin goes into its measure at its slot. The ends are in
    // the order of the source, and slots never go back within a measure, so
    // inserting the last first leaves each earlier one before the later ones.
    for (const end of [...this.#wedgeEnds].reverse()) {
      if (end.kind !== 'start' || end.dropped) continue
      const hairpin = built.get(end.payload)
      if (hairpin) measures[end.measure]?.dynamics.splice(end.payload.slot, 0, hairpin)
    }
    this.#wedgeEnds.length = 0
  }

  // Both ends of every octave shift in the part, paired the same way.
  readonly #ottavaEnds: SpanEnd<OpenOttava, undefined>[] = []
  // The last event read on each staff, from the measures settled so far.
  readonly #lastSeen = new Map<number, LastSeen>()

  startOttava(open: OpenOttava, number: string, where: WrittenAt): void {
    this.#ottavaEnds.push({
      kind: 'start',
      number,
      measure: open.measure,
      position: open.position,
      covers: open.position,
      // The staff is the shift's own, so the two cannot disagree about it.
      staff: open.staff,
      payload: open,
      where,
    })
  }

  stopOttava(
    number: string,
    measure: number,
    position: Fraction,
    cursor: Fraction,
    graceWritten: number,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#ottavaEnds.push({
      kind: 'stop',
      number,
      measure,
      position,
      staff,
      // Where the cursor stood when the stop was written. settleSpanCovers
      // below reads the covered event from it once the measure is whole, and
      // it stands as written where the measure holds no event before it.
      covers: cursor,
      graceWritten,
      where,
      stop: undefined,
    })
  }

  /**
   * States which event each hairpin and octave-shift stop of a measure covers,
   * once the whole measure is read. Neither can be settled while the measure
   * is still being read: a <backup> can put an octave shift's covered event
   * later in the document than its stop, and grace notes read after a stop
   * change how MNX numbers the ones read before it.
   *
   * A stop written after grace notes is drawn over them, so it ends on the
   * last one written before it. MNX numbers a grace note back from the note
   * it ornaments, counting from the right, so that one is the total standing
   * there less the ones the stop was written after, plus one.
   *
   * A stop with no grace notes before it keeps the place it was written for a
   * hairpin, and for an octave shift moves back to the last event the cursor
   * had passed, on the staff the stop names. Where the stop is written before
   * any event of its measure, that event is in a measure before.
   *
   * A hairpin stop also learns whether it sits at the barline, which is the
   * measure's `length` from its start.
   */
  settleSpanCovers(measure: number, length: Fraction, timeline: EventTimeline): void {
    const overGraceNotes = (end: EndPlace): boolean => {
      if (!end.graceWritten) return false
      end.coversGraceIndex = timeline.graceNotesAt(end.covers, end.staff) - end.graceWritten + 1
      return true
    }

    // The sweep settles the stops of the measure just read, against that
    // measure's own events. A stop of any other measure is settled by the
    // sweep of its own, and settling it again here would move it to an event
    // of a measure it never reached.
    const stoppingHere = <E extends EndPlace & { kind: 'start' | 'stop' }>(
      ends: readonly E[],
    ): E[] => ends.filter((end) => end.kind === 'stop' && end.measure === measure)

    for (const end of stoppingHere(this.#wedgeEnds)) {
      overGraceNotes(end)
      end.atBarline = compareFractions(end.position, length) === 0
    }

    // Only an octave shift moves back off the point its stop was written at.
    //
    // The stop moves to the last event before it on the staff it names. If
    // that staff has no event, the stop moves to the last event on any staff.
    // A source can name a staff that holds only a whole-measure rest, which MNX
    // writes as the measure's own, not as an event. Left where it was
    // written, such a stop would end on the barline, where no event begins.
    for (const end of stoppingHere(this.#ottavaEnds)) {
      if (overGraceNotes(end)) continue
      const inMeasure =
        timeline.lastEventBefore(end.covers, end.staff) ?? timeline.lastEventBefore(end.covers)
      const before = inMeasure ? undefined : this.#lastSeenOn(end.staff)
      if (before) end.coversMeasure = before.measure
      const covered = inMeasure ?? before?.event
      if (!covered) continue
      end.covers = covered.start
      if (covered.graceIndex !== undefined) end.coversGraceIndex = covered.graceIndex
    }

    for (const [staff, event] of timeline.lastEvents()) {
      this.#lastSeen.set(staff, { measure, event })
    }
  }

  /**
   * The last event read so far on a staff, or on any staff where that staff
   * has none or none is named.
   */
  #lastSeenOn(staff: number | undefined): LastSeen | undefined {
    const own = staff === undefined ? undefined : this.#lastSeen.get(staff)
    if (own) return own
    let latest: LastSeen | undefined
    for (const seen of this.#lastSeen.values()) {
      if (
        !latest ||
        seen.measure > latest.measure ||
        (seen.measure === latest.measure &&
          compareFractions(seen.event.start, latest.event.start) > 0)
      ) {
        latest = seen
      }
    }
    return latest
  }

  /** The same as dropWedgeStart, for an octave shift the reader dropped. */
  dropOttavaStart(
    number: string,
    measure: number,
    position: Fraction,
    staff: number | undefined,
    where: WrittenAt,
  ): void {
    this.#ottavaEnds.push({
      kind: 'start',
      number,
      measure,
      position,
      covers: position,
      staff,
      dropped: true,
      where,
    })
  }

  /**
   * Joins every octave shift in the part, putting each finished one on the
   * measure it begins in. MNX requires a shift to say where it stops, so one
   * the source never closed cannot be written.
   */
  #resolveOttavas(measures: readonly Measure[], warnings: WarningCollector): void {
    pairSpans<OpenOttava, undefined>(
      this.#ottavaEnds,
      (open, stop) => {
        // Assigned, not spread in, so the compiler tells an absent key from an
        // undefined one.
        const end: Draft<SpanStop> = {
          measure: stop.coversMeasure ?? stop.measure,
          position: stop.covers,
        }
        if (stop.coversGraceIndex !== undefined) end.graceIndex = stop.coversGraceIndex
        const ottava: Draft<Ottava> = {
          position: open.position,
          end,
          value: open.value,
          staff: open.staff,
        }
        if (open.placement !== undefined) ottava.placement = open.placement
        measures[open.measure]?.ottavas.push(ottava)
      },
      (reason, end) => {
        reportAt(
          end.where,
          'unclosed:spanner',
          reason === 'orphan-stop'
            ? 'An octave shift stops where none had started, and is not carried over.'
            : reason === 'backwards-stop'
              ? // MNX states the end of a shift as the last event it covers,
                // and the stop's cursor can pass the start while that event
                // falls before it. Dropped and reported, the same as one the
                // source never closed.
                'An octave shift would end before it starts, its stop covering an event ' +
                'earlier than its start, and is not carried over.'
              : 'An octave shift starts where nothing ends it, and MNX states where one ' +
                'stops, so it is not carried over.',
          warnings,
        )
      },
    )
    this.#ottavaEnds.length = 0
  }
}
