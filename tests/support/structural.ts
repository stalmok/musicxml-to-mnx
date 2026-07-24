// The source-independent structural checks: what the music is, read once from
// the converter's MNX output and once from the MusicXML source, so the two
// can be held against each other. Nothing here goes through the converter's
// own reader, which is the point: it has to be able to disagree with it.
//
// Shared by the vendored corpus test and the full-corpus gate, so both hold
// the output to the same equivalence.

import type { MNXDocument, MNXNoteValue, MNXSequenceItem } from '../../src/index.js'
import type { XmlElement } from '../../src/xml/parse.js'

// How long a written note value lasts, as a fraction of a whole note. Kept
// separate from the converter's own arithmetic on purpose.
const BASE_LENGTHS: Record<string, number> = {
  maxima: 8,
  longa: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  '16th': 1 / 16,
  '32nd': 1 / 32,
  '64th': 1 / 64,
  '128th': 1 / 128,
  '256th': 1 / 256,
  '512th': 1 / 512,
  '1024th': 1 / 1024,
}

export function writtenLength(value: MNXNoteValue): number {
  const base = BASE_LENGTHS[value.base]
  if (base === undefined) throw new Error(`Unknown note value base: ${value.base}`)
  return base * (2 - 2 ** -(value.dots ?? 0))
}

/** How much of the measure an item occupies, which is not what it is written as. */
export function sounding(item: MNXSequenceItem): number {
  if ('type' in item && item.type === 'space') return item.duration[0] / item.duration[1]
  // A grace note is squeezed in and takes no time.
  if ('type' in item && item.type === 'grace') return 0
  if ('type' in item && item.type === 'tuplet') {
    // Scaled by the ratio rather than assumed full, so a tuplet the source
    // only partly fills is still measured correctly.
    const written = item.content.reduce((total, inner) => total + sounding(inner), 0)
    const outer = writtenLength(item.outer.duration) * item.outer.multiple
    const inner = writtenLength(item.inner.duration) * item.inner.multiple
    return (written * outer) / inner
  }
  return writtenLength((item as { duration: MNXNoteValue }).duration)
}

/**
 * Where each event of a sequence begins, as a fraction of a whole note from
 * the start of the measure. Walks into tuplets and grace groups, because an
 * event inside one begins at a place of its own, and `scale` carries the
 * tuplet's ratio down so the events inside it land where they sound.
 */
export function collectStarts(
  items: readonly MNXSequenceItem[],
  at: number,
  scale: number,
  into: Set<string>,
): number {
  for (const item of items) {
    if ('type' in item && item.type === 'tuplet') {
      const outer = writtenLength(item.outer.duration) * item.outer.multiple
      const inner = writtenLength(item.inner.duration) * item.inner.multiple
      at = collectStarts(item.content, at, (scale * outer) / inner, into)
      continue
    }
    // A grace note is squeezed in beside the event it ornaments and takes
    // none of its time, so it begins where that event does.
    if ('type' in item && item.type === 'grace') {
      into.add(at.toFixed(9))
      continue
    }
    if ('type' in item && item.type === 'space') {
      at += (item.duration[0] / item.duration[1]) * scale
      continue
    }
    into.add(at.toFixed(9))
    at += writtenLength(item.duration) * scale
  }
  return at
}

interface Pitch {
  step: string
  octave: number
  alter: number
}

function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${String(pitch.octave)}${pitch.alter === 0 ? '' : `(${String(pitch.alter)})`}`
}

/** One line per part and measure: each voice's pitches in order, the voices
 * sorted. The voices sort because the source interleaves a measure's voices
 * through its cursor while MNX states each on its own, so their order is the
 * one thing the two sides may legitimately disagree on. A lost, changed, or
 * reordered pitch within a voice still shows. */
function measureLine(part: number, measure: number, voices: readonly string[]): string {
  const sounded = voices.filter((voice) => voice !== '')
  return `part ${String(part + 1)} measure ${String(measure + 1)}: ${sounded.sort().join(' | ')}`
}

/** Every pitch in the converted document, one line per part and measure. */
export function pitchesOf(document: MNXDocument): string[] {
  const lines: string[] = []
  document.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      const voices = measure.sequences.map((sequence) => {
        const found: string[] = []
        const walk = (items: readonly MNXSequenceItem[]): void => {
          for (const item of items) {
            if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
              walk(item.content)
              continue
            }
            if ('notes' in item && item.notes) {
              for (const note of item.notes) {
                found.push(pitchKey({ ...note.pitch, alter: note.pitch.alter ?? 0 }))
              }
            }
          }
        }
        walk(sequence.content)
        return found.join(' ')
      })
      lines.push(measureLine(partIndex, measureIndex, voices))
    })
  })
  return lines
}

/**
 * Every pitch in the source, one line per part and measure, read straight
 * from the XML. Deliberately not routed through the converter's reader: the
 * point is to disagree with it when it is wrong.
 */
export function sourcePitches(root: XmlElement): string[] {
  const lines: string[] = []
  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          // Grouped by voice in document order, which within one voice is the
          // order the music has.
          const byVoice = new Map<string, string[]>()
          for (const note of measure.children.filter((c) => c.name === 'note')) {
            const pitch = note.children.find((c) => c.name === 'pitch')
            if (!pitch) continue
            const text = (name: string) =>
              pitch.children.find((c) => c.name === name)?.text.trim() ?? ''
            const voice = note.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
            const list = byVoice.get(voice) ?? []
            list.push(
              pitchKey({
                step: text('step'),
                octave: Number(text('octave')),
                alter: text('alter') === '' ? 0 : Number(text('alter')),
              }),
            )
            byVoice.set(voice, list)
          }
          lines.push(
            measureLine(
              partIndex,
              measureIndex,
              [...byVoice.values()].map((v) => v.join(' ')),
            ),
          )
        })
    })
  return lines
}

/**
 * How long each measure of each part sounds in the source, in whole notes.
 * This follows MusicXML's cursor by hand: notes advance it, chord notes and
 * grace notes do not, and <backup> and <forward> move it directly. Each
 * duration is reduced to whole notes at the divisions in force where it
 * occurs, because <divisions> can change in the middle of a measure.
 */
export function sourceMeasureLengths(root: XmlElement): number[][] {
  const perPart: number[][] = []

  for (const part of root.children.filter((c) => c.name === 'part')) {
    const lengths: number[] = []
    let divisions = 1

    for (const measure of part.children.filter((c) => c.name === 'measure')) {
      let position = 0
      let furthest = 0

      for (const item of measure.children) {
        const durationOf = () =>
          Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0') /
          (divisions * 4)

        if (item.name === 'attributes') {
          const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
          if (stated) divisions = Number(stated)
        } else if (item.name === 'backup') {
          position -= durationOf()
        } else if (item.name === 'forward') {
          position += durationOf()
        } else if (item.name === 'note') {
          const isChord = item.children.some((c) => c.name === 'chord')
          const isGrace = item.children.some((c) => c.name === 'grace')
          if (!isChord && !isGrace) position += durationOf()
        }
        furthest = Math.max(furthest, position)
      }
      lengths.push(furthest)
    }
    perPart.push(lengths)
  }
  return perPart
}
