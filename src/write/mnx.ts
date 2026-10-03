// Writes the score model out as an MNX document. Everything this
// converter knows about MNX's encoding lives at or above this file.
//
// The reader has already resolved MusicXML's ambiguities, so this is a walk
// with a few shape decisions. Optional keys are omitted, not set to null,
// because MNX distinguishes an absent key from a present one.

import type { Fraction } from '../fraction.js'
import { LAYOUT_ID, countedId } from '../ids.js'
import type {
  AccidentalDisplay,
  Arpeggio,
  Beam,
  Clef,
  Dynamic,
  Lyric,
  KitComponent,
  KitNote,
  Marking,
  Markings,
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
  StaffConfig,
  NoteValueQuantity,
  Sequence,
  SequenceItem,
  Tempo,
  Tie,
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
  MNXPositionedStaffConfig,
  MNXNoteValueQuantity,
  MNXSequence,
  MNXSequenceItem,
  MNXBeam,
  MNXLyricLine,
  MNXLyrics,
  MNXAccidentalDisplay,
  MNXDynamic,
  MNXEventMarkings,
  MNXKitComponent,
  MNXKitNote,
  MNXMarking,
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
  MNXTie,
} from '../types/mnx.js'

/** The MNX version this converter emits. */
const MNX_VERSION = 1

/** What the one score rendering is called where the caller names none. */
const DEFAULT_SCORE_NAME = 'Score'

/** What a caller can say about the document written. */
export interface WriterOptions {
  /** See `ConversionOptions.scoreName`. */
  scoreName?: string
}

/**
 * The measure ids. MNX states a measure's id on the global measure, and a
 * multi-measure rest, a system, a hairpin or an octave shift points at it.
 * Asking for an id with `of` marks it, and the global block writes only the
 * marked ids.
 */
class MeasureNames {
  readonly #named = new Set<number>()

  /** What a measure at this index goes under, named or not. */
  #id(index: number): string {
    return countedId('measure', index + 1)
  }

  /** The id of the measure at this index, which is written out for it. */
  of(index: number): string {
    this.#named.add(index)
    return this.#id(index)
  }

  /** The id to write on this measure, where anything named it. It does not
   * add to the record, so the global block must be written last. */
  written(index: number): string | undefined {
    return this.#named.has(index) ? this.#id(index) : undefined
  }
}

export function writeMnx(score: Score, options: WriterOptions = {}): MNXDocument {
  const survey = surveyScore(score)
  const layouts = writeLayouts(score)

  // A source can declare that the accidentals it draws, or the beams it
  // writes, are all of them, so a renderer adds none. The declaration holds
  // for a score that beams nothing, so it wins over what the survey finds.
  // Without one, the flag follows what the source wrote.
  const useAccidentalDisplay = score.declaresAccidentals ?? survey.drawsAccidentals
  const useBeams = score.declaresBeams ?? survey.writesBeams

  // Written before the global block, because what they point at is what
  // decides which measures the global block names.
  const names = new MeasureNames()
  // Every part carries its id once a layout is written, so the layout's
  // staff sources have something to point at. The id is written verbatim:
  // the reader renames any part id MNX's id pattern cannot state.
  const parts = score.parts.map((part) =>
    writePart(part, survey.referenced, names, layouts !== undefined, score.musicFont),
  )
  const scores = writeScores(
    score,
    names,
    layouts?.[0]?.id,
    options.scoreName ?? DEFAULT_SCORE_NAME,
  )
  const measures = score.globalMeasures.map((measure, index) =>
    writeGlobalMeasure(measure, names.written(index)),
  )

  return {
    mnx: {
      version: MNX_VERSION,
      ...(useAccidentalDisplay || useBeams
        ? {
            support: {
              ...(useAccidentalDisplay ? { useAccidentalDisplay: true } : {}),
              ...(useBeams ? { useBeams: true } : {}),
            },
          }
        : {}),
    },
    global: {
      measures,
      ...writeLyricLines(survey.lyricLines),
      ...writeSounds(score),
    },
    ...(layouts ? { layouts } : {}),
    parts,
    ...scores,
  }
}

/**
 * The scores object: one score, written when the source draws a
 * multi-measure rest or states a system or page break, or when the document
 * has a layout. Those are the only things this converter states on it.
 *
 * A score is the only thing that can name a layout, so a document with a
 * layout needs one even with nothing else to say.
 */
function writeScores(
  score: Score,
  names: MeasureNames,
  layout: string | undefined,
  name: string,
): Pick<MNXDocument, 'scores'> {
  const rests = score.globalMeasures.flatMap((measure, index) => {
    if (measure.multimeasureRest === undefined) return []
    return [{ start: names.of(index), duration: measure.multimeasureRest }]
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
        systems.push({ measure: names.of(index) })
      }
    })
    pages.push({ systems })
  }

  if (rests.length === 0 && pages.length === 0 && layout === undefined) return {}

  // MNX requires a score name. A work's title names the work, not a score of
  // it, so the caller's name is used, else a placeholder.
  return {
    scores: [
      {
        name,
        ...(layout !== undefined ? { layout } : {}),
        ...(rests.length > 0 ? { multimeasureRests: rests } : {}),
        ...(pages.length > 0 ? { pages } : {}),
      },
    ],
  }
}

/**
 * The instrument grouping as a layout: one system layout whose content nests
 * staff groups around staves. Written when the source draws groups, or when
 * any part has more than one staff: parts[i].staves says two staves, but only
 * a layout says they are one braced instrument with connected barlines. A
 * score with neither gets no layout.
 *
 * A score names the layout by its id. One layout is written, so one fixed id
 * names it.
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

/**
 * The braced group a multi-staff part draws. MusicXML leaves the grand staff
 * implicit; MNX states it, as a braced group with the part's name. The
 * barline style is stated because the schema declares no default for it.
 * "instrument" connects the staves of one part.
 */
function writeGrandStaff(part: Part, id: string): MNXStaffGroup {
  return {
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
      sources: [{ part: id, staff: index + 1 }],
    })),
  }
}

function writeGroupingItem(
  item: GroupingItem,
  parts: ReadonlyMap<string, Part>,
): (MNXStaffGroup | MNXLayoutStaff)[] {
  if (item.kind === 'part') {
    const part = parts.get(item.part)
    /* v8 ignore next 2 -- the reader prunes every grouping part the score
       does not write, so the map covers the whole grouping. */
    if (part === undefined) throw new Error('A layout staff points at a part the score lacks.')
    if (part.staves > 1) return [writeGrandStaff(part, item.part)]

    // A renderer reads staff labels from the layout, so each staff points at
    // its part's name with labelref. The name stays written once, on the part.
    const labelref =
      part.name !== undefined ? 'name' : part.shortName !== undefined ? 'shortName' : undefined
    return [
      {
        type: 'staff',
        ...(labelref !== undefined ? { labelref } : {}),
        sources: [{ part: item.part }],
      },
    ]
  }
  // A brace group holding one multi-staff part restates the part's own grand
  // staff, and nested, a renderer draws two braces. The two fold into one
  // group, with the source group's label and barline style where it states
  // them.
  const only = item.content.length === 1 ? item.content[0] : undefined
  if (item.symbol === 'brace' && only?.kind === 'part') {
    const part = parts.get(only.part)
    if (part !== undefined && part.staves > 1) {
      return [
        {
          ...writeGrandStaff(part, only.part),
          ...(item.label !== undefined ? { label: item.label } : {}),
          ...(item.barlineStyle !== undefined ? { barlineStyle: item.barlineStyle } : {}),
        },
      ]
    }
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
 * What can only be known once the whole document is seen: which ids something
 * points at, whether any accidental is drawn or any beam written, and which
 * verse lines are sung. Read off the finished model in one walk.
 */
function surveyScore(score: Score): {
  referenced: ReadonlySet<string>
  drawsAccidentals: boolean
  writesBeams: boolean
  lyricLines: ReadonlySet<string>
} {
  // Only the ids that something points at are written.
  const referenced = new Set<string>()
  let drawsAccidentals = false
  let writesBeams = false
  const lyricLines = new Set<string>()

  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.kind === 'tuplet' || item.kind === 'grace' || item.kind === 'multiNoteTremolo') {
        walk(item.content)
        continue
      }
      if (item.kind !== 'event') continue
      for (const slur of item.slurs) referenced.add(slur.target)
      for (const line of item.lyrics.keys()) lyricLines.add(line)
      for (const note of item.notes) {
        for (const tie of note.ties) if (tie.target !== undefined) referenced.add(tie.target)
        if (note.accidentalDisplay?.show) drawsAccidentals = true
      }
      // A kit note is tied the same way, and the note a tie names has to be
      // named in turn whether it carries a pitch or a kit component.
      for (const note of item.kitNotes) {
        for (const tie of note.ties) if (tie.target !== undefined) referenced.add(tie.target)
      }
    }
  }
  // A beam names the events it runs over, so those events have to be named
  // in turn.
  const fromBeams = (beams: readonly Beam[]): void => {
    for (const beam of beams) {
      writesBeams = true
      for (const id of beam.events) referenced.add(id)
      fromBeams(beam.beams)
    }
  }

  for (const part of score.parts) {
    for (const measure of part.measures) {
      fromBeams(measure.beams)
      for (const sequence of measure.sequences) walk(sequence.content)
      // An arpeggio names the two notes it runs between, so those notes have
      // to be named in turn.
      for (const arpeggio of measure.arpeggios) {
        referenced.add(arpeggio.span.start)
        referenced.add(arpeggio.span.end)
      }
    }
  }

  return { referenced, drawsAccidentals, writesBeams, lyricLines }
}

/**
 * The verse lines in order, written only when there is more than one. They
 * sort by the source's verse number, not by first appearance, because a
 * later verse can start earlier in the score.
 */
function writeLyricLines(lines: ReadonlySet<string>): Partial<Pick<MNXGlobal, 'lyrics'>> {
  if (lines.size < 2) return {}
  const lineOrder = [...lines].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return { lyrics: { lineOrder } }
}

/**
 * The instrument setup, written only when the part list states one. Keyed by
 * the source's instrument id, which is what a kit component names to say what
 * plays it.
 */
function writeSounds(score: Score): Partial<Pick<MNXGlobal, 'sounds'>> {
  if (score.sounds.size === 0) return {}
  return {
    sounds: Object.fromEntries(
      [...score.sounds].map(([id, sound]) => [
        id,
        {
          ...(sound.name !== undefined ? { name: sound.name } : {}),
          ...(sound.midiNumber !== undefined ? { midiNumber: sound.midiNumber } : {}),
        },
      ]),
    ),
  }
}

function writeGlobalMeasure(measure: GlobalMeasure, id: string | undefined): MNXGlobalMeasure {
  return {
    // Written only where something points at this measure, as a hairpin's end
    // does.
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
    // Opening a repeat is stated by the key being there.
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
  names: MeasureNames,
  withId: boolean,
  musicFont: string | undefined,
): MNXPart {
  return {
    ...(withId ? { id: part.id } : {}),
    ...(part.name !== undefined ? { name: part.name } : {}),
    ...(part.shortName !== undefined ? { shortName: part.shortName } : {}),
    // One staff is the default.
    ...(part.staves > 1 ? { staves: part.staves } : {}),
    // MusicXML names the notation font once for the score, MNX per part, so
    // the one font goes on every part.
    ...(musicFont !== undefined ? { smuflFont: musicFont } : {}),
    ...(part.transposition
      ? {
          transposition: {
            interval: {
              halfSteps: part.transposition.halfSteps,
              staffDistance: part.transposition.staffDistance,
            },
            // MNX reads an absent point as a part that never flips, so it is
            // written only for a part that does.
            ...(part.transposition.keyFifthsFlipAt !== undefined
              ? { keyFifthsFlipAt: part.transposition.keyFifthsFlipAt }
              : {}),
          },
        }
      : {}),
    ...(part.kit.size > 0 ? { kit: writeKit(part.kit) } : {}),
    measures: part.measures.map((measure) => writeMeasure(measure, referenced, names)),
  }
}

/**
 * The percussion instruments a part is struck on, keyed by what its kit notes
 * name. MusicXML states where a component sits on every note struck on it and
 * MNX states it once here, which is why the reader gathers them.
 */
function writeKit(kit: ReadonlyMap<string, KitComponent>): Record<string, MNXKitComponent> {
  return Object.fromEntries(
    [...kit].map(([id, component]) => [
      id,
      {
        ...(component.name !== undefined ? { name: component.name } : {}),
        ...(component.sound !== undefined ? { sound: component.sound } : {}),
        staffPosition: component.staffPosition,
      },
    ]),
  )
}

function writeMeasure(
  measure: Measure,
  referenced: ReadonlySet<string>,
  names: MeasureNames,
): MNXPartMeasure {
  return {
    ...(measure.clefs.length > 0 ? { clefs: measure.clefs.map(writeClef) } : {}),
    ...(measure.staffConfigs.length > 0
      ? { staffConfigs: measure.staffConfigs.map(writeStaffConfig) }
      : {}),
    ...(measure.beams.length > 0 ? { beams: measure.beams.map(writeBeam) } : {}),
    ...(measure.dynamics.length > 0
      ? { dynamics: measure.dynamics.map((dynamic) => writeDynamic(dynamic, names)) }
      : {}),
    // MNX states rolled chords and chords bracketed as struck together in
    // separate lists.
    ...writeArpeggios(measure.arpeggios),
    ...(measure.measureRepeat !== undefined
      ? { measureRepeat: { number: measure.measureRepeat } }
      : {}),
    ...(measure.ottavas.length > 0
      ? {
          ottavas: measure.ottavas.map((ottava) => ({
            position: writePosition(ottava.position),
            end: writeSpanEnd(ottava.end, names),
            value: ottava.value,
            ...(ottava.staff !== undefined ? { staff: ottava.staff } : {}),
            ...(ottava.placement !== undefined ? { placement: ottava.placement } : {}),
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
            // No arrowhead is the default, so only its presence is stated.
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
 * A dynamic mark. A hairpin is gradual, and its end names the measure it
 * stops in. An accent states its glyphs, its attack value and the letters
 * around it, and a two-stage accent adds the level it settles to as the
 * residual. MNX reads an unstated accent letter as the "s" and "z" of sfz, so
 * only a letter that differs is written.
 */
function writeDynamic(dynamic: Dynamic, names: MeasureNames): MNXDynamic {
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
    ...(dynamic.end ? { end: writeSpanEnd(dynamic.end, names) } : {}),
    ...(dynamic.staff !== undefined ? { staff: dynamic.staff } : {}),
    ...(dynamic.placement ? { placement: dynamic.placement } : {}),
  }
}

function writeSpanEnd(
  end: { measure: number; position: Fraction; graceIndex?: number },
  names: MeasureNames,
): MNXMeasureRhythmicPosition {
  const measure = names.of(end.measure)

  return {
    measure,
    position: {
      ...writePosition(end.position),
      ...(end.graceIndex !== undefined ? { graceIndex: end.graceIndex } : {}),
    },
  }
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
      ...(clef.hide ? { hide: true } : {}),
    },
    // A clef at the start of the measure needs no position.
    ...(clef.position.num === 0 ? {} : { position: writePosition(clef.position) }),
    ...(clef.staff !== undefined ? { staff: clef.staff } : {}),
  }
}

function writeStaffConfig(config: StaffConfig): MNXPositionedStaffConfig {
  return {
    config: { lines: config.lines },
    // A config taking effect at the start of the measure needs no position.
    ...(config.position.num === 0 ? {} : { position: writePosition(config.position) }),
    ...(config.staff !== undefined ? { staff: config.staff } : {}),
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
        ...(item.placement !== undefined ? { placement: item.placement } : {}),
      }

    case 'grace':
      return {
        type: 'grace',
        // Stated both ways, because MNX reads an absent slash as a slash.
        slash: item.slashed,
        // Left out where the source says nothing. MNX then reads the group as
        // taking its time from the note before, its default. MusicXML states
        // no default of its own.
        ...(item.graceType !== undefined ? { graceType: item.graceType } : {}),
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
    // rides on it where the source fixed one. An event is a rest or it sounds,
    // never both, and what it sounds is pitches, kit components, or both at
    // once, which is a chord struck across a pitched staff and a kit.
    ...(event.isRest
      ? { rest: event.staffPosition !== undefined ? { staffPosition: event.staffPosition } : {} }
      : {
          ...(event.kitNotes.length === 0 || event.notes.length > 0
            ? { notes: event.notes.map((note) => writeNote(note, referenced)) }
            : {}),
          ...(event.kitNotes.length > 0
            ? { kitNotes: event.kitNotes.map((note) => writeKitNote(note, referenced)) }
            : {}),
        }),
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
    ...(hasMarking(event.markings) ? { markings: writeMarkings(event.markings) } : {}),
    ...(event.fermata ? { fermata: writeFermata(event.fermata) } : {}),
    ...(event.lyrics.size > 0 ? { lyrics: writeLyrics(event.lyrics) } : {}),
  }
}

/** True where the event carries any mark. */
function hasMarking(markings: Markings): boolean {
  return Object.values(markings).some((marking) => marking !== undefined)
}

/** Which side a mark sits on, as MNX states it: left off where unstated. */
function writeMarking(marking: Marking): MNXMarking {
  return marking.placement ? { placement: marking.placement } : {}
}

/**
 * The marks on an event, keyed by name in both the model and MNX. Four of
 * them hold more than which side they sit on, and a caesura states no side.
 * Each is written out separately, because MNX allows no property on a mark
 * beyond the ones it names for that mark.
 */
function writeMarkings(markings: Markings): MNXEventMarkings {
  const { strongAccent, bowDirection, breath, tremolo, caesura } = markings
  const written: MNXEventMarkings = {}

  // The eight that state nothing beyond which side they sit on.
  if (markings.accent) written.accent = writeMarking(markings.accent)
  if (markings.staccato) written.staccato = writeMarking(markings.staccato)
  if (markings.staccatissimo) written.staccatissimo = writeMarking(markings.staccatissimo)
  if (markings.tenuto) written.tenuto = writeMarking(markings.tenuto)
  if (markings.spiccato) written.spiccato = writeMarking(markings.spiccato)
  if (markings.stress) written.stress = writeMarking(markings.stress)
  if (markings.unstress) written.unstress = writeMarking(markings.unstress)
  if (markings.softAccent) written.softAccent = writeMarking(markings.softAccent)

  if (strongAccent) {
    written.strongAccent = {
      ...writeMarking(strongAccent),
      ...(strongAccent.pointing ? { pointing: strongAccent.pointing } : {}),
    }
  }
  // MNX states no bow mark without a direction, and neither does the model.
  if (bowDirection) {
    written.bowDirection = { ...writeMarking(bowDirection), direction: bowDirection.direction }
  }
  if (breath) {
    written.breath = {
      ...writeMarking(breath),
      ...(breath.symbol ? { symbol: breath.symbol } : {}),
    }
  }
  // MNX states no tremolo without a beam count, and neither does the model.
  if (tremolo) written.tremolo = { ...writeMarking(tremolo), marks: tremolo.marks }
  // A caesura states no side.
  if (caesura) {
    written.caesura = {
      ...(caesura.marks ? { marks: caesura.marks } : {}),
      ...(caesura.shape ? { shape: caesura.shape } : {}),
    }
  }

  return written
}

function writeFermata(fermata: Fermata): MNXFermata {
  return {
    ...(fermata.symbol ? { symbol: fermata.symbol } : {}),
    ...(fermata.pointing ? { pointing: fermata.pointing } : {}),
    ...(fermata.placement ? { placement: fermata.placement } : {}),
  }
}

// The model is keyed by line as MNX is, so nothing here can replace a line
// already written.
function writeLyrics(lyrics: ReadonlyMap<string, Lyric>): MNXLyrics {
  const lines: Record<string, MNXLyricLine> = {}
  for (const [line, lyric] of lyrics) {
    lines[line] = {
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

/** A note struck on a kit component, which names it in place of a pitch. */
function writeKitNote(note: KitNote, referenced: ReadonlySet<string>): MNXKitNote {
  return {
    ...(referenced.has(note.id) ? { id: note.id } : {}),
    kitComponent: note.component,
    ...(note.staff !== undefined ? { staff: note.staff } : {}),
    ...(note.ties.length > 0 ? { ties: writeTies(note.ties) } : {}),
  }
}

function writeNote(note: Note, referenced: ReadonlySet<string>): MNXNote {
  return {
    ...(referenced.has(note.id) ? { id: note.id } : {}),
    pitch: writePitch(note.pitch),
    ...(note.staff !== undefined ? { staff: note.staff } : {}),
    ...(note.ties.length > 0 ? { ties: writeTies(note.ties) } : {}),
    ...(note.accidentalDisplay
      ? { accidentalDisplay: writeAccidental(note.accidentalDisplay) }
      : {}),
  }
}

function writeTies(ties: readonly Tie[]): MNXTie[] {
  return ties.map((tie) => ({
    // A let-ring tie has no target: it rings out with no ending note.
    ...(tie.target !== undefined ? { target: tie.target } : {}),
    // Left unsaid for the ordinary tie, whose target is the same voice's next
    // note.
    ...(tie.crossVoice ? { targetType: 'crossVoice' as const } : {}),
    ...(tie.lv ? { lv: true } : {}),
    ...(tie.side ? { side: tie.side } : {}),
  }))
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
    // Zero is the default.
    ...(pitch.alter !== 0 ? { alter: pitch.alter } : {}),
  }
}
