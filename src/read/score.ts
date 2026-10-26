// Reads a MusicXML document into the score model: the score, its
// parts, and the walk through each measure. What a measure holds is read by
// the modules beside this one.
//
// Two rules shape the whole stage: input that is structurally broken, or that
// we cannot convert faithfully, raises a MusicXMLError rather than being
// guessed at; and any element carrying notation we do not convert is reported
// as a warning rather than passed over in silence.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { GENERATED_ID_KINDS, GENERATED_ID_PATTERN, MNX_ID_PATTERN, renamedId } from '../ids.js'
import type {
  BarlineType,
  Clef,
  Dynamic,
  Fermata,
  RepeatEnd,
  GlobalMeasure,
  Fine,
  GroupingItem,
  Measure,
  Part,
  Score,
  StaffConfig,
  Tempo,
  TimeSignature,
} from '../model/score.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import {
  attribute,
  child,
  children,
  descendants,
  peekAttribute,
  peeking,
  requireAttribute,
  trimmedText,
} from '../xml/tree.js'
import { fixTransposition, readAttributes, settleTranspositions } from './attributes.js'
import type { MeasureRepeatReading } from './attributes.js'
import { Endings, readBarline } from './barlines.js'
import type { EndingStart, EndingStop } from './barlines.js'
import { readDirection, readSound, soundSigns } from './directions.js'
import type { SoundTempo } from './directions.js'
import { requireDuration } from './divisions.js'
import { lyricLineOrder } from './lyrics.js'
import { respellPastFlip } from './transposition.js'
import { lengthOf } from './duration.js'
import { ElementReader, reportUnreadAttributes, reportUnreadText } from './element.js'
import type { Stated } from './element.js'
import { writtenGrouping } from './part-groups.js'
import { compareFractions, fraction, negate } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { readNote } from './notes.js'
import { readPartList } from './partList.js'
import type { PartList } from './partList.js'
import { readPrint } from './print.js'
import { IdGenerator } from './idGenerator.js'
import {
  mergeGlobalMeasures,
  sameFermata,
  sameName,
  sameNumbers,
  sameRepeatEnd,
  withName,
  withTarget,
} from './globalMeasures.js'
import type {
  KeysAcrossParts,
  NamedSign,
  ReadGlobalMeasure,
  ReadJump,
  UndrawnSign,
} from './globalMeasures.js'
import { settleJumps } from './jumps.js'
import { MeasureRepeats } from './measureRepeats.js'
import type { PartCollector } from './partCollector.js'
import {
  MeasureSignatures,
  scoreTimesInForce,
  timesInForce,
  settleKeysAcrossParts,
  timesDisagree,
} from './signatures.js'
import { measureLength, newPartState } from './state.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'
import type { PartState } from './state.js'
import { MeasureBuilder } from './voices.js'

interface PartReading {
  part: Part
  /** The <part>, for the warnings about it reported once every part is read. */
  element: XmlElement
  /** Where a warning about the part's id goes, ahead of what the part holds. */
  place: WarningPlace
  /** What this part declared for each of its measures, by position. */
  globals: readonly ReadGlobalMeasure[]
  /** The <sound tempo> statements of each of its measures, by position. */
  soundTempos: readonly (readonly SoundTempo[])[]
  /** The signs each of its measures marks only for playback, by position. */
  undrawn: readonly (readonly Stated<UndrawnSign>[])[]
}

/**
 * What the measures of a part hand on to be settled once the part is read,
 * besides the spans and signatures they hand to the part's state. Each
 * is finished in the order it is listed here, which is the order of its
 * reports.
 */
type MeasureCollectors = {
  endings: Endings
  measureRepeats: MeasureRepeats
}

interface MeasureReading {
  measure: Measure
  global: ReadGlobalMeasure
  /**
   * The <sound tempo> statements this measure made, held until every part has
   * been read and the marks the score draws are known.
   */
  soundTempos: readonly SoundTempo[]
  undrawn: readonly Stated<UndrawnSign>[]
}

export function readScore(root: XmlElement, warnings: WarningCollector): Score {
  if (root.name !== 'score-partwise') {
    let message: string
    if (root.name === 'score-timewise') {
      message = 'Timewise MusicXML is not supported; convert it to partwise first.'
    } else if (root.name.includes(':')) {
      // The parser does not resolve XML namespaces, so a prefix stays on the
      // element name and no reader will match it. Name the prefix rather than
      // report a <score-partwise> document as missing.
      message =
        `This document's root is <${root.name}>, an element with an XML namespace ` +
        'prefix. Namespaces are not resolved, so the prefix must be removed for the ' +
        'root to read as <score-partwise>.'
    } else {
      message = `Expected a <score-partwise> document, found <${root.name}>.`
    }
    throw new MusicXMLError(message, { path: [], line: root.line })
  }

  const path: DocumentPath = ['score-partwise']
  const reader = new ElementReader(root)
  // The parts themselves are read below, one at a time, each with a reader of
  // its own. Everything else the document holds is read here or reported.
  reader.skip('part')

  // <defaults> is page geometry with no home in MNX, except its
  // <music-font>: the family names the SMuFL font the score is engraved in,
  // which is MNX's part.smuflFont. The family is carried, and anything else
  // in the element is reported as having no home. MusicXML allows one
  // <defaults> and one <music-font> in it.
  let musicFont: string | undefined
  for (const defaults of reader.children('defaults')) {
    reader.readWhole(defaults)
    for (const font of children(defaults, 'music-font')) {
      musicFont ??= attribute(font, 'font-family')
      reportUnreadAttributes(font, warnings, {})
      reportUnreadText(font, warnings, {})
    }
    if (defaults.children.some((found) => found.name !== 'music-font')) {
      const loss = elementLoss('defaults')
      warnings.add(loss.code, `<defaults> ${loss.ending}`, {}, defaults)
    } else {
      reportUnreadText(defaults, warnings, {})
    }
  }

  // <identification> holds the composer, the rights and the encoding notes,
  // and the schema has no header for any of them. The one part with a home
  // is <encoding><supports>: a whole "yes" for accidentals or beams is the
  // schema's support flag, and is carried. A "no", or a declaration narrowed
  // to one attribute, cannot be written, and is reported with the rest.
  // MusicXML allows one <encoding> and any number of <supports> in it.
  let declaresBeams = false
  let declaresAccidentals = false
  for (const identification of reader.children('identification')) {
    reader.readWhole(identification)
    let rest = false
    for (const found of identification.children) {
      if (found.name !== 'encoding') {
        rest = true
        continue
      }
      for (const inner of found.children) {
        const whole =
          inner.name === 'supports' &&
          inner.attributes['type'] === 'yes' &&
          inner.attributes['attribute'] === undefined
        const element = inner.attributes['element']
        if (whole && element === 'beam') declaresBeams = true
        else if (whole && element === 'accidental') declaresAccidentals = true
        else rest = true
      }
    }
    if (rest) {
      const loss = elementLoss('identification')
      warnings.add(loss.code, `<identification> ${loss.ending}`, {}, identification)
    } else {
      // Only <encoding> and its whole declarations are left, so text is all
      // that can be lost in them.
      for (const found of [identification, ...descendants(identification)]) {
        reportUnreadText(found, warnings, {})
      }
    }
  }

  const partList = readPartList(reader, warnings)
  reader.reportUnread(warnings, {})

  const ids = new IdGenerator()
  const timedParts = children(root, 'part').map((element) => ({
    element,
    times: timesInForce(element),
  }))
  const scoreTimes = scoreTimesInForce(timedParts.map(({ times }) => times))
  const readings = timedParts.map(({ element, times }) =>
    readPart(element, partList, ids, times, scoreTimes, warnings, path),
  )

  // Held by position rather than by part id, which two parts can share.
  const keys = settleKeysAcrossParts(
    readings.map(({ globals, part }) => ({
      globals,
      transposition: part.transposition,
      strikesKit: part.kit.size > 0,
    })),
  )
  const merged: ReadGlobalMeasure[] = []
  readings.forEach(({ globals, part }, index) => {
    const times = timesDisagree(merged, globals)
    mergeGlobalMeasures(
      merged,
      globals,
      part.id,
      {
        ...(keys.parts[index] as KeysAcrossParts),
        keys: keys.keys,
        timeDisagreesAt: (at) => times[at] === true,
      },
      warnings,
    )
  })
  const flips = keys.parts.map((part) => part.flipAt)
  const globalMeasures = settleJumps(
    merged,
    readings.map((reading) => reading.undrawn),
    warnings,
  )

  for (const reading of readings) {
    reportSoundTempos(reading.part.id, reading.soundTempos, globalMeasures, warnings)
  }

  // The global list is the score's measure list, and every part's measures
  // line up with it by position. MNX gives a part a plain list of measures,
  // so a short part is valid MNX that falls silent partway through. It is
  // reported here.
  for (const reading of readings) {
    const found = reading.part.measures.length
    if (found !== globalMeasures.length) {
      warnings.add(
        'inconsistent:measure-count',
        `Part ${reading.part.id} has ${String(found)} measures where the score has ` +
          `${String(globalMeasures.length)}.`,
        { part: reading.part.id },
        reading.element,
      )
    }
  }

  // A staff pointing at a part the score does not hold would dangle, so the
  // grouping keeps only parts that were written.
  const writtenIds = readings.map((reading) => reading.part.id)
  const written = new Set(writtenIds)
  // Only a grouping draws a staff for each part it names, so only there is a
  // part the score never writes a staff that is not drawn.
  for (const [id, scorePart] of partList.grouping.length > 0 ? partList.scoreParts : []) {
    if (written.has(id)) continue
    warnings.add(
      'unresolved:part-id',
      `The part list names part "${id}", but the score never writes it, ` +
        'so no staff of it is drawn.',
      { part: id },
      scorePart,
    )
  }
  // MNX reads a measure stating no key, and none before it, as C major.
  let inForce = 0
  const concertKeys = globalMeasures.map((measure) => (inForce = measure.key?.fifths ?? inForce))
  const parts = readings.map(({ part }, index) => {
    const flipAt = flips[index]
    if (flipAt === undefined || !part.transposition) return part
    return {
      ...part,
      transposition: { ...part.transposition, keyFifthsFlipAt: flipAt },
      measures: respellPastFlip(part.measures, part.transposition, flipAt, concertKeys),
    }
  })
  return renamePartIds(
    {
      globalMeasures,
      parts,
      grouping: writtenGrouping(partList.grouping, writtenIds),
      sounds: partList.sounds,
      lyricLines: lyricLineOrder(parts),
      ...(musicFont !== undefined ? { musicFont } : {}),
      ...(declaresBeams ? { declaresBeams } : {}),
      ...(declaresAccidentals ? { declaresAccidentals } : {}),
    },
    readings,
    warnings,
  )
}

/**
 * Renames every part id MNX cannot state, the converter generates for
 * something else, or a part before it already holds. The parts and the
 * grouping's staves are the only places the model refers to a part by id.
 * Generated names run p1, p2, ... skipping any id a part already holds. The
 * counter only rises, so no generated name is reached twice. A generated name
 * is never one GENERATED_ID_PATTERN matches.
 *
 * The grouping names a part list entry, which is the first part holding its
 * id, so a later part sharing the id is drawn after the listed parts.
 */
function renamePartIds(
  score: Score,
  readings: readonly PartReading[],
  warnings: WarningCollector,
): Score {
  const seen = new Set<string>()
  const failing = readings.flatMap(({ part, element, place }, index) => {
    const shared = seen.has(part.id)
    seen.add(part.id)
    const invalid = !MNX_ID_PATTERN.test(part.id) || GENERATED_ID_PATTERN.test(part.id)
    return shared || invalid ? [{ part, element, place, index, shared }] : []
  })

  const taken: ReadonlySet<string> = seen
  const byPosition = new Map<number, string>()
  const firstRenames = new Map<string, string>()
  const sharing: string[] = []
  let counter = 0
  for (const { part, element, place, index, shared } of failing) {
    let generated: string
    do {
      counter += 1
      generated = renamedId('part', counter)
    } while (taken.has(generated))
    byPosition.set(index, generated)
    if (shared) {
      sharing.push(generated)
      warnings.addAt(
        place,
        'inconsistent:part-id',
        `A part before this one has the id "${part.id}" too, and MNX names each part ` +
          `once. This part is renamed ${generated}, and takes the part list's details ` +
          `for "${part.id}".`,
        { part: part.id },
        element,
      )
      continue
    }
    firstRenames.set(part.id, generated)
    warnings.addAt(
      place,
      'unrepresentable:part-id',
      MNX_ID_PATTERN.test(part.id)
        ? `The part id "${part.id}" is shaped like the ids the converter gives ` +
            `${GENERATED_ID_KINDS}, and MNX states them all the same way, so the ` +
            `part is renamed ${generated}.`
        : `The part id "${part.id}" does not fit MNX's id, which is 1 to 256 printable ` +
            `ASCII characters, so the part is renamed ${generated}.`,
      { part: part.id },
      element,
    )
  }

  const grouping = renameGroupingParts(score.grouping, firstRenames)
  return {
    ...score,
    parts: score.parts.map((part, index) => {
      const renamed = byPosition.get(index)
      return renamed === undefined ? part : { ...part, id: renamed }
    }),
    grouping:
      grouping.length === 0
        ? grouping
        : [...grouping, ...sharing.map((part): GroupingItem => ({ kind: 'part', part }))],
  }
}

/** The grouping with every renamed part renamed in its staves too. */
function renameGroupingParts(
  items: readonly GroupingItem[],
  renames: ReadonlyMap<string, string>,
): GroupingItem[] {
  return items.map((item) => {
    if (item.kind === 'part') {
      const renamed = renames.get(item.part)
      return renamed === undefined ? item : { ...item, part: renamed }
    }
    return { ...item, content: renameGroupingParts(item.content, renames) }
  })
}

function readPart(
  element: XmlElement,
  partList: PartList,
  ids: IdGenerator,
  partTimes: readonly (TimeSignature | undefined)[],
  scoreTimes: readonly (TimeSignature | undefined)[],
  warnings: WarningCollector,
  path: DocumentPath,
): PartReading {
  // Required by MusicXML, and what ties a part to its name and to every
  // warning reported against it.
  const id = requireAttribute(element, 'id', path)
  const partPath: DocumentPath = [...path, `part ${id}`]
  const place = warnings.reserve()

  if (partList.listed.size > 0 && !partList.listed.has(id)) {
    warnings.add(
      'unresolved:part-id',
      `The part list has no entry for part "${id}".`,
      { part: id },
      element,
      'id',
    )
  }

  reportUnreadText(element, warnings, { part: id })

  const state = newPartState(ids, voiceNames(element), partList.soundsByInstrument.get(id))
  const collectors: MeasureCollectors = {
    endings: new Endings(id),
    measureRepeats: new MeasureRepeats(id),
  }
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(
      measureElement,
      index,
      id,
      state,
      collectors,
      partTimes[index],
      scoreTimes[index],
      warnings,
      partPath,
    ),
  )
  // A part with no pitched note is fixed in the transposition of its first
  // key, which writes that key as the source states it.
  const [firstKey] = state.unfixedKeys
  fixTransposition(state, warnings, firstKey ? firstKey.transposition : state.transposition)
  // Settled once the whole part is in, because the document's order is not
  // the music's and an end can be measures from its start. Each reports what
  // stays unsettled.
  const settling: readonly PartCollector[] = [
    state.spanners,
    state.signatures,
    ...Object.values(collectors),
  ]
  for (const collector of settling) collector.finish(readings, warnings)

  return {
    part: {
      id,
      name: partList.names.get(id),
      shortName: partList.shortNames.get(id),
      staves: state.mostStaves,
      kit: state.kit,
      transposition: state.statedTransposition?.value,
      measures: readings.map((reading) => reading.measure),
    },
    element,
    place,
    globals: readings.map((reading) => reading.global),
    soundTempos: readings.map((reading) => reading.soundTempos),
    undrawn: readings.map((reading) => reading.undrawn),
  }
}

const ECHO_TOLERANCE = 0.01

/**
 * Reports every <sound tempo> the part states that no drawn metronome mark
 * echoes. A <sound tempo> is playback: where a mark at the same point states
 * the same tempo, the two say one thing and the mark is the one drawn, so the
 * echo is passed over. Anything else is a playback tempo of its own, which
 * MNX has no way to state without drawing a mark the source never drew.
 *
 * Decided here, once every part has been read, because the mark can be
 * written after the <sound> that echoes it and can be drawn by another part.
 *
 * The two tempos are compared as quarter notes per minute, which is what
 * MusicXML's tempo attribute counts. A mark of a dotted quarter at 72 and a
 * <sound tempo> of 108 are one statement; one of 110 is another.
 *
 * Some editors write the echo rounded, as 70.0002 for a mark of 70, or to two
 * decimals where the mark's tempo has more. Tempos closer than
 * ECHO_TOLERANCE are one statement.
 *
 * Each is reported at the place the <sound> reserved, so the report stays in
 * document order.
 */
function reportSoundTempos(
  partId: string,
  soundTempos: readonly (readonly SoundTempo[])[],
  globalMeasures: readonly GlobalMeasure[],
  warnings: WarningCollector,
): void {
  soundTempos.forEach((measureTempos, index) => {
    for (const sound of measureTempos) {
      const { bpm } = sound
      const echoed =
        bpm !== undefined &&
        (globalMeasures[index]?.tempos ?? []).some(
          (tempo) =>
            compareFractions(tempo.position, sound.position) === 0 &&
            Math.abs(quarterNotesPerMinute(tempo) - bpm) < ECHO_TOLERANCE,
        )
      if (echoed) continue
      const loss = attributeLoss('sound', 'tempo')
      warnings.addAt(
        sound.place,
        loss.code,
        `The "tempo" of a <sound> ${loss.ending}`,
        { part: partId, measure: index + 1 },
        sound.element,
        'tempo',
      )
    }
  })
}

/**
 * A drawn mark's tempo counted in quarter notes, the unit a <sound tempo>
 * states. The beat is a fraction of a whole note, so four of them make a
 * quarter: a dotted quarter is 3/8, and 3/8 * 4 is the 1.5 quarters it lasts.
 */
function quarterNotesPerMinute(tempo: Tempo): number {
  const beat = lengthOf(tempo.value)
  return (tempo.bpm * beat.num * 4) / beat.den
}

/**
 * The voices of a measure that sound a note, rather than only rest. A grace
 * note counts: a rest beside one in a line laid over the measure rest is
 * part of that line's music. A chord member sounds in its chord's voice,
 * whatever voice it names, so the note it joins already counts for it.
 */
function soundingVoices(measure: XmlElement): (string | undefined)[] {
  return peeking(() =>
    children(measure, 'note')
      .filter((note) => !child(note, 'rest') && !child(note, 'chord'))
      .map((note) => {
        const voice = child(note, 'voice')
        return voice && trimmedText(voice)
      }),
  )
}

/** Every voice name the notes of a part state, in any measure. */
function voiceNames(part: XmlElement): Set<string> {
  return peeking(
    () =>
      new Set(
        children(part, 'measure').flatMap((measure) =>
          children(measure, 'note').flatMap((note) => {
            const voice = child(note, 'voice')
            return voice ? [trimmedText(voice)] : []
          }),
        ),
      ),
  )
}

function readMeasure(
  element: XmlElement,
  index: number,
  partId: string,
  state: PartState,
  collectors: MeasureCollectors,
  opensWith: TimeSignature | undefined,
  scoreTime: TimeSignature | undefined,
  warnings: WarningCollector,
  path: DocumentPath,
): MeasureReading {
  const position = index + 1
  const context: ReportContext = { part: partId, measure: position }
  const label = readMeasureLabel(element, warnings, context)
  const measurePath: DocumentPath = [...path, `measure ${String(label ?? position)}`]
  // The measure element is walked child by child below rather than through
  // one reader, so its own attributes and text are swept here: the label
  // above read the number, and anything else (implicit, non-controlling) is a
  // loss.
  reportUnreadAttributes(element, warnings, context)
  reportUnreadText(element, warnings, context)
  // A time signature stated at the start after a <backup> stands where the
  // measure begins, so the notes written before it are measured against it.
  state.time = opensWith

  const clefs: Stated<Clef>[] = []
  const staffConfigs: Stated<StaffConfig>[] = []
  const signatures = new MeasureSignatures(state, warnings, context, measurePath)
  const dynamics: Dynamic[] = []
  const tempos: Stated<Tempo>[] = []
  // Every <sound tempo> of the measure, waiting on the score's marks to say
  // whether each one echoes a mark or stands alone.
  const soundTempos: SoundTempo[] = []
  const undrawn: Stated<UndrawnSign>[] = []
  const segnos: Stated<NamedSign>[] = []
  const codas: Stated<NamedSign>[] = []
  const fines: Stated<Fine>[] = []
  const jumps: Stated<ReadJump>[] = []
  const multimeasureRests: Stated<number>[] = []
  const measureRepeats: MeasureRepeatReading[] = []
  let systemBreak = false
  let pageBreak = false
  let barline: Stated<BarlineType> | undefined
  let repeatStart = false
  let repeatEnd: Stated<RepeatEnd> | undefined
  let endingStart: EndingStart | undefined
  let endingStop: EndingStop | undefined
  let fermata: Stated<Fermata> | undefined

  const builder = new MeasureBuilder(
    state.carriedTupletStops,
    state.carriedTremolos,
    soundingVoices(element),
    state.beamsOpenAtBarline,
    state.voiceNames,
  )

  // Walked in document order, because MusicXML states a measure as one stream
  // with a cursor running through it: what a <note> means depends on the
  // <backup> before it, and on the <divisions> in force by the time it is
  // reached. A measure may carry more than one <attributes> for that reason.
  for (const found of element.children) {
    // Each reader records what it reads out of the element, and reports the
    // rest once it is done. Built here rather than inside, so a reader that
    // returns early down one of its paths still has everything it passed over
    // reported.
    const reader = new ElementReader(found)

    switch (found.name) {
      case 'attributes': {
        const reading = readAttributes(
          reader,
          state,
          builder.position(),
          warnings,
          context,
          measurePath,
        )
        signatures.add(reading, builder.position())
        clefs.push(...reading.clefs)
        staffConfigs.push(...reading.staffConfigs)
        multimeasureRests.push(...reading.multimeasureRests)
        measureRepeats.push(...reading.measureRepeats)
        break
      }

      case 'note':
        // The <attributes> before a note can state the transposition over
        // several blocks. The keys stated since the last note are converted
        // here, and the part's transposition is fixed at its first pitched
        // note. A rest or an unpitched note is not transposed.
        // A note holds one of <pitch>, <unpitched> and <rest>.
        signatures.convertKeys()
        if (child(found, 'pitch')) fixTransposition(state, warnings, state.transposition)
        readNote(reader, state, index, builder, warnings, context, measurePath)
        break

      case 'direction': {
        const reading = readDirection(
          reader,
          builder.position(),
          (at, staff) => builder.graceNotesAt(at, staff),
          index,
          dynamics.length,
          state,
          warnings,
          context,
          measurePath,
        )
        dynamics.push(...reading.dynamics)
        tempos.push(...reading.tempos)
        segnos.push(...reading.segnos)
        codas.push(...reading.codas)
        fines.push(...reading.fines)
        jumps.push(...reading.jumps)
        soundTempos.push(...reading.soundTempos)
        undrawn.push(...reading.undrawn)
        break
      }

      case 'barline': {
        const reading = readBarline(reader, builder.position(), warnings, context)
        // readBarline only returns a style for the closing edge, so two styles
        // here are two claims about the same line, not a left and right pair.
        // A restatement of the same style is not a disagreement.
        if (barline && reading.barline && reading.barline.value !== barline.value) {
          warnings.add(
            'inconsistent:barline',
            'Two barlines close this measure with different styles. The first is the ' +
              'one converted.',
            context,
            found,
          )
        }
        // The same holds for each mark: a second statement that differs is a
        // second claim about the one mark MNX states on the measure.
        const reportSecond = <T extends { element: XmlElement }>(
          name: string,
          first: T | undefined,
          second: T | undefined,
          same: (a: T, b: T) => boolean,
        ): void => {
          if (first === undefined || second === undefined || same(first, second)) return
          warnings.add(
            'inconsistent:barline',
            `Two barlines of this measure state different ${name}s. The first is the one ` +
              'converted.',
            context,
            second.element,
          )
        }
        reportSecond('repeat', repeatEnd, reading.repeatEnd, (a, b) =>
          sameRepeatEnd(a.value, b.value),
        )
        reportSecond('ending start', endingStart, reading.endingStart, (a, b) =>
          sameNumbers(a.numbers, b.numbers),
        )
        reportSecond('ending stop', endingStop, reading.endingStop, (a, b) => a.open === b.open)
        reportSecond('fermata', fermata, reading.fermata, (a, b) => sameFermata(a.value, b.value))
        barline ??= reading.barline
        repeatStart ||= reading.repeatStart
        repeatEnd ??= reading.repeatEnd
        endingStart ??= reading.endingStart
        endingStop ??= reading.endingStop
        fermata ??= reading.fermata
        // Collected with the signs the directions read, so a sign stated
        // twice over is settled in one place for both forms.
        if (reading.segno) segnos.push(reading.segno)
        if (reading.coda) codas.push(reading.coda)
        break
      }

      case 'print': {
        const reading = readPrint(reader, warnings, context)
        systemBreak ||= reading.systemBreak
        pageBreak ||= reading.pageBreak
        break
      }

      // A <sound tempo> at the same point and tempo as a <metronome> the score
      // draws is that mark's playback echo, and is not reported. Any other is. Which
      // it is waits until every part is read, because the mark can be written
      // after the <sound> or by another part.
      case 'sound': {
        const position = builder.position()
        const reading = readSound(reader, position, warnings, context)
        if (reading.fine) fines.push({ value: reading.fine, element: found })
        jumps.push(...reading.jumps.map((jump) => ({ value: jump, element: found })))
        if (reading.tempo) soundTempos.push(reading.tempo)
        undrawn.push(...soundSigns(reading, position, found))
        break
      }

      // Both only move the cursor: <backup> against the flow of the measure,
      // <forward> with it. A <voice> or <staff> on one says which voice the
      // skipped time belongs to, which the model cannot yet express, so it
      // stays unread and is reported.
      case 'backup':
      case 'forward': {
        const by = requireDuration(reader, state, warnings, context, measurePath)
        builder.shift(found.name === 'backup' ? negate(by) : by, warnings, context, found)
        break
      }

      default: {
        const loss = elementLoss(found.name)
        warnings.add(loss.code, `<${found.name}> ${loss.ending}`, context, found)
        continue
      }
    }

    reader.reportUnread(warnings, context)
    warnings.settleHeld()
  }

  settleTranspositions(state, warnings)
  const { key, time } = signatures.settle(builder.furthest())

  // A part stating no time signature runs to the barline the score states.
  // Measured against the time signature the measure opens with, since one
  // stated after its start is the next measure's. The implicit attribute is
  // still a loss as a statement about the numbering, which the sweep above
  // reports.
  const finished = builder.finish(
    {
      anchor: peekAttribute(element, 'implicit') === 'yes' ? 'end' : 'start',
      signature: measureLength(state) ?? (scoreTime && fraction(scoreTime.count, scoreTime.unit)),
    },
    (length, lastEventBefore, graceNotesAt, lastEvents) => {
      state.spanners.settleSpanCovers(index, length, lastEventBefore, graceNotesAt, lastEvents)
    },
    state.kit,
    warnings,
    context,
    measurePath,
    element.line,
  )
  state.carriedTupletStops = finished.carriedTupletStops
  state.carriedTremolos = finished.carriedTremolos
  state.beamsOpenAtBarline = finished.beamsOpenAtBarline
  collectors.endings.add(index, endingStart, endingStop)
  collectors.measureRepeats.add(index, measureRepeats)

  return {
    measure: {
      clefs: dedupeClefs(clefs, warnings, context),
      staffConfigs: dedupeStaffConfigs(staffConfigs, warnings, context),
      // Beams are stated over the measure in MNX rather than on the notes,
      // and each voice is beamed on its own.
      beams: state.openBeams.measure(finished.beamedRuns),
      dynamics,
      arpeggios: finished.arpeggios,
      // Filled in once the whole part has been read.
      ottavas: [],
      measureRepeat: undefined,
      sequences: finished.sequences,
    },
    // Only worth carrying when it differs from where the measure sits;
    // otherwise MNX's implicit numbering already says it.
    global: {
      key,
      time,
      tempos,
      number: label !== undefined && label !== position ? { value: label, element } : undefined,
      // A light-heavy beside a backward repeat is how the closing sign is
      // drawn, and repeatEnd already draws it, so final is not stated too.
      // Settled here, not per <barline>, because a source can split the style
      // and the repeat across two elements at one edge. Any other style
      // beside the repeat stays.
      barline: repeatEnd !== undefined && barline?.value === 'final' ? undefined : barline,
      repeatStart,
      repeatEnd,
      // Filled in by the part, once the ending's other end has been met.
      ending: undefined,
      fermata,
      segno: onePerMeasure(
        segnos,
        'segno',
        undefined,
        warnings,
        context,
        drawnDifferently,
        withName,
      ),
      coda: onePerMeasure(codas, 'coda', undefined, warnings, context, drawnDifferently, withName),
      fine: onePerMeasure(fines, 'fine', 'fine', warnings, context),
      jump: onePerMeasure(
        jumps,
        'jump',
        (jump) => jump.sound,
        warnings,
        context,
        (first, other) => first.sound !== other.sound || !sameName(first.target, other.target),
        withTarget,
      ),
      multimeasureRest: oneMultimeasureRest(multimeasureRests, warnings, context),
      systemBreak,
      pageBreak,
    },
    soundTempos,
    undrawn,
  }
}

/**
 * The one navigation mark of its kind MNX states on a measure. A measure with
 * two of them at different points has no faithful conversion, so the first is
 * kept and the rest reported; two written at the same point are the same mark
 * and lose nothing, unless `differs` says they are drawn as different marks.
 * Where only a later one of them names the mark, `named` keeps that name.
 */
function onePerMeasure<T extends { location: Fraction }>(
  marks: readonly Stated<T>[],
  name: string,
  // The attribute that states the mark. Undefined where the element states it.
  attribute: string | ((mark: T) => string) | undefined,
  warnings: WarningCollector,
  context: ReportContext,
  differs?: (first: T, other: T) => boolean,
  named?: (kept: T, other: T) => T,
): Stated<T> | undefined {
  const first = marks[0]
  if (first === undefined) return undefined
  let kept = first.value
  for (const { value: other, element } of marks.slice(1)) {
    if (compareFractions(other.location, kept.location) === 0 && !differs?.(kept, other)) {
      if (named) kept = named(kept, other)
      continue
    }
    warnings.add(
      'unrepresentable:element',
      `A measure carries more than one ${name}, and MNX states one per measure. ` +
        'The first is the one converted.',
      context,
      element,
      typeof attribute === 'function' ? attribute(other) : attribute,
    )
  }
  return kept === first.value ? first : { ...first, value: kept }
}

/**
 * Whether two segnos or two codas at the same point are different marks
 * rather than the same mark restated: drawn as different glyphs, in
 * different colors, or named differently. The name is never drawn, but it
 * tells one sign from another when a jump is matched to the one it goes to.
 */
function drawnDifferently(a: NamedSign, b: NamedSign): boolean {
  return a.glyph !== b.glyph || a.color !== b.color || !sameName(a.name, b.name)
}

/**
 * The one multi-measure rest span MNX can state over a measure. A restated
 * count, as one written per staff, loses nothing; differing counts cannot all
 * be carried, so the first is kept and the disagreement reported.
 */
function oneMultimeasureRest(
  counts: readonly Stated<number>[],
  warnings: WarningCollector,
  context: ReportContext,
): Stated<number> | undefined {
  const first = counts[0]
  if (first === undefined) return undefined
  const differing = counts.find((count) => count.value !== first.value)
  if (differing !== undefined) {
    warnings.add(
      'unrepresentable:multimeasure-rest',
      'This measure states multi-measure rests of different spans, and MNX states ' +
        'one for the score. The first is the one converted.',
      context,
      differing.element,
    )
  }
  return first
}

/**
 * Drops a clef that another clef replaces at the same point on the same
 * staff, which exporters write when the clef in force is restated after the
 * barline. MNX draws one clef at a point, so the one the following notes
 * obey, which is the last declared, is the one converted.
 */
function dedupeClefs(
  clefs: readonly Stated<Clef>[],
  warnings: WarningCollector,
  context: ReportContext,
): Clef[] {
  // A clef naming no staff draws the first, so the two ways of naming staff 1
  // are the same staff.
  const staffOf = (clef: Clef) => clef.staff ?? 1
  const atSamePoint = (one: Clef, other: Clef) =>
    staffOf(one) === staffOf(other) && compareFractions(one.position, other.position) === 0
  const values = clefs.map((clef) => clef.value)
  return clefs
    .filter(({ value: clef, element }, index) => {
      const replacing = values.find((later, at) => at > index && atSamePoint(later, clef))
      // Exporters restate the clef a staff already has, which loses nothing.
      // Only a clef the next one replaces is a loss.
      if (replacing && !sameClef(replacing, clef)) {
        warnings.add(
          'unrepresentable:clef',
          'Two clefs are written at the same point on the same staff, and MNX draws ' +
            'one there. The last is the one converted.',
          context,
          element,
        )
      }
      return replacing === undefined
    })
    .map(({ value: kept }) => {
      // The same clef drawn once and hidden once at a point is drawn there.
      const drawn = values.some(
        (other) => atSamePoint(other, kept) && sameClef(other, kept) && !other.hide,
      )
      return kept.hide && drawn ? { ...kept, hide: false } : kept
    })
}

/**
 * MNX draws a staff one way at a time, so two line counts stated for the same
 * staff at the same point cannot both stand. The last is the one drawn, as it
 * is for a clef.
 */
function dedupeStaffConfigs(
  configs: readonly Stated<StaffConfig>[],
  warnings: WarningCollector,
  context: ReportContext,
): StaffConfig[] {
  // A config naming no staff draws the first, as MNX reads it, so the two
  // ways of naming staff 1 are the same staff.
  const staffOf = (config: StaffConfig) => config.staff ?? 1
  return configs
    .filter(({ value: config, element }, index) => {
      const replacing = configs.find(
        ({ value: later }, at) =>
          at > index &&
          staffOf(later) === staffOf(config) &&
          compareFractions(later.position, config.position) === 0,
      )
      if (replacing) {
        warnings.add(
          'unrepresentable:staff-config',
          'Two staff line counts are written at the same point on the same staff, and ' +
            'MNX draws one there. The last is the one converted.',
          context,
          element,
        )
      }
      return replacing === undefined
    })
    .map((config) => config.value)
}

/**
 * The sign, where it sits on the staff, how it is transposed, and whether the
 * transposition is drawn.
 */
function sameClef(a: Clef, b: Clef): boolean {
  return (
    a.sign === b.sign &&
    a.staffPosition === b.staffPosition &&
    a.octave?.amount === b.octave?.amount &&
    a.octave?.shown === b.octave?.shown
  )
}

/**
 * The number the score gives the measure, when it is one. Scores label split
 * measures "3a" and pickups "0"; the former has no home in MNX.
 */
function readMeasureLabel(
  element: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): number | undefined {
  const written = attribute(element, 'number')
  if (written === undefined) return undefined

  const value = Number(written)
  if (!/^\d+$/.test(written) || !Number.isSafeInteger(value)) {
    warnings.add(
      'unrepresentable:measure-label',
      `The measure label "${written}" is not a whole number of zero or more, which is ` +
        'how MNX numbers a measure, so it is not carried over.',
      context,
      element,
    )
    return undefined
  }
  return value
}
