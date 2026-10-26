// Reading what is drawn on a note's event: its marks, a tremolo on one note,
// its fermata and its stem. A fermata is read here for a barline too, because MusicXML writes the
// same element over a note and over a barline.

import type {
  BreathMarking,
  BreathSymbol,
  CaesuraMarking,
  CaesuraShape,
  Fermata,
  FermataSymbol,
  MarkingKind,
  Markings,
  NoteMarkings,
  SlideIn,
  SlideOut,
  TremoloMarking,
} from '../model/score.js'
import type { Draft } from './draft.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, readWholeElement, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { reportSecondMark, writtenFor } from './eventNotations.js'
import type { EventNotation } from './eventNotations.js'
import { entriesOf, recogniser } from './tables.js'
import { TREMOLO_MARKS, tremoloBeamCount } from './tremolos.js'

/**
 * The side an element is drawn on, from its placement. MusicXML's above and
 * below are the words MNX states, so a known one passes straight through.
 */
export function placementOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

export function upOrDown(value: string | undefined): 'up' | 'down' | undefined {
  return value === 'up' || value === 'down' ? value : undefined
}

const isBreathSymbol = recogniser<BreathSymbol>({
  comma: true,
  tick: true,
  upbow: true,
  salzedo: true,
})

/** A breath mark, which names its glyph as its text: a comma, a tick. */
function readBreath(
  found: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): BreathMarking {
  const placement = placementOf(found)
  const text = trimmedText(found)
  if (text === '') return { placement, symbol: undefined }
  if (isBreathSymbol(text)) return { placement, symbol: text }
  warnings.addUndefinedText(found, 'and the breath mark is converted without its glyph.', context)
  return { placement, symbol: undefined }
}

const isCaesuraShape = recogniser<CaesuraShape>({
  normal: true,
  thick: true,
  short: true,
  curved: true,
})

/**
 * A caesura, from the shape MusicXML names as its text. MusicXML's "single"
 * is one stroke; MNX draws two unless told otherwise.
 */
function readCaesura(
  found: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): CaesuraMarking | undefined {
  const text = trimmedText(found)
  if (text === '') return { marks: undefined, shape: undefined }
  if (text === 'single') return { marks: 1, shape: undefined }
  if (isCaesuraShape(text)) return { marks: undefined, shape: text }
  // The one warning accounts for the caesura whole, its side included.
  warnings.addUndefinedText(found, 'and the caesura is not converted.', context, { whole: true })
  return undefined
}

/**
 * One mark written on a note: its kind, the element stating it, and the
 * block the element sits in, which accounts for it once it is read. The
 * marking is undefined where the element states one MNX cannot hold, which
 * is reported as it is found.
 */
type WrittenMark = {
  readonly [K in MarkingKind]: { readonly kind: K; readonly marking: Markings[K] }
}[MarkingKind] &
  Pick<EventNotation, 'found' | 'block' | 'notations'>

/** The marks written on a note, each read off its element. */
export function* writtenMarks(
  written: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): Generator<WrittenMark> {
  for (const notation of written) {
    const { found, block, notations } = notation
    const at = { found, block, notations }
    switch (notation.kind) {
      case 'fermata':
      case 'multiNoteTremolo':
      case 'tuplet':
        continue
      case 'strongAccent': {
        // Which way the wedge of a strong accent points.
        const pointing = upOrDown(attribute(found, 'type'))
        yield { ...at, kind: notation.kind, marking: { placement: placementOf(found), pointing } }
        continue
      }
      case 'breath':
        yield { ...at, kind: notation.kind, marking: readBreath(found, warnings, context) }
        continue
      case 'caesura':
        yield { ...at, kind: notation.kind, marking: readCaesura(found, warnings, context) }
        continue
      case 'bowDirection': {
        const { direction } = notation
        yield { ...at, kind: notation.kind, marking: { placement: placementOf(found), direction } }
        continue
      }
      case 'tremolo': {
        const type = attribute(found, 'type') ?? 'single'
        const marking = readSingleTremolo(found, type, warnings, context)
        yield { ...at, kind: notation.kind, marking }
        continue
      }
      default:
        yield { ...at, kind: notation.kind, marking: { placement: placementOf(found) } }
    }
  }
}

/**
 * A tremolo on one note, from the beams its text counts. A mark MNX cannot
 * state is reported and gives nothing.
 */
function readSingleTremolo(
  found: XmlElement,
  type: string,
  warnings: WarningCollector,
  context: ReportContext,
): TremoloMarking | undefined {
  const placement = placementOf(found)
  // Read before the type is checked, so the count of a dropped tremolo is not
  // reported apart from it.
  const text = trimmedText(found)
  // An unmeasured tremolo has no beam count, and MNX states a tremolo as a
  // count of beams.
  if (type === 'unmeasured') {
    warnings.add(
      'unrepresentable:element',
      `A tremolo of type "${type}" cannot be stated in MNX, which counts beams.`,
      context,
      found,
    )
    return undefined
  }
  if (type !== 'single') {
    warnings.addUndefinedAttribute(found, 'type', 'and the tremolo is not converted.', context)
    return undefined
  }

  // A count that is not a tremolo a stem can carry drops the single-note mark
  // rather than degrading it.
  const marks = tremoloBeamCount(text)
  if (marks === undefined) {
    warnings.addUndefinedText(found, 'and the tremolo is not converted.', context)
    return undefined
  }
  // Zero beams write an unmeasured tremolo, and MNX counts from one.
  if (marks < TREMOLO_MARKS.fewest) {
    warnings.add(
      'unrepresentable:element',
      `A tremolo drawn with ${text} beams cannot be stated in MNX, which counts from one.`,
      context,
      found,
    )
    return undefined
  }
  return { placement, marks }
}

/** The marks written on this event. */
export function readMarkings(
  written: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): Markings {
  // Held as a draft: each notation the note carries sets its own key as it
  // is read, and the event takes the finished set.
  const markings: Draft<Markings> = {}

  for (const mark of writtenMarks(written, warnings, context)) {
    const { kind, marking, found, block } = mark
    block.read(found)
    if (marking === undefined) continue
    // MNX keys the marks by name, and so does the model, so a second of the
    // same kind has no home. The first is the one converted, as it is
    // for a second fermata. The one warning accounts for the rejected mark
    // whole, its side included, which a caesura does not otherwise read.
    if (markings[kind] !== undefined) {
      reportSecondMark(kind, found, warnings, context)
      continue
    }
    setMarking(markings, mark)
  }
  return markings
}

// Taking the mark whole keeps its kind and its marking together.
function setMarking<K extends MarkingKind>(
  markings: Draft<Markings>,
  mark: { readonly kind: K; readonly marking: Markings[K] },
): void {
  markings[mark.kind] = mark.marking
}

// MusicXML's fermata shapes, in MNX's spelling. The two agree apart from the
// hyphens. An empty <fermata> states no shape, which MNX reads as its default.
// Keyed by the model's own shape, so a shape the model gains and this table
// lacks does not compile.
const MUSICXML_FERMATA_SHAPES: Record<FermataSymbol, string> = {
  normal: 'normal',
  angled: 'angled',
  square: 'square',
  doubleAngled: 'double-angled',
  doubleSquare: 'double-square',
  doubleDot: 'double-dot',
  halfCurve: 'half-curve',
  curlew: 'curlew',
}

// The same table the way it is read: MusicXML's word to the model's shape.
const FERMATA_SYMBOLS = new Map<string, FermataSymbol>(
  entriesOf(MUSICXML_FERMATA_SHAPES).map(([shape, spelling]) => [spelling, shape]),
)

/**
 * The pause held over this event. MusicXML allows a <notations> to carry
 * several, one per staff of a part; MNX states one on the event, so the first
 * is the one converted.
 */
export function readFermata(
  written: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): Fermata | undefined {
  const fermatas = writtenFor(written, 'fermata')
  for (const { found, block } of fermatas) block.read(found)
  return readFermataAt(
    fermatas.map(({ found }) => found),
    warnings,
    context,
  )
}

/**
 * The pause the given <fermata> elements state. Shared with the barline
 * reader, because MusicXML writes the same element over a note and over a
 * barline, and MNX reads it the same way in both places.
 */
export function readFermataAt(
  found: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
): Fermata | undefined {
  const first = found[0]
  if (!first) return undefined

  if (found.length > 1) {
    // The one warning accounts for the extras whole, facing, side and shape
    // included.
    for (const extra of found.slice(1)) readWholeElement(extra)
    warnings.add(
      'unrepresentable:fermata',
      'More than one fermata is written at the same place, and MNX states one. ' +
        'The first is the one converted.',
      context,
      first,
    )
  }

  // The table holds every shape MusicXML defines.
  const shape = trimmedText(first)
  if (shape !== '' && !FERMATA_SYMBOLS.has(shape)) {
    warnings.addUndefinedText(first, 'and the fermata is converted without its shape.', context)
  }
  return fermataOf(first)
}

function fermataOf(found: XmlElement): Fermata {
  // MusicXML says which way it faces with "upright" and "inverted".
  const type = attribute(found, 'type')
  return {
    symbol: FERMATA_SYMBOLS.get(trimmedText(found)),
    pointing: type === 'upright' ? 'up' : type === 'inverted' ? 'down' : undefined,
    placement: placementOf(found),
  }
}

export function readStemDirection(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
): 'up' | 'down' | undefined {
  const stem = element.child('stem')
  if (!stem) return undefined

  const direction = trimmedText(stem)
  if (direction === 'up' || direction === 'down') return direction
  if (statesNoStem(stem) && element.child('rest')) return undefined

  if (direction !== 'none' && direction !== 'double') {
    warnings.addUndefinedText(stem, 'and is not carried over.', context)
    return undefined
  }

  // MNX's stem direction is up or down and nothing else, so "none" and
  // "double" have no home.
  warnings.add(
    'unrepresentable:stem-direction',
    `A <stem> of "${direction}" cannot be expressed in MNX, which states only up or down.`,
    context,
    stem,
  )
  return undefined
}

/** A rest is drawn with no stem, so a stem of none on one states nothing. */
export function statesNoStem(stem: XmlElement): boolean {
  return trimmedText(stem) === 'none'
}

// MusicXML files the slides into and out of a note among its articulations,
// named as MNX names them. MNX states them on the note. Keyed by the model's
// own slide, so a slide the model gains with no element here does not
// compile.
const isSlideIn = recogniser<SlideIn>({ scoop: true, plop: true })
const isSlideOut = recogniser<SlideOut>({ falloff: true, doit: true })

/** Every slide a note writes, in document order, with the reader that holds it. */
function* writtenSlides(
  notations: readonly ElementReader[],
): Generator<{ found: XmlElement; block: ElementReader; slide: Draft<NoteMarkings> }> {
  for (const notation of notations) {
    for (const block of notation.blocks('articulations')) {
      for (const found of block.element.children) {
        const name = found.name
        if (isSlideIn(name)) yield { found, block, slide: { slideIn: name } }
        if (isSlideOut(name)) yield { found, block, slide: { slideOut: name } }
      }
    }
  }
}

/**
 * The slides into and out of a note. MNX states one of each on a note, so
 * the first of each is kept and a second reported.
 */
export function readNoteMarkings(
  notations: readonly ElementReader[],
  warnings: WarningCollector,
  context: ReportContext,
): NoteMarkings | undefined {
  const markings: Draft<NoteMarkings> = {}
  for (const { found, block, slide } of writtenSlides(notations)) {
    const side = slide.slideIn !== undefined ? 'slideIn' : 'slideOut'
    if (markings[side] === undefined) {
      block.read(found)
      Object.assign(markings, slide)
      continue
    }
    block.readWhole(found)
    warnings.add(
      'unrepresentable:marking',
      `A note has two slides ${side === 'slideIn' ? 'into' : 'out of'} it, and MNX states ` +
        'one on a note. The first is the one converted.',
      context,
      found,
    )
  }
  return Object.keys(markings).length > 0 ? markings : undefined
}

/**
 * Reports the slides on a rest or a kit note. MNX states a slide on a pitched
 * note, and neither is one.
 */
export function reportSlidesOff(
  notations: readonly ElementReader[],
  carrier: 'rest' | 'kit note',
  warnings: WarningCollector,
  context: ReportContext,
): void {
  for (const { found, block } of writtenSlides(notations)) {
    block.readWhole(found)
    warnings.add(
      'unrepresentable:element',
      `A <${found.name}> on a ${carrier} cannot be expressed in MNX, which states a slide on ` +
        'a pitched note.',
      context,
      found,
    )
  }
}
