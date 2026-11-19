// The passes that wait for a measure to be whole: closing what is still open at
// the barline, settling the brackets and the measure rests, and stating each
// line as a sequence.

import { compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { DocumentPath } from '../errors.js'
import type { XmlElement } from '../xml/parse.js'
import type { BeamedRun } from './beams.js'
import { highestFirst, notesWritten } from './lines.js'
import type { PartLines, PlacedLine, WrittenLine } from './lines.js'
import type { CarriedTupletStop, MeasureExtent } from './tuplets.js'
import type { EventTimeline, MeasureTimeline } from './timeline.js'
import type { Arpeggios } from './arpeggios.js'
import { settleCandidateRest, settleFillingRest } from './measureRestForms.js'
import type { Arpeggio, Event, KitComponent, Sequence } from '../model/score.js'
import type { VoiceBuilder, VoiceLayers } from './voiceLine.js'

/** What the measure builder read, for the passes that wait for the measure to be whole. */
export interface ReadMeasure {
  readonly voices: ReadonlyMap<string | undefined, VoiceLayers>
  readonly timeline: MeasureTimeline
  readonly arpeggios: Arpeggios
  readonly lines: PartLines
  /** The stops carried in from the measures before that the measure did not meet. */
  readonly carriedStops: readonly CarriedTupletStop[]
  /** The first note naming no voice, for the report where others name one. */
  readonly unnamedNote: XmlElement | undefined
  /** The furthest the cursor ran in the measure. */
  readonly furthest: Fraction
}

/**
 * Where the beats line up, the time signature the part's measure runs
 * against, which is the score's where the part states none, and the score's,
 * which no measure may run past. Each is unset where none is stated.
 */
export interface MeasureOpening {
  anchor: 'start' | 'end'
  signature: Fraction | undefined
  scoreSignature: Fraction | undefined
}

/** What a measure holds once every pass that waits for it to be whole has run. */
export interface FinishedMeasure {
  /** Each voice's events, in order, for its beams to be read from. */
  beamedRuns: BeamedRun[]
  arpeggios: Arpeggio[]
  sequences: Sequence[]
  /** Tuplet stops no bracket here met, handed on to the next measure. */
  carriedTupletStops: CarriedTupletStop[]
  /** The voices whose two-note tremolo is still open at the closing barline. */
  carriedTremolos: (string | undefined)[]
}

/**
 * Closes the measure once every element of it is read, running the passes
 * that wait for the measure to be whole in the order each needs the one
 * before it.
 *
 * A rest filling the measure takes its form first, because the brackets
 * read what stands beside them: as a space it would be silence a bracket
 * can take in. Tuplets close next: what a bracket writes turns on what it
 * holds, on the frame the brackets around it write in, and on the silence
 * after it. A rest that is the whole of its voice only once the brackets
 * are written is then read as the measure's rest. Then every event of the
 * measure is in, so a hairpin's and an octave shift's stop can each be
 * told which one it covers, whatever order the source wrote them in. A
 * rest read as an event and then stated on the sequence still counts as
 * one there.
 */
export function finishMeasure(
  measure: ReadMeasure,
  opening: MeasureOpening,
  settleSpanCovers: (length: Fraction, timeline: EventTimeline) => void,
  /** The components this part strikes, which is where a kit note's height is. */
  kit: ReadonlyMap<string, KitComponent>,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): FinishedMeasure {
  // A tremolo still open is the innermost frame of its line, so it is
  // converted before anything around it closes.
  const carriedTremolos = convertOpenTremolos(measure, warnings, context, path, line)
  // A tuplet the source stated as a ratio with no bracket has no stop to
  // close it, so the measure's end is where its run ends.
  closeImpliedTuplets(measure, warnings, context, path, line)
  const carriedTupletStops = closeAtBarline(measure, warnings, context, path, line)

  // A pickup measure's beats line up with the barline it ends on, and it
  // has no silence past its own end.
  const furthest = measure.furthest
  const { anchor, signature, scoreSignature } = opening
  const length =
    anchor === 'start' && signature && compareFractions(signature, furthest) > 0
      ? signature
      : furthest
  settleFillingRests(measure)
  // A bracket takes in no silence past the score's time signature, since a
  // measure that runs past it is refused.
  const bound =
    scoreSignature && compareFractions(length, scoreSignature) > 0 ? scoreSignature : length
  settleBrackets(
    measure,
    {
      beatsFrom: anchor === 'end' ? length : fraction(0),
      bound,
      written: scoreSignature,
    },
    warnings,
    context,
  )
  settleCandidateRests(measure)

  settleSpanCovers(length, measure.timeline)

  const placed = placeLines(measure)
  return {
    beamedRuns: beamedRuns(measure, placed),
    arpeggios: measure.arpeggios.settle(warnings, context, kit, (event) => staffOf(measure, event)),
    sequences: sequences(measure, placed, warnings, context),
    carriedTupletStops,
    carriedTremolos,
  }
}

/**
 * Matches each line the measure states to a line of the part, and carries
 * on the open beam each line that opens with a continue or end joins.
 */
function placeLines(measure: ReadMeasure): ReadonlyMap<VoiceBuilder, PlacedLine> {
  const ranked = new Map(
    [...measure.voices].map(([voice, { layers }]) => [voice, byHeight(soundingLines(layers))]),
  )
  const lines = measure.lines.measure(
    new Map([...ranked].map(([voice, layers]) => [voice, layers.map((layer) => written(layer))])),
  )
  const placed = new Map<VoiceBuilder, PlacedLine>()
  for (const [voice, layers] of ranked) {
    for (const [rank, layer] of layers.entries()) {
      const line = lines.get(voice)?.[rank] as PlacedLine
      placed.set(layer, line)
      if (line.beamFrom) layer.beams.continueFrom(line.beamFrom)
    }
  }
  return placed
}

/** What a line of the measure writes, for the part to match it by. */
function written(builder: VoiceBuilder): WrittenLine {
  const { beams, lastEvent } = builder
  return {
    staff: commonestStaff(builder.placed.map((placed) => placed.staff)),
    ...notesWritten(builder.tuplets.content()),
    carriesBeam: beams.carriesOn(),
    leavesBeamOpen: beams.leavesOpen(lastEvent?.id) ? { staff: lastEvent?.staff } : undefined,
  }
}

/** The staff an event was placed on, or nothing where it named none. */
function staffOf(measure: ReadMeasure, event: Event): number | undefined {
  return allBuilders(measure)
    .flatMap((builder) => builder.placed)
    .find((placed) => placed.event === event)?.staff
}

/** What every voice said about its beams, voice by voice. */
function beamedRuns(
  measure: ReadMeasure,
  placed: ReadonlyMap<VoiceBuilder, PlacedLine>,
): BeamedRun[] {
  const layers = [...measure.voices.values()].flatMap(({ layers }) => rankedLines(layers))
  return [
    ...layers.map((layer) => layer.beams.run(placed.get(layer)?.key, layer.lastEvent?.id)),
    ...layers.flatMap((layer) => layer.beams.graceRuns()),
  ]
}

/**
 * Closes any tuplet the ratio alone opened, in every voice. A run of such
 * notes ends where the measure does, whether or not it filled its ratio.
 */
function closeImpliedTuplets(
  measure: ReadMeasure,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): void {
  for (const builder of allBuilders(measure)) {
    builder.tuplets.closeImplied(builder.end, warnings, context, path, line)
  }
}

/**
 * Converts each two-note tremolo still open at the barline as the plain
 * note it holds, and hands back the voices it is open in.
 */
function convertOpenTremolos(
  measure: ReadMeasure,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): (string | undefined)[] {
  const carried: (string | undefined)[] = []
  for (const [voice, layers] of measure.voices) {
    for (const builder of layers.layers) {
      const tremolo = builder.tuplets.convertUnclosedTremolo(path, line)
      if (!tremolo) continue
      warnings.add(
        'unclosed:tremolo',
        'A two-note tremolo is still open at the barline. Its note is converted as a ' +
          'plain note, half the value it is written as, and so is the note that stops it ' +
          'where that is the next note of its voice.',
        context,
        tremolo,
      )
      carried.push(voice)
    }
  }
  return carried
}

/**
 * Settles what the measure leaves open at its barline, and hands back the
 * stops the measures after it will meet with nothing to close.
 *
 * A stop carried in and not met here is handed on with them. The source may
 * write it any number of measures later, and a stop that closes nothing is
 * passed over rather than refusing the file, as one whose start was dropped
 * already is.
 */
function closeAtBarline(
  measure: ReadMeasure,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): CarriedTupletStop[] {
  const carried = [...measure.carriedStops]
  for (const [voice, layers] of measure.voices) {
    for (const builder of layers.layers) {
      const numbers = builder.tuplets.closeAtBarline(builder.end, warnings, context, path, line)
      carried.push(...numbers.map((number) => ({ voice, number })))
    }
  }
  return carried
}

function settleFillingRests(measure: ReadMeasure): void {
  for (const builder of allBuilders(measure)) {
    const rest = builder.measureRest
    if (rest?.origin !== 'fills') continue
    const form = settleFillingRest(builder, rest)
    if (form === 'event') {
      measure.timeline.add(rest.at, rest.placed.staff, false)
    }
    rest.reports[form]?.()
  }
}

/**
 * Settles every bracket of the measure, the measure being whole. What a
 * bracket writes turns on what it holds once the brackets inside it are
 * written, on the frame the brackets around it write in, and on the silence
 * after it.
 *
 * `extent` is the measure's own shape: where its beats line up, how far it
 * runs, and the time signature it runs against.
 */
function settleBrackets(
  measure: ReadMeasure,
  extent: MeasureExtent,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  for (const builder of allBuilders(measure)) {
    const voice = {
      end: builder.end,
      measure: extent,
      spent: builder.spent,
    }
    builder.end = builder.tuplets.settle(voice, warnings, context)
  }
}

function settleCandidateRests(measure: ReadMeasure): void {
  for (const builder of allBuilders(measure)) {
    const rest = builder.measureRest
    if (rest?.origin !== 'candidate') continue
    settleCandidateRest(builder, rest, measure.arpeggios.isMarked(rest.event))
  }
}

/**
 * The sequences, in the order their voices first appeared.
 *
 * A voice belongs to the staff that holds most of its time, and only the
 * events that reach across to another say so. Choosing the commonest that
 * way keeps the overrides to the notes that cross.
 */
function sequences(
  measure: ReadMeasure,
  placed: ReadonlyMap<VoiceBuilder, PlacedLine>,
  warnings: WarningCollector,
  context: ReportContext,
): Sequence[] {
  // A note that names no voice goes into its own bucket. Beside notes that do
  // name a voice, that splits one measure into two sequences with no way to
  // know the source meant them apart, so the split is reported rather than
  // silent.
  const unnamed = measure.unnamedNote
  if (unnamed && measure.voices.size > 1 && measure.voices.has(undefined)) {
    warnings.add(
      'missing:voice',
      'A note names no voice while others in the measure do. It is kept as a ' + 'separate line.',
      context,
      unnamed,
    )
  }

  const sounding = new Map(
    [...measure.voices].map(([voice, { layers }]) => [voice, soundingLines(layers)]),
  )

  for (const [voice, layers] of sounding) {
    // Undefined for a voice that sounds one line, which is the voice's
    // first and was opened by nothing.
    const openedAt = layers[1]?.openedAt
    if (openedAt === undefined) continue
    warnings.add(
      'inconsistent:voice',
      `Voice ${voice ?? '(unnamed)'} sounds ` +
        `${String(layers.length)} lines at once in this measure. Each is kept as a ` +
        'separate sequence.',
      context,
      openedAt,
    )
  }

  return [...sounding].flatMap(([, layers]) => {
    return layers.map((builder) => {
      const staff = commonestStaff(builder.placed.map((placed) => placed.staff))

      // Only the events that reach across to another staff say so.
      for (const placed of builder.placed) {
        if (placed.event && placed.staff !== undefined && placed.staff !== staff) {
          placed.event.staff = placed.staff
        }
      }

      const named = {
        staff,
        voice: placed.get(builder)?.name,
      }
      return builder.fullMeasure
        ? { ...named, content: [], fullMeasure: builder.fullMeasure }
        : { ...named, content: builder.tuplets.content(), fullMeasure: undefined }
    })
  })
}

/** Every sequence of every voice, voice by voice. */
function allBuilders(measure: ReadMeasure): VoiceBuilder[] {
  return [...measure.voices.values()].flatMap((layers) => layers.layers)
}

/**
 * The lines of a voice that the measure states. A line opened for a note that
 * was then dropped holds nothing, and a sequence stating nothing is not a line
 * the source drew. The voice's first line stays whatever it holds, so a voice
 * that wrote nothing is the one empty sequence it always was.
 */
function soundingLines(layers: readonly VoiceBuilder[]): VoiceBuilder[] {
  return layers.filter(
    (builder, index) =>
      index === 0 || builder.tuplets.content().length > 0 || builder.fullMeasure !== undefined,
  )
}

/**
 * The lines of a voice in the order of their rank, which is the order the
 * part matches them in. The lines the measure does not state come last.
 */
function rankedLines(layers: readonly VoiceBuilder[]): VoiceBuilder[] {
  const sounding = soundingLines(layers)
  return [...byHeight(sounding), ...layers.filter((layer) => !sounding.includes(layer))]
}

function byHeight(layers: readonly VoiceBuilder[]): readonly VoiceBuilder[] {
  return highestFirst(layers, (layer) => layer.tuplets.content())
}

/** The staff a voice is mostly on, or nothing when it names no staff. */
function commonestStaff(staves: readonly (number | undefined)[]): number | undefined {
  const counts = new Map<number, number>()
  for (const staff of staves) {
    if (staff !== undefined) counts.set(staff, (counts.get(staff) ?? 0) + 1)
  }

  let commonest: number | undefined
  let seen = 0
  // Ties go to the staff seen first, which the insertion order gives.
  for (const [staff, count] of counts) {
    if (count > seen) {
      commonest = staff
      seen = count
    }
  }
  return commonest
}
