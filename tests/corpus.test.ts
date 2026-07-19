// Real songs, converted on every run.
//
// This is the gate that has actually found things. The unit tests exercise
// one construct at a time, and every defect that reached them lived in a
// combination: a chord member inside a tuplet, a grace note in the cursor's
// path, a note carrying two <notations> blocks. Published music is full of
// those, and none of them appears in a hand-written fixture unless you
// already know to write it.
//
// Four checks, in increasing order of how much they can tell you:
//   1. it converts at all
//   2. the output is legal MNX
//   3. the arithmetic works out, measure by measure
//   4. the notes and the time still match the source
//
// The fourth is the strongest, because it reads the source independently of
// the converter's own reading of it. The other three can all pass on output
// that says the wrong thing about the music.

import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertMusicXML } from '../src/index.js'
import type { MNXDocument, MNXNoteValue, MNXSequenceItem } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import baseline from './corpus/warning-baseline.json' with { type: 'json' }

const corpusDir = fileURLToPath(new URL('./corpus', import.meta.url))

const songs = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.musicxml'))
  .map((name) => ({ name: name.replace('.musicxml', ''), path: join(corpusDir, name) }))

test('there are songs to convert', () => {
  expect(songs.length).toBeGreaterThan(0)
})

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

function writtenLength(value: MNXNoteValue): number {
  const base = BASE_LENGTHS[value.base]
  if (base === undefined) throw new Error(`Unknown note value base: ${value.base}`)
  return base * (2 - 2 ** -(value.dots ?? 0))
}

/** How much of the measure an item occupies, which is not what it is written as. */
function sounding(item: MNXSequenceItem): number {
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

interface Pitch {
  step: string
  octave: number
  alter: number
}

function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${String(pitch.octave)}${pitch.alter === 0 ? '' : `(${String(pitch.alter)})`}`
}

/** Every pitch in the converted document, in document order. */
function pitchesOf(document: MNXDocument): string[] {
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
function sourcePitches(root: XmlElement): string[] {
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
function sourceMeasureLengths(root: XmlElement): number[][] {
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

describe.each(songs)('$name', ({ path }) => {
  const source = readFileSync(path, 'utf8')

  test('converts without rejecting the file', () => {
    expect(() => convertMusicXML(source)).not.toThrow()
  })

  test('produces MNX the spec schema accepts', () => {
    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })

  // A voice may legitimately stop before the barline, so being short is fine.
  // Running past it is not: it means time was invented.
  test('never writes a voice past the end of its measure', () => {
    const { mnx } = convertMusicXML(source)
    const overfull: string[] = []
    let time = { count: 4, unit: 4 }

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        time = mnx.global.measures[index]?.time ?? time
        const barLength = time.count / time.unit

        measure.sequences.forEach((sequence, voice) => {
          if (sequence.fullMeasure) return
          const total = sequence.content.reduce((sum, item) => sum + sounding(item), 0)
          if (total > barLength + 1e-9) {
            overfull.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)} voice ` +
                `${String(voice + 1)}: ${String(total)} against a bar of ${String(barLength)}`,
            )
          }
        })
      })
    })

    expect(overfull).toEqual([])
  })

  test('keeps every pitch the source wrote, in order', () => {
    const { mnx } = convertMusicXML(source)

    expect(pitchesOf(mnx)).toEqual(sourcePitches(parseXmlRoot(source)))
  })

  test('sounds for as long as the source does, measure by measure', () => {
    const { mnx } = convertMusicXML(source)
    const expected = sourceMeasureLengths(parseXmlRoot(source))
    const disagreements: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        // A full-measure rest states no length of its own: the time signature
        // does, and this check is about what the converter carried over.
        if (measure.sequences.some((sequence) => sequence.fullMeasure)) return

        const converted = Math.max(
          0,
          ...measure.sequences.map((sequence) =>
            sequence.content.reduce((sum, item) => sum + sounding(item), 0),
          ),
        )
        const inSource = expected[partIndex]?.[index] ?? 0
        if (Math.abs(converted - inSource) > 1e-9) {
          disagreements.push(
            `part ${String(partIndex + 1)} measure ${String(index + 1)}: ` +
              `converted ${String(converted)} against ${String(inSource)} in the source`,
          )
        }
      })
    })

    expect(disagreements.slice(0, 5)).toEqual([])
  })

  // Losses may only shrink. A rise means something stopped being converted
  // that used to be; a fall means the baseline is due an update.
  test('loses no more than the recorded baseline', () => {
    const { warnings } = convertMusicXML(source)
    const counts: Record<string, number> = {}
    for (const warning of warnings) {
      const element = /<([a-z-]+)>/.exec(warning.message)?.[1] ?? warning.code
      counts[element] = (counts[element] ?? 0) + 1
    }

    const recorded = (baseline as Record<string, Record<string, number>>)[
      path.split('/').at(-1)?.replace('.musicxml', '') ?? ''
    ]
    expect(recorded).toBeDefined()

    const risen = Object.entries(counts).filter(
      ([element, count]) => count > (recorded?.[element] ?? 0),
    )
    expect(risen).toEqual([])
  })
})
