// Reads a MusicXML document into the neutral score model: the score, its
// parts, and the walk through each measure. What a measure holds is read by
// the modules beside this one.
//
// Two rules shape the whole stage: input that is structurally broken, or that
// we cannot convert faithfully, raises a MusicXMLError rather than being
// guessed at; and any element carrying notation we do not convert is reported
// as a warning rather than passed over in silence.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
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
  Jump,
  Measure,
  Part,
  Score,
  Segno,
  Tempo,
  TimeSignature,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, requireAttribute, trimmedText } from '../xml/tree.js'
import { readAttributes } from './attributes.js'
import type { MeasureRepeatReading } from './attributes.js'
import { readBarline, resolveEndings } from './barlines.js'
import { buildBeams } from './beams.js'
import { readDirection, readSound } from './directions.js'
import { requireDuration } from './divisions.js'
import { drawnName, ElementReader, reportUnreadAttributes } from './element.js'
import { GroupingBuilder, pruneGrouping } from './part-groups.js'
import { compareFractions, negate } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { readNote } from './notes.js'
import { readPrint } from './print.js'
import { IdGenerator } from './spanners.js'
import { newPartState } from './state.js'
import { elementLoss } from './unrepresentable.js'
import type { PartState } from './state.js'
import { MeasureBuilder } from './voices.js'

interface PartReading {
  part: Part
  /** What this part declared for each of its measures, by position. */
  globals: readonly GlobalMeasure[]
}

interface MeasureReading {
  measure: Measure
  global: GlobalMeasure
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
    throw new MusicXMLError(message, { line: root.line })
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
  const readings = children(root, 'part').map((element) =>
    readPart(element, partList, ids, warnings, path),
  )

  const globalMeasures: GlobalMeasure[] = []
  for (const reading of readings) {
    mergeGlobalMeasures(globalMeasures, reading.globals, reading.part.id, warnings)
  }
  upgradeAlFineJumps(globalMeasures)

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
  return renameInvalidPartIds(
    {
      globalMeasures,
      parts: readings.map((reading) => reading.part),
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

// MNX's id, from the schema's $defs/id: 1 to 256 printable ASCII characters.
// MusicXML's part id is an xs:ID, which allows more, such as accented letters.
//
// Copied rather than read: the schema and ajv are dev-only, and converting a
// score must not depend on either. Exported so the conformance test can hold
// this copy to $defs/id.pattern, which is what keeps the copy honest.
export const MNX_ID_PATTERN = /^[\x21-\x7E]{1,256}$/

/**
 * Renames every part id MNX's id cannot state, in the parts and in the
 * grouping's staves, which are the only places the model refers to a part by
 * id. Event, note and measure ids are generated by the converter and always
 * fit, so the source's part ids are the only ids that can fail. Generated
 * names run p1, p2, ... skipping any id a part already holds, so a rename
 * cannot collide.
 */
function renameInvalidPartIds(
  score: Score,
  lines: ReadonlyMap<string, number>,
  warnings: WarningCollector,
): Score {
  const failing = score.parts.filter((part) => !MNX_ID_PATTERN.test(part.id))
  if (failing.length === 0) return score

  const taken = new Set(score.parts.map((part) => part.id))
  const renames = new Map<string, string>()
  let counter = 0
  for (const part of failing) {
    let generated: string
    do {
      counter += 1
      generated = `p${String(counter)}`
    } while (taken.has(generated))
    taken.add(generated)
    renames.set(part.id, generated)
    const line = lines.get(part.id)
    warnings.add(
      'unrepresentable:part-id',
      `The part id "${part.id}" does not fit MNX's id, which is 1 to 256 printable ` +
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
 * A dal-segno jump returning to a Fine is a "D.S. al Fine": the player goes
 * back to the segno and stops at the Fine. MusicXML says the al-Fine only
 * through the Fine's presence, not on the <sound dalsegno> attribute, so each
 * jump is read as a plain segno first and settled here once the whole score is
 * known. MNX's jump-type enum holds "dsalfine" for this.
 *
 * A Fine only stops a jump that returns to a sign standing before it: replay
 * from a segno written after the Fine never reaches it, and such a jump is a
 * D.S. al Coda or similar, which MNX's jump-type enum cannot state. Marking
 * one "dsalfine" would say the piece ends somewhere it does not, so a score
 * with several signs is matched sign by sign, by the name MusicXML gives them.
 */
function upgradeAlFineJumps(measures: GlobalMeasure[]): void {
  const firstFine = measures.findIndex((measure) => measure.fine !== undefined)
  if (firstFine === -1) return

  const signs = measures.flatMap((measure, index) =>
    measure.segno ? [{ index, name: measure.segno.name }] : [],
  )

  for (const measure of measures) {
    if (measure.jump?.type !== 'segno') continue
    const from = segnoReturnedTo(signs, measure.jump.target)
    // A Fine at or after the sign is reached on the way back through.
    if (
      from !== undefined &&
      measures.findIndex((m, i) => i >= from && m.fine !== undefined) !== -1
    )
      measure.jump = { ...measure.jump, type: 'dsalfine' }
  }
}

/**
 * Where a jump goes back to, as a measure index. A score drawing one sign
 * settles it whatever either is called, since there is nothing to confuse it
 * with. A score drawing none is taken from its start, which is where a player
 * with no sign to find would go. Past that the name decides, and a name
 * matching no sign leaves the jump alone rather than guessing between them.
 */
function segnoReturnedTo(
  signs: readonly { index: number; name: string | undefined }[],
  target: string | undefined,
): number | undefined {
  if (signs.length === 0) return 0
  if (signs.length === 1) return signs[0]?.index
  return signs.find((sign) => sign.name === target)?.index
}

// Parts restate the same key and time; the first to declare one wins, so a
// later part repeating it is not treated as a change. A part declaring a
// different one cannot be carried, because MNX states one key and one time
// signature for the whole score, so the disagreement is reported. The result
// is as long as the longest part, because that list is the score's measure
// list.
function mergeGlobalMeasures(
  target: GlobalMeasure[],
  found: readonly GlobalMeasure[],
  part: string,
  warnings: WarningCollector,
): void {
  // What each side has in force, not just what it states: a key or time
  // signature stands until the next one, so a part that says nothing in the
  // measure where the score changes meter is disagreeing all the same. The
  // comparison runs only where one side states something, so a disagreement
  // is reported once where it starts rather than once per measure it spans.
  let scoreKey: Key | undefined
  let scoreTime: TimeSignature | undefined
  let partKey: Key | undefined
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
    scoreKey = existing?.key ?? scoreKey
    scoreTime = existing?.time ?? scoreTime
    partKey = measure.key ?? partKey
    partTime = measure.time ?? partTime
    const context = { part, measure: measure.number ?? index + 1 }
    if (
      (existing?.key ?? measure.key) &&
      scoreKey &&
      partKey &&
      scoreKey.fifths !== partKey.fifths
    ) {
      warnings.add(
        'unrepresentable:cross-part-key',
        'The parts of this score are in different keys, and MNX states one key for ' +
          'the score. The first stated is the one converted.',
        context,
        'key',
      )
    }
    if (
      (existing?.time ?? measure.time) &&
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
      key: existing?.key ?? measure.key,
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
}

// The display is only the glyph the signature is drawn as, so 4/4 as a C and
// 4/4 as numbers are not a disagreement about the meter itself.
function sameMeter(a: TimeSignature, b: TimeSignature): boolean {
  return a.count === b.count && a.unit === b.unit
}

// The written sign: where it sits, its glyph and its color. The name is
// compared too: it is never drawn, but it tells one sign from another when a
// jump is matched to the one it returns to, so parts naming the sign
// differently disagree about which sign the measure carries.
function sameSegno(a: Segno, b: Segno): boolean {
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
  return a.symbol === b.symbol && a.pointing === b.pointing && a.orient === b.orient
}

function sameFine(a: Fine, b: Fine): boolean {
  return compareFractions(a.location, b.location) === 0
}

function sameJump(a: Jump, b: Jump): boolean {
  return (
    compareFractions(a.location, b.location) === 0 && a.type === b.type && a.target === b.target
  )
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
  /** The instrument setup the list states, keyed by instrument id. */
  sounds: ReadonlyMap<string, InstrumentSound>
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
        // part; what its reader passes over is reported by the sweep. A
        // <midi-instrument> is opened as a block but nothing is taken from
        // it: the schema's sound has no home for a synthesizer setup (its
        // midiNumber is a MIDI pitch backing a percussion kit, not the
        // patch a <midi-program> names), so each child is reported by name.
        for (const instrument of scorePart.blocks('score-instrument')) {
          const instrumentId = requireAttribute(instrument.element, 'id', LIST_PATH)
          const nameElement = instrument.child('instrument-name')
          const instrumentName = nameElement ? trimmedText(nameElement) : ''
          sounds.set(instrumentId, {
            name: instrumentName === '' ? undefined : instrumentName,
          })
        }
        scorePart.blocks('midi-instrument')

        scorePart.reportUnread(warnings, id !== undefined ? { part: id } : {})
      } else if (element.name === 'part-group') {
        const group = new ElementReader(element)
        grouping.edge(group, warnings, ['score-partwise', 'part-list'])
        group.reportUnread(warnings, {})
      }
    }
  }

  return { names, shortNames, listed, lines, grouping: grouping.finish(warnings), sounds }
}

function readPart(
  element: XmlElement,
  partList: PartList,
  ids: IdGenerator,
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

  const state = newPartState(ids)
  const readings = children(element, 'measure').map((measureElement, index) =>
    readMeasure(measureElement, index, id, state, warnings, partPath),
  )
  // Hairpins and octave shifts are paired once the whole part is in, because
  // each is written between the notes and the document's order is not the
  // music's; whatever is still open once the part ends is reported in the same
  // step, so nothing left open is dropped in silence.
  state.spanners.finish(
    readings.map((reading) => reading.measure),
    warnings,
  )
  resolveEndings(readings, warnings, id)
  resolveMeasureRepeats(readings, warnings, id)

  return {
    part: {
      id,
      name: partList.names.get(id),
      shortName: partList.shortNames.get(id),
      staves: state.staves,
      measures: readings.map((reading) => reading.measure),
    },
    globals: readings.map((reading) => reading.global),
  }
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
  warnings: WarningCollector,
  path: DocumentPath,
): MeasureReading {
  const position = index + 1
  const context: WarningContext = { part: partId, measure: position }
  // Where the spanners paired at the end of the part record their ends.
  state.measure = index
  const stated = readMeasureLabel(element, warnings, context)
  const measurePath: DocumentPath = [...path, `measure ${String(stated ?? position)}`]
  // The measure element is walked child by child below rather than through
  // one reader, so its own attributes are swept here: the label above read
  // the number, and anything else (implicit, non-controlling) is a loss.
  reportUnreadAttributes(element, warnings, context)

  const clefs: Clef[] = []
  let key: Key | undefined
  let time: TimeSignature | undefined
  // Whether an <attributes> block has spoken on each. Kept apart from the
  // values, because a statement MNX cannot carry, such as senza misura or a
  // non-traditional key, reads as a statement with no value, and a later
  // block in the same measure may not overwrite it.
  let keySettled = false
  let timeSettled = false
  const dynamics: Dynamic[] = []
  const tempos: Tempo[] = []
  const segnos: Segno[] = []
  const fines: Fine[] = []
  const jumps: Jump[] = []
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

  const builder = new MeasureBuilder()

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
        if (!keySettled && reading.keyStated) {
          key = reading.key
          keySettled = true
        }
        if (!timeSettled && reading.timeStated) {
          time = reading.time
          timeSettled = true
        }
        clefs.push(...reading.clefs)
        multimeasureRests.push(...reading.multimeasureRests)
        measureRepeats.push(...reading.measureRepeats)
        break
      }

      case 'note':
        readNote(reader, state, builder, warnings, context, measurePath)
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
      // <sound tempo> at the same point as a <metronome> the score has already
      // drawn is that mark's playback echo, and is passed over in silence;
      // a bare one is reported like any other playback the output cannot hold.
      case 'sound': {
        const at = builder.position()
        const stated = tempos.some((tempo) => compareFractions(tempo.position, at) === 0)
        const reading = readSound(reader, at, stated, warnings, context)
        if (reading.fine) fines.push(reading.fine)
        if (reading.jump) jumps.push(reading.jump)
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

  builder.checkAllClosed(measurePath, element.line)

  // Every event of the measure is in now, so a hairpin's and an octave
  // shift's stop can each be told which one it covers, whatever order the
  // source wrote them in.
  state.spanners.settleSpanCovers(
    index,
    (at, staff) => builder.lastEventBefore(at, staff),
    (at, staff) => builder.graceNotesAt(at, staff),
  )

  // Beams are stated over the measure in MNX rather than on the notes, and
  // each voice is beamed on its own.
  const beams = builder.beamedEvents().flatMap((events) => buildBeams(events))

  return {
    measure: {
      clefs: dedupeClefs(clefs, warnings, context),
      beams,
      dynamics,
      arpeggios: builder.arpeggios(warnings, context),
      // Filled in below, once the whole part has been read.
      ottavas: [],
      measureRepeat: undefined,
      sequences: builder.sequences(warnings, context),
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
  return clefs.filter((clef, index) => {
    const replacing = clefs.find(
      (later, at) =>
        at > index &&
        later.staff === clef.staff &&
        compareFractions(later.position, clef.position) === 0,
    )
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
}

/** The drawn sign: where it sits on the staff, and how it is transposed. */
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
