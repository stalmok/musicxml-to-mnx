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
  /**
   * The name of the score rendering the output writes. MNX requires one to be
   * named, and MusicXML has nothing that answers it: a work's title names the
   * work, not a rendering of it. Defaults to "Score".
   */
  scoreName?: string
}

/**
 * The ids measures go under. MNX writes a measure's id on the measure
 * itself, in the global block, and everything else points at it, so asking
 * for one is what makes it written: a rest, a system, a hairpin or an octave
 * shift names the measure it reaches, and the global block then writes the
 * ids that were named. Nothing can point at a measure left unnamed.
 */
class MeasureNames {
  readonly #named = new Set<number>()

  /** What a measure at this index goes under, named or not. */
  #id(index: number): string {
    return `m${String(index + 1)}`
  }

  /** The id of the measure at this index, which is written out for it. */
  of(index: number): string {
    this.#named.add(index)
    return this.#id(index)
  }

  /** The id to write on this measure, where anything named it. Reads the
   * record rather than adding to it, so writing the global block early would
   * write no ids rather than quietly write the wrong ones. */
  written(index: number): string | undefined {
    return this.#named.has(index) ? this.#id(index) : undefined
  }
}

export function writeMnx(score: Score, options: WriterOptions = {}): MNXDocument {
  const survey = surveyScore(score)
  const layouts = writeLayouts(score)

  // What the source declared, where it declared anything: the accidentals it
  // draws, or the beams it writes, are the whole of them, so a reader marks
  // no others and beams by no rule of its own. The declaration holds for a
  // score that beams nothing on purpose, which is why it is not read off the
  // output. A source that declared nothing is taken at what it wrote.
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

  // MNX requires a score rendering to be named. The model has no name to
  // give: the source's work and movement titles are not converted (they are a
  // separate gap, and keep warning), and a work's title names the work rather
  // than a rendering of it. So the caller's name is used, and a placeholder
  // where the caller states none.
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
// ids ("note1"). A part id passes through from the source, so a source naming
// a part any of the four would name two things at once; the reader renames
// such a part, holding GENERATED_ID_PATTERN to what is written here.
const LAYOUT_ID = 'layout1'

/**
 * The braced group a multi-staff part draws. MusicXML leaves the grand staff
 * implicit; MNX states it, so the staves go inside a braced group carrying
 * the part's name. The barlines are stated too: the schema declares no
 * default, so an absent barlineStyle says nothing, and a consumer is free to
 * draw each staff its own barline. "instrument" is the grand staff's rule,
 * connecting the staves of one part.
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

    // A renderer that honours a layout resolves labels from it, so each
    // staff points back at its part's name. labelref rather than label
    // keeps the name written once, on the part.
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
  // A brace group holding exactly one multi-staff part restates the grand
  // staff the part gets on its own, and nested, a renderer draws two braces
  // side by side. The two fold into one group: the source's label and
  // barline run where it states them, the part's where it does not.
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
 * The two things about a document that can only be known once all of it has
 * been seen: which ids something points at, and whether any accidental is
 * drawn. Both are read off the finished model in one walk rather than
 * accumulated while it is built, so nothing has to be threaded through the
 * reader to be true by the time the writer asks.
 */
function surveyScore(score: Score): {
  referenced: ReadonlySet<string>
  drawsAccidentals: boolean
  writesBeams: boolean
  lyricLines: ReadonlySet<string>
} {
  // Ids exist so that a tie or slur can point at something. Writing them on
  // everything else would be noise, so only the targets are named.
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
  names: MeasureNames,
  withId: boolean,
  musicFont: string | undefined,
): MNXPart {
  return {
    ...(withId ? { id: part.id } : {}),
    ...(part.name !== undefined ? { name: part.name } : {}),
    ...(part.shortName !== undefined ? { shortName: part.shortName } : {}),
    // One staff is the default, so saying so adds nothing.
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
            end: writeSpanEnd(ottava.end, names),
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
    ...(dynamic.orient ? { orient: dynamic.orient } : {}),
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
      ...(clef.glyph !== undefined ? { glyph: clef.glyph } : {}),
      // A transposed clef states its octave and asks for the number to be
      // drawn, as MusicXML always draws the 8 or 15 of a clef-octave-change.
      ...(clef.octave !== undefined ? { octave: clef.octave, showOctave: true } : {}),
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
        ...(item.orient !== undefined ? { orient: item.orient } : {}),
      }

    case 'grace':
      return {
        type: 'grace',
        // Stated both ways, because MNX reads an absent slash as a slash.
        slash: item.slashed,
        // Left out where the source says nothing. MNX then reads the group as
        // taking its time from the note before, which is its default for an
        // unstated one, and MusicXML states no default of its own to carry.
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

/** True where the event carries any mark at all. */
function hasMarking(markings: Markings): boolean {
  return Object.values(markings).some((marking) => marking !== undefined)
}

/** Which side a mark sits on, as MNX states it: left off where unstated. */
function writeMarking(marking: Marking): MNXMarking {
  return marking.orient ? { orient: marking.orient } : {}
}

/**
 * The marks on an event, as MNX keys them: by name, so a note carries at most
 * one of each. The model is keyed the same way, so this is a transcription
 * rather than a merge, and nothing here can replace a mark already written.
 * Four of them hold more than which side they sit on, and each is written out
 * rather than folded into the others, because MNX allows no property on a mark
 * beyond the ones it names for that mark.
 */
function writeMarkings(markings: Markings): MNXEventMarkings {
  const { strongAccent, bowDirection, breath, tremolo } = markings
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
  // MNX states no tremolo without a beam count, and the model states none
  // either, so there is nothing to check for here.
  if (tremolo) written.tremolo = { ...writeMarking(tremolo), marks: tremolo.marks }

  return written
}

function writeFermata(fermata: Fermata): MNXFermata {
  return {
    ...(fermata.symbol ? { symbol: fermata.symbol } : {}),
    ...(fermata.pointing ? { pointing: fermata.pointing } : {}),
    ...(fermata.orient ? { orient: fermata.orient } : {}),
  }
}

// The model is keyed by line exactly as MNX is, so nothing here can replace a
// line already written.
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
    // Zero is the default, so writing it would be noise.
    ...(pitch.alter !== 0 ? { alter: pitch.alter } : {}),
  }
}
