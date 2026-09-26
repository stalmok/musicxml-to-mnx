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
  Key,
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
import type { WarningCollector, WarningContext, WarningPlace } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import {
  attribute,
  child,
  children,
  peekAttribute,
  requireAttribute,
  trimmedText,
} from '../xml/tree.js'
import { firstTimeStated, readAttributes } from './attributes.js'
import type { MeasureRepeatReading, StaffSignature } from './attributes.js'
import { readBarline, resolveEndings } from './barlines.js'
import { buildBeams } from './beams.js'
import { readDirection, readSound } from './directions.js'
import type { SoundTempo } from './directions.js'
import { requireDuration } from './divisions.js'
import { lengthOf } from './duration.js'
import { drawnName, ElementReader, reportUnreadAttributes } from './element.js'
import { GroupingBuilder, pruneGrouping } from './part-groups.js'
import { addFractions, compareFractions, fraction, negate } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { readNote } from './notes.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseWholeNumber } from './numbers.js'
import { readPrint } from './print.js'
import { IdGenerator } from './idGenerator.js'
import { settleJumps } from './jumps.js'
import type { NamedSegno, ReadGlobalMeasure, DalSegno } from './jumps.js'
import { measureLength, newPartState } from './state.js'
import { keyFifthsFlipAt, writtenFifths, writtenFifthsWithFlip } from './transposition.js'
import { attributeLoss, elementLoss } from './unrepresentable.js'
import type { HeldSignature, PartState, ResolvedSound } from './state.js'
import { MeasureBuilder } from './voices.js'

interface PartReading {
  part: Part
  /** What this part declared for each of its measures, by position. */
  globals: readonly ReadGlobalMeasure[]
  /** The <sound tempo> statements of each of its measures, by position. */
  soundTempos: readonly (readonly SoundTempo[])[]
}

interface MeasureReading {
  measure: Measure
  global: ReadGlobalMeasure
  /**
   * Held until the part can join it to its other end, with the line the
   * <ending> was written on, so the report names it.
   */
  endingStart: { numbers: readonly number[]; line: number } | undefined
  endingStop: { open: boolean; line: number } | undefined
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
      // report a <score-partwise> document as merely missing.
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
  // which is MNX's part.smuflFont. The family is carried; anything else in
  // the element keeps the no-home verdict, reported only where it is there
  // to lose. MusicXML allows one <defaults> and one <music-font> in it.
  let musicFont: string | undefined
  for (const defaults of reader.children('defaults')) {
    for (const font of children(defaults, 'music-font')) {
      musicFont ??= attribute(font, 'font-family')
      reportUnreadAttributes(font, warnings, {})
    }
    if (defaults.children.some((found) => found.name !== 'music-font')) {
      const loss = elementLoss('defaults')
      warnings.add(loss.code, `<defaults> ${loss.ending}`, { line: defaults.line }, 'defaults')
    }
  }

  // <identification> holds the composer, the rights and the encoding notes,
  // and the schema has no header for any of them. The one part with a home
  // is <encoding><supports>: a whole "yes" for accidentals or beams is the
  // schema's support flag, and it is carried, so those are consumed as
  // accounted. A "no", or a declaration narrowed to one attribute, is a
  // statement the writer cannot make, and counts as the rest, which is
  // reported where there is one. MusicXML allows one <encoding> and any
  // number of <supports> in it.
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
      warnings.add(
        loss.code,
        `<identification> ${loss.ending}`,
        { line: identification.line },
        'identification',
      )
    }
  }

  const partList = readPartNames(reader, warnings)
  reader.reportUnread(warnings, {})

  const ids = new IdGenerator()
  const partElements = children(root, 'part')
  const scoreTimes = scoreTimesInForce(partElements)
  const readings = partElements.map((element) =>
    readPart(element, partList, ids, scoreTimes, warnings, path),
  )

  const merged: ReadGlobalMeasure[] = []
  // Held by position rather than by part id, which two parts can share.
  const flips = readings.map((reading) =>
    mergeGlobalMeasures(merged, reading.globals, reading.part, warnings),
  )
  const globalMeasures = settleJumps(merged)

  for (const reading of readings) {
    reportSoundTempos(reading.part.id, reading.soundTempos, globalMeasures, warnings)
  }

  // The global list is the score's measure list, and every part's measures
  // line up with it by position. A part with fewer of them stops before the
  // score does, which nothing downstream can see: MNX gives a part a plain
  // list of measures, so a short one is a well-formed document that says the
  // part falls silent partway through.
  for (const reading of readings) {
    const found = reading.part.measures.length
    if (found !== globalMeasures.length) {
      warnings.add(
        'inconsistent:measure-count',
        `Part ${reading.part.id} has ${String(found)} measures where the score has ` +
          `${String(globalMeasures.length)}.`,
        { part: reading.part.id },
      )
    }
  }

  // A staff pointing at a part the score does not hold would dangle, so the
  // grouping keeps only parts that were written.
  const written = new Set(readings.map((reading) => reading.part.id))
  const parts = readings.map(({ part }, index) => {
    const flipAt = flips[index]
    if (flipAt === undefined || !part.transposition) return part
    return { ...part, transposition: { ...part.transposition, keyFifthsFlipAt: flipAt } }
  })
  return renameInvalidPartIds(
    {
      globalMeasures,
      parts,
      grouping: pruneGrouping(partList.grouping, written, partList.lines, warnings),
      sounds: partList.sounds,
      ...(musicFont !== undefined ? { musicFont } : {}),
      ...(declaresBeams ? { declaresBeams } : {}),
      ...(declaresAccidentals ? { declaresAccidentals } : {}),
    },
    partList.lines,
    warnings,
  )
}

/**
 * Renames every part id MNX cannot state or the converter generates for
 * something else, in the parts and in the grouping's staves, which are the
 * only places the model refers to a part by id. Generated names run p1, p2,
 * ... skipping any id a part already holds, so a rename cannot collide: the
 * counter only rises, so no generated name is reached twice, and the set it
 * is held against is read-only for that reason. A generated name is never
 * one GENERATED_ID_PATTERN matches.
 */
function renameInvalidPartIds(
  score: Score,
  lines: ReadonlyMap<string, number>,
  warnings: WarningCollector,
): Score {
  const failing = score.parts.filter(
    (part) => !MNX_ID_PATTERN.test(part.id) || GENERATED_ID_PATTERN.test(part.id),
  )
  if (failing.length === 0) return score

  const taken: ReadonlySet<string> = new Set(score.parts.map((part) => part.id))
  const renames = new Map<string, string>()
  let counter = 0
  for (const part of failing) {
    let generated: string
    do {
      counter += 1
      generated = renamedId('part', counter)
    } while (taken.has(generated))
    renames.set(part.id, generated)
    const line = lines.get(part.id)
    warnings.add(
      'unrepresentable:part-id',
      MNX_ID_PATTERN.test(part.id)
        ? `The part id "${part.id}" is shaped like the ids the converter gives ` +
            `${GENERATED_ID_KINDS}, and MNX states them all the same way, so the ` +
            `part is renamed ${generated}.`
        : `The part id "${part.id}" does not fit MNX's id, which is 1 to 256 printable ` +
            `ASCII characters, so the part is renamed ${generated}.`,
      { part: part.id, ...(line !== undefined ? { line } : {}) },
      'part',
    )
  }

  return {
    ...score,
    parts: score.parts.map((part) => {
      const renamed = renames.get(part.id)
      return renamed === undefined ? part : { ...part, id: renamed }
    }),
    grouping: renameGroupingParts(score.grouping, renames),
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

interface KeyPair {
  /** The fifths the score sounds in. */
  score: number
  /** The fifths this part sounds in, which is what it writes taken back
   * through its transposition. */
  part: number
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
  // A transposing part writing the enharmonic signature reads back as a key
  // twelve fifths from the rest of the score's, which is the same key spelled
  // the other way rather than a different one. MNX states where such a part
  // flips, so the keys are settled first and only what the flip point does
  // not account for is reported below.
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
  // spelling is reported below. Where an earlier part has the measure and the
  // score's key is in force, that spelling is still the score's key, so it
  // does not re-spell the parts that stated it first.
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

  // What each side has in force, not just what it states: a time signature
  // stands until the next one, so a part that says nothing in the measure
  // where the score changes meter is disagreeing all the same. The comparison
  // runs only where one side states something, so a disagreement is reported
  // once where it starts rather than once per measure it spans.
  let scoreTime: TimeSignature | undefined
  let partTime: TimeSignature | undefined
  // The barline's rule below holds for every mark MNX states once on the
  // score's measure: parts stating different ones disagree about the one
  // mark, so that is reported. Each is compared by content where two parts
  // both state one; a part restating an equal one says nothing new.
  const reportDifferingMark = <T>(
    name: string,
    inScore: T | undefined,
    inPart: T | undefined,
    same: (a: T, b: T) => boolean,
    context: WarningContext,
  ): void => {
    if (inScore === undefined || inPart === undefined || same(inScore, inPart)) return
    warnings.add(
      'unrepresentable:cross-part-mark',
      `The parts of this score state different ${name}s on this measure, and MNX ` +
        'states one there. The first stated is the one converted.',
      context,
      name,
    )
  }
  found.forEach((measure, index) => {
    const existing = target[index]
    scoreTime = existing?.time ?? scoreTime
    partTime = measure.time ?? partTime
    // The measure's position, as every other report names it. A source that
    // labels it otherwise still labels one measure of a part, and two reports
    // naming the same measure two ways cannot be held together.
    const context = { part, measure: index + 1 }
    const pair = keys[index]
    if (
      pair &&
      writtenFifthsWithFlip(pair.score, transposition, flipAt) !==
        writtenFifths(pair.part, transposition)
    ) {
      warnings.add(
        'unrepresentable:cross-part-key',
        'The parts of this score are in different keys, and MNX states one key for ' +
          'the score. The first stated is the one converted.',
        context,
        'key',
      )
    }
    // Compared only where an earlier part has the measure, as the key is:
    // past the last measure they reach, the meter in force is this part's own
    // and there is no other part to disagree with it.
    if (
      existing &&
      (existing.time ?? measure.time) &&
      scoreTime &&
      partTime &&
      !sameMeter(scoreTime, partTime)
    ) {
      warnings.add(
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
      existing.multimeasureRest !== measure.multimeasureRest
    ) {
      warnings.add(
        'unrepresentable:cross-part-multimeasure-rest',
        'The parts of this score state multi-measure rests of different spans over ' +
          'this measure, and MNX states one for the score. The first stated is the ' +
          'one converted.',
        context,
        'multiple-rest',
      )
    }
    // A barline is the whole score's: every part is cut at the same place,
    // and each usually writes the same thing. Parts writing different ones
    // disagree about the one line MNX can state, so that is reported.
    if (existing?.barline && measure.barline && existing.barline !== measure.barline) {
      warnings.add(
        'unrepresentable:cross-part-barline',
        'The parts of this score close this measure with different barlines, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        'barline',
      )
    }
    // A segno is restated in each part the same way a barline is. Parts
    // stating different signs, at different points or drawn differently,
    // disagree about the one segno MNX can state, so that is reported.
    if (existing?.segno && measure.segno && !sameSegno(existing.segno, measure.segno)) {
      warnings.add(
        'unrepresentable:cross-part-segno',
        'The parts of this score state different segnos on this measure, and MNX ' +
          'states one for the score. The first stated is the one converted.',
        context,
        'segno',
      )
    }
    // The number is the label the score writes over the measure, so parts
    // labelling the same measure differently is the source disagreeing with
    // itself. The comparison runs only where both carry one, which is only
    // where the label differs from the measure's position.
    if (
      existing?.number !== undefined &&
      measure.number !== undefined &&
      existing.number !== measure.number
    ) {
      warnings.add(
        'inconsistent:measure-number',
        `This measure is numbered ${String(existing.number)} by an earlier part and ` +
          `${String(measure.number)} by this one. The first is the one converted.`,
        context,
        'measure',
      )
    }
    reportDifferingMark('repeat', existing?.repeatEnd, measure.repeatEnd, sameRepeatEnd, context)
    reportDifferingMark('ending', existing?.ending, measure.ending, sameEnding, context)
    reportDifferingMark('fermata', existing?.fermata, measure.fermata, sameFermata, context)
    reportDifferingMark('fine', existing?.fine, measure.fine, sameFine, context)
    reportDifferingMark('jump', existing?.jump, measure.jump, sameJump, context)
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

// The display is only the glyph the signature is drawn as, so 4/4 as a C and
// 4/4 as numbers are not a disagreement about the meter itself.
function sameMeter(a: TimeSignature, b: TimeSignature): boolean {
  return a.count === b.count && a.unit === b.unit
}

function sameTime(a: TimeSignature, b: TimeSignature | undefined): boolean {
  return b !== undefined && sameMeter(a, b) && a.display === b.display
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
  return (
    a.duration === b.duration &&
    a.open === b.open &&
    a.numbers.length === b.numbers.length &&
    a.numbers.every((number, index) => number === b.numbers[index])
  )
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
 * A tempo belongs to the score rather than to a part, but MusicXML has to
 * write it inside one, and exporters routinely write the same mark into every
 * part. Taking them all would state one tempo several times over, which a
 * renderer would draw several times over; taking only the first part's would
 * lose a mark that only a later part states. So each is kept once.
 *
 * Two tempos at one point are the exception. MNX holds a list, so both would
 * be written and both drawn over the same beat, and a player would have to
 * pick one. That is the parts disagreeing about what the score does, so the
 * first is kept and the disagreement reported, as for every other mark the
 * parts share.
 */
function mergeTempos(
  existing: readonly Tempo[],
  found: readonly Tempo[],
  warnings: WarningCollector,
  context: WarningContext,
): Tempo[] {
  const merged = [...existing]
  for (const tempo of found) {
    if (merged.some((other) => sameTempo(other, tempo))) continue
    const at = merged.findIndex((other) => compareFractions(other.position, tempo.position) === 0)
    if (at >= 0) {
      // Every part is merged into the same list, so a mark already there is
      // an earlier part's where it came from the list this part was merged
      // into, and this part's own where it came from this part's marks. Both
      // are a disagreement about one beat; only the wording differs, and the
      // report is no use if it sends a reader looking for a second part that
      // is not there.
      const acrossParts = at < existing.length
      warnings.add(
        'inconsistent:tempo',
        acrossParts
          ? 'The parts of this score state different tempos at the same point in this ' +
              'measure. The first stated is the one converted.'
          : 'This part states two different tempos at the same point in this measure. ' +
              'The first is the one converted.',
        context,
        'metronome',
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
 * The name each part goes under. The part list holds a good deal more than
 * that, from a part's abbreviation to the brace grouping two of them
 * together, and every bit of it that is not read here is reported: it used to
 * be skipped wholesale on the strength of the name being read.
 */
/**
 * The part list, read once. `names` holds only the names actually drawn, while
 * `listed` holds every part id the list introduces, named or not, so a part
 * whose name is hidden or absent is still known to be listed.
 */
interface PartList {
  names: ReadonlyMap<string, string>
  shortNames: ReadonlyMap<string, string>
  listed: ReadonlySet<string>
  /** Where each <score-part> is written, for warnings about its entry. */
  lines: ReadonlyMap<string, number>
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
 * The drawn text of a named element, or undefined where the source gives none.
 * An empty element states no name, and one hidden with print-object="no" is
 * one the source chose not to draw; MNX's part.name and part.shortName are both
 * optional, so either is omitted rather than drawn.
 *
 * A <score-part> holds at most one <part-name> and one <part-abbreviation>, so
 * taking the first with child() is right.
 */
function readPartNames(root: ElementReader, warnings: WarningCollector): PartList {
  const names = new Map<string, string>()
  const shortNames = new Map<string, string>()
  const listed = new Set<string>()
  const lines = new Map<string, number>()
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
          lines.set(id, element.line)
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
        const named = new Map<string, string | undefined>()
        for (const instrument of scorePart.blocks('score-instrument')) {
          const instrumentId = requireAttribute(instrument.element, 'id', LIST_PATH)
          const nameElement = instrument.child('instrument-name')
          const instrumentName = nameElement ? trimmedText(nameElement) : ''
          named.set(instrumentId, instrumentName === '' ? undefined : instrumentName)
        }

        // From a <midi-instrument> only <midi-unpitched> is taken: the
        // schema's sound has no home for the rest of a synthesizer setup, its
        // midiNumber being the MIDI pitch backing a percussion kit rather
        // than the patch a <midi-program> names, so the others are reported
        // by name. A block naming no <score-instrument> sets up nothing a
        // note can name, so it is left unread and reported whole.
        //
        // Read without refusing anything: a block naming no instrument, or a
        // pitch outside what MIDI counts, is a playback detail of a document
        // that is otherwise ordinary music. Whatever is not taken here is left
        // unread and reported by the sweep.
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

        for (const [instrumentId, instrumentName] of named) {
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
              { ...(id !== undefined ? { part: id } : {}), line: element.line },
              'score-instrument',
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
    lines,
    grouping: grouping.finish(warnings),
    sounds,
    soundsByInstrument,
  }
}

/**
 * The time signature each measure of the score opens with, as the first part
 * stating one there has it.
 */
function scoreTimesInForce(parts: readonly XmlElement[]): (TimeSignature | undefined)[] {
  const perPart = parts.map(timesInForce)
  const longest = Math.max(0, ...perPart.map((times) => times.length))
  return Array.from({ length: longest }, (_, index) =>
    perPart.map((times) => times[index]).find((time) => time !== undefined),
  )
}

/**
 * The time signature each measure of a part opens with, read ahead of the
 * part itself: a part that states none of its own runs to the barline the
 * other parts state, and those may be read after it. It answers one question
 * per statement, whether it stands where the measure begins, so its cursor
 * moves by the rules the measure builder's does. The first statement at the
 * start stands, and the last one after it opens the next measure. The part
 * reader reports or refuses whatever here is broken, so nothing here reports
 * anything, and a value it cannot read counts as nothing.
 */
function timesInForce(part: XmlElement): (TimeSignature | undefined)[] {
  let inForce: TimeSignature | undefined
  let divisions = 1
  return children(part, 'measure').map((measure) => {
    let opens = inForce
    let settled = false
    let late = false
    let cursor = fraction(0)
    const by = (found: XmlElement) => {
      const duration = child(found, 'duration')
      const count = duration && parseWholeNumber(trimmedText(duration))
      return fraction(count ?? 0, divisions * 4)
    }
    // A grace note takes none of the measure's time, whatever it states. A
    // note stating no <duration> lasts its written value, except a rest marked
    // as the measure's, which lasts the measure where a time signature says
    // how long that is.
    const noteLength = (found: XmlElement) => {
      if (child(found, 'grace')) return fraction(0)
      if (child(found, 'duration')) return by(found)
      const rest = child(found, 'rest')
      if (rest && opens && attribute(rest, 'measure') === 'yes') {
        return fraction(opens.count, opens.unit)
      }
      const type = child(found, 'type')
      const base = type && noteValueBaseOf(type)
      return base ? lengthOf({ base, dots: children(found, 'dot').length }) : fraction(0)
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
      const count = stated && parseWholeNumber(trimmedText(stated))
      if (count && count > 0) divisions = count
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

function readPart(
  element: XmlElement,
  partList: PartList,
  ids: IdGenerator,
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
      { part: id, line: element.line },
      'score-part',
    )
  }

  const state = newPartState(ids, partList.soundsByInstrument.get(id))
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(measureElement, index, id, state, scoreTimes[index], warnings, partPath),
  )
  // Hairpins and octave shifts are paired once the whole part is in, because
  // each is written between the notes and the document's order is not the
  // music's; whatever is still open once the part ends is reported in the same
  // step, so nothing left open is dropped in silence.
  state.spanners.finish(
    readings.map((reading) => reading.measure),
    warnings,
  )
  const lastOutcome = 'This is the last measure of the part, so it is not converted.'
  if (state.lateKey) reportLate(KEY, state.lateKey, lastOutcome, warnings)
  if (state.lateTime) reportLate(TIME, state.lateTime, lastOutcome, warnings)
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
    globals: readings.map((reading) => reading.global),
    soundTempos: readings.map((reading) => reading.soundTempos),
  }
}

/**
 * A key or time signature stated after the start of a measure. A statement
 * MNX cannot carry, such as senza misura or a non-traditional key, states none.
 */
interface LateSignature<T> {
  value: T | undefined
  at: Fraction
  line: number
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
  context: WarningContext,
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
  const held = ({ at, line }: LateSignature<T>, value: T): HeldSignature<T> => ({
    value,
    partway: compareFractions(at, end) < 0,
    context: { ...context, line },
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
  at: WarningContext,
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
    at,
    kind.element,
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
  context: WarningContext,
): void {
  const at = (line: number) => ({ ...context, line })
  reportAcrossStaves(
    kind,
    group.statements,
    staves,
    inForce,
    warnings,
    at(group.first),
    group.place,
  )
  // Only what the measure opens with is settled against a converted value:
  // one stated after the start is carried to the next measure, and what
  // becomes of it is settled there.
  if (compareFractions(group.at, fraction(0)) !== 0) return
  const restated = restatement(group.statements)
  if (restated) {
    reportSecondAtStart(kind, converted, restated.value, warnings, at(group.last), group.place)
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
function restatement<T>(
  statements: readonly StaffSignature<T>[],
): { value: T | undefined } | undefined {
  const named = new Set<number | undefined>()
  let last: { value: T | undefined } | undefined
  for (const statement of statements) {
    last =
      statement.staff === undefined || named.has(statement.staff)
        ? { value: statement.value }
        : undefined
    named.add(statement.staff)
  }
  return last
}

/**
 * What the blocks at one point of a measure state about one signature: the
 * place the report reads at, the line of the first block stating one, the
 * line of the last, which is where a second statement is reported, and every
 * statement they make between them.
 */
interface StatedAt<T> {
  at: Fraction
  place: WarningPlace
  first: number
  last: number
  statements: StaffSignature<T>[]
}

/**
 * Reports a key or time signature stated again at the start of a measure,
 * differing from the first one stated there, which stands.
 */
function reportSecondAtStart<T>(
  kind: SignatureKind<T>,
  first: T | undefined,
  second: T | undefined,
  warnings: WarningCollector,
  context: WarningContext,
  place: WarningPlace,
): void {
  if (first === undefined ? second === undefined : kind.same(first, second)) return
  warnings.addAt(
    place,
    `inconsistent:${kind.element}`,
    `Two different ${kind.element} signatures are stated at the start of this measure. ` +
      'The later one is not converted.',
    context,
    kind.element,
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
    kind.element,
  )
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
 * Deciding it as each <sound> was read reported both as losses they are not.
 *
 * The two tempos are compared as quarter notes per minute, which is what
 * MusicXML's tempo attribute counts. A mark of a dotted quarter at 72 and a
 * <sound tempo> of 108 are one statement; one of 110 is another, and saying
 * so is what keeps a second playback tempo at one point from vanishing.
 *
 * The report reads in document order, so each is reported at the place the
 * <sound> kept as it was read rather than here at the end.
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
        { part: partId, measure: index + 1, line: sound.line },
        'sound',
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
    const context: WarningContext = { part: partId, measure: index + 1 }
    const stops = reading.measureRepeats.filter((edge) => edge.edge === 'stop')
    const starts = reading.measureRepeats.filter(
      (edge): edge is Extract<MeasureRepeatReading, { edge: 'start' }> => edge.edge === 'start',
    )

    // A stop is read before a start, so a measure stopping one sign may
    // start the next. A stop for a staff drawing no sign closes nothing, and
    // leaves the staves that are drawing one alone.
    const closed = stops.filter((stop) => open.delete(stop.staff)).length
    if (closed > 0) {
      if (open.size > 0) {
        warnings.add(
          'unrepresentable:measure-repeat',
          "This measure stops a measure repeat sign for one staff while another staff's " +
            'sign runs on, and MNX states one sign for the part. The sign ends here for ' +
            'every staff.',
          context,
          'measure-repeat',
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
      if (starts.some((start) => start.measures !== first.measures)) {
        warnings.add(
          'unrepresentable:measure-repeat',
          'This measure starts measure repeats of different patterns, and MNX states ' +
            'one for the measure. The first is the one converted.',
          context,
          'measure-repeat',
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
          'measure-repeat',
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
  scoreTime: TimeSignature | undefined,
  warnings: WarningCollector,
  path: DocumentPath,
): MeasureReading {
  const position = index + 1
  const context: WarningContext = { part: partId, measure: position }
  const stated = readMeasureLabel(element, warnings, context)
  const measurePath: DocumentPath = [...path, `measure ${String(stated ?? position)}`]
  // The measure element is walked child by child below rather than through
  // one reader, so its own attributes are swept here: the label above read
  // the number, and anything else (implicit, non-controlling) is a loss.
  reportUnreadAttributes(element, warnings, context)

  const clefs: Clef[] = []
  const staffConfigs: StaffConfig[] = []
  let key: Key | undefined
  let time: TimeSignature | undefined
  // Whether an <attributes> block has spoken on each. Kept apart from the
  // values, because a statement MNX cannot carry, such as senza misura or a
  // non-traditional key, reads as a statement with no value, and a later
  // block in the same measure may not overwrite it.
  let keySettled = false
  let timeSettled = false
  // Key and time signatures stated after the measure start.
  const lateKeys: LateSignature<Key>[] = []
  const lateTimes: LateSignature<TimeSignature>[] = []
  // Every key and time signature stated where the measure begins, whichever
  // block states it, settled once the measure is whole. Each is reported
  // through the place the first of them was read at, so the report still
  // reads where the source states it.
  const keyGroups: StatedAt<Key>[] = []
  const timeGroups: StatedAt<TimeSignature>[] = []
  // Every unmetered statement the measure makes, reported once the measure
  // has settled what it converts.
  const unmetered: { place: WarningPlace; line: number }[] = []
  const statedAt = <T>(groups: StatedAt<T>[], at: Fraction, line: number): StatedAt<T> => {
    const opened = groups.find((group) => compareFractions(group.at, at) === 0)
    if (opened) {
      opened.last = line
      return opened
    }
    const group: StatedAt<T> = {
      at,
      place: warnings.reserve(),
      first: line,
      last: line,
      statements: [],
    }
    groups.push(group)
    return group
  }
  const dynamics: Dynamic[] = []
  const tempos: Tempo[] = []
  // Every <sound tempo> of the measure, waiting on the score's marks to say
  // whether each one echoes a mark or stands alone.
  const soundTempos: SoundTempo[] = []
  const segnos: NamedSegno[] = []
  const fines: Fine[] = []
  const jumps: DalSegno[] = []
  const multimeasureRests: number[] = []
  const measureRepeats: MeasureRepeatReading[] = []
  let systemBreak = false
  let pageBreak = false
  let barline: BarlineType | undefined
  let repeatStart = false
  let repeatEnd: RepeatEnd | undefined
  let endingStart: { numbers: readonly number[]; line: number } | undefined
  let endingStop: { open: boolean; line: number } | undefined
  let fermata: Fermata | undefined

  const builder = new MeasureBuilder(state.carriedTupletStops, soundingVoices(element))
  // The last time signature stated after the measure start. It is the next
  // measure's, so the part takes it only once this measure is settled.
  let nextTime: { value: TimeSignature | undefined } | undefined

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
        const at = builder.position()
        // Held for the settlement after the loop, which sees every block
        // stating one at this point.
        if (reading.keys.length > 0) {
          statedAt(keyGroups, at, found.line).statements.push(...reading.keys)
          if (builder.atMeasureStart()) {
            if (!keySettled) key = reading.key
            keySettled = true
          } else {
            lateKeys.push({ value: reading.key, at, line: found.line })
          }
        }
        // Taken after the key, and before the settlement of the time blocks
        // around it, so the reports of one block read in the order it
        // states them.
        for (const stated of reading.times) {
          if (stated.value === undefined) {
            unmetered.push({ place: warnings.reserve(), line: stated.line })
          }
        }
        if (reading.times.length > 0) {
          statedAt(timeGroups, at, found.line).statements.push(...reading.times)
          if (builder.atMeasureStart()) {
            // A second statement at the start changes nothing. A senza-misura
            // statement clears it: the music is unmetered from here on,
            // whatever was in force before.
            if (!timeSettled) {
              time = reading.time
              state.time = reading.time
            }
            timeSettled = true
          } else {
            lateTimes.push({ value: reading.time, at, line: found.line })
            nextTime = { value: reading.time }
          }
        }
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
        if (barline && reading.barline && reading.barline !== barline) {
          warnings.add(
            'inconsistent:barline',
            'Two barlines close this measure with different styles. The first is the ' +
              'one converted.',
            { ...context, line: found.line },
            'barline',
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

      // A <sound> is playback, so nothing it carries reaches the output. A
      // <sound tempo> at the same point as a <metronome> the score draws is
      // that mark's playback echo, and is passed over in silence; a bare one
      // is reported like any other playback the output cannot hold. Which it
      // is waits for the end of the measure, because the mark can be written
      // after the <sound> that echoes it.
      case 'sound': {
        const reading = readSound(reader, builder.position(), warnings, context)
        if (reading.fine) fines.push(reading.fine)
        if (reading.jump) jumps.push(reading.jump)
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
        builder.shift(found.name === 'backup' ? negate(by) : by, warnings, context, found.line)
        break
      }

      default: {
        const loss = elementLoss(found.name)
        warnings.add(
          loss.code,
          `<${found.name}> ${loss.ending}`,
          { ...context, line: found.line },
          found.name,
        )
        continue
      }
    }

    reader.reportUnread(warnings, context)
  }

  // Settled with the measure whole, so a staff stated in a block of its own
  // stands beside the staves the blocks around it state.
  for (const group of keyGroups) {
    settleStated(KEY, group, key, state.staves, state.staffKeys, warnings, context)
  }
  for (const group of timeGroups) {
    settleStated(TIME, group, time, state.staves, state.staffTimes, warnings, context)
  }

  // A measure stating none, or one MNX cannot carry, leaves the one before in
  // force.
  key = opening(KEY, state.lateKey, { settled: keySettled, value: key }, warnings)
  state.convertedKey = key ?? state.convertedKey
  state.lateKey = holdLate(KEY, lateKeys, state.convertedKey, builder.furthest(), warnings, context)
  time = opening(TIME, state.lateTime, { settled: timeSettled, value: time }, warnings)
  state.convertedTime = time ?? state.convertedTime
  state.lateTime = holdLate(
    TIME,
    lateTimes,
    state.convertedTime,
    builder.furthest(),
    warnings,
    context,
  )

  // Unmetered music is a loss whatever the measure converts. What it says
  // depends on that: a measure stating a time signature beside the unmetered
  // one, and one carrying an unmetered statement past its start, are both
  // converted with a meter the music they cover does not have. Measured
  // against the meter in force, not the measure's own statement, because a
  // measure stating none keeps the one before it.
  for (const { place, line } of unmetered) {
    warnings.addAt(
      place,
      'unrepresentable:senza-misura',
      'This music is written senza misura, and MNX states meter as a time signature ' +
        `or nothing. The measure is converted with ${
          state.convertedTime ? 'the time signature in force' : 'no time signature'
        }.`,
      { ...context, line },
      'senza-misura',
    )
  }

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
    (lastEventBefore, graceNotesAt) => {
      state.spanners.settleSpanCovers(index, lastEventBefore, graceNotesAt)
    },
    state.kit,
    warnings,
    context,
    measurePath,
    element.line,
  )
  state.carriedTupletStops = finished.carriedTupletStops
  if (nextTime) state.time = nextTime.value

  return {
    measure: {
      clefs: dedupeClefs(clefs, warnings, context),
      staffConfigs: dedupeStaffConfigs(staffConfigs, warnings, context),
      // Beams are stated over the measure in MNX rather than on the notes,
      // and each voice is beamed on its own.
      beams: finished.beamedEvents.flatMap((events) => buildBeams(events)),
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
      number: stated !== position ? stated : undefined,
      // A light-heavy beside a backward repeat is how the closing sign
      // draws, and repeatEnd already says to draw it, so stating final too
      // would assert a barline the source never states. Settled here rather
      // than per <barline>, because a source can split the style and the
      // repeat across two elements at the one edge. Any other style beside
      // the repeat is the source's own statement and stays.
      barline: repeatEnd !== undefined && barline === 'final' ? undefined : barline,
      repeatStart,
      repeatEnd,
      // Filled in by the part, once the ending's other end has been met.
      ending: undefined,
      fermata,
      segno: onePerMeasure(segnos, 'segno', warnings, context, drawnDifferently),
      fine: onePerMeasure(fines, 'fine', warnings, context),
      jump: onePerMeasure(jumps, 'jump', warnings, context),
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
  marks: readonly T[],
  name: string,
  warnings: WarningCollector,
  context: WarningContext,
  differs?: (first: T, other: T) => boolean,
): T | undefined {
  const first = marks[0]
  if (first === undefined) return undefined
  for (const other of marks.slice(1)) {
    if (compareFractions(other.location, first.location) !== 0 || differs?.(first, other)) {
      warnings.add(
        'unrepresentable:element',
        `A measure carries more than one ${name}, and MNX states one per measure. ` +
          'The first is the one converted.',
        context,
        name,
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
  counts: readonly number[],
  warnings: WarningCollector,
  context: WarningContext,
): number | undefined {
  const first = counts[0]
  if (first === undefined) return undefined
  if (counts.some((count) => count !== first)) {
    warnings.add(
      'unrepresentable:multimeasure-rest',
      'This measure states multi-measure rests of different spans, and MNX states ' +
        'one for the score. The first is the one converted.',
      context,
      'multiple-rest',
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
  clefs: readonly Clef[],
  warnings: WarningCollector,
  context: WarningContext,
): Clef[] {
  const atSamePoint = (one: Clef, other: Clef) =>
    one.staff === other.staff && compareFractions(one.position, other.position) === 0
  return clefs
    .filter((clef, index) => {
      const replacing = clefs.find((later, at) => at > index && atSamePoint(later, clef))
      // Exporters restate the clef a staff already has, which says the same
      // thing twice and loses nothing by being said once. Only a clef the next
      // one really replaces is a loss, and reporting the other called a
      // lossless conversion a permanent limit of the format.
      if (replacing && !sameClef(replacing, clef)) {
        warnings.add(
          'unrepresentable:clef',
          'Two clefs are written at the same point on the same staff, and MNX draws ' +
            'one there. The last is the one converted.',
          context,
          'clef',
        )
      }
      return replacing === undefined
    })
    .map((kept) => {
      // The same clef drawn once and hidden once at a point is drawn there.
      const drawn = clefs.some(
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
  configs: readonly StaffConfig[],
  warnings: WarningCollector,
  context: WarningContext,
): StaffConfig[] {
  // A config naming no staff draws the first, as MNX reads it, so the two
  // ways of naming staff 1 are the same staff.
  const staffOf = (config: StaffConfig) => config.staff ?? 1
  return configs.filter((config, index) => {
    const replacing = configs.find(
      (later, at) =>
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
        'staff-lines',
      )
    }
    return replacing === undefined
  })
}

/** The sign, where it sits on the staff, and how it is transposed. */
function sameClef(a: Clef, b: Clef): boolean {
  return a.sign === b.sign && a.staffPosition === b.staffPosition && a.octave === b.octave
}

/**
 * The number the score gives the measure, when it is one. Scores label split
 * measures "3a" and pickups "0"; the former has nowhere to go in MNX.
 */
function readMeasureLabel(
  element: XmlElement,
  warnings: WarningCollector,
  context: WarningContext,
): number | undefined {
  const written = attribute(element, 'number')
  if (written === undefined) return undefined

  const value = Number(written)
  if (!/^\d+$/.test(written) || !Number.isSafeInteger(value)) {
    warnings.add(
      'unrepresentable:measure-label',
      `The measure label "${written}" is not a whole number of zero or more, which is ` +
        'how MNX numbers a measure, so it is not carried over.',
      { ...context, line: element.line },
      'measure',
    )
    return undefined
  }
  return value
}
