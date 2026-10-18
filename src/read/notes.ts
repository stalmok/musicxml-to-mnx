// Reading a <note>: what sounds, for how long, and everything written on it.
//
// A <note> is not always an event of its own: one carrying <chord> joins the
// note before it, and one carrying <grace> takes none of the measure's time.
// Both are settled first, because what follows applies only to a note that
// stands in the cursor's path.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, fraction, multiplyFractions } from '../fraction.js'
import type { Event, EventNotes, EventRest, GraceType } from '../model/score.js'
import type { Draft } from './draft.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, child, requireChild, trimmedText } from '../xml/tree.js'
import { beamCountForValue, beamMarkers } from './beams.js'
import { readArpeggio } from './arpeggios.js'
import type { BeamedEvent } from './beams.js'
import { readDuration } from './divisions.js'
import { describeLength, describeValue, lengthOf } from './duration.js'
import type { ElementReader } from './element.js'
import { readEventNotations, reconcile, writtenFor } from './eventNotations.js'
import { reportHidden } from './unrepresentable.js'
import { readFermata, readMarkings, readStemDirection } from './marks.js'
import { readLyrics } from './lyrics.js'
import { dropRedundantRest, readRest, reportMarkersOnMeasureRest, setMeasureRest } from './rests.js'
import type { NoteStatement, VoicedNote } from './noteStatement.js'
import {
  closeTremoloAndTuplets,
  closeTuplets,
  openTupletsAndTremolo,
  reportChordMemberRatio,
} from './noteTuplets.js'
import { readIntegerInRange } from './numbers.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import {
  drawnGraceValue,
  measuredValue,
  readWrittenValue,
  reportDurationMismatch,
} from './writtenValues.js'
import { pitchHeights, readKitNoteAt, readNoteAt, restStaffPosition } from './pitches.js'
import { entriesOf } from './tables.js'
import { readSlurs, readTies, tiePairing } from './tiesAndSlurs.js'
import { MeasureBuilder } from './voices.js'
import type { JoinedEvent, PlacedEvent, VoiceLine } from './voices.js'

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
  // MNX states one fermata, the first written, so a hidden block holding only
  // later ones hides nothing drawn. Their loss is reported as a fermata's. A
  // chord's fermata is the one its own note writes, so a note joining it
  // converts none of its own.
  const eventNotations = readEventNotations(notations)
  const fermata = element.child('chord')
    ? undefined
    : writtenFor(eventNotations, 'fermata')[0]?.found
  const reportHiddenNote = (only?: 'fermata') => {
    reportHidden(element.element, warnings, context, undefined, hiddenPlace)
    for (const { block, place } of hiddenBlocks) {
      const holdsFermata = fermata !== undefined && block.children.includes(fermata)
      if (only !== undefined && !holdsFermata) continue
      if (!holdsFermata && block.children.every((one) => one.name === 'fermata')) continue
      reportHidden(block, warnings, context, only ?? block.children[0]?.name, place)
    }
  }
  if (!restElement) reportHiddenNote()
  // <tied> is the visual side of a tie. Most of it repeats <tie>, but let-ring
  // and the drawn side live only on it, so it is read rather than skipped.
  const tieds = notations.flatMap((block) => block.children('tied'))

  const voiceElement = element.child('voice')
  const namedVoice = voiceElement && trimmedText(voiceElement)
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
  if (!chordMember && namedVoice === undefined) builder.namesNoVoice(element.element)
  const voice = chordMember
    ? undefined
    : graceElement
      ? builder.graceLine(namedVoice)
      : builder.beginNote(namedVoice, element.element, warnings, context, path, element.line)

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

  const statement: NoteStatement = {
    element,
    notations,
    eventNotations,
    tieds,
    hiddenTuplets,
    namedVoice,
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
  // belongs to the event it joins. It has no line of its own: it takes its
  // chord's.
  if (!voice) {
    readChordMember(statement, state, measureIndex, builder, warnings, context, path)
    return
  }
  const note: VoicedNote = { ...statement, voice }

  // Sources sometimes write an extra rest over a rest that already fills the
  // same voice's measure. Both are silence, so the measure rest stands and the
  // extra is dropped. That is settled before anything opens around the rest or
  // reads what it carries. A second rest marked as the measure's, or drawn to
  // its length, is refused where it is placed. One that fills it only by a
  // length no note value writes is read here before its own ratio opens, so
  // that length says nothing, and it is dropped.
  if (restElement && !graceElement && builder.restIsRedundant(voice)) {
    const reading = readRest(note, state, builder)
    if (reading.kind !== 'fills' || reading.unwritableLength !== undefined) {
      dropRedundantRest(note, restElement, state, builder, measureIndex, warnings, context, path)
      return
    }
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
    : { factor: voice.noteFactor(), by: voice.scaledBy() }

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
  const rest: EventRest | undefined = restElement && { kind: 'rest', staffPosition }
  // The event states this note's staff, so the note says nothing of its own.
  // A note sounding neither a rest nor a pitch was refused above, so it
  // strikes a kit.
  const body: EventRest | EventNotes =
    rest ??
    (pitchElement
      ? {
          kind: 'notes',
          notes: [readNoteAt(element, pitchElement, state, path, undefined, warnings, context)],
          kitNotes: [],
        }
      : {
          kind: 'notes',
          notes: [],
          kitNotes: [
            readKitNoteAt(
              element,
              requireChild(element.element, 'unpitched', path),
              staff,
              undefined,
              state,
              warnings,
              context,
            ),
          ],
        })

  // A draft, because a two-note tremolo found to have one end once the note
  // after it is read halves its value.
  const event: Draft<Event> = {
    kind: 'event',
    id: state.ids.nextEvent(),
    staff: undefined,
    value,
    slurs: [],
    lyrics: readLyrics(element, warnings, context),
    stemDirection: fills ? restStem : readStemDirection(element, warnings, context),
    markings: restMarkings ?? readMarkings(eventNotations, warnings, context),
    fermata: readFermata(eventNotations, warnings, context),
    body,
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
      graceSideToKeep(element, graceElement, voice, warnings, context),
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

  // Where the source states no <duration>, the written value as the tuplets
  // and tremolos around it scale it is how long the note lasts.
  const unstated = multiplyFractions(lengthOf(value), scale.factor)
  const placed = fills
    ? builder.addMeasureRestEvent(
        voice,
        event,
        eventNotations,
        lasts ?? unstated,
        path,
        element.line,
        staff,
      )
    : builder.addEvent(
        voice,
        event,
        eventNotations,
        scale.factor,
        duration ?? unstated,
        path,
        element.line,
        staff,
      )
  // Only a rest is ever a candidate.
  if (candidate && rest) {
    const { written: drawn, duration: lasts } = candidate
    voice.markMeasureRest(event, rest, {
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

  closeTremoloAndTuplets(builder, voice, markers, tremolo, warnings, context, path, element.line)
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
    namedVoice,
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
  // A chord member joins the note written just before it. Sibelius leaves
  // <voice> off a chord member, so the chord's voice is the one used, not
  // the member's.
  const chord = builder.chordToJoin(path, element.line)
  if (namedVoice !== undefined && namedVoice !== chord.voice.name) {
    warnings.add(
      'inconsistent:voice',
      `A note of a chord names voice ${namedVoice}, and the note it joins is in ` +
        `${chord.voice.name === '' ? 'no named voice' : `voice ${chord.voice.name}`}. ` +
        'It is converted in the voice of the note it joins.',
      context,
      requireChild(element.element, 'voice', path),
    )
  }
  // A chord member is drawn with the event it joins, so its stem and its
  // beams are that event's and are read from the note carrying them. The
  // ratio it repeats, one per note, is likewise the event's, and one that
  // disagrees is reported.
  element.skip('stem', 'beam', 'time-modification')
  reportChordMemberRatio(
    child(element.element, 'time-modification'),
    chord.last.share,
    warnings,
    context,
    path,
  )
  // A grace member's slash and the side it takes its time from are the
  // group's, carried from the note that opened it. Both are read here so
  // the sweep does not report a member for restating them; everything else
  // on the <grace> is left to the sweep. A member naming a side the chord
  // does not take is the source disagreeing with itself about one group.
  if (graceElement) {
    attribute(graceElement, 'slash')
    const open = chord.voice.graceType()
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
  const joinsGrace = chord.last.duration === undefined
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
  const reaches = staff !== undefined && staff !== chord.staff ? staff : undefined

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
  const joins = chord.last.event.value
  const writtenMatches =
    written !== undefined && written.base === joins.base && written.dots === joins.dots
  const chordDuration = chord.last.duration
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
    placed = builder.addChordNote(chord, chordNote, chordDurationOrNone, path, element.line)
    // A roll is drawn across the notes of a chord, so it is the pitched
    // members that say how far it reaches. A kit note has no pitch to order
    // it by, and the chord it sits on is what the roll spans anyway.
    readArpeggio(notations, placed, builder.arpeggios, chordNote, () => pitchHeights(state))
  } else {
    placed = builder.addChordKitNote(chord, chordNote, chordDurationOrNone, path, element.line)
    readArpeggio(notations, placed, builder.arpeggios, undefined, () => pitchHeights(state))
  }
  // Exporters write a chord's marks, fermata, tremolo and tuplet bracket on
  // every note of it. What restates the chord's own is passed over: a
  // tuplet stop read again would close a bracket nothing opened.
  const ownMarkers = reconcile(placed.notations, eventNotations, warnings, context)
  readTies(
    element,
    chordNote,
    tiePairing(chordNote),
    chord.voice.name,
    measureIndex,
    placed.start,
    graceElement !== undefined,
    state,
    warnings,
    context,
    tieds,
  )
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
    chord.voice.dropTupletStart(attribute(marker, 'number') ?? '1')
  }
  closeTuplets(builder, chord.voice, ownMarkers, warnings, context, path, element.line)
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
  voice: VoiceLine,
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
  const { body } = event
  readArpeggio(
    notations,
    placed,
    builder.arpeggios,
    body.kind === 'notes' ? body.notes[0] : undefined,
    () => pitchHeights(state),
  )
  // A rest sounds nothing, so a tie in its voice reaches across it.
  if (body.kind === 'notes') state.spanners.sound(voice.name)
  for (const note of body.kind === 'notes' ? [...body.notes, ...body.kitNotes] : []) {
    readTies(
      element,
      note,
      tiePairing(note),
      voice.name,
      measureIndex,
      placed.start,
      inGraceGroup,
      state,
      warnings,
      context,
      tieds,
    )
  }
  readSlurs(notations, placed, voice.name, measureIndex, state, warnings, context, inGraceGroup)
  builder.addBeamMarkers(
    voice,
    event.id,
    beamMarkers(element, warnings, context),
    beamCountForValue(event.value.base),
    placed.start,
    graceBeams,
  )
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
  voice: VoiceLine,
  warnings: WarningCollector,
  context: ReportContext,
): GraceType | undefined {
  const side = readGraceType(grace, warnings, context)
  const open = voice.graceType()
  if (side === undefined || open === undefined || open === side) return side
  // The <beam> children are read directly, so that a marker this never keeps
  // is still read and reported where the note's beams are.
  const joined = element.element.children.some(
    (child) =>
      child.name === 'beam' &&
      (attribute(child, 'number') ?? '1') === '1' &&
      ['continue', 'end'].includes(trimmedText(child)),
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
