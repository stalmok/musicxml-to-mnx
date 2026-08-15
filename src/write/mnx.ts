// Writes the neutral score model out as an MNX document. Everything this
// converter knows about MNX's encoding lives at or above this file.
//
// Thin by design: the reader has already resolved MusicXML's ambiguities, so
// this is a walk with a few shape decisions. Optional keys are omitted rather
// than set to null, because MNX distinguishes an absent key from a present one.

import type { Fraction } from '../fraction.js'
import type {
  AccidentalDisplay,
  Arpeggio,
  Beam,
  Clef,
  Dynamic,
  Lyric,
  Marking,
  Ending,
  Event,
  Fermata,
  FullMeasureRest,
  GlobalMeasure,
  Measure,
  Note,
  NoteValue,
  Fine,
  GroupingItem,
  Jump,
  Part,
  Pitch,
  Score,
  Segno,
  NoteValueQuantity,
  Sequence,
  SequenceItem,
  Tempo,
} from '../model/score.js'
import type {
  MNXDocument,
  MNXEvent,
  MNXGlobalMeasure,
  MNXNote,
  MNXNoteValue,
  MNXPart,
  MNXPartMeasure,
  MNXPitch,
  MNXPositionedClef,
  MNXNoteValueQuantity,
  MNXSequence,
  MNXSequenceItem,
  MNXBeam,
  MNXLyricLine,
  MNXLyrics,
  MNXAccidentalDisplay,
  MNXDynamic,
  MNXEventMarkings,
  MNXEnding,
  MNXFermata,
  MNXFine,
  MNXFullMeasureRest,
  MNXGlobal,
  MNXJump,
  MNXMeasureRhythmicPosition,
  MNXLayoutStaff,
  MNXPage,
  MNXRhythmicPosition,
  MNXSegno,
  MNXStaffGroup,
  MNXSystem,
  MNXSystemLayout,
  MNXTempo,
} from '../types/mnx.js'

/** The MNX version this converter emits. */
const MNX_VERSION = 1

export function writeMnx(score: Score): MNXDocument {
  const survey = surveyScore(score)
  const layouts = writeLayouts(score)

  return {
    mnx: {
      version: MNX_VERSION,
      // Declared once the document draws any accidental explicitly, so a
      // reader takes the marked notes as the whole of it.
      ...(survey.drawsAccidentals ? { support: { useAccidentalDisplay: true } } : {}),
    },
    global: {
      measures: score.globalMeasures.map((measure, index) =>
        writeGlobalMeasure(measure, survey.measureIds.get(index)),
      ),
      ...writeLyricLines(survey.lyricLines),
      ...writeSounds(score),
    },
    ...(layouts ? { layouts } : {}),
    // Every part carries its id once a layout is written, so the layout's
    // staff sources have something to point at. The id is written verbatim:
    // the reader renames any part id MNX's id pattern cannot state.
    parts: score.parts.map((part) =>
      writePart(part, survey.referenced, survey.measureIds, layouts !== undefined),
    ),
    ...writeScores(score, survey.measureIds, layouts?.[0]?.id),
  }
}

/**
 * The scores object: one rendering, written when the source draws a
 * multi-measure rest, states a system or page break, or groups its parts,
 * because those are the only things this converter states on it. Same
 * principle as layouts: written only when it says something.
 *
 * A score is the only thing that can name a layout, so a document with a
 * layout needs one whether or not it has anything else to say. Without it the
 * grouping is written and then unreachable, and the brackets never draw.
 */
function writeScores(
  score: Score,
  measureIds: ReadonlyMap<number, string>,
  layout: string | undefined,
): Pick<MNXDocument, 'scores'> {
  const measureId = (index: number, of: string): string => {
    const id = measureIds.get(index)
    /* v8 ignore next 2 -- surveyScore names every measure a multi-measure
       rest or a system starts in, which is where this map comes from. */
    if (id === undefined) throw new Error(`A ${of} starts in a measure with no id.`)
    return id
  }

  const rests = score.globalMeasures.flatMap((measure, index) => {
    if (measure.multimeasureRest === undefined) return []
    return [{ start: measureId(index, 'multi-measure rest'), duration: measure.multimeasureRest }]
  })

  // Any break writes the whole page structure: the first system of the score
  // is implicit in MusicXML and stated in MNX, so it opens the first page. A
  // page break starts a system of its own, stated or not.
  const pages: MNXPage[] = []
  if (score.globalMeasures.some((measure) => measure.systemBreak || measure.pageBreak)) {
    let systems: MNXSystem[] = []
    score.globalMeasures.forEach((measure, index) => {
      if (measure.pageBreak && systems.length > 0) {
        pages.push({ systems })
        systems = []
      }
      if (index === 0 || measure.systemBreak || measure.pageBreak) {
        systems.push({ measure: measureId(index, 'system') })
      }
    })
    pages.push({ systems })
  }

  if (rests.length === 0 && pages.length === 0 && layout === undefined) return {}

  // MNX requires a score rendering to be named, and the model has no name to
  // give: the source's work and movement titles are not converted (they are a
  // separate gap, and keep warning), so a fixed placeholder names the one
  // rendering written.
  return {
    scores: [
      {
        name: 'Score',
        ...(layout !== undefined ? { layout } : {}),
        ...(rests.length > 0 ? { multimeasureRests: rests } : {}),
        ...(pages.length > 0 ? { pages } : {}),
      },
    ],
  }
}

/**
 * The instrument grouping as a layout: one system-layout whose content nests
 * staff groups around staves. Written when the source draws groups, and also
 * when any part has more than one staff, because the braced grand staff is
 * something the part list does not state: parts[i].staves says two staves,
 * and nothing says they are one braced instrument with connected barlines.
 * A layout of bare single staves states nothing the part list does not, so
 * a score with neither gets none.
 *
 * The id is what a score names the layout by, and only a named layout is
 * reachable. One layout is written, so one fixed id names it.
 */
function writeLayouts(score: Score): MNXSystemLayout[] | undefined {
  const grouping: readonly GroupingItem[] =
    score.grouping.length > 0
      ? score.grouping
      : score.parts.some((part) => part.staves > 1)
        ? score.parts.map((part) => ({ kind: 'part', part: part.id }))
        : []
  if (grouping.length === 0) return undefined
  const parts = new Map(score.parts.map((part) => [part.id, part]))
  return [{ id: LAYOUT_ID, content: grouping.flatMap((item) => writeGroupingItem(item, parts)) }]
}

// Named apart from the measure ids ("m1"), the event ids ("ev1") and the note
// ids ("note1"). A part id passes through from the source, so a source that
// names a part "layout1" still collides; that exposure is the same one those
// three already carry and is not this name's to close.
const LAYOUT_ID = 'layout1'

function writeGroupingItem(
  item: GroupingItem,
  parts: ReadonlyMap<string, Part>,
): (MNXStaffGroup | MNXLayoutStaff)[] {
  if (item.kind === 'part') {
    const part = parts.get(item.part)
    /* v8 ignore next 2 -- the reader prunes every grouping part the score
       does not write, so the map covers the whole grouping. */
    if (part === undefined) throw new Error('A layout staff points at a part the score lacks.')
    // A renderer that honours a layout resolves labels from it, so each
    // staff points back at its part's name. labelref rather than label
    // keeps the name written once, on the part.
    const labelref =
      part.name !== undefined ? 'name' : part.shortName !== undefined ? 'shortName' : undefined
    if (part.staves === 1) {
      return [
        {
          type: 'staff',
          ...(labelref !== undefined ? { labelref } : {}),
          sources: [{ part: item.part }],
        },
      ]
    }
    // A multi-staff part is one instrument on several staves. MusicXML
    // leaves its grand staff implicit; MNX states it, so the staves go
    // inside a braced group carrying the part's name. The barlines are
    // stated too: the schema declares no default, so an absent barlineStyle
    // says nothing, and a consumer is free to draw each staff its own
    // barline. "instrument" is the grand staff's rule, connecting the
    // staves of one part.
    return [
      {
        type: 'group',
        symbol: 'brace',
        barlineStyle: 'instrument',
        ...(part.name !== undefined
          ? { label: part.name }
          : part.shortName !== undefined
            ? { label: part.shortName }
            : {}),
        content: Array.from({ length: part.staves }, (_, index) => ({
          type: 'staff',
          sources: [{ part: item.part, staff: index + 1 }],
        })),
      },
    ]
  }
  return [
    {
      type: 'group',
      ...(item.symbol !== undefined ? { symbol: item.symbol } : {}),
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.barlineStyle !== undefined ? { barlineStyle: item.barlineStyle } : {}),
      content: item.content.flatMap((inner) => writeGroupingItem(inner, parts)),
    },
  ]
}

/**
 * The two things about a document that can only be known once all of it has
 * been seen: which ids something points at, and whether any accidental is
 * drawn. Both are read off the finished model in one walk rather than
 * accumulated while it is built, so nothing has to be threaded through the
 * reader to be true by the time the writer asks.
 */
function surveyScore(score: Score): {
  referenced: ReadonlySet<string>
  drawsAccidentals: boolean
  measureIds: ReadonlyMap<number, string>
  lyricLines: ReadonlySet<string>
} {
  // Ids exist so that a tie or slur can point at something. Writing them on
  // everything else would be noise, so only the targets are named.
  const referenced = new Set<string>()
  let drawsAccidentals = false
  const lyricLines = new Set<string>()

  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.kind === 'tuplet' || item.kind === 'grace' || item.kind === 'multiNoteTremolo') {
        walk(item.content)
        continue
      }
      if (item.kind !== 'event') continue
      for (const slur of item.slurs) referenced.add(slur.target)
      for (const lyric of item.lyrics) lyricLines.add(lyric.line)
      for (const note of item.notes) {
        for (const tie of note.ties) if (tie.target !== undefined) referenced.add(tie.target)
        if (note.accidentalDisplay?.show) drawsAccidentals = true
      }
    }
  }
  // A beam names the events it runs over, so those events have to be named
  // in turn.
  const fromBeams = (beams: readonly Beam[]): void => {
    for (const beam of beams) {
      for (const id of beam.events) referenced.add(id)
      fromBeams(beam.beams)
    }
  }

  // A hairpin and an octave shift each point at the measure they stop in, a
  // multi-measure rest at the measure it starts in, and a system at the
  // measure it starts at, so those measures need naming. Deterministic, and
  // in score order. Any break at all writes the whole page structure, which
  // states the implicit first system, so measure one is named with it.
  const pointedAt = new Set<number>()
  const breaks = score.globalMeasures.some((measure) => measure.systemBreak || measure.pageBreak)
  score.globalMeasures.forEach((measure, index) => {
    if (measure.multimeasureRest !== undefined) pointedAt.add(index)
    if (breaks && (index === 0 || measure.systemBreak || measure.pageBreak)) pointedAt.add(index)
  })

  for (const part of score.parts) {
    for (const measure of part.measures) {
      fromBeams(measure.beams)
      for (const sequence of measure.sequences) walk(sequence.content)
      for (const dynamic of measure.dynamics) {
        if (dynamic.end) pointedAt.add(dynamic.end.measure)
      }
      for (const ottava of measure.ottavas) pointedAt.add(ottava.end.measure)
      // An arpeggio names the two notes it runs between, so those notes have
      // to be named in turn.
      for (const arpeggio of measure.arpeggios) {
        referenced.add(arpeggio.span.start)
        referenced.add(arpeggio.span.end)
      }
    }
  }

  const measureIds = new Map<number, string>()
  for (const index of [...pointedAt].sort((a, b) => a - b)) {
    measureIds.set(index, `m${String(index + 1)}`)
  }

  return { referenced, drawsAccidentals, measureIds, lyricLines }
}

/**
 * The verse lines in order, written only when there is more than one: the
 * order of a single line says nothing. The source numbers its verses, so
 * the numbering orders them; left to first appearance, a later-numbered
 * verse whose first syllable comes early would stack in the wrong place.
 */
function writeLyricLines(lines: ReadonlySet<string>): Partial<Pick<MNXGlobal, 'lyrics'>> {
  if (lines.size < 2) return {}
  const lineOrder = [...lines].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return { lyrics: { lineOrder } }
}

/**
 * The instrument setup, written only when the part list states one. Keyed by
 * the source's instrument id. The sound's midiNumber is never written: it is
 * a MIDI pitch backing a percussion kit, which nothing here converts yet.
 */
function writeSounds(score: Score): Partial<Pick<MNXGlobal, 'sounds'>> {
  if (score.sounds.size === 0) return {}
  return {
    sounds: Object.fromEntries(
      [...score.sounds].map(([id, sound]) => [
        id,
        { ...(sound.name !== undefined ? { name: sound.name } : {}) },
      ]),
    ),
  }
}

function writeGlobalMeasure(measure: GlobalMeasure, id: string | undefined): MNXGlobalMeasure {
  return {
    // Written only where something points at this measure, as a hairpin's end
    // does. Naming every measure would be noise.
    ...(id !== undefined ? { id } : {}),
    ...(measure.number !== undefined ? { number: measure.number } : {}),
    ...(measure.key ? { key: { fifths: measure.key.fifths } } : {}),
    ...(measure.time
      ? {
          time: {
            count: measure.time.count,
            unit: measure.time.unit,
            ...(measure.time.display ? { display: measure.time.display } : {}),
          },
        }
      : {}),
    ...(measure.tempos.length > 0 ? { tempos: measure.tempos.map(writeTempo) } : {}),
    ...(measure.barline ? { barline: { type: measure.barline } } : {}),
    // Opening a repeat is stated by the key being there at all.
    ...(measure.repeatStart ? { repeatStart: {} } : {}),
    ...(measure.repeatEnd
      ? {
          repeatEnd:
            measure.repeatEnd.times === undefined ? {} : { times: measure.repeatEnd.times },
        }
      : {}),
    ...(measure.ending ? { ending: writeEnding(measure.ending) } : {}),
    ...(measure.fermata ? { fermata: writeFermata(measure.fermata) } : {}),
    ...(measure.segno ? { segno: writeSegno(measure.segno) } : {}),
    ...(measure.fine ? { fine: writeFine(measure.fine) } : {}),
    ...(measure.jump ? { jump: writeJump(measure.jump) } : {}),
  }
}

function writeSegno(segno: Segno): MNXSegno {
  return {
    // MNX requires a segno to say where it sits, even at the measure's start.
    location: writePosition(segno.location),
    ...(segno.glyph !== undefined ? { glyph: segno.glyph } : {}),
    ...(segno.color !== undefined ? { color: segno.color } : {}),
  }
}

function writeFine(fine: Fine): MNXFine {
  return { location: writePosition(fine.location) }
}

function writeJump(jump: Jump): MNXJump {
  return { location: writePosition(jump.location), type: jump.type }
}

function writeEnding(ending: Ending): MNXEnding {
  return {
    duration: ending.duration,
    ...(ending.numbers.length > 0 ? { numbers: [...ending.numbers] } : {}),
    // A closed bracket is the ordinary one, so only an open one is stated.
    ...(ending.open ? { open: true } : {}),
  }
}

function writeTempo(tempo: Tempo): MNXTempo {
  return {
    value: writeNoteValue(tempo.value),
    bpm: tempo.bpm,
    // A tempo at the start of the measure needs no position.
    ...(tempo.position.num === 0 ? {} : { location: writePosition(tempo.position) }),
  }
}

function writePosition(position: Fraction): MNXRhythmicPosition {
  return { fraction: [position.num, position.den] }
}

function writePart(
  part: Part,
  referenced: ReadonlySet<string>,
  measureIds: ReadonlyMap<number, string>,
  withId: boolean,
): MNXPart {
  return {
    ...(withId ? { id: part.id } : {}),
    ...(part.name !== undefined ? { name: part.name } : {}),
    ...(part.shortName !== undefined ? { shortName: part.shortName } : {}),
    // One staff is the default, so saying so adds nothing.
    ...(part.staves > 1 ? { staves: part.staves } : {}),
    measures: part.measures.map((measure) => writeMeasure(measure, referenced, measureIds)),
  }
}

function writeMeasure(
  measure: Measure,
  referenced: ReadonlySet<string>,
  measureIds: ReadonlyMap<number, string>,
): MNXPartMeasure {
  return {
    ...(measure.clefs.length > 0 ? { clefs: measure.clefs.map(writeClef) } : {}),
    ...(measure.beams.length > 0 ? { beams: measure.beams.map(writeBeam) } : {}),
    ...(measure.dynamics.length > 0
      ? { dynamics: measure.dynamics.map((dynamic) => writeDynamic(dynamic, measureIds)) }
      : {}),
    // MNX keeps the two apart: a rolled chord and one bracketed as struck
    // together are opposite instructions, so they are separate lists.
    ...writeArpeggios(measure.arpeggios),
    ...(measure.measureRepeat !== undefined
      ? { measureRepeat: { number: measure.measureRepeat } }
      : {}),
    ...(measure.ottavas.length > 0
      ? {
          ottavas: measure.ottavas.map((ottava) => ({
            position: writePosition(ottava.position),
            end: writeSpanEnd(ottava.end, measureIds),
            value: ottava.value,
            ...(ottava.staff !== undefined ? { staff: ottava.staff } : {}),
            ...(ottava.orient !== undefined ? { orient: ottava.orient } : {}),
          })),
        }
      : {}),
    sequences: measure.sequences.map((sequence) => writeSequence(sequence, referenced)),
  }
}

function writeArpeggios(
  arpeggios: readonly Arpeggio[],
): Pick<MNXPartMeasure, 'arpeggios' | 'nonArpeggios'> {
  const rolled = arpeggios.filter((arpeggio) => !arpeggio.struck)
  const struck = arpeggios.filter((arpeggio) => arpeggio.struck)

  return {
    ...(rolled.length > 0
      ? {
          arpeggios: rolled.map((arpeggio) => ({
            position: writePosition(arpeggio.position),
            span: { ...arpeggio.span },
            direction: arpeggio.direction,
            // An arrowhead is the ordinary absence, so only its presence is
            // stated.
            ...(arpeggio.arrow ? { arrow: true } : {}),
          })),
        }
      : {}),
    ...(struck.length > 0
      ? {
          nonArpeggios: struck.map((arpeggio) => ({
            position: writePosition(arpeggio.position),
            span: { ...arpeggio.span },
          })),
        }
      : {}),
  }
}

/**
 * A dynamic mark. A hairpin is what makes one gradual rather than immediate,
 * and it points at the measure it stops in, which is why measures carry ids;
 * an accent is drawn from its combined glyph, with its spelling stated as the
 * attack value and the letters around it, and a two-stage one adding the
 * level it settles to as the residual. MNX reads an unstated accent letter as
 * the "s" and "z" of sfz, so only a letter that differs from those defaults
 * is written. The wording a source wraps the mark in goes over as the prefix
 * and suffix drawn around it.
 */
function writeDynamic(dynamic: Dynamic, measureIds: ReadonlyMap<number, string>): MNXDynamic {
  return {
    position: writePosition(dynamic.position),
    type: dynamic.wedge ? 'gradual' : dynamic.accent ? 'accent' : 'immediate',
    ...(dynamic.value ? { value: dynamic.value } : {}),
    ...(dynamic.accent?.residualValue ? { residualValue: dynamic.accent.residualValue } : {}),
    ...(dynamic.accent?.prefix !== undefined && dynamic.accent.prefix !== 's'
      ? { accentPrefix: dynamic.accent.prefix }
      : {}),
    ...(dynamic.accent?.suffix !== undefined && dynamic.accent.suffix !== 'z'
      ? { accentSuffix: dynamic.accent.suffix }
      : {}),
    ...(dynamic.accent ? { glyphs: [...dynamic.accent.glyphs] } : {}),
    ...(dynamic.prefix !== undefined ? { prefix: dynamic.prefix } : {}),
    ...(dynamic.suffix !== undefined ? { suffix: dynamic.suffix } : {}),
    ...(dynamic.wedge ? { wedgeType: dynamic.wedge } : {}),
    ...(dynamic.end ? { end: writeSpanEnd(dynamic.end, measureIds) } : {}),
    ...(dynamic.staff !== undefined ? { staff: dynamic.staff } : {}),
    ...(dynamic.orient ? { orient: dynamic.orient } : {}),
  }
}

function writeSpanEnd(
  end: { measure: number; position: Fraction },
  measureIds: ReadonlyMap<number, string>,
): MNXMeasureRhythmicPosition {
  const measure = measureIds.get(end.measure)
  /* v8 ignore next -- surveyScore names every measure a span ends in,
     which is where this map comes from. */
  if (measure === undefined) throw new Error('A span ends in a measure with no id.')

  return { measure, position: writePosition(end.position) }
}

function writeBeam(beam: Beam): MNXBeam {
  return {
    events: [...beam.events],
    ...(beam.beams.length > 0 ? { beams: beam.beams.map(writeBeam) } : {}),
    ...(beam.direction ? { direction: beam.direction } : {}),
  }
}

function writeClef(clef: Clef): MNXPositionedClef {
  return {
    clef: {
      sign: clef.sign,
      staffPosition: clef.staffPosition,
      // A transposed clef states its octave and asks for the number to be
      // drawn, as MusicXML always draws the 8 or 15 of a clef-octave-change.
      ...(clef.octave !== undefined ? { octave: clef.octave, showOctave: true } : {}),
    },
    // A clef at the start of the measure needs no position.
    ...(clef.position.num === 0 ? {} : { position: writePosition(clef.position) }),
    ...(clef.staff !== undefined ? { staff: clef.staff } : {}),
  }
}

function writeSequence(sequence: Sequence, referenced: ReadonlySet<string>): MNXSequence {
  return {
    ...(sequence.voice !== undefined ? { voice: sequence.voice } : {}),
    ...(sequence.staff !== undefined ? { staff: sequence.staff } : {}),
    content: sequence.content.map((item) => writeItem(item, referenced)),
    // A sequence that is a full-measure rest holds no events: the rest is
    // stated on the sequence itself.
    ...(sequence.fullMeasure ? { fullMeasure: writeFullMeasure(sequence.fullMeasure) } : {}),
  }
}

function writeFullMeasure(rest: FullMeasureRest): MNXFullMeasureRest {
  return {
    ...(rest.visualDuration ? { visualDuration: writeNoteValue(rest.visualDuration) } : {}),
    ...(rest.fermata ? { fermata: writeFermata(rest.fermata) } : {}),
    ...(rest.staffPosition !== undefined ? { staffPosition: rest.staffPosition } : {}),
  }
}

function writeItem(item: SequenceItem, referenced: ReadonlySet<string>): MNXSequenceItem {
  switch (item.kind) {
    // A space is time the voice passes over without sounding. MNX writes a
    // duration as a [numerator, denominator] pair.
    case 'space':
      return { type: 'space', duration: [item.duration.num, item.duration.den] }

    case 'tuplet':
      return {
        type: 'tuplet',
        inner: writeQuantity(item.inner),
        outer: writeQuantity(item.outer),
        content: item.content.map((inner) => writeItem(inner, referenced)),
        ...(item.bracket !== undefined ? { bracket: item.bracket } : {}),
        ...(item.showNumber !== undefined ? { showNumber: item.showNumber } : {}),
        ...(item.showValue !== undefined ? { showValue: item.showValue } : {}),
        ...(item.orient !== undefined ? { orient: item.orient } : {}),
      }

    case 'grace':
      return {
        type: 'grace',
        // Stated both ways: the schema declares no default for slash, so an
        // absent one is unspecified rather than false.
        slash: item.slashed,
        content: item.content.map((event) => writeEvent(event, referenced)),
      }

    case 'multiNoteTremolo':
      return {
        type: 'tremolo',
        marks: item.marks,
        outer: writeQuantity(item.outer),
        content: item.content.map((event) => writeEvent(event, referenced)),
      }

    default:
      return writeEvent(item, referenced)
  }
}

function writeQuantity(quantity: NoteValueQuantity): MNXNoteValueQuantity {
  return { duration: writeNoteValue(quantity.value), multiple: quantity.multiple }
}

function writeEvent(event: Event, referenced: ReadonlySet<string>): MNXEvent {
  return {
    ...(referenced.has(event.id) ? { id: event.id } : {}),
    ...(event.staff !== undefined ? { staff: event.staff } : {}),
    duration: writeNoteValue(event.value),
    // A rest is marked by the presence of the object, not by a flag; its height
    // rides on it where the source fixed one.
    ...(event.isRest
      ? { rest: event.staffPosition !== undefined ? { staffPosition: event.staffPosition } : {} }
      : { notes: event.notes.map((note) => writeNote(note, referenced)) }),
    ...(event.slurs.length > 0
      ? {
          slurs: event.slurs.map((slur) => ({
            target: slur.target,
            ...(slur.side ? { side: slur.side } : {}),
            ...(slur.sideEnd ? { sideEnd: slur.sideEnd } : {}),
            ...(slur.lineType ? { lineType: slur.lineType } : {}),
          })),
        }
      : {}),
    ...(event.stemDirection ? { stemDirection: event.stemDirection } : {}),
    ...(event.markings.length > 0 ? { markings: writeMarkings(event.markings) } : {}),
    ...(event.fermata ? { fermata: writeFermata(event.fermata) } : {}),
    ...(event.lyrics.length > 0 ? { lyrics: writeLyrics(event.lyrics) } : {}),
  }
}

/**
 * The marks on an event, as MNX keys them: by name, so a note carries at most
 * one of each. Two of them hold more than which side they sit on, and both
 * are written out rather than folded into the others, because MNX allows no
 * property on a mark beyond the ones it names for that mark.
 */
function writeMarkings(markings: readonly Marking[]): MNXEventMarkings {
  const written: MNXEventMarkings = {}

  for (const marking of markings) {
    const orient = marking.orient ? { orient: marking.orient } : {}
    switch (marking.kind) {
      case 'strongAccent':
        written.strongAccent = {
          ...orient,
          ...(marking.pointing ? { pointing: marking.pointing } : {}),
        }
        break
      case 'breath':
        written.breath = { ...orient, ...(marking.symbol ? { symbol: marking.symbol } : {}) }
        break
      case 'tremolo':
        /* v8 ignore next -- the reader states a beam count on every tremolo
           marking, so the writer states it rather than defaulting it here. */
        if (marking.marks === undefined) throw new Error('A tremolo marking carries no beam count.')
        written.tremolo = { ...orient, marks: marking.marks }
        break
      default:
        written[marking.kind] = orient
    }
  }
  return written
}

function writeFermata(fermata: Fermata): MNXFermata {
  return {
    ...(fermata.symbol ? { symbol: fermata.symbol } : {}),
    ...(fermata.pointing ? { pointing: fermata.pointing } : {}),
    ...(fermata.orient ? { orient: fermata.orient } : {}),
  }
}

function writeLyrics(lyrics: readonly Lyric[]): MNXLyrics {
  const lines: Record<string, MNXLyricLine> = {}
  for (const lyric of lyrics) {
    lines[lyric.line] = {
      text: lyric.text,
      ...(lyric.type ? { type: lyric.type } : {}),
    }
  }
  return { lines }
}

function writeNoteValue(value: NoteValue): MNXNoteValue {
  return {
    base: value.base,
    ...(value.dots > 0 ? { dots: value.dots } : {}),
  }
}

function writeNote(note: Note, referenced: ReadonlySet<string>): MNXNote {
  return {
    ...(referenced.has(note.id) ? { id: note.id } : {}),
    pitch: writePitch(note.pitch),
    ...(note.ties.length > 0
      ? {
          ties: note.ties.map((tie) => ({
            // A let-ring tie has no target: it rings out with no ending note.
            ...(tie.target !== undefined ? { target: tie.target } : {}),
            // Left unsaid for the ordinary tie, whose target is the same
            // voice's next note.
            ...(tie.crossVoice ? { targetType: 'crossVoice' as const } : {}),
            ...(tie.lv ? { lv: true } : {}),
            ...(tie.side ? { side: tie.side } : {}),
          })),
        }
      : {}),
    ...(note.accidentalDisplay
      ? { accidentalDisplay: writeAccidental(note.accidentalDisplay) }
      : {}),
  }
}

function writeAccidental(display: AccidentalDisplay): MNXAccidentalDisplay {
  return {
    show: display.show,
    ...(display.enclosure ? { enclosure: { symbol: display.enclosure } } : {}),
    ...(display.force ? { force: true } : {}),
  }
}

function writePitch(pitch: Pitch): MNXPitch {
  return {
    step: pitch.step,
    octave: pitch.octave,
    // Zero is the default, so writing it would be noise.
    ...(pitch.alter !== 0 ? { alter: pitch.alter } : {}),
  }
}
