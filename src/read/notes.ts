// Reading a <note>: what sounds, for how long, and everything written on it.
//
// A <note> is not always an event of its own: one carrying <chord> joins the
// note before it, and one carrying <grace> takes none of the measure's time.
// Both are settled first, because what follows applies only to a note that
// stands in the cursor's path.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  AccidentalDisplay,
  PitchedClefSign,
  CurveSide,
  Event,
  Fermata,
  FermataSymbol,
  GraceType,
  KitNote,
  LineType,
  MarkingKind,
  CaesuraMarking,
  CaesuraShape,
  Markings,
  Note,
  NoteValue,
  NoteValueQuantity,
  Pitch,
  Step,
  TieTarget,
  TremoloMarking,
  TupletDisplay,
} from '../model/score.js'
import type { Draft } from './draft.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, descendants, requireChild, trimmedText } from '../xml/tree.js'
import { beamCountForValue, valueForBeamCount } from './beams.js'
import type { BeamedEvent } from './beams.js'
import { readDuration } from './divisions.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'
import type { ElementReader } from './element.js'
import { readEventNotations, reconcile, reportSecondMark, writtenFor } from './eventNotations.js'
import type { EventNotation } from './eventNotations.js'
import { reportHidden } from './unrepresentable.js'
import { readLyrics } from './lyrics.js'
import { readRest } from './rests.js'
import type { FillsMeasure, RestNote } from './rests.js'
import { noteValueBaseOf, requireNoteValueBase } from './noteValues.js'
import { parseWholeNumber, readIntegerInRange } from './numbers.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import { soundingPitch } from './transposition.js'
import { entriesOf, recogniser } from './tables.js'
import { tieKey } from './spanners.js'
import { MeasureBuilder } from './voices.js'
import type { JoinedEvent, PlacedEvent } from './voices.js'
import type { TupletDisplaySettings } from './tuplets.js'

// A recogniser narrows the value to the model's Step, so no cast is needed,
// and the list and Step are checked against each other in both directions.
const isStep = recogniser<Step>({ A: true, B: true, C: true, D: true, E: true, F: true, G: true })

// The diatonic order of a step within its octave, counting from C, since staff
// height is counted diatonically.
const STEP_ORDER: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

// The diatonic index of the pitch each clef sign places on its line: G4 for a
// G clef, F3 for an F clef, C4 for a C clef.
const CLEF_REFERENCE: Record<PitchedClefSign, number> = {
  G: 4 * 7 + STEP_ORDER.G,
  F: 3 * 7 + STEP_ORDER.F,
  C: 4 * 7 + STEP_ORDER.C,
}

/** A pitch's diatonic index: its octave times seven, plus the step's order. */
function diatonicIndex(step: Step, octave: number): number {
  return octave * 7 + STEP_ORDER[step]
}

/**
 * The height a <display-step>/<display-octave> pair states, in steps from the
 * middle of the staff. The clef in force holds the position its reference
 * pitch sits at, and each diatonic step from there is one more step of
 * height. Undefined where the pair is incomplete or no clef is in force. The
 * caller decides what follows: a rest without a height is drawn at its
 * default, and an unpitched note without one has nowhere to sit.
 */
function displayStaffPosition(
  element: XmlElement,
  staff: number | undefined,
  state: PartState,
): number | undefined {
  const stepElement = child(element, 'display-step')
  const octaveElement = child(element, 'display-octave')

  const step = stepElement?.text.trim().toUpperCase() ?? ''
  const octave = parseWholeNumber(octaveElement?.text.trim() ?? '')
  const clef = state.clefs.get(staff ?? 1)
  if (!isStep(step) || octave === undefined || octave < 0 || octave > 9 || clef === undefined) {
    return undefined
  }

  return clef.staffPosition + (diatonicIndex(step, octave) - CLEF_REFERENCE[clef.sign])
}

/** A rest's height, with the loss reported where the source states one it cannot place. */
function restStaffPosition(
  restElement: XmlElement,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): number | undefined {
  // A rest stating neither is drawn at its default height, which is not a loss.
  const stated = child(restElement, 'display-step') ?? child(restElement, 'display-octave')
  if (!stated) return undefined

  const position = displayStaffPosition(restElement, staff, state)
  if (position === undefined) {
    warnings.add(
      'unsupported:element',
      "A rest's staff position, given by <display-step> and <display-octave>, needs " +
        'both and a clef in force to place, which this measure does not give.',
      context,
      stated,
    )
  }
  return position
}

// Where a kit component sits when the source does not say: the middle line,
// which is the one height every staff has.
const UNPLACED_KIT_COMPONENT = 0

/**
 * The kit component an unpitched note strikes, added to the part's kit the
 * first time a note strikes it.
 *
 * MNX names a component once, on the part, and MusicXML tells one from
 * another by the <instrument> each note names. Where a source names none, the
 * height the note is written at stands in for the instrument.
 */
function kitComponent(
  element: ElementReader,
  unpitchedElement: XmlElement,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): string {
  // MusicXML lets a note name more than one instrument, for a note played on
  // several at once. MNX strikes one component per kit note, so the first is
  // the one converted.
  const instruments = element.children('instrument')
  const [named, extra] = instruments
  if (extra) {
    warnings.add(
      'unrepresentable:element',
      `A note is struck on ${String(instruments.length)} instruments at once, and MNX ` +
        'states one for each note of a kit. The first is the one converted.',
      context,
      extra,
    )
  }

  const position = displayStaffPosition(unpitchedElement, staff, state)
  const id = named ? attribute(named, 'id') : undefined
  // A component is an instrument written at a height. MNX places a component
  // once and every note struck on it sits there, so two notes strike the same
  // one only when they agree on both. A part can name one instrument for the
  // whole drumset, and a source can tell two drums apart by instrument alone.
  // Where a source names no instrument, the height is all it gives.
  const source = `${id ?? ''}@${String(position ?? UNPLACED_KIT_COMPONENT)}`

  const existing = state.kitKeys.get(source)
  if (existing !== undefined) return existing

  if (position === undefined) {
    warnings.add(
      'missing:display-step',
      'An unpitched note gives no usable <display-step> and <display-octave> to place it by, or ' +
        'no clef is in force to read them against. It is written on the middle line.',
      context,
      unpitchedElement,
    )
  }
  // The part list holds the name and the sound; the id a note writes is not
  // always one MNX can state, so what the score holds the sound under is what
  // the component names.
  const resolved = id !== undefined ? state.sounds.get(id) : undefined
  if (named && id !== undefined && resolved === undefined) {
    warnings.add(
      'unresolved:instrument-id',
      `The part list has no <score-instrument> with id ${id}.`,
      context,
      named,
    )
  }

  const key = state.ids.nextKitComponent()
  state.kitKeys.set(source, key)
  state.kit.set(key, {
    name: resolved?.name,
    staffPosition: position ?? UNPLACED_KIT_COMPONENT,
    sound: resolved?.key,
  })
  return key
}

/** What is read from a <note> once and shared by the paths that place it. */
interface NoteStatement extends RestNote {
  /** The notations the note writes on its event. */
  eventNotations: readonly EventNotation[]
  tieds: readonly XmlElement[]
  /** The <tuplet> markers in a block hidden with print-object="no". */
  hiddenTuplets: ReadonlySet<XmlElement>
  pitch: XmlElement | undefined
  unpitched: XmlElement | undefined
  staff: number | undefined
  staffPosition: number | undefined
  /** Whether the note is hidden with print-object="no". */
  hidden: boolean
  /**
   * Reports the note and its <notations> blocks hidden, each in the place it
   * was read. Given `only`, just a block holding a fermata is reported, naming
   * it: nothing else in the block is converted, so hiding it loses nothing.
   */
  reportHidden: (only?: 'fermata') => void
}

export function readNote(
  element: ElementReader,
  state: PartState,
  /** Which measure of the part the note is in, counted from zero. */
  measureIndex: number,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const restElement = element.child('rest')
  const pitchElement = element.child('pitch')
  // A note struck on a percussion kit: no pitch, and a height on the staff
  // instead. What it strikes is a component of the part's kit.
  const unpitchedElement = element.child('unpitched')
  const sounded = [restElement, pitchElement, unpitchedElement].filter(
    (found) => found !== undefined,
  )
  if (sounded.length > 1) {
    throw new MusicXMLError('A <note> states more than one of <pitch>, <unpitched> and <rest>.', {
      path,
      line: element.line,
    })
  }
  if (sounded.length === 0) {
    throw new MusicXMLError('A <note> states none of <pitch>, <unpitched> and <rest>.', {
      path,
      line: element.line,
    })
  }

  // A hidden rest written as a space beside grace notes loses nothing drawn.
  // That is settled only once the rest is placed, so its report keeps this
  // place until then.
  const hiddenPlace = warnings.reserve()
  const hidden = attribute(element.element, 'print-object') === 'no'

  const notations = element.blocks('notations')
  // A <notations> block hidden with print-object="no" still has its slur,
  // fermata and everything else in it drawn, because MNX cannot mark them
  // invisible. The hiding is reported, naming what the block holds. The
  // exception is a block holding only <tuplet> markers: a hidden tuplet
  // notation is the tuplet drawn with no bracket, number or value, which
  // MNX's display settings state, so the hiding converts. Sources use this to
  // number only the first tuplet of a run. A block on a rest is reported once
  // the rest is placed, as the rest's own hiding is.
  const hiddenTuplets = new Set<XmlElement>()
  const hiddenBlocks: { block: XmlElement; place: WarningPlace }[] = []
  for (const block of notations) {
    // An empty block hides nothing, so there is nothing to lose.
    if (block.element.children.length === 0) {
      attribute(block.element, 'print-object')
      continue
    }
    const tupletsOnly =
      block.element.children.length > 0 &&
      block.element.children.every((child) => child.name === 'tuplet')
    if (tupletsOnly && attribute(block.element, 'print-object') === 'no') {
      for (const marker of block.element.children) hiddenTuplets.add(marker)
      continue
    }
    if (attribute(block.element, 'print-object') === 'no') {
      hiddenBlocks.push({ block: block.element, place: warnings.reserve() })
    }
  }
  const reportHiddenNote = (only?: 'fermata') => {
    reportHidden(element.element, warnings, context, undefined, hiddenPlace)
    for (const { block, place } of hiddenBlocks) {
      if (only !== undefined && !child(block, only)) continue
      reportHidden(block, warnings, context, only ?? block.children[0]?.name, place)
    }
  }
  if (!restElement) reportHiddenNote()
  // <tied> is the visual side of a tie. Most of it repeats <tie>, but let-ring
  // and the drawn side live only on it, so it is read rather than skipped.
  const tieds = notations.flatMap((block) => block.children('tied'))

  const voice = element.child('voice')?.text.trim()
  const duration = readDuration(element, state, warnings, context, path)
  const written = readWrittenValue(element, path)
  const graceElement = element.child('grace')

  // Which sequence of its voice this note is written in, settled before
  // anything asks the voice what is open around it.
  //
  // A chord member joins the event before it and settles nothing. Neither
  // does a grace note: it takes none of the measure's time, so it overlaps
  // nothing and cannot open a sequence on its own account. It is read into
  // the sequence the voice last sounded in and carried to the one its note
  // turns out to take.
  const chordMember = element.child('chord') !== undefined
  if (!chordMember && voice === undefined) builder.namesNoVoice(element.element)
  if (!chordMember && !graceElement) builder.beginNote(voice, element.element)

  // Which staff the note names. It is range-checked even in a one-staff part,
  // so a note naming a staff that <staves> has not declared is rejected, not
  // placed on the first. It is stated only where the part has more than one
  // staff.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  // A rest may be pinned to a height with <display-step>/<display-octave>, read
  // against the clef in force on its staff. MNX states it as rest.staffPosition,
  // steps from the middle line. Without both, or without a clef to read them
  // against, the height cannot be placed and is reported rather than guessed.
  const staffPosition = restElement
    ? restStaffPosition(restElement, staff, state, warnings, context)
    : undefined

  const eventNotations = readEventNotations(notations)
  const note: NoteStatement = {
    element,
    notations,
    eventNotations,
    tieds,
    hiddenTuplets,
    voice,
    duration,
    written,
    rest: restElement,
    grace: graceElement,
    pitch: pitchElement,
    unpitched: unpitchedElement,
    staff,
    staffPosition,
    hidden,
    reportHidden: reportHiddenNote,
  }

  // A note carrying <chord> sounds with the one before it, so it joins that
  // event rather than starting another. It is settled first because it is
  // not an event of its own: it opens no tuplet, and the ratio it repeats
  // belongs to the event it joins.
  if (chordMember) {
    readChordMember(note, state, measureIndex, builder, warnings, context, path)
    return
  }

  const { markers, tremolo } = openTupletsAndTremolo(note, builder, warnings, context, path)

  const restReading = readRest(note, state, builder)

  // MNX's rest filling the measure carries no marking and no stem, so a rest
  // a note value can write stays an event to keep either, as it does for a
  // lyric. Read once here, and the event takes what was read. Where no note
  // value can write the rest, both stay unread and are reported as a loss.
  const fills = restReading.kind === 'fills' ? restReading : undefined
  const canStayEvent = fills?.canStayEvent ?? false
  const restMarkings = canStayEvent ? readMarkings(eventNotations, warnings, context) : undefined
  const restStem = canStayEvent ? readStemDirection(element, warnings, context) : undefined
  const carriesMarking = restMarkings !== undefined && Object.keys(restMarkings).length > 0

  if (
    fills &&
    !((fills.needsEvent || carriesMarking || restStem !== undefined) && fills.canStayEvent)
  ) {
    reportMarkersOnMeasureRest(markers, warnings, context)
    setMeasureRest(note, fills, state, builder, measureIndex, warnings, context, path)
    return
  }
  if (restElement) reportHiddenNote()

  // What the tuplets and tremolos open around this note scale its written
  // value by. A grace note takes none of the measure's time, so none of them
  // scales the <duration> an exporter writes on one.
  const scale = graceElement
    ? { factor: fraction(1), by: undefined }
    : { factor: builder.noteFactor(voice), by: builder.scaledBy(voice) }

  const candidate = restReading.kind === 'candidate' ? restReading : undefined
  // A rest that may be the measure's reports a mismatch only once the voice
  // is whole, through the place the report would hold here.
  const mismatchPlace = warnings.reserve()
  // Where the source states no <duration>, a rest filling the measure lasts
  // the measure.
  const lasts = duration ?? (fills ? measureLength(state) : undefined)
  if (written && lasts && !candidate) {
    reportDurationMismatch(element, written, lasts, scale, warnings, context, mismatchPlace)
  }

  const value =
    written ??
    // A grace note carries no <duration> to measure a value from, so where it
    // states no <type> the beams over it are what say how it is drawn.
    (graceElement && duration === undefined
      ? drawnGraceValue(element, graceElement, warnings, context)
      : undefined) ??
    measuredValue(element, duration, scale, state, path)
  // The event states this note's staff, so the note says nothing of its own.
  const notes: Note[] = pitchElement
    ? [readNoteAt(element, pitchElement, state, path, undefined, warnings, context)]
    : []
  const kitNotes: KitNote[] = unpitchedElement
    ? [readKitNoteAt(element, unpitchedElement, staff, undefined, state, warnings, context)]
    : []

  const event: Event = {
    kind: 'event',
    id: state.ids.nextEvent(),
    staff: undefined,
    value,
    slurs: [],
    lyrics: readLyrics(element, warnings, context),
    stemDirection: fills ? restStem : readStemDirection(element, warnings, context),
    markings: restMarkings ?? readMarkings(eventNotations, warnings, context),
    fermata: readFermata(eventNotations, warnings, context),
    notes,
    kitNotes,
    isRest: restElement !== undefined,
    staffPosition,
  }

  // A grace note is drawn small beside the note it ornaments and takes none
  // of the measure's time, which is why it carries no <duration>. It joins a
  // group rather than standing in the cursor's path.
  if (graceElement) {
    const placed = builder.addGraceNote(
      voice,
      event,
      eventNotations,
      attribute(graceElement, 'slash') === 'yes',
      graceSideToKeep(element, graceElement, voice, builder, warnings, context),
      staff,
    )
    readEventSpanners(
      element,
      notations,
      placed,
      voice,
      builder,
      state,
      measureIndex,
      warnings,
      context,
      tieds,
      placed.beams,
    )
    // A bracket can stop on a grace note, and the stop is read here as it is
    // on any other note. Left unread, the bracket would run on past the group
    // and take in whatever sounded next.
    closeTuplets(builder, voice, markers, warnings, context, path, element.line)
    return
  }

  // Sources sometimes write an extra rest over a rest that already fills the
  // same voice's measure. Both are silence, so the measure rest
  // stands, the extra is reported, and the cursor still moves past it.
  if (restElement && builder.restIsRedundant(voice)) {
    reportMarkersOnMeasureRest(markers, warnings, context)
    warnings.add(
      'redundant:rest',
      'A rest is written over a rest that already fills the measure in the same ' +
        'voice. The measure rest is the one converted.',
      context,
      restElement,
    )
    builder.passOver(duration ?? lengthOf(value))
    return
  }

  // Where the source states no <duration>, the written value is how long the
  // note lasts.
  const placed = fills
    ? builder.addMeasureRestEvent(
        voice,
        event,
        eventNotations,
        lasts ?? lengthOf(value),
        path,
        element.line,
        staff,
      )
    : builder.addEvent(
        voice,
        event,
        eventNotations,
        duration ?? lengthOf(value),
        path,
        element.line,
        staff,
      )
  if (candidate) {
    const { written: drawn, duration: lasts } = candidate
    builder.markMeasureRest(voice, event, {
      event: () =>
        reportDurationMismatch(element, drawn, lasts, scale, warnings, context, mismatchPlace),
    })
  }
  readEventSpanners(
    element,
    notations,
    placed,
    voice,
    builder,
    state,
    measureIndex,
    warnings,
    context,
    tieds,
    undefined,
  )

  // Closed before any tuplet stopping on the same note, because the pair
  // sits inside the bracket.
  if (tremolo?.type === 'stop') {
    builder.closeTremolo(voice, tremolo, warnings, context, path, element.line)
  }
  closeTuplets(builder, voice, markers, warnings, context, path, element.line)
}

/**
 * Opens what the note starts around it: the tuplets, drawn or implied by a
 * run of ratios, and a two-note tremolo. Returns the tuplet markers and the
 * tremolo, which close once the note is placed.
 */
function openTupletsAndTremolo(
  note: NoteStatement,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): { markers: readonly XmlElement[]; tremolo: MultiNoteTremolo | undefined } {
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

  // A tremolo on a single note carries no <time-modification> and lasts what
  // it is written as, so only the ornament itself is lost, and that is
  // reported where <ornaments> is. Across two notes it carries the pair's
  // 2:1 ratio, which the tremolo item states.
  const ratio = element.child('time-modification')

  // Whether a bracket the source drew is open. A tuplet the ratio alone
  // opened is not one: it is the reading below, not something the source
  // stated the extent of.
  const insideDrawnBracket = builder.insideBracket(voice) && !builder.insideImpliedTuplet(voice)

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
  // A note that starts a two-note tremolo states the pair's 2:1 multiplied
  // into whatever tuplet it stands in, so the ratio is read through the pair:
  // its share comes out, and what is left says whether a tuplet is there.
  // The note that stops the pair states the same and adds nothing, the
  // tremolo standing in the run in its place. A pair stating no value to
  // count states no tuplet either, and is left to be read as the pair it is.
  const readsRatio =
    ratio !== undefined &&
    starts.length === 0 &&
    !graceElement &&
    !insideDrawnBracket &&
    tremolo?.type !== 'stop' &&
    (!tremolo || ratioCountedValue(ratio, element, path) !== undefined)
  const stated = readsRatio ? readTupletRatio(ratio, element, path) : undefined
  const rated = stated && tremolo ? tupletShareOfRatio(stated) : stated

  // Full, or this note does not belong in it either way: the run ends here. A
  // grace note takes none of the measure's time, so it neither fills a run nor
  // ends one, and the run it sits in reaches over it. Time the voice passed
  // over in silence before it is another matter, and ends the run whatever
  // stands after the skip.
  const endsRun = graceElement
    ? builder.impliedTupletEndsAtGap(voice)
    : builder.impliedTupletEndsBefore(voice, rated)
  if (endsRun) builder.closeImpliedTuplet(voice, warnings, context, path, element.line)

  // A ratio is read only where no bracket the source drew is open, and the
  // close above ends any run this note does not belong in, so what is open
  // here is the run this note joins, or nothing.
  if (!graceElement && ratio && rated && !builder.insideImpliedTuplet(voice)) {
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
    // that opens a bracket and starts a tremolo states the two multiplied.
    // The tremolo's own half is not the bracket's to hold.
    const quantities = tremolo?.type === 'start' ? withoutTremoloShare(stated) : stated
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
    const inTremolo = tremolo?.type === 'start' || builder.insideTremolo(voice)
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
      builder.dropTupletStart(voice, start.number)
      return false
    })

    if (opened.length > 0) {
      builder.openTuplets(
        voice,
        quantities.inner,
        quantities.outer,
        opened,
        warnings,
        context,
        path,
        element.line,
        derived !== undefined,
      )
    }
  }

  // Opened after any tuplet starting on the same note: the pair may sit
  // inside a tuplet, and the bracket is the outer grouping.
  if (tremolo?.type === 'start') {
    builder.openTremolo(voice, tremolo.marks, path, element.line)
  }

  return { markers, tremolo }
}

/**
 * A rest that fills the measure stands in no bracket. A start opens one, and
 * a rest inside a bracket stays an event, so the markers here are stops.
 */
function reportMarkersOnMeasureRest(
  markers: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
): void {
  for (const marker of markers) {
    warnings.addWhole(
      'unsupported:element',
      'A <tuplet> on a rest that fills the measure closes no bracket, and is not converted.',
      context,
      marker,
    )
  }
}

/** Places a rest as its voice's rest through the measure. */
function setMeasureRest(
  note: NoteStatement,
  fills: FillsMeasure,
  state: PartState,
  builder: MeasureBuilder,
  measureIndex: number,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const { element, eventNotations, voice, written, duration, staff, staffPosition } = note
  // A beam over a rest alone is not a beam, so a source stating one says
  // nothing this loses.
  element.skip('beam')
  if (!fills.canStayEvent) {
    const at = builder.position()
    reportCarriedByUnwritableRest(note, warnings, context, (type, slur) => {
      const number = attribute(slur, 'number') ?? '1'
      state.spanners.dropSlurEnd(type, number, voice, measureIndex, at, { context, element: slur })
    })
  }

  const { eventValue: restValue, unwritableLength: unwritableRest } = fills
  const place = warnings.reserve()

  // A rest no note value writes is written as a space beside grace notes, and
  // a hidden one then loses nothing drawn. So its hiding, like its length, is
  // reported only where it stays on the sequence. Where the rest cannot stay
  // an event, only its fermata is converted, so only a hidden block holding
  // one is drawn anyway.
  const hiddenDrawn = fills.canStayEvent ? undefined : 'fermata'
  if (restValue) note.reportHidden(hiddenDrawn)

  // Where the source states no <duration>, the rest lasts the measure. A bar
  // of silence is drawn as a whole rest in any meter, so the written value is
  // what it lasts only where no time signature says how long the measure is.
  const lasts = duration ?? measureLength(state) ?? (written && lengthOf(written))
  const fermata = readFermata(eventNotations, warnings, context)
  builder.setFullMeasure(
    voice,
    {
      visualDuration: written,
      fermata,
      // MNX's full-measure rest carries a staffPosition too, so a display
      // height on one is placed there rather than lost.
      staffPosition,
    },
    lasts,
    staff,
    // What grace notes beside the rest write it as. A marking, a stem, a
    // lyric or a slur would have kept it an event already.
    restValue &&
      (() => ({
        kind: 'event',
        id: state.ids.nextEvent(),
        staff: undefined,
        value: restValue,
        slurs: [],
        lyrics: new Map(),
        stemDirection: undefined,
        markings: {},
        fermata,
        notes: [],
        kitNotes: [],
        isRest: true,
        staffPosition,
      })),
    {
      // A tuplet or a tremolo open around the rest is refused, so nothing
      // scales its written value.
      event: () => {
        if (written && lasts) {
          const scale = { factor: fraction(1), by: undefined }
          reportDurationMismatch(element, written, lasts, scale, warnings, context, place)
        }
      },
      sequence: () => {
        if (!restValue) note.reportHidden(hiddenDrawn)
        // MNX's rest filling the measure states no length, so how long the
        // source drew this one is not carried. Only a rest that reached here
        // on its own length reports it: one marked as the measure's, or drawn
        // to what the time signature states, says nothing MNX's measure does
        // not. A space written for the rest beside grace notes states the
        // length.
        if (unwritableRest) {
          warnings.addAt(
            place,
            'unrepresentable:rest-length',
            `A rest lasting ${describeLength(unwritableRest)} is the whole of its voice in ` +
              (state.time === undefined
                ? 'a measure written with no time signature. '
                : 'this measure, and no note value can write that length. ') +
              'MNX states such a rest on the sequence, which carries no length, so the ' +
              'length is not converted.',
            context,
            fills.rest,
          )
        }
      },
      space: () => {
        // A hidden rest is time with nothing drawn in it, which is what a
        // space is, unless a fermata is drawn over it.
        if (note.hidden && !fermata) return
        warnings.addAt(
          place,
          'unrepresentable:grace-beside-rest',
          'A grace note stands beside a rest that fills the measure, and no note value ' +
            'can write that rest as an event. MNX states such a rest on a sequence that ' +
            'holds nothing, so the rest is converted as a space of its length. The rest ' +
            'is not drawn, nor a fermata or a position stated on it.',
          context,
          fills.rest,
        )
      },
    },
    path,
    element.line,
  )
}

/**
 * Reports what only an event holds on a rest no note value writes as one.
 * MNX states that rest on the sequence, or as a space beside grace notes,
 * and neither carries a stem, a mark, a slur end or a lyric. What the source
 * does not draw loses nothing drawn, so it is read and not reported.
 */
function reportCarriedByUnwritableRest(
  { element, notations, eventNotations, hidden }: NoteStatement,
  warnings: WarningCollector,
  context: ReportContext,
  dropSlurEnd: (type: 'start' | 'stop', slur: XmlElement) => void,
): void {
  const marks = [...writtenMarks(eventNotations, warnings, context)].flatMap(
    ({ marking, found, block, notations }) => {
      block.read(found)
      // A mark MNX cannot state was reported as it was read.
      if (marking === undefined) return []
      return [{ found, shown: attribute(notations.element, 'print-object') !== 'no' }]
    },
  )
  // A slur passing over the rest needs nothing of it. A slur end in a hidden
  // block still closes or opens its slur, so its loss reaches the other end.
  const slurEnds = notations.flatMap((block) =>
    children(block.element, 'slur').filter((slur) => {
      const type = attribute(slur, 'type')
      if (type !== 'start' && type !== 'stop') return false
      block.read(slur)
      return true
    }),
  )
  for (const slur of stopsFirst(slurEnds)) {
    dropSlurEnd(attribute(slur, 'type') === 'stop' ? 'stop' : 'start', slur)
  }
  // A note has at most one <stem>. A hidden rest draws none it states.
  const stem = element.child('stem')
  // Each element the rest carries, and whether the source draws it.
  const carried = new Map<XmlElement | undefined, boolean>([
    [stem, !hidden && stem !== undefined && !statesNoStem(stem)],
    ...marks.map(({ found, shown }) => [found, shown] as const),
    ...slurEnds.map((slur) => [slur, true] as const),
    ...element.children('lyric').map((lyric) => [lyric, true] as const),
  ])
  for (const found of descendants(element.element)) {
    const drawn = carried.get(found)
    if (drawn === undefined) continue
    // Reading it, or the one warning, accounts for the element whole.
    for (const name of Object.keys(found.attributes)) attribute(found, name)
    if (!drawn) continue
    warnings.add(
      'unrepresentable:element',
      `A <${found.name}> on a rest that fills the measure is not converted. No note value ` +
        'writes the rest as an event, and neither the rest MNX states on the sequence nor a ' +
        'space written for it carries one.',
      context,
      found,
    )
  }
}

/** A note carrying <chord>, joined to the event before it. */
function readChordMember(
  note: NoteStatement,
  state: PartState,
  measureIndex: number,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): void {
  const {
    element,
    notations,
    eventNotations,
    tieds,
    voice,
    duration,
    written,
    rest: restElement,
    grace: graceElement,
    pitch: pitchElement,
    staff,
  } = note
  if (restElement) {
    throw new MusicXMLError('A rest cannot be part of a chord.', { path, line: element.line })
  }
  // A chord member is drawn with the event it joins, so its stem and its
  // beams are that event's and are read from the note carrying them. The
  // ratio it repeats is likewise the event's.
  element.skip('stem', 'beam', 'time-modification')
  // A grace member's slash and the side it takes its time from are the
  // group's, carried from the note that opened it. Both are read here so
  // the sweep does not report a member for restating them; everything else
  // on the <grace> is left to the sweep. A member naming a side the chord
  // does not take is the source disagreeing with itself about one group.
  if (graceElement) {
    attribute(graceElement, 'slash')
    const open = builder.openGraceType(voice)
    for (const [side, named] of entriesOf(GRACE_TIME_ATTRIBUTES)) {
      if (attribute(graceElement, named) === undefined) continue
      if (open === undefined || open === side) continue
      warnings.add(
        'inconsistent:grace-time',
        `A note of a grace chord names ${named}, and the chord it joins takes its ` +
          'time from another side. The side the chord states is the one converted.',
        context,
        graceElement,
      )
    }
  }

  // A chord cannot be part grace note and part full note. The note the chord
  // opened with decides, and a member marked the other way is reported.
  const joinsGrace = builder.chordIsGrace(voice)
  if (joinsGrace === (graceElement === undefined)) {
    warnings.add(
      'inconsistent:grace',
      joinsGrace
        ? 'A note of a chord states no <grace>, and the grace note it joins does. It is ' +
            'converted as a grace note of that chord.'
        : 'A note of a chord is a grace note, and the note it joins is not. It is ' +
            'converted as a full note of that chord.',
      context,
      requireChild(element.element, 'chord', path),
    )
  }

  // MNX states the staff on the event and, where a note of a chord reaches
  // across to the other hand, on that note. A chord straddling the two
  // staves is ordinary piano writing, so only the note that differs from
  // the event's staff states one of its own.
  const reaches = staff !== undefined && staff !== builder.staffOfChord(voice) ? staff : undefined

  // A chord member is a pitch or an unpitched note: a rest was refused just
  // above, and a note sounding none of the three never reached here.
  const chordNote = pitchElement
    ? readNoteAt(element, pitchElement, state, path, reaches, warnings, context)
    : readKitNoteAt(
        element,
        requireChild(element.element, 'unpitched', path),
        staff,
        reaches,
        state,
        warnings,
        context,
      )

  // Sibelius writes some chord members with a duration that disagrees with
  // the value every note of the chord is written as (a dotted half whose
  // duration dropped the dot). Where the written values agree the chord is
  // coherent: the written value is the one converted, and the duration is
  // reported rather than compared.
  const joins = builder.chordValue(voice)
  const writtenMatches =
    written !== undefined &&
    joins !== undefined &&
    written.base === joins.base &&
    written.dots === joins.dots
  const chordDuration = builder.chordDuration(voice)
  if (
    writtenMatches &&
    duration &&
    chordDuration &&
    compareFractions(duration, chordDuration) !== 0
  ) {
    warnings.add(
      'inconsistent:duration',
      `A <note> in a chord lasts ${describeLength(duration)} but is written as ` +
        `${describeValue(written)}, as the chord is. The written value is the one converted.`,
      context,
      element.element,
    )
  }
  const chordDurationOrNone = writtenMatches ? undefined : duration
  let placed: JoinedEvent
  if ('pitch' in chordNote) {
    placed = builder.addChordNote(voice, chordNote, chordDurationOrNone, path, element.line)
    // A roll is drawn across the notes of a chord, so it is the pitched
    // members that say how far it reaches. A kit note has no pitch to order
    // it by, and the chord it sits on is what the roll spans anyway.
    readArpeggio(notations, placed, builder, chordNote)
  } else {
    placed = builder.addChordKitNote(voice, chordNote, chordDurationOrNone, path, element.line)
    readArpeggio(notations, placed, builder, undefined)
  }
  // Exporters write a chord's marks, fermata, tremolo and tuplet bracket on
  // every note of it. What restates the chord's own is passed over: a
  // tuplet stop read again would close a bracket nothing opened.
  const ownMarkers = reconcile(placed.notations, eventNotations, warnings, context)
  readTies(
    element,
    chordNote,
    tiePairing(chordNote),
    voice,
    measureIndex,
    placed.start,
    graceElement !== undefined,
    state,
    warnings,
    context,
    tieds,
  )
  // Sibelius leaves <voice> off a chord member, so the chord's voice is the
  // one asked, not the member's.
  const chordVoice = builder.voiceOfChord(voice)
  for (const marker of ownMarkers) {
    if (attribute(marker, 'type') !== 'start') continue
    // A bracket the chord's own note did not open cannot open here either:
    // the event a chord member joins is already placed by the time the
    // member is read, so the bracket would begin after the chord it
    // belongs to. The number is recorded so the stop that matches it is
    // dropped too, rather than closing the bracket around it.
    warnings.addWhole(
      'unsupported:element',
      'A <tuplet> starts on a chord member, where the bracket would begin after the ' +
        'chord it belongs to, so it is not converted yet.',
      context,
      marker,
    )
    builder.dropTupletStart(chordVoice, attribute(marker, 'number') ?? '1')
  }
  closeTuplets(builder, chordVoice, ownMarkers, warnings, context, path, element.line)
}

/**
 * The spanners and beams an event carries, read once it is in its voice: the
 * arpeggio it rolls, the ties on its notes, the slurs it joins, and its beam
 * markers. Shared by the grace path and the ordinary one, which differ only in
 * that a grace note beams within its own group.
 */
function readEventSpanners(
  element: ElementReader,
  notations: readonly ElementReader[],
  placed: PlacedEvent,
  voice: string | undefined,
  builder: MeasureBuilder,
  state: PartState,
  measureIndex: number,
  warnings: WarningCollector,
  context: ReportContext,
  tieds: readonly XmlElement[],
  /** The run a grace note's group beams within; nothing for any other event. */
  graceBeams: BeamedEvent[] | undefined,
): void {
  const inGraceGroup = graceBeams !== undefined
  // The event's own note is the one these notations sit on: a chord member's
  // are read where the member is, against the note it added.
  const { event } = placed
  readArpeggio(notations, placed, builder, event.notes[0])
  for (const note of [...event.notes, ...event.kitNotes]) {
    readTies(
      element,
      note,
      tiePairing(note),
      voice,
      measureIndex,
      placed.start,
      inGraceGroup,
      state,
      warnings,
      context,
      tieds,
    )
  }
  readSlurs(notations, placed, voice, measureIndex, state, warnings, context, inGraceGroup)
  builder.addBeamMarkers(
    voice,
    event.id,
    beamMarkers(element, warnings, context),
    beamCountForValue(event.value.base),
    graceBeams,
  )
}

function closeTuplets(
  builder: MeasureBuilder,
  voice: string | undefined,
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
  for (const marker of markers) {
    if (attribute(marker, 'type') !== 'stop') continue
    // A stop's placement restates the start's, which the tuplet's placement
    // already carries, so it is read only for the record.
    attribute(marker, 'placement')
    // A marker that states no number is tuplet 1, as the spec has it.
    const number = attribute(marker, 'number') ?? '1'
    // The start this stop matches was dropped where it could not be drawn,
    // and reported there. There is no bracket of its own to close, and
    // closing here would end the bracket around it instead.
    if (builder.closesDroppedTuplet(voice, number)) continue
    // A stop inside a run the ratio alone gathered. No bracket of the
    // source's is open for it to close, and what the ratio counts is what
    // ends the run. Where the run ends on this note the two agree; where it
    // does not, the marker states a grouping the ratio contradicts.
    if (builder.insideImpliedTuplet(voice)) {
      if (!builder.impliedTupletFilled(voice)) {
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
    const ended = builder.closeTuplet(voice, warnings, context, path, line, marker)
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

// MusicXML says where a grace note's time comes from with one attribute per
// side, each naming an amount: a percentage of the note beside it, or, for
// make-time, a length in divisions. MNX names the side and states no amount.
// Keyed by the side, so a side the model gains with no attribute here is
// never read.
const GRACE_TIME_ATTRIBUTES: Record<GraceType, string> = {
  stealPrevious: 'steal-time-previous',
  stealFollowing: 'steal-time-following',
  makeTime: 'make-time',
}

/**
 * The side to add a grace note with, once the beam over it has had its say.
 *
 * A run of grace notes is cut where the side changes, and each group beams
 * within itself, so a beam drawn across the cut would be left with one note
 * at each end and dropped. The beam is what the engraver drew, and the side
 * is playback, so a note beamed to the one before it stays in the open group
 * and the side it states is reported instead.
 */
function graceSideToKeep(
  element: ElementReader,
  grace: XmlElement,
  voice: string | undefined,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: ReportContext,
): GraceType | undefined {
  const side = readGraceType(grace, warnings, context)
  const open = builder.openGraceType(voice)
  if (side === undefined || open === undefined || open === side) return side
  // The <beam> children are read directly, so that a marker this never keeps
  // is still read and reported where the note's beams are.
  const joined = element.element.children.some(
    (child) =>
      child.name === 'beam' &&
      (attribute(child, 'number') ?? '1') === '1' &&
      ['continue', 'end'].includes(child.text.trim()),
  )
  if (!joined) return side
  warnings.add(
    'unrepresentable:grace-time',
    `A grace note states it takes its time from another side than the grace notes it ` +
      'is beamed to. MNX states one side for each group of grace notes, and splitting ' +
      'the group would break the beam, so the side already stated is the one converted.',
    context,
    grace,
  )
  return undefined
}

/**
 * Where a grace note takes its time from. MNX states the side on the group
 * and no amount, so the amount the source names is reported rather than
 * carried. A note naming more than one side keeps one and reports the rest,
 * because MNX states one. The sides are read in a fixed order rather than the
 * source's, because attributes carry none.
 */
function readGraceType(
  grace: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): GraceType | undefined {
  let kind: GraceType | undefined
  for (const [type, written] of entriesOf(GRACE_TIME_ATTRIBUTES)) {
    const amount = attribute(grace, written)
    if (amount === undefined) continue
    if (kind !== undefined) {
      warnings.add(
        'unrepresentable:grace-time',
        `A grace note names ${written} as well as another side to take its time from. ` +
          'MNX states one side, and only one is converted.',
        context,
        grace,
      )
      continue
    }
    kind = type
    warnings.add(
      'unrepresentable:grace-time',
      `A grace note states ${written}="${amount}", and MNX states which side a grace ` +
        'group takes its time from without an amount. The side is converted and the ' +
        'amount is not.',
      context,
      grace,
    )
  }
  return kind
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
  warnings.addWhole(
    'unsupported:element',
    `A <caesura> of "${text}" names no shape MusicXML defines, and is not converted.`,
    context,
    found,
  )
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
function* writtenMarks(
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
      case 'breath': {
        // A breath mark names its glyph as its text: a comma, a tick.
        const symbol = trimmedText(found) || undefined
        yield { ...at, kind: notation.kind, marking: { placement: placementOf(found), symbol } }
        continue
      }
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
  // An unmeasured tremolo has no beam count, and MNX states a tremolo as a
  // count of beams.
  if (type !== 'single') {
    warnings.add(
      'unrepresentable:element',
      `A tremolo of type "${type}" cannot be stated in MNX, which counts beams.`,
      context,
      found,
    )
    return undefined
  }

  const text = trimmedText(found)
  // Zero beams write an unmeasured tremolo, and MNX counts from one. Anything
  // else out of range is not a tremolo a stem can carry, so the single-note
  // mark is dropped rather than degraded.
  const marks = tremoloBeamCount(text)
  if (marks === undefined) {
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
function readMarkings(
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
function readFermata(
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
    // The one warning accounts for the extras whole, facing and side
    // included.
    for (const extra of found.slice(1)) {
      attribute(extra, 'type')
      attribute(extra, 'placement')
    }
    warnings.add(
      'unrepresentable:fermata',
      'More than one fermata is written at the same place, and MNX states one. ' +
        'The first is the one converted.',
      context,
      first,
    )
  }

  const shape = trimmedText(first)
  if (shape !== '' && !FERMATA_SYMBOLS.has(shape)) {
    warnings.add(
      'unsupported:element',
      `A <fermata> of "${shape}" is not converted yet.`,
      context,
      first,
    )
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

function placementOf(element: XmlElement): 'above' | 'below' | undefined {
  const placement = attribute(element, 'placement')
  return placement === 'above' || placement === 'below' ? placement : undefined
}

function upOrDown(value: string | undefined): 'up' | 'down' | undefined {
  return value === 'up' || value === 'down' ? value : undefined
}

/**
 * Whether the chord this note belongs to is rolled, or bracketed as struck
 * together. MusicXML marks every note of the chord; MNX states it once, over
 * the notes it runs between, so the mark is passed to the builder and the
 * span worked out once the chord is complete.
 */
function readArpeggio(
  notations: readonly ElementReader[],
  placed: PlacedEvent,
  builder: MeasureBuilder,
  /** The note carrying these notations, or nothing where a rest carries them. */
  note: Note | undefined,
): void {
  for (const block of notations) {
    for (const rolled of block.children('arpeggiate')) {
      // MusicXML states a direction only when an arrowhead is drawn, and
      // rolls from the lowest note up when it states none.
      const direction = upOrDown(attribute(rolled, 'direction'))
      // The number is what joins one chord's mark to another's, so an absent
      // one is passed on absent: a default would make every unnumbered mark in
      // the measure claim the same roll.
      builder.markArpeggio(
        placed,
        note,
        attribute(rolled, 'number'),
        false,
        direction,
        direction !== undefined,
        rolled,
      )
    }
    // <non-arpeggiate> says the opposite: a bracket meaning the notes are
    // struck together. Its type names which end of the bracket this note is,
    // which MNX has no use for, since the span already says where it runs;
    // it is read here only so the sweep knows it is accounted for.
    for (const struck of block.children('non-arpeggiate')) {
      attribute(struck, 'type')
      builder.markArpeggio(
        placed,
        note,
        attribute(struck, 'number'),
        true,
        undefined,
        false,
        struck,
      )
    }
  }
}

function readStemDirection(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
): 'up' | 'down' | undefined {
  const stem = element.child('stem')
  if (!stem) return undefined

  const direction = stem.text.trim()
  if (direction === 'up' || direction === 'down') return direction
  if (statesNoStem(stem) && element.child('rest')) return undefined

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
function statesNoStem(stem: XmlElement): boolean {
  return stem.text.trim() === 'none'
}

const ENCLOSURES = new Map<string, 'parentheses' | 'brackets'>([
  ['parentheses', 'parentheses'],
  ['bracket', 'brackets'],
])

function readNoteAt(
  element: ElementReader,
  pitchElement: XmlElement,
  state: PartState,
  path: DocumentPath,
  staff: number | undefined,
  warnings: WarningCollector,
  context: ReportContext,
): Note {
  // MusicXML writes the pitch the player reads, MNX the pitch the instrument
  // sounds. They differ only for a transposing part, which states the
  // interval between them.
  const written = readPitch(pitchElement, path, warnings, context)

  return {
    id: state.ids.nextNote(),
    pitch: state.transposition ? soundingPitch(written, state.transposition) : written,
    ties: [],
    accidentalDisplay: readAccidentalDisplay(element),
    staff,
  }
}

/** The same, for a note struck on a component of the part's percussion kit. */
function readKitNoteAt(
  element: ElementReader,
  unpitchedElement: XmlElement,
  onStaff: number | undefined,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): KitNote {
  return {
    id: state.ids.nextNote(),
    component: kitComponent(element, unpitchedElement, onStaff, state, warnings, context),
    ties: [],
    staff,
  }
}

/**
 * What a tie on this note pairs by: the pitch of a pitched note, and the kit
 * component struck for a note with no pitch to compare.
 */
function tiePairing(note: Note | KitNote): string {
  return 'pitch' in note ? tieKey(note.pitch) : note.component
}

/**
 * How a note's accidental is drawn, or nothing where the source draws none.
 * MusicXML draws an accidental where it writes an <accidental>, so its
 * presence is what marks the note; a note with an alter but no <accidental> is
 * covered by the key or a note before it.
 */
function readAccidentalDisplay(element: ElementReader): AccidentalDisplay | undefined {
  const accidental = element.child('accidental')
  if (!accidental) return undefined

  let enclosure: 'parentheses' | 'brackets' | undefined
  for (const [source, symbol] of ENCLOSURES) {
    if (attribute(accidental, source) === 'yes') enclosure = symbol
  }

  // A cautionary or editorial accidental is drawn though the key or a note
  // before it would not require it, which is what MNX's `force` states.
  const forced =
    attribute(accidental, 'cautionary') === 'yes' || attribute(accidental, 'editorial') === 'yes'

  return { show: true, enclosure, ...(forced ? { force: true } : {}) }
}

/**
 * A <tie> says a tie begins or ends on this note. A note in the middle of a
 * chain carries both, which is why every one of them is read.
 */
function readTies(
  element: ElementReader,
  note: TieTarget,
  pairedBy: string,
  voice: string | undefined,
  measureIndex: number,
  at: Fraction,
  grace: boolean,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  tieds: readonly XmlElement[],
): void {
  const ties = element.children('tie')
  const side = startTiedSide(tieds)

  // A tie is reported once the part is whole, so the element each edge is
  // written with is recorded with the edge.
  for (const edge of tieEdges(ties, tieds, warnings, context)) {
    const where = { context, element: edge.element }
    if (edge.kind === 'stop') {
      state.spanners.stopTie(note, pairedBy, voice, measureIndex, at, grace, where)
    } else {
      state.spanners.startTie(note, pairedBy, voice, side, measureIndex, at, grace, where)
    }
  }

  // A let-ring (l.v.) tie rings out with no ending note. MusicXML 4.0 states
  // it as type "let-ring" on either <tie> or <tied>; MNX states it as a tie's
  // `lv`, with no target.
  const letRing =
    ties.some((tie) => attribute(tie, 'type') === 'let-ring') ||
    tieds.some((tied) => attribute(tied, 'type') === 'let-ring')
  if (letRing) note.ties = [...note.ties, { crossVoice: false, lv: true }]
}

/**
 * The tie edges a note carries, in the order they apply: a note in the middle
 * of a chain ends the tie before it and then starts the next.
 *
 * <tie> is the sounded tie and <tied> the drawn one, so a document stating
 * both is read from <tie>. A note that is not sounded, such as a cue, states
 * the tie in <tied> alone and is read from that instead.
 */
function tieEdges(
  ties: readonly XmlElement[],
  tieds: readonly XmlElement[],
  warnings: WarningCollector,
  context: ReportContext,
): { kind: 'start' | 'stop'; element: XmlElement }[] {
  const starts: XmlElement[] = []
  const stops: XmlElement[] = []
  for (const tie of ties) {
    const type = attribute(tie, 'type')
    if (type === 'stop') stops.push(tie)
    else if (type === 'start') starts.push(tie)
    else if (type !== 'let-ring') {
      warnings.add(
        'unsupported:element',
        `A <tie> of type "${type ?? ''}" is not converted yet.`,
        context,
        tie,
      )
    }
  }

  // Read from <tied> only where no <tie> stated an edge. A note whose only
  // <tie> is a let-ring still states its drawn tie in <tied>.
  if (starts.length === 0 && stops.length === 0) {
    for (const tied of tieds) {
      const type = attribute(tied, 'type')
      // A "continue" is the middle of a chain, which <tie> writes as a stop
      // and a start on the one note.
      if (type === 'continue') {
        starts.push(tied)
        stops.push(tied)
      } else if (type === 'stop') stops.push(tied)
      else if (type === 'start') starts.push(tied)
      else if (type !== 'let-ring') {
        warnings.add(
          'unsupported:element',
          `A <tied> of type "${type ?? ''}" is not converted yet.`,
          context,
          tied,
        )
      }
    }
  }

  // Every stop before every start, whichever order the document writes them
  // in. A note is the middle of a chain only one way round: it ends the tie
  // before it and then starts the next. Taken as written, a note stating its
  // start first would close that tie and be tied to itself.
  return [
    ...stops.map((element) => ({ kind: 'stop' as const, element })),
    ...starts.map((element) => ({ kind: 'start' as const, element })),
  ]
}

// The side a tie is drawn on, from its <tied> edges. MNX's tie states one
// side, on the note it starts from, so the start's statement is the tie's:
// a side stated on a stop is read and dropped, with the read accounting for
// the attributes. A "continue" starts the next tie of a chain, so its side is
// that tie's, as a start's is.
function startTiedSide(tieds: readonly XmlElement[]): CurveSide | undefined {
  let side: CurveSide | undefined
  for (const tied of tieds) {
    const stated = curveSide(tied)
    const type = attribute(tied, 'type')
    if (side === undefined && (type === 'start' || type === 'continue')) side = stated
  }
  return side
}

/**
 * A note's slur edges with every stop before every start, whichever order the
 * document writes them in. A slur cannot start and end on one note, so a stop
 * closes a slur opened before the note, as a tie's does.
 */
function stopsFirst(slurs: readonly XmlElement[]): XmlElement[] {
  const isStop = (slur: XmlElement) => attribute(slur, 'type') === 'stop'
  return [...slurs.filter(isStop), ...slurs.filter((slur) => !isStop(slur))]
}

/**
 * Slurs are matched by the number the source gives them, across the part.
 *
 * Each end records where it stands, because the pairing runs once the whole
 * part is read rather than as the ends are met: a <backup> can write a stop
 * before the start the music puts first.
 */
function readSlurs(
  notations: readonly ElementReader[],
  { event, start: at }: PlacedEvent,
  voice: string | undefined,
  measureIndex: number,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  grace: boolean,
): void {
  const slurs = notations.flatMap((block) => block.children('slur'))
  if (slurs.length === 0) return
  for (const slur of stopsFirst(slurs)) {
    const type = attribute(slur, 'type')
    const number = attribute(slur, 'number') ?? '1'
    // Every edge is read for its side, so the attributes are accounted for
    // wherever the source writes them. Only the start's and the stop's go
    // anywhere: a "continue" edge's side has no home in MNX and is dropped.
    const side = curveSide(slur)
    // Reported once the part is whole, so the <slur> is recorded with the
    // edge.
    const where = { context, element: slur }
    if (type === 'stop') {
      state.spanners.stopSlur(event, number, side, voice, measureIndex, at, grace, where)
    } else if (type === 'start') {
      state.spanners.startSlur(
        event,
        number,
        side,
        slurLineType(slur),
        voice,
        measureIndex,
        at,
        grace,
        where,
      )
    } else if (type !== 'continue') {
      // "continue" marks a note partway along a slur. MNX states only where a
      // slur begins and ends, so there is nothing for it to carry, and
      // nothing is lost by passing over it.
      warnings.add(
        'unsupported:element',
        `A <slur> of type "${type ?? ''}" is not converted yet.`,
        context,
        slur,
      )
    }
  }
}

// The side a slur or tie is drawn on. MusicXML states it two ways at once:
// orientation (over/under) is the curve itself, placement (above/below) only
// where the notation sits, so the orientation wins where they disagree and
// the placement stands in where the source states no orientation. Both are
// read off every edge either way.
function curveSide(element: XmlElement): CurveSide | undefined {
  const orientation = attribute(element, 'orientation')
  const placement = attribute(element, 'placement')
  if (orientation === 'over') return 'up'
  if (orientation === 'under') return 'down'
  if (placement === 'above') return 'up'
  if (placement === 'below') return 'down'
  return undefined
}

// MusicXML's line-type values are the same words MNX states, so a known one
// passes straight through; anything else leaves the slur drawn solid.
const isLineType = recogniser<LineType>({ dashed: true, dotted: true, solid: true, wavy: true })

function slurLineType(slur: XmlElement): LineType | undefined {
  const lineType = attribute(slur, 'line-type')
  return lineType !== undefined && isLineType(lineType) ? lineType : undefined
}

/**
 * What a note says about its beams, by level. A note carries one <beam> per
 * level it is beamed at, so all of them are read: level 1 is the eighth-note
 * beam, level 2 the sixteenth, and so on.
 */
function beamMarkers(
  element: ElementReader,
  warnings: WarningCollector,
  context: ReportContext,
): ReadonlyMap<number, string> {
  const markers = new Map<number, string>()
  for (const beam of element.children('beam')) {
    // A fanned beam draws an accelerando or ritardando by spreading the beams.
    // MNX has no home for it in this schema pin, and <beam> has no children
    // for the unread-element sweep to catch, so it is reported here.
    const fan = attribute(beam, 'fan')
    if (fan !== undefined && fan !== 'none') {
      warnings.add(
        'unsupported:element',
        `A <beam> fanned as "${fan}" is not converted yet.`,
        context,
        beam,
        'fan',
      )
    }

    // The level is the attribute; the element's own text says what the beam
    // does there, as "begin" or "end".
    const stated = attribute(beam, 'number')
    if (stated === undefined) {
      markers.set(1, trimmedText(beam))
      continue
    }

    // A level outside the eight a stem can carry draws no beam, and the
    // measure adds up without it, so the marker is dropped and reported, not
    // refused. The beams around it are drawn as if it were never written: a
    // run whose end was written here closes at the last marker it kept, and
    // comes out short. The report says so.
    const level = parseWholeNumber(stated)
    if (level === undefined || level < 1 || level > MOST_BEAM_LEVELS) {
      warnings.add(
        'unresolved:attribute-value',
        `The "number" of a <beam> is "${stated}", which is not one of the eight beam ` +
          'levels. The marker is dropped, and the beams beside it are drawn as if it ' +
          'had never been written.',
        context,
        beam,
        'number',
      )
      continue
    }
    markers.set(level, trimmedText(beam))
  }
  return markers
}

/**
 * The beam count a `<tremolo>` states in its text: three where it states none,
 * which is how the mark is usually drawn, or nothing where the text is not a
 * whole number in the one-to-eight range MNX can draw. The single-note and
 * two-note kinds part ways on what to do with an out-of-range count, so each
 * reports its own loss; only the reading of the count is shared.
 */
function tremoloBeamCount(text: string): number | undefined {
  const marks = text === '' ? 3 : parseWholeNumber(text)
  return marks !== undefined && marks >= 1 && marks <= 8 ? marks : undefined
}

interface MultiNoteTremolo {
  type: 'start' | 'stop'
  marks: number
  /** The <tremolo> marker. */
  element: XmlElement
}

function multiNoteTremoloOf(
  written: readonly EventNotation[],
  warnings: WarningCollector,
  context: ReportContext,
): MultiNoteTremolo | undefined {
  // A note is one end of one pair, so a second marker stays unread.
  const [first] = writtenFor(written, 'multiNoteTremolo')
  if (!first) return undefined
  const { found: tremolo, block } = first
  block.read(tremolo)
  const type = attribute(tremolo, 'type') === 'start' ? 'start' : 'stop'

  // MNX has nowhere on a two-note tremolo to say which side it is drawn on;
  // the single-note kind carries that, this kind does not.
  if (attribute(tremolo, 'placement') !== undefined) {
    warnings.add(
      'unrepresentable:element',
      'A tremolo written across two notes says which side it is drawn on, and MNX ' +
        'has nowhere to put that.',
      context,
      tremolo,
    )
  }

  const text = tremolo.text.trim()
  let marks = tremoloBeamCount(text)
  if (marks === undefined) {
    // Unlike the single-note kind, the pair still converts, drawn the usual
    // way with three beams.
    warnings.add(
      'unrepresentable:element',
      `A tremolo drawn with ${text} beams cannot be stated in MNX, which counts ` +
        'from one to eight. Three beams are drawn instead.',
      context,
      tremolo,
    )
    marks = 3
  }
  return { type, marks, element: tremolo }
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
  return {
    multiple: number ? readIntegerInRange(number, path, 1, 1_000) : fallback.multiple,
    value: type
      ? { base: requireNoteValueBase(type, path), dots: children(portion, 'tuplet-dot').length }
      : fallback.value,
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
 * The ratio a bracket holds, with the share a two-note tremolo starting on
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

/** The derived ratio as a fraction, for the report that names it. */
function describeRatio(quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity }): string {
  return `${String(quantities.outer.multiple)}/${String(quantities.inner.multiple)}`
}

/**
 * What a <time-modification> says is played, and the space it is played in.
 * The value counted is <normal-type> where the source gives one, and the
 * note's own written value otherwise.
 */
function readTupletRatio(
  ratio: XmlElement,
  element: ElementReader,
  path: DocumentPath,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } {
  const played = readIntegerInRange(requireChild(ratio, 'actual-notes', path), path, 1, 1_000)
  const space = readIntegerInRange(requireChild(ratio, 'normal-notes', path), path, 1, 1_000)

  const value = ratioCountedValue(ratio, element, path)

  if (!value) {
    throw new MusicXMLError('A tuplet states no note value to count.', {
      path,
      line: ratio.line,
    })
  }

  return { inner: { value, multiple: played }, outer: { value, multiple: space } }
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

/** The value as written: `<type>` plus however many `<dot>`s follow it. */
function readWrittenValue(element: ElementReader, path: DocumentPath): NoteValue | undefined {
  const typeElement = element.child('type')
  // <dot> is read either way: a note with dots and no <type> has still stated
  // them, and leaving them unread would report them as a loss.
  const dots = element.children('dot').length
  if (!typeElement) return undefined

  const base = noteValueBaseOf(typeElement)
  if (!base) {
    throw new MusicXMLError(`Unknown note type "${trimmedText(typeElement)}".`, {
      path,
      line: typeElement.line,
    })
  }
  return { base, dots }
}

// A stem carries at most eight beams, so a level past that draws nothing.
const MOST_BEAM_LEVELS = 8

/**
 * How much a note's written value is scaled by what is open around it, and
 * which of the two states it, for a report to name.
 */
interface NoteScale {
  factor: Fraction
  by: 'tuplet' | 'tremolo' | undefined
}

/**
 * The value a grace note stating no <type> is drawn with. Nothing in the
 * source states its length: a grace note carries no <duration>, and MNX
 * states a value for every event. The beams over it are what draw it, one
 * for an eighth and one more for each halving, and a grace note carrying
 * none is drawn as an eighth.
 */
function drawnGraceValue(
  element: ElementReader,
  grace: XmlElement,
  warnings: WarningCollector,
  context: ReportContext,
): NoteValue {
  const levels = element.children('beam').flatMap((beam) => {
    const level = parseWholeNumber(attribute(beam, 'number') ?? '1')
    return level !== undefined && level <= MOST_BEAM_LEVELS ? [level] : []
  })
  // A level below one draws no beam, and the zero here is what says so.
  const beams = Math.max(0, ...levels)
  const base = valueForBeamCount(beams) ?? 'eighth'

  warnings.add(
    'missing:note-type',
    `A grace note states no <type>, and carries no <duration> to measure one from. ` +
      `MNX states a value for every event, so it is converted as ${describeValue({ base, dots: 0 })}` +
      (beams > 0 ? ', which its beams draw.' : ', which is how a grace note is drawn.'),
    context,
    grace,
  )
  return { base, dots: 0 }
}

/**
 * The value to use when the note does not say which one is written. A
 * <duration> is the time the note sounds, which a tuplet or a tremolo around
 * it has already scaled, so `scale` takes that ratio back out.
 */
function measuredValue(
  element: ElementReader,
  duration: Fraction | undefined,
  scale: NoteScale,
  state: PartState,
  path: DocumentPath,
): NoteValue {
  if (!duration) {
    throw new MusicXMLError('A <note> states neither a <type> nor a <duration>.', {
      path,
      line: element.line,
    })
  }

  // The duration was measured in assumed divisions, and with no written value
  // there is nothing to check the assumption against.
  if (state.divisionsAssumed) {
    throw new MusicXMLError(
      'A <note> has no <type>, and no <divisions> ever said how long its <duration> is.',
      { path, line: element.line },
    )
  }

  const written = divideFractions(duration, scale.factor)
  const value = noteValueOf(written)
  if (!value) {
    // A bracket may state a ratio that scales nothing, and naming the same
    // length twice would read as though it did.
    const scaled = scale.by !== undefined && compareFractions(written, duration) !== 0
    throw new MusicXMLError(
      scaled && scale.by
        ? `A <note> states no <type>. It lasts ${describeLength(duration)}, written as ` +
            `${describeLength(written)} by the ${scale.by} around it, which no note value ` +
            'can write.'
        : `A <note> states no <type>, and lasts ${describeLength(duration)}, which no note ` +
            'value can write.',
      { path, line: element.line },
    )
  }
  return value
}

// A note inside a tuplet is meant to last less than it is written as, by the
// open tuplets' combined ratio, so the written value is scaled by it before
// the two are compared. Only a disagreement beyond that is the source
// disagreeing with itself.
function reportDurationMismatch(
  element: ElementReader,
  written: NoteValue,
  duration: Fraction,
  scale: NoteScale,
  warnings: WarningCollector,
  context: ReportContext,
  place: WarningPlace,
): void {
  const scaledBy = scale.by
  const wanted = multiplyFractions(lengthOf(written), scale.factor)
  if (compareFractions(wanted, duration) === 0) return

  // The ratio is what the written value is compared with, so inside a
  // tuplet or a tremolo the message names the length that ratio wants, and
  // which of the two states it. Naming the written value alone would give
  // "written as an eighth but lasts an eighth", the same length twice.
  warnings.addAt(
    place,
    'inconsistent:duration',
    scaledBy
      ? `A <note> is written as ${describeValue(written)}, which the ${scaledBy} around ` +
          `it makes ${describeLength(wanted)}, but it lasts ${describeLength(duration)}. ` +
          'The written value is the one converted.'
      : `A <note> is written as ${describeValue(written)} but lasts ` +
          `${describeLength(duration)}. The written value is the one converted.`,
    context,
    element.element,
  )
}

function readPitch(
  element: XmlElement,
  path: DocumentPath,
  warnings: WarningCollector,
  context: ReportContext,
): Pitch {
  const step = trimmedText(requireChild(element, 'step', path))
  if (!isStep(step)) {
    throw new MusicXMLError(`Unknown pitch step "${step}".`, { path, line: element.line })
  }

  const octave = readIntegerInRange(requireChild(element, 'octave', path), path, 0, 9)
  const alterElement = child(element, 'alter')

  return {
    step,
    octave,
    alter: alterElement ? readAlter(alterElement, path, warnings, context) : 0,
  }
}

// A decimal as MusicXML writes one, which is what <alter> counts semitones
// in. Stricter than Number(), for the same reason as readInteger.
const DECIMAL_SEMITONES = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * How many semitones a note is altered by. MNX states this as a plain
 * integer, with no range, so a triple sharp goes over as readily as a sharp.
 *
 * MusicXML writes it as a decimal so that a microtone can state a quarter of
 * a semitone. MNX has no fraction of one, so such a note takes the nearest
 * whole alteration and the microtone is reported. A half-way alteration takes
 * the smaller: a three-quarter flat is drawn as a flat rather than as a
 * double flat.
 */
function readAlter(
  element: XmlElement,
  path: DocumentPath,
  warnings: WarningCollector,
  context: ReportContext,
): number {
  const written = trimmedText(element)
  const value = Number(written)
  if (!DECIMAL_SEMITONES.test(written) || !Number.isFinite(value)) {
    throw new MusicXMLError(`<alter> is not a number of semitones: "${written}".`, {
      path,
      line: element.line,
    })
  }
  if (Number.isInteger(value)) return value

  const nearest = Math.sign(value) * Math.ceil(Math.abs(value) - 0.5)
  warnings.add(
    'unrepresentable:microtone',
    `A note is altered by ${written} semitones, which MNX cannot state: its alter is a ` +
      `whole number of them. The note is converted altered by ${String(nearest)}.`,
    context,
    element,
  )
  return nearest === 0 ? 0 : nearest
}
