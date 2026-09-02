// Reading a <note>: what sounds, for how long, and everything written on it.
//
// This is where most of MusicXML's encoding decisions are met. A <note> is not
// always an event of its own: one carrying <chord> joins the note before it,
// and one carrying <grace> is squeezed in beside the beat. Both are settled
// first, because what follows only applies to a note that stands in the
// cursor's path.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type {
  AccidentalDisplay,
  ClefSign,
  CurveSide,
  Event,
  Fermata,
  FermataSymbol,
  LineType,
  MarkingKind,
  Markings,
  Note,
  NoteValue,
  NoteValueQuantity,
  Pitch,
  Step,
  TupletDisplay,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, children, requireChild, trimmedText } from '../xml/tree.js'
import { beamCountForValue } from './beams.js'
import { readDuration } from './divisions.js'
import { describeLength, describeValue, lengthOf, noteValueOf } from './duration.js'
import type { ElementReader } from './element.js'
import { reportHidden } from './unrepresentable.js'
import { readLyrics } from './lyrics.js'
import { noteValueBaseOf, requireNoteValueBase } from './noteValues.js'
import { readIntegerInRange } from './numbers.js'
import type { PartState } from './state.js'
import { entriesOf, recogniser } from './tables.js'
import { MeasureBuilder } from './voices.js'
import type { TupletDisplaySettings } from './voices.js'

// A recogniser rather than a bare set: it narrows the value it accepts to the
// model's type, so a validated value reaches the writer without a cast, and
// the list and the model's Step are held to each other in both directions.
const isStep = recogniser<Step>({ A: true, B: true, C: true, D: true, E: true, F: true, G: true })

// The diatonic order of a step within its octave, counting from C, since staff
// height is counted diatonically.
const STEP_ORDER: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

// The diatonic index of the pitch each clef sign places on its line: G4 for a
// G clef, F3 for an F clef, C4 for a C clef.
const CLEF_REFERENCE: Record<ClefSign, number> = {
  G: 4 * 7 + STEP_ORDER.G,
  F: 3 * 7 + STEP_ORDER.F,
  C: 4 * 7 + STEP_ORDER.C,
}

/** A pitch's diatonic index: its octave times seven, plus the step's order. */
function diatonicIndex(step: Step, octave: number): number {
  return octave * 7 + STEP_ORDER[step]
}

/**
 * A rest's height on the staff from its <display-step>/<display-octave>, in
 * steps from the middle line. The clef in force sits its reference pitch on its
 * own line (2*line - 6 from the middle), and each diatonic step from there is
 * one more step of height. Undefined, with the loss reported, where the pair is
 * incomplete or no clef is in force to read it against.
 */
function restStaffPosition(
  restElement: XmlElement,
  staff: number | undefined,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
): number | undefined {
  const stepElement = child(restElement, 'display-step')
  const octaveElement = child(restElement, 'display-octave')
  if (!stepElement && !octaveElement) return undefined

  const step = stepElement?.text.trim().toUpperCase() ?? ''
  const octaveText = octaveElement?.text.trim() ?? ''
  const clef = state.clefs.get(staff ?? 1)
  if (!isStep(step) || !/^-?\d+$/.test(octaveText) || clef === undefined) {
    warnings.add(
      'unsupported:element',
      "A rest's staff position, given by <display-step> and <display-octave>, needs " +
        'both and a clef in force to place, which this measure does not give.',
      { ...context, line: restElement.line },
      'display-step',
    )
    return undefined
  }
  return 2 * clef.line - 6 + (diatonicIndex(step, Number(octaveText)) - CLEF_REFERENCE[clef.sign])
}

export function readNote(
  element: ElementReader,
  state: PartState,
  builder: MeasureBuilder,
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
): void {
  const restElement = element.child('rest')
  const pitchElement = element.child('pitch')
  if (restElement && pitchElement) {
    throw new MusicXMLError('A <note> is both a rest and a pitch.', { path, line: element.line })
  }
  if (!restElement && !pitchElement) {
    throw new MusicXMLError('A <note> has neither <pitch> nor <rest>.', {
      path,
      line: element.line,
    })
  }

  reportHidden(element.element, 'note', warnings, context)

  const notations = element.blocks('notations')
  // A <notations> block hidden with print-object="no" still has its slur,
  // fermata and the rest drawn, because MNX cannot mark them invisible.
  // Report the hiding rather than drop it in silence, naming what the block
  // holds. The one exception is a block holding only <tuplet> markers: a
  // hidden tuplet notation is the tuplet drawn with no bracket, no number
  // and no value, and MNX's display settings state all three, so the hiding
  // converts instead. That is the standard way a source numbers only the
  // first tuplet of a run.
  const hiddenTuplets = new Set<XmlElement>()
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
    reportHidden(block.element, 'notations', warnings, context, block.element.children[0]?.name)
  }
  // <tied> is the visual side of a tie. Most of it repeats <tie>, but let-ring
  // and the drawn side live only on it, so it is read rather than skipped.
  const tieds = notations.flatMap((block) => block.children('tied'))

  const voice = element.child('voice')?.text.trim()
  const duration = readDuration(element, state, warnings, context, path)
  const written = readWrittenValue(element, path)
  const graceElement = element.child('grace')

  // Which staff the note names. Read and bounded whatever the part has, so
  // that a note naming a staff before <staves> said the part had one is
  // rejected rather than quietly placed on the first. It is only worth
  // stating where the part has more than one staff to choose between.
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

  // A note carrying <chord> sounds with the one before it, so it joins that
  // event rather than starting another. It is settled first because it is
  // not an event of its own: it opens no tuplet, and the ratio it repeats
  // belongs to the event it joins.
  if (element.child('chord')) {
    if (!pitchElement) {
      throw new MusicXMLError('A rest cannot be part of a chord.', { path, line: element.line })
    }
    // A chord member is drawn with the event it joins, so its stem and its
    // beams are that event's and are read from the note carrying them. The
    // ratio it repeats is likewise the event's, and a grace member's slash
    // is the group's, carried from the note that opened it.
    element.skip('stem', 'beam', 'time-modification')
    if (graceElement) attribute(graceElement, 'slash')

    // MNX states the staff on the event and, where a note of a chord reaches
    // across to the other hand, on that note. A chord straddling the two
    // staves is ordinary piano writing, so only the note that differs from
    // the event's staff states one of its own.
    const reaches = staff !== undefined && staff !== builder.staffOfChord(voice) ? staff : undefined

    const chordNote = readNoteAt(element, pitchElement, state, path, reaches)

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
        { ...context, line: element.line },
        'note',
      )
    }
    builder.addChordNote(
      voice,
      chordNote,
      writtenMatches ? undefined : duration,
      path,
      element.line,
    )
    readArpeggio(notations, voice, builder, chordNote)
    readTies(
      element,
      chordNote,
      voice,
      builder,
      graceElement !== undefined,
      state,
      warnings,
      context,
      tieds,
    )
    // A bracket runs around a whole chord, and exporters draw it by writing
    // the same marker on every note of that chord. Such a marker restates the
    // one the chord's own note carried, and the bracket it names is already
    // open or already closed, so it is passed over rather than read again:
    // read again, the stop closed a second bracket that nothing opened and
    // refused the document. Sibelius leaves <voice> off a chord member, so
    // the chord's voice is the one asked, not the member's.
    const chordVoice = builder.voiceOfChord(voice)
    const chordMarkers = tupletMarkers(notations).filter(
      (marker) => !builder.restatesTupletMarker(chordVoice, tupletMarkerKey(marker)),
    )
    for (const marker of chordMarkers) {
      if (attribute(marker, 'type') !== 'start') continue
      // A bracket the chord's own note did not open cannot open here either:
      // the event a chord member joins is already placed by the time the
      // member is read, so the bracket would begin after the chord it
      // belongs to. The number is recorded so the stop that matches it is
      // dropped too, rather than closing the bracket around it.
      warnings.add(
        'unsupported:element',
        'A <tuplet> starts on a chord member, where the bracket would begin after the ' +
          'chord it belongs to, so it is not converted yet.',
        { ...context, line: element.line },
        'tuplet',
      )
      builder.dropTuplet(chordVoice, attribute(marker, 'number') ?? '1')
    }
    closeTuplets(builder, chordVoice, chordMarkers, warnings, context, path, element.line)
    return
  }

  const markers = tupletMarkers(notations)
  // Held so the notes of a chord that follow can tell a marker restating this
  // one from a marker of its own.
  builder.noteTupletMarkers(voice, markers.map(tupletMarkerKey))

  // A tremolo written across two notes gives each of them the value of the
  // pair while the pair lasts only one of them. The pair is gathered into
  // one item, which is how MNX states it.
  const tremolo = multiNoteTremoloOf(notations, warnings, context)

  // A tremolo on a single note carries no <time-modification> and lasts what
  // it is written as, so only the ornament itself is lost, and that is
  // reported where <ornaments> is. Across two notes it carries the pair's
  // 2:1 ratio, which the tremolo item states.
  const ratio = element.child('time-modification')

  // A tuplet is bracketed in the source, and that bracket is what says where
  // one ends and the next begins. Without it there is nothing to group by,
  // and guessing would invent a grouping the source never wrote.
  if (ratio && markers.length === 0 && !builder.insideTuplet(voice) && !tremolo) {
    throw new MusicXMLError(
      'A note carries a tuplet ratio but no <tuplet> bracket marks where the tuplet runs.',
      { path, line: element.line },
    )
  }

  const starts = markers.filter((marker) => attribute(marker, 'type') === 'start')
  if (starts.length > 0) {
    // A bracket with no ratio beside it is written by real engravers, and the
    // note itself says what the ratio is: how long it lasts against how it is
    // written. Ten songs of the Lieder corpus carry one, some as a plain
    // bracket over notes that play as written, some as a triplet whose
    // <time-modification> the exporter left out.
    const derived = ratio ? undefined : impliedTupletRatio(written, duration)
    if (!ratio && !derived) {
      throw new MusicXMLError(
        'A tuplet starts on a note with no <time-modification>, and the note does not ' +
          'say how long it lasts against how it is written.',
        { path, line: element.line },
      )
    }

    const quantities = ratio ? readTupletRatio(ratio, element, path) : derived
    /* v8 ignore next -- one of the two is set, or the throw above ran. */
    if (!quantities) throw new Error('A tuplet opened with no ratio.')
    const opening = starts.map((marker) => ({
      display: tupletDisplayOf(marker, hiddenTuplets.has(marker)),
      stated: statedTupletRatio(marker, quantities, path),
      // A marker that states no number is tuplet 1, as the spec has it.
      number: attribute(marker, 'number') ?? '1',
    }))

    // The note states one ratio for however many brackets open on it. Where
    // several do, only the markers can say how it divides between them, and
    // <time-modification> is not there to be weighed against them.
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
          'of what it is written as, so that is the ratio converted.',
        { ...context, line: element.line },
        'tuplet',
      )
    }

    builder.openTuplets(
      voice,
      quantities.inner,
      quantities.outer,
      opening,
      warnings,
      context,
      path,
      element.line,
      derived !== undefined,
    )
  }

  // Opened after any tuplet starting on the same note: the pair may sit
  // inside a tuplet, and the bracket is the outer grouping.
  if (tremolo?.type === 'start') {
    builder.openTremolo(voice, tremolo.marks, path, element.line)
  }

  // A rest marked as filling the measure is not an event with a length: MNX
  // states it on the sequence, and how long the measure runs is the time
  // signature's business. Some exporters leave measure="yes" off, so a rest
  // with no written value lasting exactly the measure is read the same way;
  // in an irregular measure that length may have no note value at all.
  const fillsMeasure =
    restElement !== undefined &&
    written === undefined &&
    duration !== undefined &&
    !state.divisionsAssumed &&
    state.time !== undefined &&
    compareFractions(duration, fraction(state.time.count, state.time.unit)) === 0
  const restFillsMeasure =
    (restElement !== undefined && attribute(restElement, 'measure') === 'yes') || fillsMeasure

  // A word spoken over an otherwise resting bar is written as a lyric on the
  // whole-measure rest. MNX's sequence-level full-measure rest states only a
  // visual duration and a fermata, with no room for a lyric, but a plain rest
  // event carries one. A slur that starts or ends on the rest is the same
  // story: MNX states a slur as a reference to the event it reaches, and the
  // full-measure rest is not an event with an id. So a measure-filling rest that
  // carries a lyric or a slur endpoint stays an event where its length has a
  // note value to state it with. A slur only passing over the rest (a
  // "continue") needs no target, so it does not force the event. An irregular
  // measure whose length no note value can write still takes the full-measure
  // rest, which needs none, and the lyric or slur is reported as a loss. The
  // checks read the element directly so that an unkept one stays unread and
  // reported.
  const carriesLyric = element.element.children.some((c) => c.name === 'lyric')
  const carriesSlurEnd = notations.some((block) =>
    block.element.children.some(
      (c) =>
        c.name === 'slur' && (attribute(c, 'type') === 'start' || attribute(c, 'type') === 'stop'),
    ),
  )
  const canBeEvent =
    written !== undefined ||
    (duration !== undefined && !state.divisionsAssumed && noteValueOf(duration) !== undefined)

  if (restFillsMeasure && !((carriesLyric || carriesSlurEnd) && canBeEvent)) {
    // A rest is not drawn with a stem, and a beam over one alone is not a
    // beam, so a source stating either says nothing this loses.
    element.skip('stem', 'beam')

    builder.setFullMeasure(
      voice,
      {
        visualDuration: written,
        fermata: readFermata(notations, warnings, context),
        // MNX's full-measure rest carries a staffPosition too, so a display
        // height on one is placed there rather than lost.
        staffPosition,
      },
      duration,
      staff,
      path,
      element.line,
    )
    if (duration) builder.shift(duration, warnings, context, element.line)
    return
  }

  if (written && duration) {
    reportDurationMismatch(
      element,
      written,
      duration,
      builder.tupletFactor(voice),
      builder.scaledBy(voice),
      warnings,
      context,
    )
  }

  const value = written ?? measuredValue(element, duration, state, path)
  // The event states this note's staff, so the note says nothing of its own.
  const notes: Note[] = pitchElement
    ? [readNoteAt(element, pitchElement, state, path, undefined)]
    : []

  const event: Event = {
    kind: 'event',
    id: state.ids.nextEvent(),
    staff: undefined,
    value,
    slurs: [],
    lyrics: readLyrics(element, warnings, context),
    stemDirection: readStemDirection(element, warnings, context),
    markings: readMarkings(notations, warnings, context),
    fermata: readFermata(notations, warnings, context),
    notes,
    isRest: restElement !== undefined,
    staffPosition,
  }

  // A grace note is squeezed in before the beat and takes none of the
  // measure's time, which is why it carries no <duration>. It joins a group
  // rather than standing in the cursor's path.
  if (graceElement) {
    builder.addGraceNote(voice, event, attribute(graceElement, 'slash') === 'yes', staff)
    readEventSpanners(
      element,
      notations,
      event,
      voice,
      builder,
      state,
      warnings,
      context,
      tieds,
      true,
    )
    return
  }

  // Real scores write an occasional extra rest over a rest that already
  // fills the same voice's measure. Both are silence, so the measure rest
  // stands, the extra is reported, and the cursor still moves past it.
  if (event.isRest && builder.hasFullMeasure(voice)) {
    warnings.add(
      'redundant:rest',
      'A rest is written over a rest that already fills the measure in the same ' +
        'voice. The measure rest is the one converted.',
      { ...context, line: element.line },
      'rest',
    )
    if (duration) builder.shift(duration, warnings, context, element.line)
    return
  }

  // Where the source states no <duration>, the written value is how long the
  // note lasts.
  builder.addEvent(voice, event, duration ?? lengthOf(value), path, element.line, staff)
  readEventSpanners(
    element,
    notations,
    event,
    voice,
    builder,
    state,
    warnings,
    context,
    tieds,
    false,
  )

  // Closed before any tuplet stopping on the same note, because the pair
  // sits inside the bracket.
  if (tremolo?.type === 'stop') {
    builder.closeTremolo(voice, tremolo.marks, warnings, context, path, element.line)
  }
  closeTuplets(builder, voice, markers, warnings, context, path, element.line)
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
  event: Event,
  voice: string | undefined,
  builder: MeasureBuilder,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  tieds: readonly XmlElement[],
  inGraceGroup: boolean,
): void {
  // The event's own note is the one these notations sit on: a chord member's
  // are read where the member is, against the note it added.
  readArpeggio(notations, voice, builder, event.notes[0])
  for (const note of event.notes) {
    readTies(element, note, voice, builder, inGraceGroup, state, warnings, context, tieds)
  }
  readSlurs(notations, event, voice, builder, state, warnings, context, inGraceGroup)
  builder.addBeamMarkers(
    voice,
    event.id,
    beamMarkers(element, warnings, context),
    beamCountForValue(event.value.base),
    inGraceGroup,
  )
}

function closeTuplets(
  builder: MeasureBuilder,
  voice: string | undefined,
  markers: readonly XmlElement[],
  warnings: WarningCollector,
  context: WarningContext,
  path: DocumentPath,
  line: number,
): void {
  // Which stop is written first inside <notations> is not constrained, so
  // the note's stops are weighed as a batch: each closes the innermost open
  // tuplet, and only when the numbers the stops state disagree with the
  // numbers of the tuplets closed, as sets, has the source stated tuplets
  // that cross, which MNX's nested tuplets cannot.
  const stated: string[] = []
  const closed: string[] = []
  for (const marker of markers) {
    if (attribute(marker, 'type') !== 'stop') continue
    // A stop's placement restates the start's, which the tuplet's orient
    // already carries, so it is read only for the record.
    attribute(marker, 'placement')
    // A marker that states no number is tuplet 1, as the spec has it.
    const number = attribute(marker, 'number') ?? '1'
    // The start this stop matches was dropped where it could not be drawn,
    // and reported there. There is no bracket of its own to close, and
    // closing here would end the bracket around it instead.
    if (builder.closesDroppedTuplet(voice, number)) continue
    stated.push(number)
    closed.push(builder.closeTuplet(voice, warnings, context, path, line))
  }
  if (stated.length > 0 && String([...stated].sort()) !== String([...closed].sort())) {
    warnings.add(
      'unrepresentable:tuplet-crossing',
      "The source's tuplets cross: a stop names a tuplet other than one ending here. " +
        "MNX's tuplets nest, so each stop is matched to the innermost open tuplet.",
      { ...context, line },
      'tuplet',
    )
  }
}

// MusicXML's <articulations> children, in MNX's spelling. Everything else it
// allows there, from a caesura to a falloff, has no home in event-markings and
// stays unread, which is what reports it. A tremolo is not one of them: it is
// written among the ornaments, and read below with the beam count it needs.
// Keyed by the mark rather than by the element, so the compiler demands an
// entry for every kind the model holds: a kind added there with no spelling
// here would simply never be read.
const ARTICULATIONS: Record<Exclude<MarkingKind, 'tremolo'>, string> = {
  accent: 'accent',
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  tenuto: 'tenuto',
  spiccato: 'spiccato',
  stress: 'stress',
  unstress: 'unstress',
  softAccent: 'soft-accent',
  strongAccent: 'strong-accent',
  // MusicXML files a breath mark among the articulations; MNX states it
  // beside them, under its own name.
  breath: 'breath-mark',
}

/**
 * The marks written on this event. Read in a fixed order rather than the
 * source's, because MNX keys them by name, so a note carries at most one of
 * each and the order they were written in is not part of what it says.
 */
function readMarkings(
  notations: readonly ElementReader[],
  warnings: WarningCollector,
  context: WarningContext,
): Markings {
  const markings: Markings = {}

  for (const block of notations) {
    for (const articulations of block.blocks('articulations')) {
      for (const [kind, written] of entriesOf(ARTICULATIONS)) {
        for (const found of articulations.children(written)) {
          // MNX keys the marks by name, and so does the model, so a second of
          // the same kind has nowhere to go. The first is the one converted,
          // as it is for a second fermata. The one warning accounts for the
          // rejected mark whole, its side and pointing included.
          if (markings[kind] !== undefined) {
            attribute(found, 'placement')
            attribute(found, 'type')
            warnings.add(
              'unrepresentable:marking',
              `An event carries more than one <${written}>, and MNX states one of each ` +
                'kind. The first is the one converted.',
              { ...context, line: found.line },
              written,
            )
            continue
          }

          const orient = placementOf(found)
          if (kind === 'strongAccent') {
            // Which way the wedge of a strong accent points.
            markings.strongAccent = { orient, pointing: upOrDown(attribute(found, 'type')) }
          } else if (kind === 'breath') {
            // A breath mark names its glyph as its text: a comma, a tick.
            markings.breath = { orient, symbol: trimmedText(found) || undefined }
          } else {
            markings[kind] = { orient }
          }
        }
      }
    }

    // A tremolo on one note is drawn as beams across its stem, and MNX
    // states it with the other marks. One written across two notes is a
    // pair of events rather than a mark, gathered where the note is read,
    // so its start and stop markers are passed over here.
    for (const ornaments of block.blocks('ornaments')) {
      for (const found of ornaments.children('tremolo')) {
        const type = attribute(found, 'type') ?? 'single'
        if (type === 'start' || type === 'stop') continue
        // An unmeasured tremolo has no beam count, and MNX states a tremolo
        // as a count of beams.
        if (type !== 'single') {
          warnings.add(
            'unrepresentable:element',
            `A tremolo of type "${type}" cannot be stated in MNX, which counts beams.`,
            { ...context, line: found.line },
            'tremolo',
          )
          continue
        }

        const text = trimmedText(found)
        // Zero beams write an unmeasured tremolo, and MNX counts from one.
        // Anything else out of range is not a tremolo a stem can carry, so the
        // single-note mark is dropped rather than degraded.
        const marks = tremoloBeamCount(text)
        if (marks === undefined) {
          warnings.add(
            'unrepresentable:element',
            `A tremolo drawn with ${text} beams cannot be stated in MNX, which counts ` +
              'from one.',
            { ...context, line: found.line },
            'tremolo',
          )
          continue
        }
        if (markings.tremolo !== undefined) {
          warnings.add(
            'unrepresentable:marking',
            'An event carries more than one <tremolo>, and MNX states one of each ' +
              'kind. The first is the one converted.',
            { ...context, line: found.line },
            'tremolo',
          )
          continue
        }

        markings.tremolo = { orient: placementOf(found), marks }
      }
    }
  }
  return markings
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
  notations: readonly ElementReader[],
  warnings: WarningCollector,
  context: WarningContext,
): Fermata | undefined {
  return readFermataAt(
    notations.flatMap((block) => block.children('fermata')),
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
  context: WarningContext,
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
      { ...context, line: first.line },
      'fermata',
    )
  }

  const shape = trimmedText(first)
  const symbol = FERMATA_SYMBOLS.get(shape)
  if (shape !== '' && !symbol) {
    warnings.add(
      'unsupported:element',
      `A <fermata> of "${shape}" is not converted yet.`,
      { ...context, line: first.line },
      'fermata',
    )
  }

  // MusicXML says which way it faces with "upright" and "inverted".
  const type = attribute(first, 'type')
  return {
    symbol,
    pointing: type === 'upright' ? 'up' : type === 'inverted' ? 'down' : undefined,
    orient: placementOf(first),
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
  voice: string | undefined,
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
      // one is passed on absent rather than defaulted: a default made every
      // unnumbered mark in the measure claim the same roll.
      builder.markArpeggio(
        voice,
        note,
        attribute(rolled, 'number'),
        false,
        direction,
        direction !== undefined,
      )
    }
    // <non-arpeggiate> says the opposite: a bracket meaning the notes are
    // struck together. Its type names which end of the bracket this note is,
    // which MNX has no use for, since the span already says where it runs;
    // it is read here only so the sweep knows it is accounted for.
    for (const struck of block.children('non-arpeggiate')) {
      attribute(struck, 'type')
      builder.markArpeggio(voice, note, attribute(struck, 'number'), true, undefined, false)
    }
  }
}

function readStemDirection(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): 'up' | 'down' | undefined {
  const stem = element.child('stem')
  if (!stem) return undefined

  const direction = stem.text.trim()
  if (direction === 'up' || direction === 'down') return direction

  // MNX's stem direction is up or down and nothing else, so "none" and
  // "double" have nowhere to go.
  warnings.add(
    'unrepresentable:stem-direction',
    `A <stem> of "${direction}" cannot be expressed in MNX, which states only up or down.`,
    { ...context, line: stem.line },
    'stem',
  )
  return undefined
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
): Note {
  return {
    id: state.ids.nextNote(),
    pitch: readPitch(pitchElement, path),
    ties: [],
    accidentalDisplay: readAccidentalDisplay(element),
    staff,
  }
}

/**
 * How a note's accidental is drawn, or nothing where the source draws none.
 * MusicXML draws an accidental exactly where it writes an <accidental>, so its
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
  note: Note,
  voice: string | undefined,
  builder: MeasureBuilder,
  grace: boolean,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  tieds: readonly XmlElement[],
): void {
  const ties = element.children('tie')
  const side = startTiedSide(tieds)

  // The note is in its voice by now, so the cursor has moved past it and its
  // own start is what the pairing orders it by.
  const at = builder.lastEventStart(voice)
  /* v8 ignore next 2 -- a note joins its voice before its ties are read, so
     there is always a place here to pair from. */
  if (!at) throw new Error('A tie on a note with no place in the measure.')

  for (const edge of tieEdges(ties, tieds, warnings, context)) {
    if (edge === 'stop') state.spanners.stopTie(note, voice, state.measure, at, grace, context)
    else state.spanners.startTie(note, voice, side, state.measure, at, grace, context)
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
  context: WarningContext,
): ('start' | 'stop')[] {
  let starts = 0
  let stops = 0
  for (const tie of ties) {
    const type = attribute(tie, 'type')
    if (type === 'stop') stops += 1
    else if (type === 'start') starts += 1
    else if (type !== 'let-ring') {
      warnings.add(
        'unsupported:element',
        `A <tie> of type "${type ?? ''}" is not converted yet.`,
        context,
        'tie',
      )
    }
  }

  // Read from <tied> only where no <tie> stated an edge. A note whose only
  // <tie> is a let-ring still states its drawn tie in <tied>.
  if (starts === 0 && stops === 0) {
    for (const tied of tieds) {
      const type = attribute(tied, 'type')
      // A "continue" is the middle of a chain, which <tie> writes as a stop
      // and a start on the one note.
      if (type === 'continue') {
        starts += 1
        stops += 1
      } else if (type === 'stop') stops += 1
      else if (type === 'start') starts += 1
      else if (type !== 'let-ring') {
        warnings.add(
          'unsupported:element',
          `A <tied> of type "${type ?? ''}" is not converted yet.`,
          context,
          'tied',
        )
      }
    }
  }

  // Every stop before every start, whichever order the document writes them
  // in. A note is the middle of a chain only one way round: it ends the tie
  // before it and then starts the next. Taken as written, a note stating its
  // start first closed that very tie and came out tied to itself.
  return [...Array<'stop'>(stops).fill('stop'), ...Array<'start'>(starts).fill('start')]
}

// The side a tie is drawn on, from its <tied> edges. MNX's tie states one
// side, on the note it starts from, so the start's statement is the tie's:
// a side stated on a stop is read and dropped, with the read accounting for
// the attributes. A "continue" starts the next tie of a chain, so its side is
// that tie's, exactly as a start's is.
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
 * Slurs are matched by the number the source gives them, across the part.
 *
 * Each end records where it stands, because the pairing runs once the whole
 * part is read rather than as the ends are met: a <backup> can write a stop
 * before the start the music puts first.
 */
function readSlurs(
  notations: readonly ElementReader[],
  event: Event,
  voice: string | undefined,
  builder: MeasureBuilder,
  state: PartState,
  warnings: WarningCollector,
  context: WarningContext,
  grace: boolean,
): void {
  const slurs = notations.flatMap((block) => block.children('slur'))
  if (slurs.length === 0) return
  // The event is in its voice by now, so the cursor has moved past it and its
  // own start is what the pairing orders it by.
  const at = builder.lastEventStart(voice)
  /* v8 ignore next 2 -- a note joins its voice before its notations are read,
     so there is always a place here to pair from. */
  if (!at) throw new Error('A slur on an event with no place in the measure.')
  for (const slur of slurs) {
    const type = attribute(slur, 'type')
    const number = attribute(slur, 'number') ?? '1'
    // Every edge is read for its side, so the attributes are accounted for
    // wherever the source writes them. Only the start's and the stop's go
    // anywhere: a "continue" edge's side has no home in MNX and is dropped.
    const side = curveSide(slur)
    if (type === 'stop') {
      state.spanners.stopSlur(event, number, side, voice, state.measure, at, grace, context)
    } else if (type === 'start') {
      state.spanners.startSlur(
        event,
        number,
        side,
        slurLineType(slur),
        voice,
        state.measure,
        at,
        grace,
        context,
      )
    } else if (type !== 'continue') {
      // "continue" marks a note partway along a slur. MNX states only where a
      // slur begins and ends, so there is nothing for it to carry, and
      // nothing is lost by passing over it.
      warnings.add(
        'unsupported:element',
        `A <slur> of type "${type ?? ''}" is not converted yet.`,
        context,
        'slur',
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
  context: WarningContext,
): ReadonlyMap<number, string> {
  const markers = new Map<number, string>()
  for (const beam of element.children('beam')) {
    // A fanned beam draws an accelerando or ritardando by spreading the beams.
    // MNX has no home for it in this pin, and <beam> has no children for the
    // loss net to catch, so it is reported here rather than dropped silently.
    const fan = attribute(beam, 'fan')
    if (fan !== undefined && fan !== 'none') {
      warnings.add(
        'unsupported:element',
        `A <beam> fanned as "${fan}" is not converted yet.`,
        { ...context, line: beam.line },
        'beam',
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

    // A level outside the eight a stem can carry says nothing a beam can be
    // drawn from, and the measure adds up without it: how a note is beamed is
    // drawing, not duration. So the marker is dropped and reported, as a
    // fanned beam above is, rather than the document being refused over it.
    //
    // The marker said where a beam begins or ends, so the beams around it are
    // drawn as if it had never been written: a run whose end was written here
    // closes at the last marker it kept, and comes out short. The report says
    // so, because a reader told only that one level is missing would not look
    // at the beams beside it.
    const level = Number(stated)
    if (!/^\d+$/.test(stated) || level < 1 || level > 8) {
      warnings.add(
        'unresolved:attribute-value',
        `The "number" of a <beam> is "${stated}", which is not one of the eight beam ` +
          'levels. The marker is dropped, and the beams beside it are drawn as if it ' +
          'had never been written.',
        { ...context, line: beam.line },
        'beam',
        'number',
      )
      continue
    }
    markers.set(level, trimmedText(beam))
  }
  return markers
}

/**
 * The end of a two-note tremolo this note carries, when it does. The
 * element's text counts the beams joining the pair; three where it says
 * nothing, which is how the mark is usually drawn.
 */
/**
 * The beam count a `<tremolo>` states in its text: three where it states none,
 * which is how the mark is usually drawn, or nothing where the text is not a
 * whole number in the one-to-eight range MNX can draw. The single-note and
 * two-note kinds part ways on what to do with an out-of-range count, so each
 * reports its own loss; only the reading of the count is shared.
 */
function tremoloBeamCount(text: string): number | undefined {
  const marks = text === '' ? 3 : Number(text)
  return Number.isInteger(marks) && marks >= 1 && marks <= 8 ? marks : undefined
}

function multiNoteTremoloOf(
  notations: readonly ElementReader[],
  warnings: WarningCollector,
  context: WarningContext,
): { type: 'start' | 'stop'; marks: number } | undefined {
  for (const block of notations) {
    for (const ornaments of block.blocks('ornaments')) {
      for (const tremolo of ornaments.children('tremolo')) {
        const type = attribute(tremolo, 'type')
        if (type !== 'start' && type !== 'stop') continue

        // MNX has nowhere on a two-note tremolo to say which side it is
        // drawn on; the single-note kind carries that, this kind does not.
        if (attribute(tremolo, 'placement') !== undefined) {
          warnings.add(
            'unrepresentable:element',
            'A tremolo written across two notes says which side it is drawn on, and MNX ' +
              'has nowhere to put that.',
            { ...context, line: tremolo.line },
            'tremolo',
          )
        }

        const text = tremolo.text.trim()
        let marks = tremoloBeamCount(text)
        if (marks === undefined) {
          // Unlike the single-note kind, the pair still converts, drawn the
          // usual way with three beams.
          warnings.add(
            'unrepresentable:element',
            `A tremolo drawn with ${text} beams cannot be stated in MNX, which counts ` +
              'from one to eight. Three beams are drawn instead.',
            { ...context, line: tremolo.line },
            'tremolo',
          )
          marks = 3
        }
        return { type, marks }
      }
    }
  }
  return undefined
}

/**
 * The <tuplet> markers a note carries, in the order they are written. A note
 * may hold several <notations> blocks, and exporters use that: a tie in one,
 * a tuplet marker in another. One block may also hold several markers, as
 * when two nested tuplets start on the same note, so this reads children()
 * rather than the first child.
 */
/**
 * What a `<tuplet>` marker says, as the pair of its type and its number, for
 * telling a chord member's restatement of the chord's own marker from one it
 * states of itself. A marker that states no number is tuplet 1, as the spec
 * has it.
 */
function tupletMarkerKey(marker: XmlElement): string {
  return `${attribute(marker, 'type') ?? ''} ${attribute(marker, 'number') ?? '1'}`
}

function tupletMarkers(notations: readonly ElementReader[]): readonly XmlElement[] {
  // Every marker is keyed by tupletMarkerKey, on the chord path and on the
  // ordinary one, and the key reads both the type and the number. So each is
  // accounted for whether or not it goes on to open or close a bracket, and
  // there is nothing left here to read.
  return notations.flatMap((block) => block.children('tuplet'))
}

// MusicXML's show-number/show-type values in MNX's. "actual" is the played
// count, which MNX calls the inner one.
// What MusicXML's show-number and show-type say, in MNX's spelling. Keyed by
// the model's own word, so a setting the model gains and this table lacks does
// not compile.
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

  // MusicXML's placement is MNX's orient, both above or below.
  const placement = attribute(start, 'placement')
  if (placement === 'above' || placement === 'below') settings.orient = placement

  const showNumber = attribute(start, 'show-number')
  const number = showNumber === undefined ? undefined : TUPLET_DISPLAY.get(showNumber)
  if (number !== undefined) settings.showNumber = number

  const showType = attribute(start, 'show-type')
  const value = showType === undefined ? undefined : TUPLET_DISPLAY.get(showType)
  if (value !== undefined) settings.showValue = value

  // A marker inside a hidden <notations> block draws nothing at all, so the
  // hiding outweighs any display attribute stated within it.
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
 * write in a <time-modification>: there is no reading to be had, and the
 * caller refuses the document rather than inventing one.
 */
function impliedTupletRatio(
  written: NoteValue | undefined,
  duration: Fraction | undefined,
): { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined {
  if (!written || !duration || duration.num <= 0) return undefined

  const ratio = divideFractions(lengthOf(written), duration)
  // A tuplet nobody would write is not a reading of the bracket; it is the
  // note's duration disagreeing with its written value, which the caller
  // refuses over rather than dressing up as a ratio the source meant.
  if (ratio.num > MOST_A_TUPLET_COUNTS || ratio.den > MOST_A_TUPLET_COUNTS) return undefined
  return {
    inner: { value: written, multiple: ratio.num },
    outer: { value: written, multiple: ratio.den },
  }
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

  const normalType = child(ratio, 'normal-type')
  const value = normalType
    ? { base: requireNoteValueBase(normalType, path), dots: children(ratio, 'normal-dot').length }
    : readWrittenValue(element, path)

  if (!value) {
    throw new MusicXMLError('A tuplet states no note value to count.', {
      path,
      line: ratio.line,
    })
  }

  return { inner: { value, multiple: played }, outer: { value, multiple: space } }
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

/** The value to use when the note does not say which one is written. */
function measuredValue(
  element: ElementReader,
  duration: Fraction | undefined,
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
  // there is nothing to check the assumption against. A wrong guess here
  // would be a silently wrong note length.
  if (state.divisionsAssumed) {
    throw new MusicXMLError(
      'A <note> has no <type>, and no <divisions> ever said how long its <duration> is.',
      { path, line: element.line },
    )
  }

  const value = noteValueOf(duration)
  if (!value) {
    throw new MusicXMLError(
      `A <note> lasts ${describeLength(duration)}, which no note value can write. ` +
        'It needs a tuplet, which is not converted yet.',
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
  tupletFactor: Fraction,
  /** What is open around the note scaling it, where anything is. */
  scaledBy: 'tuplet' | 'tremolo' | undefined,
  warnings: WarningCollector,
  context: WarningContext,
): void {
  const wanted = multiplyFractions(lengthOf(written), tupletFactor)
  if (compareFractions(wanted, duration) === 0) return

  // The ratio is what the written value is weighed against, so inside a
  // tuplet or a tremolo the message names the length that ratio wants, and
  // which of the two states it. Naming the written value alone read as
  // "written as an eighth but lasts an eighth", the same length twice, which
  // reads as a fault in the converter rather than in the source.
  warnings.add(
    'inconsistent:duration',
    scaledBy
      ? `A <note> is written as ${describeValue(written)}, which the ${scaledBy} around ` +
          `it makes ${describeLength(wanted)}, but it lasts ${describeLength(duration)}. ` +
          'The written value is the one converted.'
      : `A <note> is written as ${describeValue(written)} but lasts ` +
          `${describeLength(duration)}. The written value is the one converted.`,
    { ...context, line: element.line },
    'note',
  )
}

function readPitch(element: XmlElement, path: DocumentPath): Pitch {
  const step = trimmedText(requireChild(element, 'step', path))
  if (!isStep(step)) {
    throw new MusicXMLError(`Unknown pitch step "${step}".`, { path, line: element.line })
  }

  const octave = readIntegerInRange(requireChild(element, 'octave', path), path, 0, 9)
  const alterElement = child(element, 'alter')

  return {
    step,
    octave,
    // MusicXML allows fractional alterations for microtones; MNX's alter is an
    // integer, so anything fractional would have to be rounded, silently
    // retuning the note. Two semitones covers double sharps and flats.
    alter: alterElement ? readIntegerInRange(alterElement, path, -2, 2) : 0,
  }
}
