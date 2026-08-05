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
  Fermata,
  RepeatEnd,
  GlobalMeasure,
  Key,
  Fine,
  GroupingItem,
  Jump,
  Measure,
  Part,
  PartGroup,
  Score,
  Segno,
  Tempo,
  TimeSignature,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, children, requireAttribute, trimmedText } from '../xml/tree.js'
import { readAttributes } from './attributes.js'
import { readBarline, resolveEndings } from './barlines.js'
import { buildBeams } from './beams.js'
import { readDirection, readSound } from './directions.js'
import { requireDuration } from './divisions.js'
import { ElementReader } from './element.js'
import { compareFractions, negate } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { readNote } from './notes.js'
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
  /** Held until the part can join it to its other end. */
  endingStart: { numbers: readonly number[] } | undefined
  endingStop: { open: boolean } | undefined
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
  return {
    globalMeasures,
    parts: readings.map((reading) => reading.part),
    grouping: pruneGrouping(partList.grouping, written, warnings),
  }
}

function pruneGrouping(
  items: readonly GroupingItem[],
  written: ReadonlySet<string>,
  warnings: WarningCollector,
): readonly GroupingItem[] {
  return items.flatMap((item): GroupingItem[] => {
    if (item.kind === 'part') {
      if (written.has(item.part)) return [item]
      warnings.add(
        'unresolved:part-id',
        `The part list names part ${item.part}, but the score never writes it, ` +
          'so no staff of it is drawn.',
        { part: item.part },
        'score-part',
      )
      return []
    }
    return [{ ...item, content: pruneGrouping(item.content, written, warnings) }]
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
    target[index] = {
      key: existing?.key ?? measure.key,
      time: existing?.time ?? measure.time,
      tempos: mergeTempos(existing?.tempos ?? [], measure.tempos),
      number: existing?.number ?? measure.number,
      // A barline is the whole score's: every part is cut at the same place,
      // and each writes the same thing, so the first to state one wins.
      barline: existing?.barline ?? measure.barline,
      repeatStart: (existing?.repeatStart ?? false) || measure.repeatStart,
      repeatEnd: existing?.repeatEnd ?? measure.repeatEnd,
      ending: existing?.ending ?? measure.ending,
      fermata: existing?.fermata ?? measure.fermata,
      // A segno is the score's navigation mark, restated in each part like the
      // barline, so the first part to state one wins.
      segno: existing?.segno ?? measure.segno,
      fine: existing?.fine ?? measure.fine,
      jump: existing?.jump ?? measure.jump,
    }
  })
}

// The display is only the glyph the signature is drawn as, so 4/4 as a C and
// 4/4 as numbers are not a disagreement about the meter itself.
function sameMeter(a: TimeSignature, b: TimeSignature): boolean {
  return a.count === b.count && a.unit === b.unit
}

/**
 * A tempo belongs to the score rather than to a part, but MusicXML has to
 * write it inside one, and exporters routinely write the same mark into every
 * part. Taking them all would state one tempo several times over, which a
 * renderer would draw several times over; taking only the first part's would
 * lose a mark that only a later part states. So each is kept once.
 */
function mergeTempos(existing: readonly Tempo[], found: readonly Tempo[]): Tempo[] {
  const merged = [...existing]
  for (const tempo of found) {
    if (!merged.some((other) => sameTempo(other, tempo))) merged.push(tempo)
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
  /** The instrument grouping the list draws, empty where it draws none. */
  grouping: readonly GroupingItem[]
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
function drawnName(reader: ElementReader, tag: string): string | undefined {
  const element = reader.child(tag)
  const text = element?.text.trim()
  const hidden = element !== undefined && attribute(element, 'print-object') === 'no'
  return text && !hidden ? text : undefined
}

/** A part group whose stop has not arrived yet. */
interface OpenPartGroup {
  number: string
  symbol: PartGroup['symbol']
  label: string | undefined
  barlineStyle: PartGroup['barlineStyle']
  content: GroupingItem[]
  /** Where the start edge is written, for reporting a stop that never comes. */
  line: number
  /** Set once a crossing stop was reported, so the close is not reported twice. */
  crossed?: boolean
}

function readPartNames(root: ElementReader, warnings: WarningCollector): PartList {
  const names = new Map<string, string>()
  const shortNames = new Map<string, string>()
  const listed = new Set<string>()

  const top: GroupingItem[] = []
  const open: OpenPartGroup[] = []
  let groups = 0
  // Into the innermost group whose stop has not arrived, like the source's
  // own nesting: a group's members are whatever the list writes between its
  // two edges.
  const place = (item: GroupingItem): void => {
    ;(open.at(-1)?.content ?? top).push(item)
  }

  for (const list of root.blocks('part-list')) {
    // Both kinds are marked read here; the walk below goes through the raw
    // children instead, because a group's members are decided by document
    // order across the two kinds.
    list.children('score-part')
    list.children('part-group')
    for (const element of list.element.children) {
      if (element.name === 'score-part') {
        const scorePart = new ElementReader(element)
        const id = attribute(element, 'id')
        if (id !== undefined) {
          listed.add(id)
          place({ kind: 'part', part: id })
        }

        const name = drawnName(scorePart, 'part-name')
        const shortName = drawnName(scorePart, 'part-abbreviation')
        if (id !== undefined) {
          if (name) names.set(id, name)
          if (shortName) shortNames.set(id, shortName)
        }

        scorePart.reportUnread(warnings, id !== undefined ? { part: id } : {})
      } else if (element.name === 'part-group') {
        // A group can nest inside another, told apart by number, like other
        // paired markers.
        const group = new ElementReader(element)
        const type = attribute(element, 'type')
        const number = attribute(element, 'number') ?? '1'
        if (type === 'start') {
          open.push({
            number,
            symbol: groupSymbolOf(group, warnings),
            label: drawnName(group, 'group-name'),
            barlineStyle: groupBarlineOf(group),
            content: [],
            line: element.line,
          })
        } else if (type === 'stop') {
          if (open.at(-1)?.number === number) {
            const closed = open.pop()
            if (closed) {
              place(closedGroup(closed))
              groups += 1
            }
          } else {
            const crossed = [...open].reverse().find((entry) => entry.number === number)
            if (crossed) {
              // The stop arrives while a group started after this one is
              // still open, so their edges cross, which no tree can hold.
              // This group runs to the end of the part list instead.
              crossed.crossed = true
              warnings.add(
                'unclosed:part-group',
                'The edges of two part groups cross. The one stopping here runs to the ' +
                  'end of the part list instead.',
                { line: element.line },
                'part-group',
              )
            } else {
              warnings.add(
                'unclosed:part-group',
                'A part group stops where none had started, and draws nothing.',
                { line: element.line },
                'part-group',
              )
            }
          }
        }
        group.reportUnread(warnings, {})
      }
    }
  }

  // A group whose stop never arrives runs to the end of the list, which is
  // what a reader drawing the source would do. Innermost first, so nesting
  // survives the close.
  for (let closed = open.pop(); closed; closed = open.pop()) {
    if (!closed.crossed) {
      warnings.add(
        'unclosed:part-group',
        'A part group starts where nothing stops it, and runs to the end of the part list.',
        { line: closed.line },
        'part-group',
      )
    }
    place(closedGroup(closed))
    groups += 1
  }

  // A grouping without a single group says nothing a plain part list does
  // not, so none is kept.
  return { names, shortNames, listed, grouping: groups > 0 ? top : [] }
}

/** The group as the model holds it, without the number that paired its edges. */
function closedGroup(open: OpenPartGroup): GroupingItem {
  return {
    kind: 'group',
    symbol: open.symbol,
    label: open.label,
    barlineStyle: open.barlineStyle,
    content: open.content,
  }
}

/**
 * The symbol a group is drawn with. MusicXML's default is "none", which MNX
 * spells "noSymbol". A <part-group> holds at most one <group-symbol>, so
 * taking the first with child() is right.
 */
function groupSymbolOf(group: ElementReader, warnings: WarningCollector): PartGroup['symbol'] {
  const element = group.child('group-symbol')
  const text = element ? trimmedText(element) : 'none'
  if (text === 'bracket' || text === 'brace') return text
  if (text === 'none' || text === '') return 'noSymbol'
  // line and square: the group is kept, with no symbol stated rather than
  // one the source did not draw.
  warnings.add(
    'unrepresentable:group-symbol',
    `A part group is drawn with a "${text}" symbol, which MNX cannot state. ` +
      'The group is kept with no symbol.',
    { line: element?.line ?? group.element.line },
    'group-symbol',
  )
  return undefined
}

/**
 * How barlines run through the group. A <part-group> holds at most one
 * <group-barline>, so taking the first with child() is right.
 */
function groupBarlineOf(group: ElementReader): PartGroup['barlineStyle'] {
  const element = group.child('group-barline')
  if (!element) return undefined
  const text = trimmedText(element)
  if (text === 'yes') return 'unified'
  if (text === 'no') return 'individual'
  if (text === 'Mensurstrich') return 'mensurstrich'
  return undefined
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
    readings.map((reading) => reading.measure.ottavas),
    warnings,
  )
  resolveEndings(readings, warnings, id)

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
  const stated = readMeasureLabel(element, warnings, context)
  const measurePath: DocumentPath = [...path, `measure ${String(stated ?? position)}`]

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
  let barline: BarlineType | undefined
  let repeatStart = false
  let repeatEnd: RepeatEnd | undefined
  let endingStart: { numbers: readonly number[] } | undefined
  let endingStop: { open: boolean } | undefined
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
        break
      }

      case 'note':
        readNote(reader, state, builder, warnings, context, measurePath)
        break

      case 'direction': {
        const reading = readDirection(
          reader,
          builder.position(),
          builder.lastEventBefore(builder.position()),
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
        const reading = readBarline(reader, warnings, context)
        barline ??= reading.barline
        repeatStart ||= reading.repeatStart
        repeatEnd ??= reading.repeatEnd
        endingStart ??= reading.endingStart
        endingStop ??= reading.endingStop
        fermata ??= reading.fermata
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
        builder.shift(found.name === 'backup' ? negate(by) : by, measurePath, found.line)
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
      sequences: builder.sequences(warnings, context),
    },
    // Only worth carrying when it differs from where the measure sits;
    // otherwise MNX's implicit numbering already says it.
    global: {
      key,
      time,
      tempos,
      number: stated !== position ? stated : undefined,
      barline,
      repeatStart,
      repeatEnd,
      // Filled in by the part, once the ending's other end has been met.
      ending: undefined,
      fermata,
      segno: onePerMeasure(segnos, 'segno', warnings, context),
      fine: onePerMeasure(fines, 'fine', warnings, context),
      jump: onePerMeasure(jumps, 'jump', warnings, context),
    },
    endingStart,
    endingStop,
  }
}

/**
 * The one navigation mark of its kind MNX states on a measure. A measure with
 * two of them at different points has no faithful conversion, so the first is
 * kept and the rest reported; two written at the same point are the same mark
 * and lose nothing.
 */
function onePerMeasure<T extends { location: Fraction }>(
  marks: readonly T[],
  name: string,
  warnings: WarningCollector,
  context: WarningContext,
): T | undefined {
  const first = marks[0]
  if (first === undefined) return undefined
  for (const other of marks.slice(1)) {
    if (compareFractions(other.location, first.location) !== 0) {
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
    const replaced = clefs.some(
      (later, at) =>
        at > index &&
        later.staff === clef.staff &&
        compareFractions(later.position, clef.position) === 0,
    )
    if (replaced) {
      warnings.add(
        'unrepresentable:clef',
        'Two clefs are written at the same point on the same staff, and MNX draws ' +
          'one there. The last is the one converted.',
        context,
        'clef',
      )
    }
    return !replaced
  })
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
  if (!/^-?\d+$/.test(written) || !Number.isSafeInteger(value)) {
    warnings.add(
      'unrepresentable:measure-label',
      `The measure label "${written}" is not a number, and MNX numbers a measure ` +
        'with an integer, so it is not carried over.',
      { ...context, line: element.line },
      'measure',
    )
    return undefined
  }
  return value
}
