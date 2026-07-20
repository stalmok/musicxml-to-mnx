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
  Clef,
  Dynamic,
  GlobalMeasure,
  Key,
  Measure,
  Part,
  Score,
  Tempo,
  TimeSignature,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, requireAttribute } from '../xml/tree.js'
import { readAttributes } from './attributes.js'
import { buildBeams } from './beams.js'
import { readDirection } from './directions.js'
import { requireDuration } from './divisions.js'
import { ElementReader } from './element.js'
import { compareFractions, negate } from '../fraction.js'
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
}

export function readScore(root: XmlElement, warnings: WarningCollector): Score {
  if (root.name !== 'score-partwise') {
    throw new MusicXMLError(
      root.name === 'score-timewise'
        ? 'Timewise MusicXML is not supported; convert it to partwise first.'
        : `Expected a <score-partwise> document, found <${root.name}>.`,
      { line: root.line },
    )
  }

  const path: DocumentPath = ['score-partwise']
  const reader = new ElementReader(root)
  reader.skip('part-list', 'part')
  reader.reportUnread(warnings, {})

  const names = readPartNames(root)
  const ids = new IdGenerator()
  const readings = children(root, 'part').map((element) =>
    readPart(element, names, ids, warnings, path),
  )

  const globalMeasures: GlobalMeasure[] = []
  for (const reading of readings) {
    mergeGlobalMeasures(globalMeasures, reading.globals)
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

  return { globalMeasures, parts: readings.map((reading) => reading.part) }
}

// Parts restate the same key and time; the first to declare one wins, so a
// later part repeating it is not treated as a change. The result is as long
// as the longest part, because that list is the score's measure list.
function mergeGlobalMeasures(target: GlobalMeasure[], found: readonly GlobalMeasure[]): void {
  found.forEach((measure, index) => {
    const existing = target[index]
    target[index] = {
      key: existing?.key ?? measure.key,
      time: existing?.time ?? measure.time,
      tempos: mergeTempos(existing?.tempos ?? [], measure.tempos),
      number: existing?.number ?? measure.number,
    }
  })
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

function readPartNames(root: XmlElement): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const list = child(root, 'part-list')
  if (!list) return names

  for (const scorePart of children(list, 'score-part')) {
    const id = attribute(scorePart, 'id')
    const name = child(scorePart, 'part-name')?.text.trim()
    // An empty <part-name> states no name, so it is not one.
    if (id !== undefined && name) names.set(id, name)
  }
  return names
}

function readPart(
  element: XmlElement,
  names: ReadonlyMap<string, string>,
  ids: IdGenerator,
  warnings: WarningCollector,
  path: DocumentPath,
): PartReading {
  // Required by MusicXML, and what ties a part to its name and to every
  // warning reported against it.
  const id = requireAttribute(element, 'id', path)
  const partPath: DocumentPath = [...path, `part ${id}`]

  if (names.size > 0 && !names.has(id)) {
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
  // Whatever is still open once the part ends is never going to close.
  state.spanners.reportUnclosed(warnings)

  return {
    part: {
      id,
      name: names.get(id),
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
  const dynamics: Dynamic[] = []
  const tempos: Tempo[] = []

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
        const reading = readAttributes(reader, state, warnings, context, measurePath)
        key ??= reading.key
        time ??= reading.time
        clefs.push(...reading.clefs)
        break
      }

      case 'note':
        readNote(reader, state, builder, warnings, context, measurePath)
        break

      case 'direction': {
        const reading = readDirection(reader, builder.position(), warnings, context, measurePath)
        dynamics.push(...reading.dynamics)
        tempos.push(...reading.tempos)
        break
      }

      // Both only move the cursor: <backup> against the flow of the measure,
      // <forward> with it. A <voice> or <staff> on one says which voice the
      // skipped time belongs to, which the model cannot yet express, so it
      // stays unread and is reported.
      case 'backup':
      case 'forward': {
        const by = requireDuration(reader, state, measurePath)
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
    measure: { clefs, beams, dynamics, sequences: builder.sequences() },
    // Only worth carrying when it differs from where the measure sits;
    // otherwise MNX's implicit numbering already says it.
    global: { key, time, tempos, number: stated !== position ? stated : undefined },
  }
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
