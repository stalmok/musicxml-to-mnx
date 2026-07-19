// Writes the neutral score model out as an MNX document. Everything this
// converter knows about MNX's encoding lives at or above this file.
//
// Thin by design: the reader has already resolved MusicXML's ambiguities, so
// this is a walk with a few shape decisions. Optional keys are omitted rather
// than set to null, because MNX distinguishes an absent key from a present one.

import type {
  Beam,
  Clef,
  Event,
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
} from '../types/mnx.js'

/** The MNX version this converter emits. */
const MNX_VERSION = 1

export function writeMnx(score: Score): MNXDocument {
  // Ids exist so that a tie or slur can point at something. Writing them on
  // everything else would be noise, so the targets are gathered first and
  // only those are named.
  const referenced = referencedIds(score)

  return {
    mnx: { version: MNX_VERSION },
    global: { measures: score.globalMeasures.map(writeGlobalMeasure) },
    parts: score.parts.map((part) => writePart(part, referenced)),
  }
}

function referencedIds(score: Score): ReadonlySet<string> {
  const targets = new Set<string>()
  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.kind === 'tuplet' || item.kind === 'grace') {
        walk(item.content)
        continue
      }
      if (item.kind !== 'event') continue
      for (const slur of item.slurs) targets.add(slur.target)
      for (const note of item.notes) {
        for (const tie of note.ties) targets.add(tie.target)
      }
    }
  }
  // A beam names the events it runs over, so those events have to be named
  // in turn.
  const fromBeams = (beams: readonly Beam[]): void => {
    for (const beam of beams) {
      for (const id of beam.events) targets.add(id)
      fromBeams(beam.beams)
    }
  }

  for (const part of score.parts) {
    for (const measure of part.measures) {
      fromBeams(measure.beams)
      for (const sequence of measure.sequences) walk(sequence.content)
    }
  }
  return targets
}

function writeGlobalMeasure(measure: GlobalMeasure): MNXGlobalMeasure {
  return {
    ...(measure.number !== undefined ? { number: measure.number } : {}),
    ...(measure.key ? { key: { fifths: measure.key.fifths } } : {}),
    ...(measure.time ? { time: { count: measure.time.count, unit: measure.time.unit } } : {}),
  }
}

function writePart(part: Part, referenced: ReadonlySet<string>): MNXPart {
  return {
    ...(part.name !== undefined ? { name: part.name } : {}),
    measures: part.measures.map((measure) => writeMeasure(measure, referenced)),
  }
}

function writeMeasure(measure: Measure, referenced: ReadonlySet<string>): MNXPartMeasure {
  return {
    ...(measure.clefs.length > 0 ? { clefs: measure.clefs.map(writeClef) } : {}),
    ...(measure.beams.length > 0 ? { beams: measure.beams.map(writeBeam) } : {}),
    sequences: measure.sequences.map((sequence) => writeSequence(sequence, referenced)),
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
  return { clef: { sign: clef.sign, staffPosition: clef.staffPosition } }
}

function writeSequence(sequence: Sequence, referenced: ReadonlySet<string>): MNXSequence {
  return {
    ...(sequence.voice !== undefined ? { voice: sequence.voice } : {}),
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
  }
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
