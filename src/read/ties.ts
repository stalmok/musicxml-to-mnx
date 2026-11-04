// Joining up the two ends of a tie.
//
// MusicXML marks both ends and leaves the connection implied: a note says a
// tie starts here, and a later note of the same pitch says one stops. MNX
// states the connection once, on the note where it begins, pointing at the
// id of the note where it finishes.

import { compareFractions, isZero } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  CurveSide,
  KitNote,
  Measure,
  Note,
  Pitch,
  SequenceItem,
  TieTarget,
} from '../model/score.js'
import { reportAt } from './collector.js'
import type { WarningCollector, WrittenAt } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'
import type { TiesOn } from './lines.js'
import { inTimeOrder, openedIn, pairSpans, voiceKey } from './spanPairing.js'
import { chromaticIndex } from './steps.js'
import type { EndPlace, StartEnd, StopEnd } from './spanPairing.js'

/** A tie that has begun, waiting for the note that ends it. */
interface OpenTie {
  note: TieTarget
  /**
   * Where the note stops sounding, from the start of its measure. A grace
   * note takes no time, so it is where the note begins.
   */
  until: Fraction
  /** Whether the note sounds until the barline. Settled once its measure is whole. */
  reachesBarline: boolean
  /** The side the tie is drawn on, where the start states it. */
  side: CurveSide | undefined
  /** Whether the start states the tie in <tied>, not in <tie> alone. */
  drawn: boolean
}

/** Where a tie ends. */
interface TieStopAt {
  note: TieTarget
  /** Whether the stop states the tie in <tied>, not in <tie> alone. */
  drawn: boolean
}

/**
 * How many events a voice or line has sounded in the part, the note's own
 * included, and how many of those just before the note were grace notes.
 */
interface SoundedPlace {
  sounded: number
  gracesBefore: number
}

/** Where a tie's end is written, and how far its voice has sounded. */
type TiePlace = EndPlace & SoundedPlace

/** A tie's end, with the line its note is written in once the part is read. */
type LinedTiePlace = TiePlace & { line: LinePlace | undefined }

/** One end of a tie, and on a stop the note it is written on. */
type TieEnd = (StartEnd<OpenTie> | StopEnd<TieStopAt>) & TiePlace

export type LinedTieEnd = TieEnd & LinedTiePlace
type LinedTieStart = Extract<LinedTieEnd, { kind: 'start' }>
type LinedTieStop = Extract<LinedTieEnd, { kind: 'stop' }>

// Ties are matched on pitch across the part, not within a voice. A tie often
// runs between voices, which MNX allows with a crossVoice target.
//
// Matched on the sounding pitch, not the written spelling, because a tie can
// end on a respelling of the same sound: G sharp to A flat, or B sharp to C
// across the octave boundary. A pair that disagrees on the sound stays
// unmatched and is reported.
function tieKey(pitch: Pitch): string {
  return String(chromaticIndex(pitch))
}

/**
 * What a tie on this note pairs by: the pitch of a pitched note, and the kit
 * component struck for a note with no pitch to compare.
 */
export function tiePairing(note: Note | KitNote): string {
  return 'pitch' in note ? tieKey(note.pitch) : note.component
}

/**
 * Where a note is written: the voice and staff of its sequence, how far that
 * line has sounded, and what each grace note the line sounded just before it pairs by.
 */
interface LinePlace extends SoundedPlace {
  voice: string | undefined
  staff: number | undefined
  graceKeys: readonly (readonly string[])[]
}

/** How far a voice or line has sounded, and the grace notes it sounded last. */
interface SoundCount {
  sounded: number
  graceRun: number
}

/** What each grace note a line sounded last pairs by, by the line's voice. */
type GraceRuns = Map<string | undefined, string[][]>

/** Counts one event sounded in a voice or line, and says where it falls. */
function countSound(
  counts: Map<string | undefined, SoundCount>,
  voice: string | undefined,
  grace: boolean,
): SoundedPlace {
  const { sounded, graceRun } = counts.get(voice) ?? { sounded: 0, graceRun: 0 }
  counts.set(voice, { sounded: sounded + 1, graceRun: grace ? graceRun + 1 : 0 })
  return { sounded: sounded + 1, gracesBefore: graceRun }
}

/** What each measure writes of the part's lines, by the line's name. */
interface MeasureLines {
  /** Whether a measure writes a line of that voice. */
  writes(line: string | undefined, measure: number): boolean
  /** The staff a measure writes a line on, where the part has more than one. */
  staffOf(line: string | undefined, measure: number): number | undefined
}

/**
 * The line each note is written in, by the note's id, how far each line had
 * sounded at each note it sounds, by voiceKey, and what each measure
 * writes of each line.
 */
function linePlacesOf(measures: readonly Measure[]): {
  places: Map<string, LinePlace>
  sounds: Map<string, number[]>
  lines: MeasureLines
} {
  const places = new Map<string, LinePlace>()
  const sounds = new Map<string, number[]>()
  const written: ReadonlyMap<string | undefined, number | undefined>[] = []
  const counts = new Map<string | undefined, SoundCount>()
  const graceRuns: GraceRuns = new Map()
  const walk = (
    items: readonly SequenceItem[],
    voice: string | undefined,
    staff: number | undefined,
    grace: boolean,
  ): void => {
    for (const item of items) {
      if (item.kind === 'event') {
        // A rest ends the grace notes sounded just before a note.
        if (item.body.kind === 'rest') {
          graceRuns.set(voice, [])
          continue
        }
        const place = countSound(counts, voice, grace)
        const notes = [...item.body.notes, ...item.body.kitNotes]
        const graceKeys = graceRuns.get(voice) ?? []
        for (const note of notes) {
          places.set(note.id, { voice, staff, graceKeys, ...place })
          const key = voiceKey(voice, tiePairing(note))
          const at = sounds.get(key)
          if (at) at.push(place.sounded)
          else sounds.set(key, [place.sounded])
        }
        graceRuns.set(voice, grace ? [...graceKeys, notes.map(tiePairing)] : [])
      } else if (item.kind !== 'space') {
        walk(item.content, voice, staff, grace || item.kind === 'grace')
      }
    }
  }
  for (const measure of measures) {
    for (const sequence of measure.sequences) {
      walk(sequence.content, sequence.voice, sequence.staff, false)
    }
    written.push(new Map(measure.sequences.map((sequence) => [sequence.voice, sequence.staff])))
  }
  const lines: MeasureLines = {
    writes: (line, measure) => written[measure]?.has(line) === true,
    staffOf: (line, measure) => written[measure]?.get(line),
  }
  return { places, sounds, lines }
}

/**
 * Whether a stop falls on the event its line sounds next after the start,
 * where grace notes before the stop do not count. A voice that writes two
 * lines laid over each other sounds both, so within one line only that
 * line's events count. A line keeps its name across the barline (see
 * PartLines), except where the voice sounds one line between the two ends,
 * which may hold either (see keepsLineBetween). Where the two ends are in
 * different lines, or either note's line is unknown, every event of the
 * voice counts. A tie does not reach across its pitch sounded anywhere in
 * its voice, within one line or past grace notes.
 */
function soundsNext(
  start: LinedTiePlace,
  stop: LinedTiePlace,
  lines: MeasureLines,
  voiceSounds: VoiceSounds,
  soundedBetween: () => boolean,
): boolean {
  const inLine =
    start.line !== undefined &&
    stop.line !== undefined &&
    start.line.voice === stop.line.voice &&
    nextPastGraces(start.line, stop.line) &&
    keepsLineBetween(
      { ...start, line: start.line },
      { ...stop, line: stop.line },
      lines,
      voiceSounds,
    )
  return (inLine || nextPastGraces(start, stop)) && !soundedBetween()
}

/** Whether a voice sounds anything in a measure, in any of its lines. */
type VoiceSounds = (voice: string | undefined, measure: number) => boolean

/**
 * Whether each measure between a tie's two ends in one line writes that
 * line, or sounds nothing of the voice, or sounds it on a staff neither end
 * is on. A measure that writes the voice in one line names that line after
 * the voice, and the one line may be sounding the tie's line.
 */
function keepsLineBetween(
  start: PlacedTieEnd<LinedTiePlace>,
  stop: PlacedTieEnd<LinedTiePlace>,
  lines: MeasureLines,
  voiceSounds: VoiceSounds,
): boolean {
  for (let measure = start.measure + 1; measure < stop.measure; measure++) {
    if (lines.writes(start.line.voice, measure) || !voiceSounds(start.voice, measure)) continue
    const staff = lines.staffOf(start.voice, measure)
    if (staff === undefined || staff === start.line.staff || staff === stop.line.staff) {
      return false
    }
  }
  return true
}

/** Whether only grace notes sound between a start and a stop. */
function nextPastGraces(start: SoundedPlace, stop: SoundedPlace): boolean {
  return stop.sounded > start.sounded && stop.sounded - start.sounded <= stop.gracesBefore + 1
}

/** A tie end whose note the part's sequences hold. */
type PlacedTieEnd<E> = E & { line: LinePlace }

/** Whether two tie ends are written in one line, which is one sequence of the measure. */
function sameLine(start: { line: LinePlace }, stop: { line: LinePlace }): boolean {
  return start.line.voice === stop.line.voice
}

/**
 * Whether a stop begins the instant its start's note stops sounding: in the
 * same measure, or on the first beat after the barline the note runs to. A
 * grace note takes no time, so a tie from one ends on a note at its own
 * instant that sounds after it: later in its line, or the beat note of
 * another line.
 */
function touches(start: PlacedTieEnd<LinedTieStart>, stop: PlacedTieEnd<LinedTieStop>): boolean {
  const { until, reachesBarline } = start.payload
  const atUntil =
    stop.measure === start.measure
      ? compareFractions(stop.position, until) === 0
      : stop.measure === start.measure + 1 && isZero(stop.position) && reachesBarline
  if (!atUntil || start.grace !== true) return atUntil
  return sameLine(start, stop) ? stop.line.sounded > start.line.sounded : stop.grace !== true
}

/**
 * Whether a grace note on the tie's pitch sounds in the stop's line just
 * before the stop, after the start. The tie would reach across it.
 */
function crossesGraceNote(
  start: PlacedTieEnd<LinedTieStart>,
  stop: PlacedTieEnd<LinedTieStop>,
): boolean {
  const { graceKeys, sounded } = stop.line
  const first = sounded - graceKeys.length
  const afterStart = (index: number): boolean =>
    !sameLine(start, stop) || first + index > start.line.sounded
  return graceKeys.some((keys, index) => keys.includes(stop.number) && afterStart(index))
}

/**
 * Joins each tie whose stop begins the instant its start's note stops
 * sounding, and hands back the ends it joined. A start takes such a stop in
 * its own line first, then in its own voice, then in any voice, so the ties
 * of one pitch in two lines or two hands stay apart. Among stops alike in
 * that, it takes the first written, so the ties of a pitch written twice in
 * one chord keep their order.
 *
 * A start of another voice does not take a stop that a start of the stop's
 * own voice `owns`, by the rules the ends left over are paired by. A tie
 * within one voice is the source's own statement, past rests too.
 */
export function pairTouching(
  ends: readonly LinedTieEnd[],
  owns: (start: LinedTieStart, stop: LinedTieStop) => boolean,
  join: (start: LinedTieStart, stop: LinedTieStop) => void,
): Set<LinedTieEnd> {
  const placed = ends.filter((end): end is PlacedTieEnd<LinedTieEnd> => end.line !== undefined)
  const at = (number: string, measure: number): string => JSON.stringify([number, measure])
  const stops = new Map<string, PlacedTieEnd<LinedTieStop>[]>()
  for (const end of placed) {
    if (end.kind !== 'stop') continue
    const key = at(end.number, end.measure)
    const here = stops.get(key)
    if (here) here.push(end)
    else stops.set(key, [end])
  }

  const joined = new Set<LinedTieEnd>()
  const starts = inTimeOrder(
    placed.filter((end): end is PlacedTieEnd<LinedTieStart> => end.kind === 'start'),
    'as-written',
  )
  const startsOf = new Map<string, LinedTieStart[]>()
  for (const start of starts) {
    const same = startsOf.get(start.number)
    if (same) same.push(start)
    else startsOf.set(start.number, [start])
  }
  // Asked at the any-voice level only, where the start is in another voice
  // from the stop and owns nothing of it.
  const ownedElsewhere = (stop: LinedTieStop): boolean =>
    (startsOf.get(stop.number) ?? []).some((other) => !joined.has(other) && owns(other, stop))
  const levels = [
    sameLine,
    openedIn,
    (_: LinedTieStart, stop: LinedTieStop) => !ownedElsewhere(stop),
  ]
  for (const level of levels) {
    for (const start of starts) {
      if (joined.has(start)) continue
      const candidates = [
        ...(stops.get(at(start.number, start.measure)) ?? []),
        ...(stops.get(at(start.number, start.measure + 1)) ?? []),
      ]
      const stop = candidates.find(
        (candidate) =>
          !joined.has(candidate) &&
          touches(start, candidate) &&
          level(start, candidate) &&
          !crossesGraceNote(start, candidate),
      )
      if (!stop) continue
      joined.add(start)
      joined.add(stop)
      join(start, stop)
    }
  }
  return joined
}

/**
 * A point in a voice's time. A grace note sounds before the beat it is at,
 * and grace notes at one beat sound in the order the voice sounds them.
 */
interface Instant {
  measure: number
  position: Fraction
  grace?: boolean
  sounded: number
}

function isBefore(a: Instant, b: Instant): boolean {
  if (a.measure !== b.measure) return a.measure < b.measure
  const byPosition = compareFractions(a.position, b.position)
  if (byPosition !== 0) return byPosition < 0
  if (a.grace === true && b.grace === true) return a.sounded < b.sounded
  return a.grace === true && b.grace !== true
}

export class TieResolver implements PartCollector {
  // Both ends of every tie in the part, paired once all of them are in.
  readonly #tieEnds: TieEnd[] = []
  /** What the ties written on each note pair by, by the note's id. */
  readonly #tiesOn = new Map<string, TiesOn>()
  // How far each voice has sounded so far in the part.
  readonly #sounded = new Map<string | undefined, SoundCount>()
  // Where the event each voice sounded last falls.
  readonly #lastSounded = new Map<string | undefined, SoundedPlace>()
  // The voices that sound in the measure being read, until it is whole.
  readonly #soundingInMeasure = new Set<string | undefined>()
  // The voices that sound in each measure.
  readonly #soundingByMeasure: ReadonlySet<string | undefined>[] = []
  // Where each voice sounds what a tie pairs by, by voiceKey.
  readonly #soundings = new Map<string, Instant[]>()
  // The ties begun in the measure being read, until it is whole.
  readonly #startsInMeasure: OpenTie[] = []

  /**
   * Counts an event that sounds in a voice. A tie in its own voice joins one
   * event to the next its voice sounds, past any grace notes, so this is what
   * tells a stop from a start its voice has sounded past.
   */
  sound(voice: string | undefined, grace: boolean): void {
    this.#lastSounded.set(voice, countSound(this.#sounded, voice, grace))
    this.#soundingInMeasure.add(voice)
  }

  /** Notes where a voice sounds a note, by what a tie on it pairs by. */
  sounding(
    pairedBy: string,
    voice: string | undefined,
    measure: number,
    position: Fraction,
    grace: boolean,
  ): void {
    const key = voiceKey(voice, pairedBy)
    const instant = { measure, position, grace, sounded: this.#soundedIn(voice).sounded }
    const at = this.#soundings.get(key)
    if (at) at.push(instant)
    else this.#soundings.set(key, [instant])
  }

  /** Whether the voice of a tie sounds its pitch between the tie's two ends. */
  #soundedBetween(start: TiePlace, stop: TiePlace): boolean {
    const at = this.#soundings.get(voiceKey(start.voice, start.number)) ?? []
    return at.some((instant) => isBefore(start, instant) && isBefore(instant, stop))
  }

  #soundedIn(voice: string | undefined): SoundedPlace {
    return this.#lastSounded.get(voice) ?? { sounded: 0, gracesBefore: 0 }
  }

  /** What the ties written on a note pair by, at each end it holds. */
  tiesOn(note: string): TiesOn {
    return this.#tiesOn.get(note) ?? { start: undefined, stop: undefined }
  }

  #tieOn(note: string, end: keyof TiesOn, pairedBy: string): void {
    this.#tiesOn.set(note, { ...this.tiesOn(note), [end]: pairedBy })
  }

  /**
   * Notes the note a tie begins on, to be paired once the part is read.
   *
   * A tie joins two notes of the same sound, and `pairedBy` is what says two
   * are the same: a pitch for a pitched note, and the kit component struck
   * for a note with no pitch to compare.
   */
  startTie(
    note: TieTarget,
    pairedBy: string,
    voice: string | undefined,
    side: CurveSide | undefined,
    drawn: boolean,
    measure: number,
    position: Fraction,
    until: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    const open = { note, until, reachesBarline: false, side, drawn }
    this.#tieOn(note.id, 'start', pairedBy)
    this.#startsInMeasure.push(open)
    this.#tieEnds.push({
      kind: 'start',
      number: pairedBy,
      measure,
      position,
      voice,
      grace,
      covers: position,
      payload: open,
      where,
      ...this.#soundedIn(voice),
    })
  }

  /** The same, for the note a tie ends on. */
  stopTie(
    note: TieTarget,
    pairedBy: string,
    voice: string | undefined,
    drawn: boolean,
    measure: number,
    position: Fraction,
    grace: boolean,
    where: WrittenAt,
  ): void {
    this.#tieOn(note.id, 'stop', pairedBy)
    this.#tieEnds.push({
      kind: 'stop',
      number: pairedBy,
      measure,
      position,
      voice,
      grace,
      covers: position,
      where,
      stop: { note, drawn },
      ...this.#soundedIn(voice),
    })
  }

  /**
   * Joins every tie in the part, once both ends of all of them are in.
   *
   * A tie holds a note on into the next note of its pitch, so a stop that
   * begins the instant its start stops sounding is that start's own, and is
   * joined first (see pairTouching). A start written at the stop's own
   * instant, in a line laid over it, does not reach it.
   *
   * The ends left over are paired in time order, not as the ends are met,
   * for the reason every span is (see SpanEnd in spanPairing.ts). Sources tie a note into its
   * pitch past rests, past a note in between, or into a measure that runs
   * short.
   *
   * A stop takes the open start of its own voice on the event its voice
   * sounded just before, grace notes aside, so two hands each sustaining one pitch pair within a
   * hand. That pair is the source's own statement, and it holds at any
   * distance: a score can tie a note to its pitch's next sounding measures
   * away, across rests. A start its voice has sounded past is not one. Where a
   * voice writes two lines laid over each other, a tie within one line counts
   * that line's events only (see soundsNext). Where a stop's own line and
   * another line each hold a start it could take, it takes the one in its
   * own line.
   *
   * A stop with no same-voice start falls back to the most recent open start
   * of any voice. That pair is inferred, so it reaches back one measure at
   * most: a cross-voice tie joins two notes sounding into each other, and a
   * note never crosses a barline. It does not reach across its pitch sounded
   * in its own voice.
   *
   * Whether MNX marks a tie as crossing voices does not follow from which way
   * it paired. It follows from the sequences its two notes are written in.
   */
  #resolveTies(measures: readonly Measure[], warnings: WarningCollector): void {
    const { places, sounds, lines } = linePlacesOf(measures)
    const ends = this.#tieEnds.map((end): LinedTieEnd => ({
      ...end,
      line: places.get(end.kind === 'start' ? end.payload.note.id : end.stop.note.id),
    }))
    // Within one line, by that line's own events: the other line of a voice
    // that writes two sounds its own notes. Across two lines, or where a
    // line is unknown, by the voice's.
    const soundedBetween = (start: LinedTiePlace, stop: LinedTiePlace): boolean => {
      if (!start.line || !stop.line || start.line.voice !== stop.line.voice) {
        return this.#soundedBetween(start, stop)
      }
      const from = start.line.sounded
      const to = stop.line.sounded
      const at = sounds.get(voiceKey(start.line.voice, start.number)) ?? []
      return at.some((sounded) => sounded > from && sounded < to)
    }
    // A tie's two ends mark the very points they are written on, so no stop
    // covers a point before its start; the backwards message is here for the
    // shape of the report, as a slur's is.
    const messages = {
      'orphan-stop': 'A tie ends on a note where none had started, and is not carried over.',
      'backwards-stop': 'A tie would end before it starts, and is not carried over.',
      'unclosed-start': 'A tie starts on a note that nothing ties to, and is not carried over.',
    }
    const join = (
      open: OpenTie,
      stop: StopEnd<TieStopAt> & LinedTiePlace,
      start: StartEnd<OpenTie> & LinedTiePlace,
    ): void => {
      // A tie stated in <tie> at both ends and in <tied> at neither sounds
      // but is not drawn, as MuseScore writes an invisible tie.
      if (!open.drawn && !stop.stop.drawn) {
        reportAt(
          start.where,
          'unrepresentable:element',
          'A tie stated by <tie> with no <tied> on either note sounds but is not drawn, ' +
            'and cannot be expressed in MNX, where a tie is always drawn.',
          warnings,
        )
        return
      }

      open.note.ties = [
        ...open.note.ties,
        {
          kind: 'target',
          target: stop.stop.note.id,
          // Compared by the sequences the two notes are written in, not by
          // the source's <voice>: a line laid over its own voice is a
          // sequence of its own, with a name of its own.
          crossVoice: start.line?.voice !== stop.line?.voice,
          ...(open.side !== undefined ? { side: open.side } : {}),
        },
      ]
    }
    const voiceSounds: VoiceSounds = (voice, measure) =>
      this.#soundingByMeasure[measure]?.has(voice) === true
    const owns = (start: LinedTiePlace, stop: LinedTiePlace): boolean =>
      openedIn(start, stop) &&
      soundsNext(start, stop, lines, voiceSounds, () => this.#soundedBetween(start, stop))
    const joined = pairTouching(ends, owns, (start, stop) => {
      join(start.payload, stop, start)
    })
    // Two ties of one pitch can be open at once, as when two hands each
    // sustain it, so each pitch holds a stack rather than a single open tie.
    pairSpans<OpenTie, TieStopAt, LinedTiePlace>(
      ends.filter((end) => !joined.has(end)),
      join,
      (reason, end) => {
        reportAt(end.where, 'unclosed:spanner', messages[reason], warnings)
      },
      'as-written',
      undefined,
      {
        prefers: (start, stop) => start.line?.voice === stop.line?.voice,
        owns,
        reaches: (start, stop) =>
          stop.measure - start.measure <= 1 &&
          !(openedIn(start, stop) && soundedBetween(start, stop)),
      },
    )
    this.#tieEnds.length = 0
  }

  /**
   * Settles what waits for the measure to be whole: whether each tie begun in
   * it sounds until the barline, which is the measure's `length` from its
   * start, and which voices sounded in it.
   */
  settleMeasure(measure: number, length: Fraction): void {
    for (const open of this.#startsInMeasure) {
      open.reachesBarline = compareFractions(open.until, length) === 0
    }
    this.#soundingByMeasure[measure] = new Set(this.#soundingInMeasure)
    this.#soundingInMeasure.clear()
    this.#startsInMeasure.length = 0
  }

  /** Joins every tie in the part, and reports what stays unpaired. */
  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void {
    this.#resolveTies(
      measures.map((reading) => reading.measure),
      warnings,
    )
  }
}
