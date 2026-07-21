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

/** Every pitch in the converted document, in document order. */
export function pitchesOf(document: MNXDocument): string[] {
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
  for (const part of document.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) walk(sequence.content)
    }
  }
  return found
}

/**
 * Every pitch in the source, read straight from the XML. Deliberately not
 * routed through the converter's reader: the point is to disagree with it
 * when it is wrong.
 */
export function sourcePitches(root: XmlElement): string[] {
  const found: string[] = []
  const walk = (element: XmlElement): void => {
    if (element.name === 'pitch') {
      const text = (name: string) =>
        element.children.find((c) => c.name === name)?.text.trim() ?? ''
      found.push(
        pitchKey({
          step: text('step'),
          octave: Number(text('octave')),
          alter: text('alter') === '' ? 0 : Number(text('alter')),
        }),
      )
      return
    }
    for (const child of element.children) walk(child)
  }
  walk(root)
  return found
}

/**
 * How long each measure of each part sounds in the source, counted in
 * divisions and reduced to whole notes. This follows MusicXML's cursor by
 * hand: notes advance it, chord notes and grace notes do not, and <backup>
 * and <forward> move it directly.
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
          Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0')

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
      lengths.push(furthest / (divisions * 4))
    }
    perPart.push(lengths)
  }
  return perPart
}
