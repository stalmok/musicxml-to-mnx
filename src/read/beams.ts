// Turning MusicXML's per-note beam markings into MNX's tree of beams.
//
// MusicXML puts the beams on the notes. Each note says, for every beam level
// it carries, whether a beam begins, continues or ends there, where level 1
// is the eighth-note beam, level 2 the sixteenth, and so on. A note beamed to
// only one neighbour carries a hook instead, pointing forward or back.
//
// MNX states it as a tree over the measure: an outer beam listing the events
// it runs over, nested beams for the secondary levels, and a beam of one event
// with a direction for a hook.

import type { Beam, NoteValueBase } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { ElementReader } from './element.js'
import { parseWholeNumber } from './numbers.js'
import { attributeLoss } from './unrepresentable.js'
import { entriesOf, recogniser } from './tables.js'

/** MusicXML's beam-value: what the beam at a level does at a note. */
export type BeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook'

export const isBeamValue = recogniser<BeamValue>({
  begin: true,
  continue: true,
  end: true,
  'forward hook': true,
  'backward hook': true,
})

/** What one <beam> says the beam at its level does at this event. */
export interface BeamMarker {
  /**
   * Nothing where the text is not one MusicXML defines. The beam at its level
   * then stops before the event, as at an event with no marker there.
   */
  kind: BeamValue | undefined
  element: XmlElement
}

/** What one event says about the beams it carries, by level. */
export interface BeamedEvent {
  id: string
  markers: ReadonlyMap<number, BeamMarker>
  /**
   * Set where the event opens the measure with a primary continue or end, in
   * a voice whose primary beam the measure before left open. `line` names
   * the line whose beam it carries on, as lineKey names it, or nothing where
   * another line of the voice carries that beam on. Never set for a grace
   * note, whose beams stay in its group.
   */
  continuesFrom: { line: string | undefined } | undefined
  /**
   * How many beams the note's value calls for: an eighth one, a 16th two. An
   * inner beam that closes on this event alone is kept only up to this level.
   */
  beamCount: number
}

// How many beams each note value is drawn with. A Record, so a note value
// added to the model does not compile until it is added here.
const BEAM_COUNTS: Record<NoteValueBase, number> = {
  maxima: 0,
  longa: 0,
  breve: 0,
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
  '256th': 6,
  '512th': 7,
  '1024th': 8,
}

/** How many beams a note of this value carries. Zero for a quarter or longer. */
export function beamCountForValue(base: NoteValueBase): number {
  return BEAM_COUNTS[base]
}

// The table read the other way round, for a note whose beams are the only
// sign of its value. Only beamed values are in it, so each count names one
// value.
const VALUE_FOR_BEAMS = new Map<number, NoteValueBase>(
  entriesOf(BEAM_COUNTS)
    .filter(([, count]) => count > 0)
    .map(([base, count]) => [count, base]),
)

/** The value drawn with `count` beams: one beam is an eighth, two a 16th. */
export function valueForBeamCount(count: number): NoteValueBase | undefined {
  return VALUE_FOR_BEAMS.get(count)
}

// A stem carries at most eight beams, so a level past that draws nothing.
export const MOST_BEAM_LEVELS = 8

const HOOK_DIRECTIONS = new Map<BeamValue, 'left' | 'right'>([
  ['forward hook', 'right'],
  ['backward hook', 'left'],
])

/**
 * The primary beams a measure leaves open at its barline: by voice, the
 * staff each line of the voice left its beam open on, by line.
 */
export type BeamsOpenAtBarline = ReadonlyMap<string, ReadonlyMap<number, number | undefined>>

/** Names a line of a voice across measures, as the voice and its line number. */
export function lineKey(voice: string, line: number): string {
  return `${voice}\n${String(line)}`
}

/** One line of a voice's beam markers over a measure. */
export interface BeamedRun {
  /** The line, as lineKey names it. Nothing for a grace group, which beams within itself. */
  line: string | undefined
  events: readonly BeamedEvent[]
  /** Whether the line's last event leaves its primary beam open at the barline. */
  openAtBarline: boolean
}

/** A primary beam left open at a barline, waiting for the next measure. */
interface OpenBeam {
  /** Its events so far, from the measure it starts in on. */
  events: readonly BeamedEvent[]
  /** The beams of the measure it starts in, which is where MNX states it. */
  home: Beam[]
  /** The beam as stated so far, where it holds more than one event. */
  stated: Beam | undefined
}

/**
 * The primary beams a part leaves open at its barlines, by line.
 *
 * A beam crossing the barline shows as a continue or end on the event that
 * opens the measure, in a voice whose beam the measure before left open.
 * MNX states such a beam on the measure it starts in, listing the events of
 * every measure it runs over. An open beam is stated as it stands, since a
 * source may leave the barline to close it, and replaced by the joined beam
 * where the next measure carries it on.
 */
export class OpenBeams {
  #open = new Map<string, OpenBeam>()

  /** The beams of one measure, outermost first, less any it joins to an earlier measure. */
  measure(runs: readonly BeamedRun[]): Beam[] {
    const carried = this.#open
    this.#open = new Map()
    const beams: Beam[] = []
    for (const { line, events, openAtBarline } of runs) {
      const joins = events[0]?.continuesFrom?.line
      const from = joins === undefined ? undefined : carried.get(joins)
      const { beams: built, trailing } = beamRuns(from ? [...from.events, ...events] : events, 1)
      for (const beam of built) {
        if (from && beam.events[0] === from.events[0]?.id) restate(from, beam)
        else beams.push(beam)
      }
      if (line !== undefined && openAtBarline && trailing) {
        const joined = from !== undefined && trailing.run[0] === from.events[0]
        this.#open.set(line, {
          events: trailing.run,
          home: joined ? from.home : beams,
          stated: trailing.beam,
        })
      }
    }
    return beams
  }
}

/** States the joined beam in place of the open beam it carries on. */
function restate(open: OpenBeam, beam: Beam): void {
  const at = open.stated === undefined ? -1 : open.home.indexOf(open.stated)
  if (at < 0) open.home.push(beam)
  else open.home[at] = beam
}

/**
 * The beams over one measure of one voice, outermost first.
 *
 * A run at a given level starts where a beam begins and closes where it ends.
 * A run the measure never closes is kept, since a source may leave the
 * barline to close it. A primary run over one event is dropped, because a
 * beam over a single note is a flag.
 */
export function buildBeams(events: readonly BeamedEvent[]): Beam[] {
  return beamRuns(events, 1).beams
}

interface BeamedRuns {
  beams: Beam[]
  /**
   * The run still open where the events run out, and the beam stated for it
   * where it holds one.
   */
  trailing: { run: readonly BeamedEvent[]; beam: Beam | undefined } | undefined
}

function beamRuns(
  events: readonly BeamedEvent[],
  level: number,
  /**
   * Whether the run these events make up carries on a beam from the measure
   * before, so an inner beam can carry on with it.
   */
  carriesOn = true,
): BeamedRuns {
  const beams: Beam[] = []
  let run: BeamedEvent[] = []
  // Whether the run carries on a beam from the measure before.
  let fromBefore = false

  const close = (): void => {
    const [only] = run
    if (run.length > 1) {
      beams.push({
        events: run.map((event) => event.id),
        beams: beamRuns(run, level + 1, fromBefore).beams,
        direction: undefined,
      })
    } else if (only !== undefined && level > 1 && only.beamCount >= level) {
      // A single event left at an inner level came from a begin, or carries
      // on a beam from the measure before. Where the note's value needs this
      // beam, it is a partial beam pointing at the rest of it. A repeated
      // begin (two begins with no end between) leaves the first note in this
      // shape.
      beams.push({ events: [only.id], beams: [], direction: fromBefore ? 'left' : 'right' })
    }
    // A single event whose value does not need this beam is a stray marker.
    // It is dropped with no warning, because the note is drawn correctly
    // without it.
    run = []
    fromBefore = false
  }

  for (const event of events) {
    const found = event.markers.get(level)
    const marker = found?.kind

    const hook = marker === undefined ? undefined : HOOK_DIRECTIONS.get(marker)
    if (hook) {
      // A hook belongs to the level it is written at, beside the runs there.
      // A note may carry hooks at several levels, as a 32nd beside a
      // double-dotted eighth does, and the deeper ones nest inside this one.
      beams.push({
        events: [event.id],
        beams: beamRuns([event], level + 1, false).beams,
        direction: hook,
      })
      continue
    }

    if (marker === 'begin') {
      close()
      run = [event]
    } else if (found?.kind === 'continue' || found?.kind === 'end') {
      if (run.length > 0) {
        run.push(event)
      } else if (carriesOn && event.continuesFrom !== undefined) {
        // The beam before it holds no begin, so there is nothing to join to.
        run = [event]
        fromBefore = true
      }
      // Anywhere else, an end or continue with no begin is not a beam, and
      // the notes are drawn correctly without it.
      if (marker === 'end') close()
    } else {
      close()
    }
  }
  const trailing = run.length > 0 ? run : undefined
  const stated = beams.length
  close()

  return {
    beams,
    trailing: trailing && { run: trailing, beam: beams.length > stated ? beams.at(-1) : undefined },
  }
}

/**
 * What a note says about its beams, by level. A note carries one <beam> per
 * level it is beamed at, so all of them are read: level 1 is the eighth-note
 * beam, level 2 the sixteenth, and so on.
 */
export function beamMarkers(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
): ReadonlyMap<number, BeamMarker> {
  const markers = new Map<number, BeamMarker>()
  for (const beam of element.children('beam')) {
    // Read before the marker is checked, so the fan and the text of a
    // dropped marker are not reported apart from it.
    const fan = attribute(beam, 'fan')
    const kind = trimmedText(beam)
    // The level is the attribute; the element's own text says what the beam
    // does there, as "begin" or "end". A level MusicXML does not define draws
    // no beam, and the measure adds up without it, so the marker is dropped
    // and reported, not refused.
    const level = beamLevel(beam, warnings, context)
    if (level === undefined) continue
    if (isBeamValue(kind)) {
      reportFan(beam, fan, warnings, context)
      markers.set(level, { kind, element: beam })
    } else {
      warnings.addUndefinedText(beam, 'and the beam at its level stops before this note.', context)
      markers.set(level, { kind: undefined, element: beam })
    }
  }
  return markers
}

/**
 * A fanned beam draws an accelerando or ritardando by spreading the beams.
 * Reading the fan keeps the unread-attribute sweep from reporting it, so it is
 * reported here.
 */
function reportFan(
  beam: XmlElement,
  fan: string | undefined,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  if (fan === 'accel' || fan === 'rit') {
    const { code, ending } = attributeLoss('beam', 'fan')
    warnings.add(
      code,
      `A <beam> fanned as "${fan}" is drawn as a plain beam. Its fan ${ending}`,
      context,
      beam,
      'fan',
    )
  } else if (fan !== undefined && fan !== 'none') {
    warnings.addUndefinedAttribute(beam, 'fan', 'and is not carried over.', context)
  }
}

/**
 * The level a <beam> states, or 1 where it states none. A level outside the
 * eight a stem can carry is reported, and gives nothing.
 */
function beamLevel(
  beam: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): number | undefined {
  const stated = attribute(beam, 'number')
  if (stated === undefined) return 1
  const level = parseWholeNumber(stated)
  if (level !== undefined && level >= 1 && level <= MOST_BEAM_LEVELS) return level
  warnings.add(
    'unresolved:attribute-value',
    `The "number" of a <beam> is "${stated}", which is not one of the eight beam ` +
      'levels. The marker is dropped, and the beams beside it are drawn as if it ' +
      'had never been written.',
    context,
    beam,
    'number',
  )
  return undefined
}
