// Writes the neutral score model out as an MNX document. Everything this
// converter knows about MNX's encoding lives at or above this file.
//
// Thin by design: the reader has already resolved MusicXML's ambiguities, so
// this is a walk with a few shape decisions. Optional keys are omitted rather
// than set to null, because MNX distinguishes an absent key from a present one.

import type {
  Clef,
  Event,
  GlobalMeasure,
  Measure,
  Note,
  NoteValue,
  Part,
  Pitch,
  Score,
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
  MNXSequence,
  MNXSequenceItem,
} from '../types/mnx.js'

/** The MNX version this converter emits. */
const MNX_VERSION = 1

export function writeMnx(score: Score): MNXDocument {
  return {
    mnx: { version: MNX_VERSION },
    global: { measures: score.globalMeasures.map(writeGlobalMeasure) },
    parts: score.parts.map(writePart),
  }
}

function writeGlobalMeasure(measure: GlobalMeasure): MNXGlobalMeasure {
  return {
    ...(measure.number !== undefined ? { number: measure.number } : {}),
    ...(measure.key ? { key: { fifths: measure.key.fifths } } : {}),
    ...(measure.time ? { time: { count: measure.time.count, unit: measure.time.unit } } : {}),
  }
}

function writePart(part: Part): MNXPart {
  return {
    ...(part.name !== undefined ? { name: part.name } : {}),
    measures: part.measures.map(writeMeasure),
  }
}

function writeMeasure(measure: Measure): MNXPartMeasure {
  return {
    ...(measure.clefs.length > 0 ? { clefs: measure.clefs.map(writeClef) } : {}),
    sequences: measure.sequences.map(writeSequence),
  }
}

function writeClef(clef: Clef): MNXPositionedClef {
  return { clef: { sign: clef.sign, staffPosition: clef.staffPosition } }
}

function writeSequence(sequence: Sequence): MNXSequence {
  return {
    ...(sequence.voice !== undefined ? { voice: sequence.voice } : {}),
    content: sequence.content.map(writeItem),
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

function writeItem(item: SequenceItem): MNXSequenceItem {
  // A space is time the voice passes over without sounding. MNX writes a
  // duration as a [numerator, denominator] pair.
  if (item.kind === 'space') {
    return { type: 'space', duration: [item.duration.num, item.duration.den] }
  }
  return writeEvent(item)
}

function writeEvent(event: Event): MNXEvent {
  return {
    duration: writeNoteValue(event.value),
    // A rest is marked by the presence of an empty object, not by a flag.
    ...(event.isRest ? { rest: {} } : { notes: event.notes.map(writeNote) }),
  }
}

function writeNoteValue(value: NoteValue): MNXNoteValue {
  return {
    base: value.base,
    ...(value.dots > 0 ? { dots: value.dots } : {}),
  }
}

function writeNote(note: Note): MNXNote {
  return { pitch: writePitch(note.pitch) }
}

function writePitch(pitch: Pitch): MNXPitch {
  return {
    step: pitch.step,
    octave: pitch.octave,
    // Zero is the default, so writing it would be noise.
    ...(pitch.alter !== 0 ? { alter: pitch.alter } : {}),
  }
}
