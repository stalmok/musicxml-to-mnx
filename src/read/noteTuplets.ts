// Reading the tuplets and two-note tremolos a note opens and closes: the
// ratio its <time-modification> states, the brackets its <tuplet> markers
// draw, and how each bracket is shown.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { NoteValue, NoteValueQuantity, TupletDisplay } from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, readWholeElement, requireChild } from '../xml/tree.js'
import { lengthOf } from './duration.js'
import type { ElementReader } from './element.js'
import { writtenFor } from './eventNotations.js'
import type { EventNotation } from './eventNotations.js'
import type { VoicedNote } from './noteStatement.js'
import { requireNoteValueBase } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import { entriesOf } from './tables.js'
import { multiNoteTremoloOf } from './tremolos.js'
import type { TremoloMarker } from './tremolos.js'
import type { TupletDisplaySettings } from './tuplets.js'
import type { MeasureBuilder, VoiceLine } from './voices.js'
import { readWrittenValue } from './writtenValues.js'

/**
 * Opens what the note starts around it: the tuplets, drawn or implied by a
 * run of ratios, and a two-note tremolo. Returns the tuplet markers and the
 * tremolo, which close once the note is placed.
 */
export function openTupletsAndTremolo(
  note: VoicedNote,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): { markers: readonly XmlElement[]; tremolo: TremoloMarker | undefined } {
  const {
    element,
    eventNotations,
    hiddenTuplets,
    voice,
    duration,
    written,
    grace: graceElement,
  } = note
  const markers = tupletMarkers(eventNotations)

  // A tremolo written across two notes gives each of them the value of the
  // pair while the pair lasts only one of them. The pair is gathered into
  // one item, which is how MNX states it.
  const tremolo = multiNoteTremoloOf(eventNotations, warnings, context)

  // The note after a tremolo's first note is its second, and stops it. One
  // that does not leaves the tremolo with one end, and is read outside it. A
  // grace note takes none of the pair's time, so it does not end the pair.
  // That holds across a barline: a tremolo the barline before cut, and
  // reported, is stopped by the voice's first note or by none. A grace note
  // carrying the stop is the end the barline cut off too.
  const cut = (!graceElement || tremolo?.type === 'stop') && builder.takesCarriedTremolo(voice)
  if (!graceElement && tremolo?.type !== 'stop') {
    voice.convertUnstoppedTremolo(warnings, context, path, element.line)
  }

  // A stop where no tremolo is open is the only end its tremolo has. Its note
  // is written with the pair's value as the note that opens one is, so it
  // opens one around itself, and is converted as a plain note once it is
  // placed. A grace note takes none of the pair's time, so one opens nothing.
  const unpaired = tremolo?.type === 'stop' && !voice.insideTremolo()
  if (unpaired && !cut) {
    warnings.add(
      'unclosed:tremolo',
      'A two-note tremolo stops where none is open. Its note is converted as a plain ' +
        'note, half the value it is written as.',
      context,
      tremolo.element,
    )
  }
  // A grace note takes none of the measure's time, so it cannot be one of the
  // pair either.
  const startsTremolo = tremolo?.type === 'start'
  const opensTremolo = !graceElement && (startsTremolo || unpaired)
  if (graceElement && startsTremolo) {
    warnings.add(
      'inconsistent:tremolo',
      "A two-note tremolo starts on a grace note, which takes none of the measure's time, " +
        'so it cannot be one of the pair. The marker is not converted.',
      context,
      tremolo.element,
    )
  }

  // A tremolo on a single note carries no <time-modification> and lasts what
  // it is written as, so only the ornament itself is lost, and that is
  // reported where <ornaments> is. Across two notes it carries the pair's
  // 2:1 ratio, which the tremolo item states.
  const ratio = element.child('time-modification')

  // Whether a bracket the source drew is open. A tuplet the ratio alone
  // opened is not one: it is the reading below, not something the source
  // stated the extent of.
  const insideDrawnBracket = voice.insideBracket() && !voice.insideImpliedTuplet()

  // A grace note takes none of the measure's time, so a ratio on one says
  // nothing about how long a group is or where it ends, and no bracket is
  // there to say it either.
  if (ratio && markers.length === 0 && !insideDrawnBracket && !tremolo && graceElement) {
    throw new MusicXMLError(
      'A grace note carries a tuplet ratio but no <tuplet> bracket marks where the tuplet runs.',
      { path, line: element.line },
    )
  }

  const starts = markers.filter((marker) => attribute(marker, 'type') === 'start')

  // MusicXML states a tuplet twice: the ratio on every note is what makes it
  // one, and <tuplet> only draws a bracket around it. A source stating the
  // ratio and drawing nothing still says how long the group is, as the
  // written value the ratio counts, so a run of notes carrying the same ratio
  // divides into one group after another with nothing guessed. Faure's
  // Cantique de Jean Racine is written this way throughout.
  //
  // The ratio is read only where it can settle such a run. A start marker
  // opens a bracket of its own below; inside a bracket the source drew, the
  // bracket says where the tuplet runs, and a note there need not state a
  // value. A stop marker naming no bracket is passed over further down.
  //
  // A note that opens a two-note tremolo states the pair's 2:1 multiplied
  // into whatever tuplet it stands in, so the ratio is read through the pair:
  // its share comes out, and what is left says whether a tuplet is there.
  // The note that stops the pair states the same and adds nothing, the
  // tremolo standing in the run in its place. A pair stating no value to
  // count states no tuplet either, and is left to be read as the pair it is.
  const mayReadRatio =
    ratio !== undefined &&
    starts.length === 0 &&
    !graceElement &&
    !insideDrawnBracket &&
    (tremolo?.type !== 'stop' || opensTremolo)
  // A ratio on a note stating no <type>, with no <normal-type> of its own,
  // counts no note value. Outside a run of ratios it says nothing about how
  // long a group is, and is passed over: a rest that fills the measure is
  // written with no <type>, and some sources state a ratio on it. Inside a
  // run with room left it is what says where the run ends, so it is refused
  // there.
  const passesOver =
    mayReadRatio && !tremolo && (!voice.insideImpliedTuplet() || voice.impliedTupletFilled())
  const stated = !mayReadRatio
    ? undefined
    : passesOver
      ? readCountedRatio(ratio, element, path)
      : tremolo && ratioCountedValue(ratio, element, path) === undefined
        ? undefined
        : readTupletRatio(ratio, element, path)
  if (passesOver && !stated) {
    warnings.add(
      'missing:normal-type',
      'A <time-modification> counts no note value: it states no <normal-type>, and the ' +
        'note states no <type>. The ratio is not converted, and the note is read without it.',
      context,
      ratio,
    )
  }
  const rated = stated && tremolo ? tupletShareOfRatio(stated) : stated
  // A start marker reads the ratio below. Elsewhere the drawn bracket or the
  // two-note tremolo the note stands in states it, so it is accounted for
  // whole, as is a ratio passed over above.
  if (ratio && !stated && starts.length === 0) element.readWhole(ratio)

  // The brackets and the tremolo around the note say how long it lasts
  // against its written value, and its own ratio has to say the same. A note
  // a bracket starts on is what that bracket's ratio is read from. A ratio
  // the converter divided out or read off a note is not the source's to
  // disagree with. A grace note takes none of the measure's time.
  const tupletRatios = voice.statedTupletRatios()
  if (ratio && insideDrawnBracket && starts.length === 0 && !graceElement && tupletRatios) {
    const tremoloed = opensTremolo || voice.insideTremolo()
    const tuplets = tupletRatios.reduce(multiplyFractions, fraction(1))
    const around = tremoloed ? multiplyFractions(tuplets, fraction(1, 2)) : tuplets
    const own = ratioShare(ratio, path)
    if (compareFractions(own, around) !== 0) {
      const by = !tremoloed
        ? 'tuplet'
        : tupletRatios.length > 0
          ? 'tuplet and two-note tremolo'
          : 'two-note tremolo'
      warnings.add(
        'inconsistent:tuplet',
        `A note's <time-modification> gives it ${describeShare(own)} of its written value. ` +
          `Inside the ${by} around it, it lasts ${describeShare(around)}. ` +
          `The ${by} is the one converted.`,
        context,
        ratio,
      )
    }
  }

  // Full, or this note does not belong in it either way: the run ends here. A
  // grace note takes none of the measure's time, so it neither fills a run nor
  // ends one, and a run with room left reaches over it. A full run is over,
  // so the grace note leads to the note after it. A bracket starting on a
  // grace note opens inside a run with room left, and the run ends before it
  // only once a note that takes time is written there: see beginNote. A skip
  // before the note that fills the run, or carries it past what its ratio
  // counts, ends it too.
  const endsRun = graceElement
    ? builder.impliedTupletFull(voice)
    : builder.impliedTupletEndsBefore(voice, rated)
  if (endsRun) builder.closeImpliedTuplet(voice, warnings, context, path, element.line)

  // A ratio is read only where no bracket the source drew is open, and the
  // close above ends any run this note does not belong in, so what is open
  // here is the run this note joins, or nothing.
  if (!graceElement && ratio && rated && !voice.insideImpliedTuplet()) {
    builder.openImpliedTuplet(voice, rated.inner, rated.outer, ratio)
  }

  const [firstStart] = starts
  if (firstStart) {
    // Sources write a bracket with no ratio beside it, and the note itself
    // says what the ratio is: how long it lasts against how it is written.
    // Some write a plain bracket over notes that play as written, some a
    // triplet whose <time-modification> the exporter left out.
    const derived = ratio ? undefined : impliedTupletRatio(written, duration)
    if (!ratio && !derived) {
      throw new MusicXMLError(
        'A tuplet starts on a note with no <time-modification>, and the note does not ' +
          'say how long it lasts against how it is written.',
        { path, line: element.line },
      )
    }

    const stated = ratio ? readTupletRatio(ratio, element, path) : derived
    /* v8 ignore next -- one of the two is set, or the throw above ran. */
    if (!stated) throw new Error('A tuplet opened with no ratio.')
    // MusicXML counts a tuplet and a two-note tremolo together, so a note
    // that opens a bracket and a tremolo states the two multiplied.
    // The tremolo's own half is not the bracket's to hold.
    const quantities = opensTremolo || startsTremolo ? withoutTremoloShare(stated) : stated
    const opening = starts.map((marker) => ({
      display: tupletDisplayOf(marker, hiddenTuplets.has(marker)),
      stated: statedTupletRatio(marker, quantities, path),
      // A marker that states no number is tuplet 1, as the spec has it.
      number: attribute(marker, 'number') ?? '1',
      element: marker,
    }))

    // The note states one ratio for however many brackets open on it. Where
    // several do, only the markers can say how it divides between them, and
    // <time-modification> is not there to be compared with them.
    if (derived && opening.some((start) => !start.stated) && opening.length > 1) {
      throw new MusicXMLError(
        'More than one tuplet starts on a note with no <time-modification>, and the ' +
          'markers do not state how the ratio divides between them.',
        { path, line: element.line },
      )
    }
    if (derived) {
      warnings.add(
        'missing:time-modification',
        `A tuplet starts with no <time-modification>. The note lasts ${describeRatio(derived)} ` +
          'of what it is written as, ' +
          (quantities === derived
            ? 'so that is the ratio converted.'
            : `and the two-note tremolo on it takes half of that, so the bracket is ` +
              `converted as ${describeRatio(quantities)}.`),
        context,
        firstStart,
      )
    }

    // MNX states a two-note tremolo as one item holding both notes, so a
    // bracket around one of them has no home. MuseScore writes that:
    // each note of the pair carries a bracket of one in the time of one,
    // drawn with neither bracket nor number. Such a bracket scales nothing,
    // so passing it over adds no duration, and the stop that matches it is
    // passed over with it. A bracket that does scale something is refused
    // where it opens.
    const inTremolo = opensTremolo || voice.insideTremolo()
    const opened = opening.filter((start) => {
      if (!inTremolo || !scalesNothing(start.stated ?? quantities)) return true
      warnings.add(
        'unsupported:element',
        'A <tuplet> holds one note of a two-note tremolo, which MNX states as one item ' +
          'holding both notes. The bracket is one in the time of one, so it scales nothing ' +
          'and is not converted.',
        context,
        start.element,
      )
      voice.dropTupletStart(start.number)
      return false
    })

    if (opened.length > 0) {
      builder.openTuplets(
        voice,
        quantities.inner,
        quantities.outer,
        opened,
        warnings,
        path,
        element.line,
        derived !== undefined,
        graceElement !== undefined,
      )
    }
  }

  // Opened after any tuplet starting on the same note: the pair may sit
  // inside a tuplet, and the bracket is the outer grouping.
  if (tremolo && opensTremolo) builder.openTremolo(voice, tremolo)

  return { markers, tremolo }
}

/**
 * Closes what the note stops around it: a two-note tremolo, then the tuplets.
 * The tremolo closes first, because the pair sits inside the bracket.
 */
export function closeTremoloAndTuplets(
  builder: MeasureBuilder,
  voice: VoiceLine,
  markers: readonly XmlElement[],
  tremolo: TremoloMarker | undefined,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): void {
  if (tremolo?.type === 'stop') voice.closeTremolo(tremolo, warnings, context, path, line)
  closeTuplets(builder, voice, markers, warnings, context, path, line)
}

export function closeTuplets(
  builder: MeasureBuilder,
  voice: VoiceLine,
  markers: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
  line: number,
): void {
  // Which stop is written first inside <notations> is not constrained, so
  // the note's stops are checked as a batch: each closes the innermost open
  // tuplet, and only when the numbers the stops state disagree with the
  // numbers of the tuplets closed, as sets, has the source stated tuplets
  // that cross, which MNX's nested tuplets cannot.
  const stated: string[] = []
  const closed: string[] = []
  const stops: XmlElement[] = []
  const stopMarkers = markers
    .filter((marker) => attribute(marker, 'type') === 'stop')
    // A marker that states no number is tuplet 1, as the spec has it.
    .map((marker) => ({ marker, number: attribute(marker, 'number') ?? '1' }))
  voice.nestStoppingTuplets(new Set(stopMarkers.map(({ number }) => number)))
  for (const { marker, number } of stopMarkers) {
    // A stop's placement and ratio restate the start's, which the tuplet
    // already carries, so they are read only for the record. MusicXML allows
    // at most one <tuplet-actual> and one <tuplet-normal> in a <tuplet>.
    attribute(marker, 'placement')
    for (const name of ['tuplet-actual', 'tuplet-normal']) {
      const portion = child(marker, name)
      if (portion) readWholeElement(portion)
    }
    // The start this stop matches was dropped where it could not be drawn,
    // and reported there. There is no bracket of its own to close, and
    // closing here would end the bracket around it instead.
    if (builder.closesDroppedTuplet(voice, number)) continue
    // A stop inside a run the ratio alone gathered. No bracket of the
    // source's is open for it to close, and what the ratio counts is what
    // ends the run. Where the run ends on this note the two agree; where it
    // does not, the marker states a grouping the ratio contradicts.
    if (voice.insideImpliedTuplet()) {
      if (!voice.impliedTupletFilled()) {
        warnings.add(
          'inconsistent:tuplet',
          'A <tuplet> stops where no tuplet the source opened is running, and short of ' +
            "what its ratio counts. The ratio's count is the one converted.",
          context,
          marker,
        )
      }
      continue
    }
    // A stop with no bracket to close is reported where it is met and takes
    // no part in the crossing test below: it names no tuplet that ended here.
    const ended = voice.closeTuplet(warnings, context, path, line, marker)
    if (ended === undefined) continue
    stated.push(number)
    closed.push(ended)
    stops.push(marker)
  }
  // Reported at the first stop that closed a tuplet other than the one it
  // names.
  const crossing = stops.find((_, index) => stated[index] !== closed[index])
  if (crossing && String([...stated].sort()) !== String([...closed].sort())) {
    warnings.add(
      'unrepresentable:tuplet-crossing',
      "The source's tuplets cross: a stop names a tuplet other than one ending here. " +
        "MNX's tuplets nest, so each stop is matched to the innermost open tuplet.",
      context,
      crossing,
    )
  }
}

/**
 * The <tuplet> markers a note carries, in the order they are written. Each is
 * accounted for whether or not it goes on to open or close a bracket.
 */
function tupletMarkers(written: readonly EventNotation[]): readonly XmlElement[] {
  return writtenFor(written, 'tuplet').map(({ found, block }) => {
    block.read(found)
    return found
  })
}

// What MusicXML's show-number and show-type say, in MNX's spelling. "actual"
// is the played count, which MNX calls the inner one. Keyed by the model's own
// word, so a setting the model gains and this table lacks does not compile.
const MUSICXML_TUPLET_DISPLAY: Record<TupletDisplay, string> = {
  both: 'both',
  inner: 'actual',
  noNumber: 'none',
}

// The same table the way it is read: MusicXML's word to the model's.
const TUPLET_DISPLAY = new Map<string, TupletDisplay>(
  entriesOf(MUSICXML_TUPLET_DISPLAY).map(([setting, spelling]) => [spelling, setting]),
)

/**
 * What a start `<tuplet>` marker says about how its tuplet is drawn: whether
 * a bracket is shown, whether its number and note value are, and which side
 * of the notes it sits on. Each has a home on the MNX tuplet; absent leaves
 * the renderer to decide. Each start marker states its own tuplet's display,
 * so two tuplets starting on the same note keep their own settings.
 */
function tupletDisplayOf(start: XmlElement, hidden: boolean): TupletDisplaySettings {
  const settings: TupletDisplaySettings = {}

  const bracket = attribute(start, 'bracket')
  if (bracket === 'yes' || bracket === 'no') settings.bracket = bracket

  const placement = attribute(start, 'placement')
  if (placement === 'above' || placement === 'below') settings.placement = placement

  const showNumber = attribute(start, 'show-number')
  const number = showNumber === undefined ? undefined : TUPLET_DISPLAY.get(showNumber)
  if (number !== undefined) settings.showNumber = number

  const showType = attribute(start, 'show-type')
  const value = showType === undefined ? undefined : TUPLET_DISPLAY.get(showType)
  if (value !== undefined) settings.showValue = value

  // A marker inside a hidden <notations> block draws nothing, so the
  // hiding overrides any display attribute stated within it.
  if (hidden) {
    settings.bracket = 'no'
    settings.showNumber = 'noNumber'
    settings.showValue = 'noNumber'
  }

  return settings
}

/**
 * The ratio a start `<tuplet>` marker states of its own, from its
 * <tuplet-actual> and <tuplet-normal>, or undefined where it states neither.
 * A note's <time-modification> is cumulative across nested tuplets, so when
 * two tuplets start on the same note these are what tell each bracket's share
 * apart. MusicXML allows at most one <tuplet-actual> and one <tuplet-normal>
 * in a <tuplet>, so child() is right here. What either leaves out defaults to
 * the <time-modification>, as the spec has it.
 */
function statedTupletRatio(
  marker: XmlElement,
  fallback: { inner: NoteValueQuantity; outer: NoteValueQuantity },
  path: DocumentPath,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined {
  const actual = child(marker, 'tuplet-actual')
  const normal = child(marker, 'tuplet-normal')
  if (!actual && !normal) return undefined
  return {
    inner: tupletPortion(actual, fallback.inner, path),
    outer: tupletPortion(normal, fallback.outer, path),
  }
}

/**
 * One side of a marker's stated ratio. MusicXML allows at most one
 * <tuplet-number> and one <tuplet-type> in each portion, so child() is right;
 * <tuplet-dot> repeats, one per dot.
 */
function tupletPortion(
  portion: XmlElement | undefined,
  fallback: NoteValueQuantity,
  path: DocumentPath,
): NoteValueQuantity {
  if (!portion) return fallback
  const number = child(portion, 'tuplet-number')
  const type = child(portion, 'tuplet-type')
  // A dot with no <tuplet-type> has no value to dot, so it states nothing.
  const dots = children(portion, 'tuplet-dot').length
  return {
    multiple: number ? readIntegerInRange(number, path, 1, 1_000) : fallback.multiple,
    value: type ? { base: requireNoteValueBase(type, path), dots } : fallback.value,
  }
}

// The largest count either side of a derived ratio may reach. Real tuplets
// run to a few notes in the time of a few; a bracket whose first note works
// out as thirty-one in the time of seventeen is a broken duration, not a
// tuplet.
const MOST_A_TUPLET_COUNTS = 32

/**
 * The ratio of a bracket the source states no <time-modification> for, read
 * from the note the bracket starts on: how long the note lasts against how it
 * is written. A note written as an eighth and lasting two thirds of one is
 * three in the time of two; one lasting exactly an eighth is one in the time
 * of one, which is a bracket that changes no duration.
 *
 * Cumulative, as a <time-modification> is: it states every open level's ratio
 * together, and the builder divides out the levels already open.
 *
 * The multiples stand for this one note. What the whole bracket holds is not
 * known until it closes, and the builder scales them to it there.
 *
 * Nothing is read where the note does not say both how it is written and how
 * long it lasts, or where the ratio needs numbers larger than MusicXML would
 * write in a <time-modification>. The caller then refuses the document.
 */
function impliedTupletRatio(
  written: NoteValue | undefined,
  duration: Fraction | undefined,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined {
  if (!written || !duration || duration.num <= 0) return undefined

  const ratio = divideFractions(lengthOf(written), duration)
  // A ratio this large is the note's duration disagreeing with its written
  // value, not a tuplet. The caller refuses it.
  if (ratio.num > MOST_A_TUPLET_COUNTS || ratio.den > MOST_A_TUPLET_COUNTS) return undefined
  return {
    inner: { value: written, multiple: ratio.num },
    outer: { value: written, multiple: ratio.den },
  }
}

/**
 * The ratio a bracket holds, with the share a two-note tremolo opening on
 * the same note taken out of it. MusicXML counts the two together: a triplet
 * whose first note is a tremolo pair states six in the time of two and draws
 * three, so halving the count keeps the number the bracket draws. Where that
 * count is odd, which a tremolo's own 2:1 never leaves, the space it is
 * played in is doubled instead, for the same ratio.
 */
function withoutTremoloShare(quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity }): {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
} {
  const { inner, outer } = quantities
  return inner.multiple % 2 === 0
    ? { inner: { ...inner, multiple: inner.multiple / 2 }, outer }
    : { inner, outer: { ...outer, multiple: outer.multiple * 2 } }
}

/**
 * The ratio left for a tuplet once a two-note tremolo on the same note takes
 * its share, or undefined where the pair takes all of it: a plain pair states
 * 2:1 and leaves one in the time of one, which is no tuplet. Both sides of a
 * <time-modification> count the same value, so the counts alone say it.
 */
function tupletShareOfRatio(quantities: {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
}): { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined {
  const left = withoutTremoloShare(quantities)
  return left.inner.multiple === left.outer.multiple ? undefined : left
}

/**
 * Whether a tuplet's ratio plays its notes in the time they are written as.
 * Both sides may count different values, so the two are compared as lengths
 * rather than as counts.
 */
function scalesNothing(quantities: {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
}): boolean {
  return (
    compareFractions(
      multiplyFractions(lengthOf(quantities.inner.value), fraction(quantities.inner.multiple)),
      multiplyFractions(lengthOf(quantities.outer.value), fraction(quantities.outer.multiple)),
    ) === 0
  )
}

/** A share of a written value, for a report to name. */
function describeShare(share: Fraction): string {
  return `${String(share.num)}/${String(share.den)}`
}

/** The derived ratio as a fraction, for the report that names it. */
function describeRatio(quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity }): string {
  return `${String(quantities.outer.multiple)}/${String(quantities.inner.multiple)}`
}

/**
 * What a <time-modification> says is played, and the space it is played in.
 * The value counted is <normal-type> where the source gives one, and the
 * note's own written value otherwise.
 */
export function readTupletRatio(
  ratio: XmlElement,
  element: ElementReader,
  path: DocumentPath,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } {
  const read = readCountedRatio(ratio, element, path)
  if (!read) {
    throw new MusicXMLError('A tuplet states no note value to count.', {
      path,
      line: ratio.line,
    })
  }
  return read
}

/**
 * The same, or undefined where the ratio counts no note value: it states no
 * <normal-type>, and the note states no <type>.
 */
export function readCountedRatio(
  ratio: XmlElement,
  element: ElementReader,
  path: DocumentPath,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined {
  const { played, space } = readRatioCounts(ratio, path)

  const value = ratioCountedValue(ratio, element, path)
  if (!value) return undefined

  return { inner: { value, multiple: played }, outer: { value, multiple: space } }
}

/**
 * Reports a chord member whose <time-modification> gives it another share of
 * its written value than the note it joins lasts. The chord lasts what that
 * note does.
 */
export function reportChordMemberRatio(
  member: XmlElement | undefined,
  chord: Fraction | undefined,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  if (!member) return
  const own = ratioShare(member, path)
  if (!chord || compareFractions(own, chord) === 0) return
  warnings.add(
    'inconsistent:tuplet',
    `A chord note's <time-modification> gives it ${describeShare(own)} of its written value. ` +
      `The note it joins lasts ${describeShare(chord)}. The note it joins is the one converted.`,
    context,
    member,
  )
}

/** The share of its written value a <time-modification> gives a note. */
function ratioShare(ratio: XmlElement, path: DocumentPath): Fraction {
  const { played, space } = readRatioCounts(ratio, path)
  return fraction(space, played)
}

/** How many notes a <time-modification> plays, and in the space of how many. */
function readRatioCounts(ratio: XmlElement, path: DocumentPath): { played: number; space: number } {
  return {
    played: readIntegerInRange(requireChild(ratio, 'actual-notes', path), path, 1, 1_000),
    space: readIntegerInRange(requireChild(ratio, 'normal-notes', path), path, 1, 1_000),
  }
}

/**
 * The note value a <time-modification> counts: <normal-type> where the source
 * gives one, and the note's own written value otherwise. Undefined where the
 * source states neither, which leaves the ratio counting nothing.
 */
function ratioCountedValue(
  ratio: XmlElement,
  element: ElementReader,
  path: DocumentPath,
): NoteValue | undefined {
  const normalType = child(ratio, 'normal-type')
  return normalType
    ? { base: requireNoteValueBase(normalType, path), dots: children(ratio, 'normal-dot').length }
    : readWrittenValue(element, path)
}
