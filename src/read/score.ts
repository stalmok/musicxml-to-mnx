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
  Ending,
  Fermata,
  RepeatEnd,
  GlobalMeasure,
  InstrumentSound,
  Fine,
  GroupingItem,
  Measure,
  Part,
  Score,
  Segno,
  StaffConfig,
  Tempo,
  TimeSignature,
} from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import {
  attribute,
  child,
  children,
  peekAttribute,
  requireAttribute,
  trimmedText,
} from '../xml/tree.js'
import { readAttributes, settleTranspositions } from './attributes.js'
import type { MeasureRepeatReading } from './attributes.js'
import { readBarline, resolveEndings } from './barlines.js'
import type { EndingStart, EndingStop } from './barlines.js'
import { buildBeams } from './beams.js'
import { readDirection, readSound } from './directions.js'
import type { SoundTempo } from './directions.js'
import { requireDuration } from './divisions.js'
import { lengthOf } from './duration.js'
import { drawnName, ElementReader, reportUnreadAttributes } from './element.js'
import type { Stated } from './element.js'
import { GroupingBuilder, writtenGrouping } from './part-groups.js'
import { compareFractions, fraction, negate } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { readNote } from './notes.js'
import { parseWholeNumber } from './numbers.js'
import { readPrint } from './print.js'
import { IdGenerator } from './idGenerator.js'
import { settleJumps } from './jumps.js'
import type { NamedSegno, ReadGlobalMeasure, DalSegno } from './jumps.js'
import {
  MeasureSignatures,
  reportHeldAtPartEnd,
  scoreTimesInForce,
  timesInForce,
  settleAcrossParts,
} from './signatures.js'
import { measureLength, newPartState } from './state.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'
import type { PartState, ResolvedSound } from './state.js'
import { MeasureBuilder } from './voices.js'

interface PartReading {
  part: Part
  /** The <part>, for the warnings about it reported once every part is read. */
  element: XmlElement
  /** What this part declared for each of its measures, by position. */
  globals: readonly ReadGlobalMeasure[]
  /** The <sound tempo> statements of each of its measures, by position. */
  soundTempos: readonly (readonly SoundTempo[])[]
}

interface MeasureReading {
  measure: Measure
  global: ReadGlobalMeasure
  /**
   * Held until the part can join it to its other end, with its <ending>,
   * so the report names it.
   */
  endingStart: EndingStart | undefined
  endingStop: EndingStop | undefined
  /**
   * The measure repeat edges this measure stated, held until the part can
   * walk the sign from its start to its stop or the end of the part.
   */
  measureRepeats: readonly MeasureRepeatReading[]
  /**
   * The <sound tempo> statements this measure made, held until every part has
   * been read and the marks the score draws are known.
   */
  soundTempos: readonly SoundTempo[]
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
    for (const font of children(defaults, 'music-font')) {
      musicFont ??= attribute(font, 'font-family')
      reportUnreadAttributes(font, warnings, {})
    }
    if (defaults.children.some((found) => found.name !== 'music-font')) {
      const loss = elementLoss('defaults')
      warnings.add(loss.code, `<defaults> ${loss.ending}`, {}, defaults)
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
    }
  }

  const partList = readPartNames(reader, warnings)
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

  const merged: ReadGlobalMeasure[] = []
  // Held by position rather than by part id, which two parts can share.
  const flips = readings.map((reading) =>
    mergeGlobalMeasures(merged, reading.globals, reading.part, warnings),
  )
  const globalMeasures = settleJumps(merged, warnings)

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
      `The part list names part ${id}, but the score never writes it, ` +
        'so no staff of it is drawn.',
      { part: id },
      scorePart,
    )
  }
  const parts = readings.map(({ part }, index) => {
    const flipAt = flips[index]
    if (flipAt === undefined || !part.transposition) return part
    return { ...part, transposition: { ...part.transposition, keyFifthsFlipAt: flipAt } }
  })
  return renamePartIds(
    {
      globalMeasures,
      parts,
      grouping: writtenGrouping(partList.grouping, writtenIds),
      sounds: partList.sounds,
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
  const failing = readings.flatMap(({ part, element }, index) => {
    const shared = seen.has(part.id)
    seen.add(part.id)
    const invalid = !MNX_ID_PATTERN.test(part.id) || GENERATED_ID_PATTERN.test(part.id)
    return shared || invalid ? [{ part, element, index, shared }] : []
  })

  const taken: ReadonlySet<string> = seen
  const byPosition = new Map<number, string>()
  const firstRenames = new Map<string, string>()
  const sharing: string[] = []
  let counter = 0
  for (const { part, element, index, shared } of failing) {
    let generated: string
    do {
      counter += 1
      generated = renamedId('part', counter)
    } while (taken.has(generated))
    byPosition.set(index, generated)
    if (shared) {
      sharing.push(generated)
      warnings.add(
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
    warnings.add(
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

// Parts restate the same key and time; the first to declare one wins, so a
// later part repeating it is not treated as a change. A part declaring a
// different one cannot be carried, because MNX states one key and one time
// signature for the whole score, so the disagreement is reported. The result
// is as long as the longest part, because that list is the score's measure
// list.
function mergeGlobalMeasures(
  target: ReadGlobalMeasure[],
  found: readonly ReadGlobalMeasure[],
  { id: part, transposition }: Part,
  warnings: WarningCollector,
): number | undefined {
  const { flipAt, contributed, keyDisagreesAt, timeDisagreesAt } = settleAcrossParts(
    target,
    found,
    transposition,
  )

  // The barline's rule below holds for every mark MNX states once on the
  // score's measure: parts stating different ones disagree about the one
  // mark, so that is reported. Each is compared by content where two parts
  // both state one; a part restating an equal one says nothing new.
  // `attribute` states the mark, where the element itself does not.
  const reportDifferingMark = <T>(
    name: string,
    attribute: string | undefined,
    inScore: Stated<T> | undefined,
    inPart: Stated<T> | undefined,
    same: (a: T, b: T) => boolean,
    context: ReportContext,
  ): void => {
    if (inScore === undefined || inPart === undefined || same(inScore.value, inPart.value)) return
    warnings.add(
      'unrepresentable:cross-part-mark',
      `The parts of this score state different ${name}s on this measure, and MNX ` +
        'states one there. The first stated is the one converted.',
      context,
      inPart.element,
      attribute,
    )
  }
  found.forEach((measure, index) => {
    const existing = target[index]
    // The measure's position, as every other report names it, not the
    // source's label.
    const context = { part, measure: index + 1 }
    if (keyDisagreesAt(index)) {
      warnings.addForMeasure(
        'unrepresentable:cross-part-key',
        'The parts of this score are in different keys, and MNX states one key for ' +
          'the score. The first stated is the one converted.',
        context,
        'key',
      )
    }
    if (timeDisagreesAt(index)) {
      warnings.addForMeasure(
        'unrepresentable:cross-part-time',
        'The parts of this score are in different time signatures, and MNX states one ' +
          'for the score. The first stated is the one converted.',
        context,
        'time',
      )
    }
    // A multi-measure rest is the whole score's, like the barline: parts
    // usually restate the same span. Parts stating different spans over the
    // same measure disagree about the one MNX can state, so that is reported.
    if (
      existing?.multimeasureRest !== undefined &&
      measure.multimeasureRest !== undefined &&
      existing.multimeasureRest.value !== measure.multimeasureRest.value
    ) {
      warnings.add(
        'unrepresentable:cross-part-multimeasure-rest',
        'The parts of this score state multi-measure rests of different spans over ' +
          'this measure, and MNX states one for the score. The first stated is the ' +
          'one converted.',
        context,
        measure.multimeasureRest.element,
      )
    }
    // A barline is the whole score's: every part is cut at the same place,
    // and each usually writes the same thing. Parts writing different ones
    // disagree about the one line MNX can state, so that is reported.
    if (existing?.barline && measure.barline && existing.barline.value !== measure.barline.value) {
      warnings.add(
        'unrepresentable:cross-part-barline',
        'The parts of this score close this measure with different barlines, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        measure.barline.element,
      )
    }
    // A segno is restated in each part the same way a barline is. Parts
    // stating different signs, at different points or drawn differently,
    // disagree about the one segno MNX can state, so that is reported.
    if (existing?.segno && measure.segno && !sameSegno(existing.segno.value, measure.segno.value)) {
      warnings.add(
        'unrepresentable:cross-part-segno',
        'The parts of this score state different segnos on this measure, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        measure.segno.element,
      )
    }
    // The number is the label the score writes over the measure, so parts
    // labelling the same measure differently is the source disagreeing with
    // itself. The comparison runs only where both carry one, which is only
    // where the label differs from the measure's position.
    if (
      existing?.number !== undefined &&
      measure.number !== undefined &&
      existing.number.value !== measure.number.value
    ) {
      warnings.add(
        'inconsistent:measure-number',
        `This measure is numbered ${String(existing.number.value)} by an earlier part and ` +
          `${String(measure.number.value)} by this one. The first is the one converted.`,
        context,
        measure.number.element,
        'number',
      )
    }
    reportDifferingMark(
      'repeat',
      undefined,
      existing?.repeatEnd,
      measure.repeatEnd,
      sameRepeatEnd,
      context,
    )
    reportDifferingMark('ending', undefined, existing?.ending, measure.ending, sameEnding, context)
    reportDifferingMark(
      'fermata',
      undefined,
      existing?.fermata,
      measure.fermata,
      sameFermata,
      context,
    )
    reportDifferingMark('fine', 'fine', existing?.fine, measure.fine, sameFine, context)
    reportDifferingMark('jump', 'dalsegno', existing?.jump, measure.jump, sameJump, context)
    target[index] = {
      key: existing?.key ?? contributed[index],
      time: existing?.time ?? measure.time,
      tempos: mergeTempos(existing?.tempos ?? [], measure.tempos, warnings, context),
      number: existing?.number ?? measure.number,
      barline: existing?.barline ?? measure.barline,
      // The three marks a part states as a plain yes follow a different rule
      // from the objects around them: a mark any part states is kept, and a
      // part not stating one is not disagreeing. A boolean cannot tell "no"
      // from "nothing said", so there is no disagreement to report.
      repeatStart: (existing?.repeatStart ?? false) || measure.repeatStart,
      repeatEnd: existing?.repeatEnd ?? measure.repeatEnd,
      ending: existing?.ending ?? measure.ending,
      fermata: existing?.fermata ?? measure.fermata,
      // A segno is the score's navigation mark, restated in each part like the
      // barline, so the first part to state one wins.
      segno: existing?.segno ?? measure.segno,
      fine: existing?.fine ?? measure.fine,
      jump: existing?.jump ?? measure.jump,
      multimeasureRest: existing?.multimeasureRest ?? measure.multimeasureRest,
      // A break is one of those three, and is usually written into one part
      // only: the part not stating it leaves the layout to the parts that do.
      systemBreak: (existing?.systemBreak ?? false) || measure.systemBreak,
      pageBreak: (existing?.pageBreak ?? false) || measure.pageBreak,
    }
  })

  return flipAt
}

// The written sign: where it sits, its glyph and its color. The name is
// compared too: it is never drawn, but it tells one sign from another when a
// jump is matched to the one it returns to, so parts naming the sign
// differently disagree about which sign the measure carries.
function sameSegno(a: NamedSegno, b: NamedSegno): boolean {
  return (
    compareFractions(a.location, b.location) === 0 &&
    a.glyph === b.glyph &&
    a.color === b.color &&
    a.name === b.name
  )
}

// Content equality for the marks compared above, one per shape.
function sameRepeatEnd(a: RepeatEnd, b: RepeatEnd): boolean {
  return a.times === b.times
}

function sameEnding(a: Ending, b: Ending): boolean {
  return a.duration === b.duration && a.open === b.open && sameNumbers(a.numbers, b.numbers)
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((number, index) => number === b[index])
}

function sameFermata(a: Fermata, b: Fermata): boolean {
  return a.symbol === b.symbol && a.pointing === b.pointing && a.placement === b.placement
}

function sameFine(a: Fine, b: Fine): boolean {
  return compareFractions(a.location, b.location) === 0
}

function sameJump(a: DalSegno, b: DalSegno): boolean {
  return compareFractions(a.location, b.location) === 0 && a.target === b.target
}

/**
 * A tempo belongs to the score, but MusicXML writes it inside a part, and
 * exporters often write the same mark into every part. Each mark is kept
 * once, whichever part states it.
 *
 * MNX holds a list, so two different tempos at one point would both be drawn
 * over the same beat. The first is kept and the disagreement reported, as for
 * every other mark the parts share.
 */
function mergeTempos(
  existing: readonly Stated<Tempo>[],
  found: readonly Stated<Tempo>[],
  warnings: WarningCollector,
  context: ReportContext,
): Stated<Tempo>[] {
  const merged = [...existing]
  for (const tempo of found) {
    if (merged.some((other) => sameTempo(other.value, tempo.value))) continue
    const at = merged.findIndex(
      (other) => compareFractions(other.value.position, tempo.value.position) === 0,
    )
    if (at >= 0) {
      // A mark below existing.length is an earlier part's, and one at or past
      // it is this part's own. Only the wording of the report differs.
      const acrossParts = at < existing.length
      warnings.add(
        'inconsistent:tempo',
        acrossParts
          ? 'The parts of this score state different tempos at the same point in this ' +
              'measure. The first stated is the one converted.'
          : 'This part states two different tempos at the same point in this measure. ' +
              'The first is the one converted.',
        context,
        tempo.element,
      )
      continue
    }
    merged.push(tempo)
  }
  return merged
}

function sameTempo(a: Tempo, b: Tempo): boolean {
  return (
    a.bpm === b.bpm &&
    a.value.base === b.value.base &&
    a.value.dots === b.value.dots &&
    compareFractions(a.position, b.position) === 0
  )
}

/**
 * The part list, read once. `names` holds only the names drawn, while
 * `listed` holds every part id the list introduces, named or not, so a part
 * whose name is hidden or absent is still known to be listed.
 */
interface PartList {
  names: ReadonlyMap<string, string>
  shortNames: ReadonlyMap<string, string>
  listed: ReadonlySet<string>
  /** Each <score-part> by its id, for warnings about its entry. */
  scoreParts: ReadonlyMap<string, XmlElement>
  /** The instrument grouping the list draws, empty where it draws none. */
  grouping: readonly GroupingItem[]
  /** The instrument setup the list states, keyed by what the score holds it under. */
  sounds: ReadonlyMap<string, InstrumentSound>
  /**
   * What a note's <instrument> resolves to: the key the score holds the sound
   * under, and the name to draw. Keyed by the part that sets the instrument
   * up, then by the source's own instrument id, which is what a note names
   * and which MNX may not be able to state. An id belongs to the part whose
   * <score-part> declares it, so a note naming another part's id resolves to
   * nothing.
   */
  soundsByInstrument: ReadonlyMap<string, ReadonlyMap<string, ResolvedSound>>
}

/**
 * Reads the part list: each part's names and instrument setup, and the part
 * group edges. Everything not read here is reported.
 */
function readPartNames(root: ElementReader, warnings: WarningCollector): PartList {
  const names = new Map<string, string>()
  const shortNames = new Map<string, string>()
  const listed = new Set<string>()
  const scoreParts = new Map<string, XmlElement>()
  const grouping = new GroupingBuilder()
  const sounds = new Map<string, InstrumentSound>()
  const soundsByInstrument = new Map<string, Map<string, ResolvedSound>>()
  // Generated keys for instrument ids MNX cannot state, running sound1,
  // sound2, ... and skipping any key already taken, so a rename cannot
  // collide with an id the source wrote. Sounds are the score's, so every
  // part's instruments are taken, including those of parts not read yet.
  let renamed = 0
  const instrumentIds = new Set(
    root
      .blocks('part-list')
      .flatMap((list) => children(list.element, 'score-part'))
      .flatMap((part) => children(part, 'score-instrument'))
      .flatMap((instrument) => peekAttribute(instrument, 'id') ?? []),
  )
  const LIST_PATH: DocumentPath = ['score-partwise', 'part-list']

  for (const list of root.blocks('part-list')) {
    // Both kinds are accounted for here and walked below through readers of
    // their own, which report each whole; the walk goes through the raw
    // children because a group's members are decided by document order
    // across the two kinds.
    list.skip('score-part', 'part-group')
    for (const element of list.element.children) {
      if (element.name === 'score-part') {
        const scorePart = new ElementReader(element)
        const id = attribute(element, 'id')
        if (id !== undefined) {
          listed.add(id)
          scoreParts.set(id, element)
          grouping.part(id)
        }

        const name = drawnName(scorePart, 'part-name')
        const shortName = drawnName(scorePart, 'part-abbreviation')
        if (id !== undefined) {
          if (name) names.set(id, name)
          if (shortName) shortNames.set(id, shortName)
        }

        // The instrument setup. A <score-instrument> names what plays the
        // part; what its reader passes over is reported by the sweep. A part
        // may set up several, one per kit component, so every block is read.
        const named = new Map<string, { name: string | undefined; element: XmlElement }>()
        for (const instrument of scorePart.blocks('score-instrument')) {
          const instrumentId = requireAttribute(instrument.element, 'id', LIST_PATH)
          const nameElement = instrument.child('instrument-name')
          const instrumentName = nameElement ? trimmedText(nameElement) : ''
          named.set(instrumentId, {
            name: instrumentName === '' ? undefined : instrumentName,
            element: instrument.element,
          })
        }

        // From a <midi-instrument> only <midi-unpitched> is taken: the
        // schema's sound has no home for the rest of a synthesizer setup, its
        // midiNumber being the MIDI pitch backing a percussion kit rather
        // than the patch a <midi-program> names, so the others are reported
        // by name. A block naming no <score-instrument> sets up nothing a
        // note can name, so it is left unread and reported whole.
        //
        // Nothing here is refused: a block naming no instrument, or a pitch
        // outside MIDI's range, is a playback detail. Whatever is not taken
        // here is reported by the sweep.
        const midiPitches = new Map<string, number>()
        for (const midi of scorePart.blocks('midi-instrument')) {
          const midiId = attribute(midi.element, 'id')
          if (midiId === undefined || !named.has(midiId)) continue
          const stated = child(midi.element, 'midi-unpitched')?.text.trim() ?? ''
          // MusicXML numbers these from 1 and MIDI from 0.
          const pitch = parseWholeNumber(stated)
          if (pitch === undefined || pitch < 1 || pitch > 128) continue
          midi.child('midi-unpitched')
          midiPitches.set(midiId, pitch - 1)
        }

        for (const [instrumentId, { name: instrumentName, element: instrument }] of named) {
          let key = instrumentId
          const fits = MNX_ID_PATTERN.test(key)
          if (!fits || GENERATED_ID_PATTERN.test(key)) {
            do {
              renamed += 1
              key = renamedId('instrument', renamed)
            } while (instrumentIds.has(key))
            warnings.add(
              'unrepresentable:instrument-id',
              fits
                ? `The instrument id "${instrumentId}" is shaped like the ids the converter ` +
                    `gives ${GENERATED_ID_KINDS}, and MNX states them all the same way, so the ` +
                    `instrument is renamed ${key}.`
                : `The instrument id "${instrumentId}" does not fit MNX's id, which is 1 to 256 ` +
                    `printable ASCII characters, so the instrument is renamed ${key}.`,
              id !== undefined ? { part: id } : {},
              instrument,
            )
          }
          sounds.set(key, {
            name: instrumentName,
            midiNumber: midiPitches.get(instrumentId),
          })
          if (id !== undefined) {
            const forPart = soundsByInstrument.get(id) ?? new Map<string, ResolvedSound>()
            forPart.set(instrumentId, { key, name: instrumentName })
            soundsByInstrument.set(id, forPart)
          }
        }

        scorePart.reportUnread(warnings, id !== undefined ? { part: id } : {})
      } else if (element.name === 'part-group') {
        const group = new ElementReader(element)
        grouping.edge(group, warnings, ['score-partwise', 'part-list'])
        group.reportUnread(warnings, {})
      }
    }
  }

  return {
    names,
    shortNames,
    listed,
    scoreParts,
    grouping: grouping.finish(warnings),
    sounds,
    soundsByInstrument,
  }
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

  if (partList.listed.size > 0 && !partList.listed.has(id)) {
    warnings.add(
      'unresolved:part-id',
      `The part list has no entry for part ${id}.`,
      { part: id },
      element,
      'id',
    )
  }

  const state = newPartState(ids, partList.soundsByInstrument.get(id))
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(
      measureElement,
      index,
      id,
      state,
      partTimes[index],
      scoreTimes[index],
      warnings,
      partPath,
    ),
  )
  // Spans are paired once the whole part is in, because the document's order
  // is not the music's. What stays open is reported in the same step.
  state.spanners.finish(
    readings.map((reading) => reading.measure),
    warnings,
  )
  reportHeldAtPartEnd(state, warnings)
  resolveEndings(readings, warnings, id)
  resolveMeasureRepeats(readings, warnings, id)

  return {
    part: {
      id,
      name: partList.names.get(id),
      shortName: partList.shortNames.get(id),
      staves: state.staves,
      kit: state.kit,
      transposition: state.statedTransposition,
      measures: readings.map((reading) => reading.measure),
    },
    element,
    globals: readings.map((reading) => reading.global),
    soundTempos: readings.map((reading) => reading.soundTempos),
  }
}

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
      const echoed = (globalMeasures[index]?.tempos ?? []).some(
        (tempo) =>
          compareFractions(tempo.position, sound.position) === 0 &&
          quarterNotesPerMinute(tempo) === sound.bpm,
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
 * part of that line's music.
 */
function soundingVoices(measure: XmlElement): (string | undefined)[] {
  return children(measure, 'note')
    .filter((note) => !child(note, 'rest'))
    .map((note) => child(note, 'voice')?.text.trim())
}

/**
 * Walks each measure repeat sign from its start to its stop, or to the end
 * of the part where the source never closes it, as MusicXML allows. Every
 * measure under the sign draws it in MusicXML; MNX states it only on the
 * first measure of each pattern, so a two-measure pattern is marked on
 * every other measure.
 *
 * MusicXML scopes each edge to a staff, and MNX states one sign for the
 * part's measure, so staves that truly disagree cannot all be carried: the
 * part's sign ends at the first stop and restarts at any start. An edge
 * that cuts or overrides another staff's running sign is reported.
 */
function resolveMeasureRepeats(
  readings: readonly MeasureReading[],
  warnings: WarningCollector,
  partId: string,
): void {
  // The pattern each staff's sign states, keyed by staff. An edge written
  // without a staff was read as one edge per staff, so the keys are always
  // concrete.
  const open = new Map<number, number>()
  let pattern: number | undefined
  let offset = 0
  readings.forEach((reading, index) => {
    const context: ReportContext = { part: partId, measure: index + 1 }
    const stops = reading.measureRepeats.filter((edge) => edge.edge === 'stop')
    const starts = reading.measureRepeats.filter(
      (edge): edge is Extract<MeasureRepeatReading, { edge: 'start' }> => edge.edge === 'start',
    )

    // A stop is read before a start, so a measure stopping one sign may
    // start the next. A stop for a staff drawing no sign closes nothing, and
    // leaves the staves that are drawing one alone.
    const closed = stops.filter((stop) => open.delete(stop.staff))
    const firstClosed = closed[0]
    if (firstClosed !== undefined) {
      if (open.size > 0) {
        warnings.add(
          'unrepresentable:measure-repeat',
          "This measure stops a measure repeat sign for one staff while another staff's " +
            'sign runs on, and MNX states one sign for the part. The sign ends here for ' +
            'every staff.',
          context,
          firstClosed.element,
        )
        open.clear()
      }
      pattern = undefined
    }

    const first = starts[0]
    if (first !== undefined) {
      // A restated length, as one written per staff, loses nothing;
      // differing lengths cannot all be carried, so the first is kept and
      // the disagreement reported.
      const differing = starts.find((start) => start.measures !== first.measures)
      if (differing !== undefined) {
        warnings.add(
          'unrepresentable:measure-repeat',
          'This measure starts measure repeats of different patterns, and MNX states ' +
            'one for the measure. The first is the one converted.',
          context,
          differing.element,
        )
      }

      // A staff's running sign that no start here restates is cut by the
      // restart, which MusicXML never said happens on that staff.
      const restated = new Set(starts.map((start) => start.staff))
      const cut = [...open.keys()].filter((staff) => !restated.has(staff))
      if (cut.length > 0) {
        warnings.add(
          'unrepresentable:measure-repeat',
          "This measure starts a measure repeat sign while another staff's sign is " +
            'still running, and MNX states one sign for the part. The new sign ' +
            'replaces the running one.',
          context,
          first.element,
        )
        for (const staff of cut) open.delete(staff)
      }

      for (const start of starts) open.set(start.staff, start.measures)
      pattern = first.measures
      offset = 0
    }

    if (pattern !== undefined) {
      if (offset % pattern === 0) reading.measure.measureRepeat = pattern
      offset += 1
    }
  })
}

function readMeasure(
  element: XmlElement,
  index: number,
  partId: string,
  state: PartState,
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
  // one reader, so its own attributes are swept here: the label above read
  // the number, and anything else (implicit, non-controlling) is a loss.
  reportUnreadAttributes(element, warnings, context)
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
  const segnos: Stated<NamedSegno>[] = []
  const fines: Stated<Fine>[] = []
  const jumps: Stated<DalSegno>[] = []
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
    soundingVoices(element),
    state.beamsOpenAtBarline,
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
        readNote(reader, state, index, builder, warnings, context, measurePath)
        break

      case 'direction': {
        const reading = readDirection(
          reader,
          builder.position(),
          (at, staff) => builder.graceNotesAt(at, staff),
          index,
          state,
          warnings,
          context,
          measurePath,
        )
        dynamics.push(...reading.dynamics)
        tempos.push(...reading.tempos)
        segnos.push(...reading.segnos)
        fines.push(...reading.fines)
        jumps.push(...reading.jumps)
        soundTempos.push(...reading.soundTempos)
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
        // The same holds for each mark: a second statement at the same edge
        // that differs is a second claim about the one mark MNX states there.
        const reportSecond = (name: string, second: XmlElement | undefined): void => {
          if (second === undefined) return
          warnings.add(
            'inconsistent:barline',
            `Two barlines at this edge of the measure state different ${name}s. The ` +
              'first is the one converted.',
            context,
            second,
          )
        }
        if (repeatEnd && reading.repeatEnd) {
          reportSecond(
            'repeat',
            sameRepeatEnd(repeatEnd.value, reading.repeatEnd.value)
              ? undefined
              : reading.repeatEnd.element,
          )
        }
        if (endingStart && reading.endingStart) {
          reportSecond(
            'ending start',
            sameNumbers(endingStart.numbers, reading.endingStart.numbers)
              ? undefined
              : reading.endingStart.element,
          )
        }
        if (endingStop && reading.endingStop) {
          reportSecond(
            'ending stop',
            endingStop.open === reading.endingStop.open ? undefined : reading.endingStop.element,
          )
        }
        if (fermata && reading.fermata) {
          reportSecond(
            'fermata',
            sameFermata(fermata.value, reading.fermata.value) ? undefined : reading.fermata.element,
          )
        }
        barline ??= reading.barline
        repeatStart ||= reading.repeatStart
        repeatEnd ??= reading.repeatEnd
        endingStart ??= reading.endingStart
        endingStop ??= reading.endingStop
        fermata ??= reading.fermata
        // Collected with the segnos the directions read, so a sign stated
        // twice over is settled in one place for both forms.
        if (reading.segno) segnos.push(reading.segno)
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
        const reading = readSound(reader, builder.position(), warnings, context)
        if (reading.fine) fines.push({ value: reading.fine, element: found })
        if (reading.jump) jumps.push({ value: reading.jump, element: found })
        if (reading.tempo) soundTempos.push(reading.tempo)
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
    (lastEventBefore, graceNotesAt, lastEvents) => {
      state.spanners.settleSpanCovers(index, lastEventBefore, graceNotesAt, lastEvents)
    },
    state.kit,
    warnings,
    context,
    measurePath,
    element.line,
  )
  state.carriedTupletStops = finished.carriedTupletStops
  state.beamsOpenAtBarline = finished.beamsOpenAtBarline

  return {
    measure: {
      clefs: dedupeClefs(clefs, warnings, context),
      staffConfigs: dedupeStaffConfigs(staffConfigs, warnings, context),
      // Beams are stated over the measure in MNX rather than on the notes,
      // and each voice is beamed on its own.
      beams: finished.beamedEvents.flatMap((events) => buildBeams(events, warnings, context)),
      dynamics,
      arpeggios: finished.arpeggios,
      // Filled in below, once the whole part has been read.
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
      segno: onePerMeasure(segnos, 'segno', undefined, warnings, context, drawnDifferently),
      fine: onePerMeasure(fines, 'fine', 'fine', warnings, context),
      jump: onePerMeasure(jumps, 'jump', 'dalsegno', warnings, context),
      multimeasureRest: oneMultimeasureRest(multimeasureRests, warnings, context),
      systemBreak,
      pageBreak,
    },
    endingStart,
    endingStop,
    measureRepeats,
    soundTempos,
  }
}

/**
 * The one navigation mark of its kind MNX states on a measure. A measure with
 * two of them at different points has no faithful conversion, so the first is
 * kept and the rest reported; two written at the same point are the same mark
 * and lose nothing, unless `differs` says they are drawn as different marks.
 */
function onePerMeasure<T extends { location: Fraction }>(
  marks: readonly Stated<T>[],
  name: string,
  // The attribute that states the mark. Undefined where the element states it.
  attribute: string | undefined,
  warnings: WarningCollector,
  context: ReportContext,
  differs?: (first: T, other: T) => boolean,
): Stated<T> | undefined {
  const first = marks[0]
  if (first === undefined) return undefined
  for (const { value: other, element } of marks.slice(1)) {
    if (
      compareFractions(other.location, first.value.location) !== 0 ||
      differs?.(first.value, other)
    ) {
      warnings.add(
        'unrepresentable:element',
        `A measure carries more than one ${name}, and MNX states one per measure. ` +
          'The first is the one converted.',
        context,
        element,
        attribute,
      )
    }
  }
  return first
}

/**
 * Whether two segnos at the same point are different marks rather than the
 * same mark restated: drawn as different glyphs, or in different colors. The
 * name is not compared, because it is never written; it only matches a jump
 * to the sign it returns to.
 */
function drawnDifferently(a: Segno, b: Segno): boolean {
  return a.glyph !== b.glyph || a.color !== b.color
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

/** The sign, where it sits on the staff, and how it is transposed. */
function sameClef(a: Clef, b: Clef): boolean {
  return a.sign === b.sign && a.staffPosition === b.staffPosition && a.octave === b.octave
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
