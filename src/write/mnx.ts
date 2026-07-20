// Writes the neutral score model out as an MNX document. Everything this
// converter knows about MNX's encoding lives at or above this file.
//
// Thin by design: the reader has already resolved MusicXML's ambiguities, so
// this is a walk with a few shape decisions. Optional keys are omitted rather
// than set to null, because MNX distinguishes an absent key from a present one.

import type { Fraction } from '../fraction.js'
import type {
  AccidentalDisplay,
  Beam,
  Clef,
  Dynamic,
  Lyric,
  Marking,
  Ending,
  Event,
  Fermata,
  GlobalMeasure,
  Measure,
  Note,
  NoteValue,
  Part,
  Pitch,
  Score,
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
  MNXRhythmicPosition,
  MNXTempo,
} from '../types/mnx.js'

/** The MNX version this converter emits. */
const MNX_VERSION = 1

export function writeMnx(score: Score): MNXDocument {
  const survey = surveyScore(score)

  return {
    mnx: {
      version: MNX_VERSION,
      // Declared once the document draws any accidental explicitly, so a
      // reader takes the marked notes as the whole of it.
      ...(survey.drawsAccidentals ? { support: { useAccidentalDisplay: true } } : {}),
    },
    global: { measures: score.globalMeasures.map(writeGlobalMeasure) },
    parts: score.parts.map((part) => writePart(part, survey.referenced)),
  }
}

/**
 * The two things about a document that can only be known once all of it has
 * been seen: which ids something points at, and whether any accidental is
 * drawn. Both are read off the finished model in one walk rather than
 * accumulated while it is built, so nothing has to be threaded through the
 * reader to be true by the time the writer asks.
 */
function surveyScore(score: Score): { referenced: ReadonlySet<string>; drawsAccidentals: boolean } {
  // Ids exist so that a tie or slur can point at something. Writing them on
  // everything else would be noise, so only the targets are named.
  const referenced = new Set<string>()
  let drawsAccidentals = false

  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.kind === 'tuplet' || item.kind === 'grace') {
        walk(item.content)
        continue
      }
      if (item.kind !== 'event') continue
      for (const slur of item.slurs) referenced.add(slur.target)
      for (const note of item.notes) {
        for (const tie of note.ties) referenced.add(tie.target)
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

  for (const part of score.parts) {
    for (const measure of part.measures) {
      fromBeams(measure.beams)
      for (const sequence of measure.sequences) walk(sequence.content)
    }
  }
  return { referenced, drawsAccidentals }
}

function writeGlobalMeasure(measure: GlobalMeasure): MNXGlobalMeasure {
  return {
    ...(measure.number !== undefined ? { number: measure.number } : {}),
    ...(measure.key ? { key: { fifths: measure.key.fifths } } : {}),
    ...(measure.time ? { time: { count: measure.time.count, unit: measure.time.unit } } : {}),
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
  }
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

function writePart(part: Part, referenced: ReadonlySet<string>): MNXPart {
  return {
    ...(part.name !== undefined ? { name: part.name } : {}),
    // One staff is the default, so saying so adds nothing.
    ...(part.staves > 1 ? { staves: part.staves } : {}),
    measures: part.measures.map((measure) => writeMeasure(measure, referenced)),
  }
}

function writeMeasure(measure: Measure, referenced: ReadonlySet<string>): MNXPartMeasure {
  return {
    ...(measure.clefs.length > 0 ? { clefs: measure.clefs.map(writeClef) } : {}),
    ...(measure.beams.length > 0 ? { beams: measure.beams.map(writeBeam) } : {}),
    ...(measure.dynamics.length > 0 ? { dynamics: measure.dynamics.map(writeDynamic) } : {}),
    sequences: measure.sequences.map((sequence) => writeSequence(sequence, referenced)),
  }
}

function writeDynamic(dynamic: Dynamic): MNXDynamic {
  // Every dynamic converted so far is a mark that takes effect at once.
  return {
    position: writePosition(dynamic.position),
    type: 'immediate',
    value: dynamic.value,
    ...(dynamic.staff !== undefined ? { staff: dynamic.staff } : {}),
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
    clef: { sign: clef.sign, staffPosition: clef.staffPosition },
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
    ...(sequence.fullMeasure
      ? {
          fullMeasure: sequence.fullMeasure.visualDuration
            ? { visualDuration: writeNoteValue(sequence.fullMeasure.visualDuration) }
            : {},
        }
      : {}),
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
      }

    case 'grace':
      return {
        type: 'grace',
        content: item.content.map((event) => writeEvent(event, referenced)),
        ...(item.slashed ? { slash: true } : {}),
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
    // A rest is marked by the presence of an empty object, not by a flag.
    ...(event.isRest
      ? { rest: {} }
      : { notes: event.notes.map((note) => writeNote(note, referenced)) }),
    ...(event.slurs.length > 0
      ? {
          slurs: event.slurs.map((slur) => ({
            target: slur.target,
            ...(slur.side ? { side: slur.side } : {}),
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
    ...(note.ties.length > 0 ? { ties: note.ties.map((tie) => ({ target: tie.target })) } : {}),
    ...(note.accidentalDisplay
      ? { accidentalDisplay: writeAccidental(note.accidentalDisplay) }
      : {}),
  }
}

function writeAccidental(display: AccidentalDisplay): MNXAccidentalDisplay {
  return {
    show: display.show,
    ...(display.enclosure ? { enclosure: { symbol: display.enclosure } } : {}),
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
